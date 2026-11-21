import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const databaseName = /^recipe_inventory_test_[a-z0-9_]+$/;

export function validatedAdminUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { /* Report the contract without echoing the value. */ }
  assert.ok(url?.protocol === "postgres:" && url.hostname === "127.0.0.1" && url.port
    && Number(url.port) > 0 && url.pathname === "/postgres" && url.username && url.password && !/[?#]/.test(url.href),
  "RECIPE_INVENTORY_LOCAL_PG_ADMIN_URL requires an explicit local test username and password, a loopback port, and /postgres without query or fragment delimiters");
  return url;
}

function client(url, label) {
  return postgres(url.href, { max: 1, ssl: false, connect_timeout: 5, onnotice: () => {},
    connection: { application_name: `recipe-inventory-proof-${label}`, statement_timeout: 12000, lock_timeout: 8000 } });
}

export async function withDatabase(body) {
  const adminUrl = validatedAdminUrl(process.env.RECIPE_INVENTORY_LOCAL_PG_ADMIN_URL);
  const name = `recipe_inventory_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, databaseName);
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  const admin = client(adminUrl, "admin");
  const connections = [];
  let created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const [setup, first, second, observe] = ["setup", "first", "second", "observe"].map(label => {
      const sql = client(url, label); connections.push(sql); return sql;
    });
    const db = drizzle(setup);
    await migrate(db, { migrationsFolder: path.join(root, "drizzle") });
    const [{ pid: firstPid }] = await first`SELECT pg_backend_pid() AS pid`;
    const [{ pid: secondPid }] = await second`SELECT pg_backend_pid() AS pid`;
    assert.notEqual(firstPid, secondPid);
    await body({ url, db, setup, observe, firstPid, secondPid, firstDb: drizzle(first), secondDb: drizzle(second) });
  } finally {
    try {
      await Promise.all(connections.map(connection => connection.end({ timeout: 2 })));
    } finally {
      try {
        if (created) await admin.unsafe(`DROP DATABASE "${name}"`);
      } finally { await admin.end({ timeout: 2 }); }
    }
  }
}

// The application uses TypeScript path aliases. Compile its real modules into
// a temporary directory for node:test. A control can change only generated JS.
export async function applicationModules(transform = (_source, code) => code) {
  const directory = await mkdtemp(path.join(tmpdir(), "recipe-inventory-proof-"));
  const compiled = new Map();
  async function compile(relative) {
    if (compiled.has(relative)) return compiled.get(relative);
    const output = path.join(directory, relative.replace(/\.ts$/, ".mjs"));
    compiled.set(relative, output);
    const source = await readFile(path.join(root, relative), "utf8");
    let code = transform(relative, ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, esModuleInterop: true,
    } }).outputText);
    for (const { fileName: specifier } of ts.preProcessFile(code).importedFiles) {
      const resolved = specifier.startsWith("@/") ? `src/${specifier.slice(2)}`
        : specifier.startsWith("@tests/") ? `tests/${specifier.slice(7)}`
          : specifier.startsWith(".") ? path.join(path.dirname(relative), specifier) : null;
      const target = resolved ? pathToFileURL(await compile(`${resolved}.ts`)).href : import.meta.resolve(specifier);
      code = code.replaceAll(`"${specifier}"`, JSON.stringify(target)).replaceAll(`'${specifier}'`, JSON.stringify(target));
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, code);
    return output;
  }
  return { load: async relative => import(pathToFileURL(await compile(relative)).href),
    close: () => rm(directory, { recursive: true, force: true }) };
}

function deferred() {
  let resolve;
  const promise = new Promise(callback => { resolve = callback; });
  return { promise, resolve };
}

const outcome = promise => promise.then(value => ({ value }), error => ({ error }));

// Pause after the real command, before its SQL COMMIT. The other command must
// be seen waiting on its PID; then both outcomes and persisted state are tested.
export async function ordered(h, label, winner, contender, beforeRelease = async () => {}) {
  const entered = deferred(), release = deferred();
  const heldDb = new Proxy(h.firstDb, { get(target, key) {
    if (key === "transaction") return (body, options) => target.transaction(async tx => {
      const value = await body(tx);
      entered.resolve();
      await release.promise;
      return value;
    }, options);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const first = outcome(winner(heldDb));
  let second;
  try {
    await Promise.race([entered.promise, first.then(({ error }) => { if (error) throw error; })]);
    let settled = false;
    second = outcome(contender(h.secondDb)).then(result => { settled = true; return result; });
    const deadline = Date.now() + 5000;
    while (true) {
      const [{ blockers }] = await h.observe`SELECT pg_blocking_pids(${h.secondPid}) AS blockers`;
      if (blockers.includes(h.firstPid)) break;
      assert.equal(settled, false, `${label}: contender completed before PostgreSQL lock barrier`);
      assert.ok(Date.now() < deadline, `${label}: expected PostgreSQL lock wait was not observed`);
      await setImmediate();
    }
    console.log(`LOCK_BARRIER ${label} waiting=${h.secondPid} holding=${h.firstPid}`);
    await beforeRelease();
    release.resolve();
    const [won, lost] = await Promise.all([first, second]);
    assert.ifError(won.error);
    return [won.value, lost];
  } finally { release.resolve(); await first; if (second) await second; }
}
