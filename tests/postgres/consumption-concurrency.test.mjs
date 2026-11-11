import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableConfig } from "drizzle-orm/pg-core";
import postgres from "postgres";
import ts from "typescript";

// Only this explicit disposable local target is accepted, before any connection.
function localAdminUrl() {
  const raw = process.env.CONSUMPTION_LOCAL_PG_ADMIN_URL;
  assert.ok(raw, "CONSUMPTION_LOCAL_PG_ADMIN_URL must name an isolated local PostgreSQL instance");
  let url;
  try { url = new URL(raw); } catch { throw new Error("CONSUMPTION_LOCAL_PG_ADMIN_URL must be a valid isolated local URL"); }
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port && Number(url.port) > 0, "an explicit loopback port is required");
  assert.equal(url.pathname, "/postgres");
  assert.equal(url.search, "", "connection overrides are not allowed");
  return url;
}
const adminUrl = localAdminUrl();
const root = fileURLToPath(new URL("../../", import.meta.url));
const generated = await mkdtemp(path.join(tmpdir(), "dayoffdough-consumption-modules-"));
after(() => rm(generated, { recursive: true, force: true }));
const compiled = new Map();
// Compile the actual application and existing fixture modules, never duplicate
// command logic. Only generated JS is written here; no source/dependency changes.
async function loadModule(relative) {
  async function compile(source) {
    if (compiled.has(source)) return compiled.get(source);
    const output = path.join(generated, path.relative(root, source)).replace(/\.ts$/, ".mjs");
    compiled.set(source, output);
    const input = await readFile(source, "utf8");
    let code = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, esModuleInterop: true } }).outputText;
    for (const { fileName: specifier } of ts.preProcessFile(code).importedFiles) {
      let resolved;
      if (specifier.startsWith("@/")) resolved = path.join(root, "src", specifier.slice(2));
      else if (specifier.startsWith("@tests/")) resolved = path.join(root, "tests", specifier.slice(7));
      else if (specifier.startsWith(".")) resolved = path.resolve(path.dirname(source), specifier);
      const target = resolved ? pathToFileURL(await compile(`${resolved}.ts`)).href : import.meta.resolve(specifier);
      code = code.replaceAll(`"${specifier}"`, JSON.stringify(target)).replaceAll(`'${specifier}'`, JSON.stringify(target));
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, code);
    return output;
  }
  return import(pathToFileURL(await compile(path.join(root, relative))).href);
}
const fixture = await loadModule("tests/fixtures/consumption.ts");
const { OWNER_ID } = await loadModule("tests/fixtures/owner.ts");
const { createConsumptionCommandService: consumption } = await loadModule("src/modules/consumption/application/consumption-commands.ts");
const { createCycleOperationsCommandService: operations } = await loadModule("src/modules/operations/application/cycle-commands.ts");
const { readStockLedger } = await loadModule("src/modules/inventory/application/stock-ledger.ts");
const { createInventoryService: inventory } = await loadModule("src/modules/inventory/application/inventory.ts");
const { createShoppingCommandService: shopping } = await loadModule("src/modules/shopping/application/shopping-commands.ts");
const { createPlanningCommandService: planning } = await loadModule("src/modules/planning/application/planning-commands.ts");
const { createPlanningQueryService: planningQueries } = await loadModule("src/modules/planning/application/planning-queries.ts");
const { seedLockedPlanningScenario } = await loadModule("tests/fixtures/planning.ts");
const { writeConsumptionOperation } = await loadModule("src/modules/consumption/application/command-support.ts");
const applicationSchema = await loadModule("src/lib/db/schema.ts");
const consumptionTables = ["consumption_operations", "consumption_revision_items", "consumption_revisions", "cycle_consumption_contexts", "cycle_consumption_items", "inventory_ledger_states"];

async function catalog(connection) {
  const snapshot = JSON.parse(await readFile(path.join(root, "drizzle/meta/0014_snapshot.json"), "utf8"));
  const journal = JSON.parse(await readFile(path.join(root, "drizzle/meta/_journal.json"), "utf8"));
  assert.equal(journal.entries.at(-1).tag, "0014_phase_5a_consumption");
  const tables = [applicationSchema.consumptionOperations, applicationSchema.consumptionRevisionItems,
    applicationSchema.consumptionRevisions, applicationSchema.cycleConsumptionContexts,
    applicationSchema.cycleConsumptionItems, applicationSchema.inventoryLedgerStates];
  const normalizeType = type => type.replaceAll("character varying", "varchar").replaceAll("timestamp with time zone", "timestamptz").replaceAll("timestamp without time zone", "timestamp").replaceAll(/\s/g, "");
  for (const table of tables) {
    const config = getTableConfig(table);
    const actual = await connection`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS "notNull"
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=${config.name} AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`;
    const clean = columns => columns.map(column => ({ name: column.name, type: normalizeType(column.type), notNull: column.notNull })).sort((a,b) => a.name.localeCompare(b.name));
    assert.deepEqual(clean(actual), clean(config.columns.map(column => ({ name: column.name, type: column.getSQLType(), notNull: column.notNull }))));
    assert.deepEqual(clean(actual), clean(Object.values(snapshot.tables[`public.${config.name}`].columns)));
    const actualKeys = await connection`SELECT k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k
      JOIN pg_class c ON c.oid=k.conrelid WHERE c.relname=${config.name} AND k.contype='f' ORDER BY k.conname`;
    assert.deepEqual(actualKeys.map(key => key.conname), config.foreignKeys.map(key => key.getName()).sort());
    assert.deepEqual(actualKeys.map(key => key.conname), Object.keys(snapshot.tables[`public.${config.name}`].foreignKeys).sort());
    for (const key of config.foreignKeys) {
      const reference = key.reference();
      const columns = reference.columns.map(column => column.name);
      const foreignColumns = reference.foreignColumns.map(column => column.name);
      const foreignTable = getTableConfig(reference.foreignTable).name;
      const definition = `FOREIGN KEY (${columns.join(", ")}) REFERENCES ${foreignTable}(${foreignColumns.join(", ")}) ON DELETE RESTRICT`;
      assert.ok(actualKeys.find(actualKey => actualKey.conname === key.getName()).definition.startsWith(definition));
      const snapshotKey = snapshot.tables[`public.${config.name}`].foreignKeys[key.getName()];
      assert.deepEqual(snapshotKey.columnsFrom, columns);
      assert.deepEqual(snapshotKey.columnsTo, foreignColumns);
      assert.equal(snapshotKey.tableTo, foreignTable);
      assert.equal(snapshotKey.onDelete, "restrict");
    }
  }
  const rls = await connection`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ${connection(consumptionTables)} ORDER BY relname`;
  assert.deepEqual([...rls], consumptionTables.map(relname => ({ relname, relrowsecurity: true })));
  assert.equal((await connection`SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ${connection(consumptionTables)}`).length, 0);
  const keys = await connection`SELECT conname, confdeltype, condeferrable, condeferred, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE contype='f' AND conrelid IN (SELECT oid FROM pg_class WHERE relname IN ${connection(consumptionTables)}) ORDER BY conname`;
  assert.equal(keys.length, 17);
  for (const key of keys) { assert.equal(key.confdeltype, "r"); assert.match(key.definition, /FOREIGN KEY \(owner_id,/); }
  for (const name of ["consumption_revision_items_movement_fk", "consumption_revision_items_settlement_count_fk"]) {
    assert.equal(keys.find(key => key.conname === name)?.condeferred, true);
  }
  const triggers = await connection`SELECT c.relname, t.tgname, t.tgdeferrable, t.tginitdeferred FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE NOT t.tgisinternal AND (c.relname IN ${connection(consumptionTables)} OR c.relname IN ('bake_cycles','inventory_movements')) ORDER BY c.relname,t.tgname`;
  assert.ok(triggers.some(trigger => trigger.tgdeferrable && trigger.tginitdeferred));
  console.log(`CATALOG tables=${rls.length} ownedRestrictFKs=${keys.length} applicationSchema+snapshot=match policies=0`);
  return { keys: [...keys], triggers: [...triggers] };
}

test("fresh and through-0013 upgrade preserve legacy history and install identical final catalog", { timeout: 60000 }, async () => {
  let fresh;
  await database(async h => { fresh = await catalog(h.observer); });
  await database(async h => {
    const item = randomUUID(), cycle = randomUUID(), snapshot = randomUUID();
    await h.setup`INSERT INTO inventory_items (id,owner_id,name,category,base_unit,purchase_unit_label,base_quantity_per_purchase_pack)
      VALUES (${item},${OWNER_ID},'Legacy flour','INGREDIENT','g','bag',1000)`;
    await h.setup`INSERT INTO inventory_movements (owner_id,inventory_item_id,type,quantity_delta_in_base_unit,counted_quantity_in_base_unit,occurred_at)
      VALUES (${OWNER_ID},${item},'COUNT',8,8,'2026-10-23'),(${OWNER_ID},${item},'PURCHASE',2,NULL,'2026-10-23'),(${OWNER_ID},${item},'COUNT',-15,0,'2000-01-01')`;
    for (const status of ["DRAFT","OPEN","LOCKED","IN_PRODUCTION","COMPLETED","CANCELLED"]) await h.setup`
      INSERT INTO bake_cycles (id,owner_id,name,status,target_production_date,primary_delivery_date)
      VALUES (${status === "LOCKED" ? cycle : randomUUID()},${OWNER_ID},${status},${status},'2026-10-24','2026-10-25')`;
    await h.setup`INSERT INTO cycle_planning_snapshots (id,owner_id,bake_cycle_id,generation,status,lock_request_id,input_fingerprint,cycle_number,cycle_name,target_production_date,primary_delivery_date,labor_rate_satang_per_hour,default_waste_allowance_percent,timezone,currency,cost_complete,locked_at)
      VALUES (${snapshot},${OWNER_ID},${cycle},1,'ACTIVE',${randomUUID()},${"a".repeat(64)},1,'Legacy plan','2026-10-24','2026-10-25',0,0,'Asia/Bangkok','THB',true,now())`;
    const movements = [...await h.observer`SELECT * FROM inventory_movements ORDER BY id`];
    const snapshots = [...await h.observer`SELECT * FROM cycle_planning_snapshots ORDER BY id`];
    await migrate(h.setup, 14);
    assert.deepEqual([...await h.observer`SELECT * FROM inventory_movements ORDER BY id`], movements);
    assert.deepEqual([...await h.observer`SELECT * FROM cycle_planning_snapshots ORDER BY id`], snapshots);
    const [sum] = await h.observer`SELECT trim_scale(sum(quantity_delta_in_base_unit))::text AS balance FROM inventory_movements`;
    assert.equal(sum.balance, "-5"); // Legacy anomaly preserved, never silently repaired/backfilled.
    assert.deepEqual([...await h.observer`SELECT consumption_policy FROM bake_cycles ORDER BY name`], Array(6).fill({ consumption_policy: "LEGACY" }));
    assert.deepEqual([...await h.observer`SELECT ledger_revision::text AS revision,latest_count_movement_id AS fence FROM inventory_ledger_states`], [{ revision: "0", fence: null }]);
    assert.deepEqual(await state(h), { operations: 0, revisions: 0, movements: 0, pointers: 0 });
    const [newCycle] = await h.setup`INSERT INTO bake_cycles (owner_id,name,target_production_date,primary_delivery_date)
      VALUES (${OWNER_ID},'Post cutover','2026-10-24','2026-10-25') RETURNING consumption_policy`;
    assert.equal(newCycle.consumption_policy, "CONSUMPTION_V1");
    assert.deepEqual(await catalog(h.observer), fresh);
    console.log("UPGRADE legacyMovements=unchanged legacyBalance=-5 fingerprints=unchanged legacyPolicies=6 baseline=0/null newPolicy=CONSUMPTION_V1");
  }, { upgrade: true });
});

test("real PostgreSQL rejects owned-FK, fake-settlement, history, metadata and pointer bypasses atomically", { timeout: 60000 }, async () => database(async h => {
  const s = await scenario(h);
  const before = [...await h.observer`SELECT * FROM inventory_ledger_states ORDER BY inventory_item_id`];
  const preparedFixture = await fixture.prepareConsumptionFixture(h.db, OWNER_ID, s.cycleId);
  // A fabricated SETTLE link on a CONFIRM cannot grant COUNT authority.
  const bad = { ...preparedFixture.prepared, revisionItems: preparedFixture.prepared.revisionItems.map((item, index) => index ? item :
    { ...item, mode: "COUNT_SETTLED", quantityDelta: "0", settlementCountMovementId: randomUUID() }) };
  await assert.rejects(h.db.transaction(tx => writeConsumptionOperation(tx, OWNER_ID, bad, preparedFixture.confirmedAt)));
  await assert.rejects(h.setup`INSERT INTO inventory_movements (owner_id,inventory_item_id,type,quantity_delta_in_base_unit,counted_quantity_in_base_unit,reference_type,reference_id,occurred_at)
    VALUES (${OWNER_ID},${s.itemIds[0]},'COUNT',0,2200,'CONSUMPTION_OPERATION',${randomUUID()},now())`, /COUNT requires complete owned settlement authority/);
  assert.deepEqual(await state(h), { operations: 0, revisions: 0, movements: 0, pointers: 0 });
  assert.deepEqual([...await h.observer`SELECT * FROM inventory_ledger_states ORDER BY inventory_item_id`], before);
  const otherOwner = randomUUID(), foreignOperation = randomUUID();
  await assert.rejects(h.setup.begin(async tx => {
    await tx`INSERT INTO consumption_operations (id,owner_id,request_id,kind,manifest,revision_ids,count_movement_ids)
      VALUES (${foreignOperation},${otherOwner},${randomUUID()},'CONFIRM','{}','{}','{}')`;
    await tx`INSERT INTO consumption_revisions (owner_id,context_id,operation_id,revision_number)
      VALUES (${OWNER_ID},${s.input.contextId},${foreignOperation},1)`;
  }), error => error.code === "23503" && error.constraint_name === "consumption_revisions_operation_fk");
  assert.deepEqual(await state(h), { operations: 0, revisions: 0, movements: 0, pointers: 0 });
  const first = await consumption(h.db).confirmUse(OWNER_ID, s.input);
  const corrected = await consumption(h.db).correctUse(OWNER_ID, correction(s.input, first.revisionIds[0], await tokens(h.db, s.itemIds)));
  const snapshot = async () => ({ ledger: [...await h.observer`SELECT * FROM inventory_ledger_states ORDER BY inventory_item_id`],
    events: [...await h.observer`SELECT * FROM inventory_movements ORDER BY id`], state: await state(h),
    pointer: [...await h.observer`SELECT current_revision_id FROM cycle_consumption_contexts ORDER BY id`] });
  const committed = await snapshot();
  const attacks = [
    () => h.setup`UPDATE inventory_movements SET quantity_delta_in_base_unit=0 WHERE inventory_item_id=${s.itemIds[0]}`,
    () => h.setup`DELETE FROM inventory_movements WHERE inventory_item_id=${s.itemIds[0]}`,
    () => h.setup`UPDATE inventory_ledger_states SET ledger_revision=0,latest_count_movement_id=NULL WHERE inventory_item_id=${s.itemIds[0]}`,
    () => h.setup`DELETE FROM inventory_ledger_states WHERE inventory_item_id=${s.itemIds[0]}`,
    () => h.setup`UPDATE consumption_operations SET manifest='{}' WHERE id=${first.operationId}`,
    () => h.setup`DELETE FROM consumption_revisions WHERE id=${corrected.revisionIds[0]}`,
    () => h.setup`UPDATE cycle_consumption_items SET planned_quantity=0 WHERE context_id=${s.input.contextId}`,
    () => h.setup`UPDATE consumption_revision_items SET used_quantity=0 WHERE revision_id=${corrected.revisionIds[0]}`,
    () => h.setup`UPDATE cycle_consumption_contexts SET current_revision_id=${first.revisionIds[0]} WHERE id=${s.input.contextId}`,
    () => h.setup`UPDATE cycle_consumption_contexts SET current_revision_id=${randomUUID()} WHERE id=${s.input.contextId}`,
    () => h.setup`UPDATE cycle_consumption_contexts SET current_revision_id=NULL WHERE id=${s.input.contextId}`,
    () => h.setup`UPDATE bake_cycles SET consumption_policy='LEGACY' WHERE id=${s.cycleId}`,
    () => h.setup`INSERT INTO bake_cycles (owner_id,name,consumption_policy,target_production_date,primary_delivery_date) VALUES (${OWNER_ID},'Opt out','LEGACY','2026-10-24','2026-10-25')`,
    () => h.setup`INSERT INTO bake_cycles (owner_id,name,status,target_production_date,primary_delivery_date) VALUES (${OWNER_ID},'Bypass','IN_PRODUCTION','2026-10-24','2026-10-25')`,
    () => h.setup`INSERT INTO bake_cycles (owner_id,name,status,target_production_date,primary_delivery_date) VALUES (${OWNER_ID},'Bypass','COMPLETED','2026-10-24','2026-10-25')`,
    () => h.setup.begin(async tx => {
      await tx`INSERT INTO inventory_movements (owner_id,inventory_item_id,type,quantity_delta_in_base_unit,occurred_at) VALUES (${OWNER_ID},${s.itemIds[0]},'PURCHASE',1,now())`;
      await tx`SELECT 1/0`;
    }),
  ];
  for (const attack of attacks) { await assert.rejects(attack()); assert.deepEqual(await snapshot(), committed); }
  const [locked] = await h.setup`INSERT INTO bake_cycles (owner_id,name,status,target_production_date,primary_delivery_date)
    VALUES (${OWNER_ID},'No registered source','LOCKED','2026-10-24','2026-10-25') RETURNING id`;
  await assert.rejects(h.setup`UPDATE bake_cycles SET status='IN_PRODUCTION' WHERE id=${locked.id}`);
  assert.deepEqual(await snapshot(), committed);
  console.log(`INTEGRITY attacks=${attacks.length + 4} rejected atomic observer_state_unchanged`);
}));

function client(url, role) {
  return postgres(url.toString(), { max: 1, connect_timeout: 5, onnotice: () => {},
    connection: { application_name: `consumption-proof-${role}`, statement_timeout: 12000, lock_timeout: 8000 } });
}
async function migrate(connection, from = 0, to = 14) {
  const migrations = readMigrationFiles({ migrationsFolder: path.join(root, "drizzle") });
  assert.equal(migrations.length, 15);
  for (let index = from; index <= to; index++) await connection.begin(async tx => {
    for (const statement of migrations[index].sql) if (statement.trim()) await tx.unsafe(statement);
  });
}
async function database(body, { upgrade = false } = {}) {
  const name = `dayoffdough_consumption_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  const admin = client(adminUrl, "admin");
  const connections = [];
  let created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`); created = true;
    console.log(`OWNED_DATABASE ${name}`);
    const [setup, first, second, observer] = ["setup", "first", "second", "observer"].map(role => {
      const connection = client(url, role); connections.push(connection); return connection;
    });
    await migrate(setup, 0, upgrade ? 13 : 14);
    const [{ pid: firstPid }] = await first`SELECT pg_backend_pid() AS pid`;
    const [{ pid: secondPid }] = await second`SELECT pg_backend_pid() AS pid`;
    assert.notEqual(firstPid, secondPid);
    await body({ setup, first, second, observer, firstPid, secondPid,
      db: drizzle(setup), firstDb: drizzle(first), secondDb: drizzle(second) });
    // Check every committed revision has its exact membership and owned events,
    // not merely an operation count that could conceal partial child writes.
    const [integrity] = await observer`SELECT count(*)::int AS incomplete FROM consumption_revisions r
      WHERE (SELECT count(*) FROM consumption_revision_items i WHERE i.owner_id=r.owner_id AND i.revision_id=r.id)
        <> (SELECT count(*) FROM cycle_consumption_items s WHERE s.owner_id=r.owner_id AND s.context_id=r.context_id)
      OR EXISTS (SELECT 1 FROM consumption_revision_items i WHERE i.owner_id=r.owner_id AND i.revision_id=r.id
        AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.owner_id=i.owner_id AND m.inventory_item_id=i.inventory_item_id
          AND m.id=i.movement_id AND m.reference_type='CONSUMPTION_REVISION' AND m.reference_id=r.id))`;
    assert.equal(integrity.incomplete, 0);
    const negative = await observer`SELECT inventory_item_id FROM inventory_movements GROUP BY owner_id,inventory_item_id
      HAVING sum(quantity_delta_in_base_unit)<0 AND bool_or(reference_type='CONSUMPTION_REVISION')`;
    assert.equal(negative.length, 0);
    console.log("OBSERVER_COMMITTED_INTEGRITY incompleteRevisions=0 negativeConsumedItems=0");
  } finally {
    await Promise.allSettled(connections.map(async connection => {
      try { await connection`ROLLBACK`; } finally { await connection.end({ timeout: 2 }); }
    }));
    try {
      if (created) {
        await admin.unsafe(`DROP DATABASE "${name}"`);
        console.log(`DROPPED_DATABASE ${name}`);
      }
    } finally { await admin.end({ timeout: 2 }); }
  }
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function outcome(promise) { return promise.then(value => ({ value }), error => ({ error })); }
// Pause AFTER the actual command callback, BEFORE its real transaction COMMIT.
// The second independent connection executes the unmodified application command.
function holdCommit(db, holdError = false) {
  const entered = deferred(), release = deferred();
  const heldDb = new Proxy(db, { get(target, key) {
    if (key === "transaction") return callback => target.transaction(async tx => {
      try {
        const result = await callback(tx); entered.resolve(); await release.promise; return result;
      } catch (error) {
        if (holdError) { entered.resolve(); await release.promise; }
        throw error;
      }
    });
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  return { db: heldDb, entered, release };
}

async function ordered(h, firstCommand, secondCommand, { holdError = false, beforeRelease = async () => {} } = {}) {
  const held = holdCommit(h.firstDb, holdError);
  const first = outcome(firstCommand(held.db));
  let second;
  try {
    await Promise.race([held.entered.promise, first.then(r => { if (r.error) throw r.error; })]);
    await beforeRelease();
    second = outcome(secondCommand(h.secondDb));
    await blocked(h, h.secondPid, h.firstPid, second);
    held.release.resolve();
    return [await first, await second];
  } finally { held.release.resolve(); await first; if (second) await second; }
}
const countDate = new Date("2000-01-01T00:00:00Z"); // Applied identity, never chronological order.
function count(db, item, remaining = "25") { return inventory(db).recordCount(OWNER_ID, item, remaining, countDate); }
async function balance(h, ids) { return (await readStockLedger(drizzle(h.observer), OWNER_ID, ids)).map(row => row.balance); }
function correction(input, revisionId, expectedLedger) {
  return { cycleId: input.cycleId, planningSnapshotId: input.planningSnapshotId, contextId: input.contextId,
    requestId: randomUUID(), expectedRevisionId: revisionId, expectedLedger, reason: "Correct measured use",
    items: input.items.map((item, index) => ({ ...item, usedQuantity: index ? "5" : "2140" })) };
}

for (const countFirst of [false, true]) {
  test(`use/ordinary COUNT, ${countFirst ? "COUNT" : "use"} first`, { timeout: 60000 }, async () => database(async h => {
    const s = await scenario(h);
    const use = db => consumption(db).confirmUse(OWNER_ID, s.input);
    const physicalCount = db => count(db, s.itemIds[0]);
    const results = await ordered(h, countFirst ? physicalCount : use, countFirst ? use : physicalCount, {
      holdError: countFirst,
      beforeRelease: async () => assert.deepEqual(await state(h), { operations: 0, revisions: 0, movements: 0, pointers: 0 }),
    });
    const [useResult, countResult] = countFirst ? results.reverse() : results;
    assert.ifError(useResult.error);
    if (countFirst) assert.equal(countResult.error?.kind, "PENDING_USE");
    else assert.ifError(countResult.error);
    assert.deepEqual(await balance(h, s.itemIds), [countFirst ? "50" : "25", "8"]);
    assert.deepEqual(await state(h), { operations: 1, revisions: 1, movements: 2, pointers: 1 });
    if (!countFirst) {
      const corrected = await consumption(h.db).correctUse(OWNER_ID, correction(s.input, useResult.value.revisionIds[0], await tokens(h.db, s.itemIds)));
      const rows = await h.observer`SELECT mode, trim_scale(quantity_delta)::text AS delta FROM consumption_revision_items
        WHERE revision_id = ${corrected.revisionIds[0]} ORDER BY inventory_item_id`;
      assert.deepEqual([...rows], [{ mode: "HISTORY_ONLY", delta: "0" }, { mode: "DIRECT", delta: "1" }]);
      assert.deepEqual(await balance(h, s.itemIds), ["25", "9"]);
      await h.setup`UPDATE bake_cycles SET status = 'CANCELLED' WHERE id = ${s.cycleId}`;
      assert.deepEqual(await consumption(h.db).confirmUse(OWNER_ID, s.input), { ...useResult.value, replayed: true });
    }
  }));

  test(`correction/COUNT, ${countFirst ? "COUNT" : "correction"} first`, { timeout: 60000 }, async () => database(async h => {
    const s = await scenario(h);
    const initial = await consumption(h.db).confirmUse(OWNER_ID, s.input);
    const input = correction(s.input, initial.revisionIds[0], await tokens(h.db, s.itemIds));
    const correct = db => consumption(db).correctUse(OWNER_ID, input);
    const physicalCount = db => count(db, s.itemIds[0], "50"); // zero delta still changes fence
    const results = await ordered(h, countFirst ? physicalCount : correct, countFirst ? correct : physicalCount);
    const [corrected, counted] = countFirst ? results.reverse() : results;
    assert.ifError(counted.error);
    if (countFirst) {
      assert.equal(corrected.error?.kind, "STALE_DATA");
      assert.deepEqual(await state(h), { operations: 1, revisions: 1, movements: 2, pointers: 1 });
      const retry = await consumption(h.db).correctUse(OWNER_ID, { ...input, expectedLedger: await tokens(h.db, s.itemIds) });
      const [flour] = await h.observer`SELECT mode, trim_scale(quantity_delta)::text AS delta FROM consumption_revision_items
        WHERE revision_id = ${retry.revisionIds[0]} AND inventory_item_id = ${s.itemIds[0]}`;
      assert.deepEqual(flour, { mode: "HISTORY_ONLY", delta: "0" });
    } else assert.ifError(corrected.error);
    assert.deepEqual(await balance(h, s.itemIds), ["50", "9"]);
  }));

  test(`start pending-registration/COUNT, ${countFirst ? "COUNT" : "start"} first`, { timeout: 60000 }, async () => database(async h => {
    const s = await scenario(h, { start: false });
    const start = db => operations(db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    const physicalCount = db => count(db, s.itemIds[0]);
    const results = await ordered(h, countFirst ? physicalCount : start, countFirst ? start : physicalCount, {
      beforeRelease: async () => {
        const [row] = await h.observer`SELECT status, (SELECT count(*)::int FROM cycle_consumption_contexts) AS contexts FROM bake_cycles WHERE id = ${s.cycleId}`;
        assert.deepEqual(row, { status: "LOCKED", contexts: 0 });
      },
    });
    const [started, counted] = countFirst ? results.reverse() : results;
    assert.ifError(started.error);
    if (countFirst) assert.ifError(counted.error); else assert.equal(counted.error?.kind, "PENDING_USE");
    const [row] = await h.observer`SELECT status, (SELECT count(*)::int FROM cycle_consumption_contexts WHERE current_revision_id IS NULL) AS pending FROM bake_cycles WHERE id = ${s.cycleId}`;
    assert.deepEqual(row, { status: "IN_PRODUCTION", pending: 1 });
    assert.deepEqual(await balance(h, s.itemIds), [countFirst ? "25" : "2200", "14"]);
  }));
}

for (const purchaseFirst of [false, true]) {
  test(`purchase/use, ${purchaseFirst ? "purchase" : "use"} first`, { timeout: 60000 }, async () => database(async h => {
    const source = await seedLockedPlanningScenario(h.db);
    const itemIds = [source.ingredientItemId, source.packagingItemId];
    await shopping(h.db).confirmStock(OWNER_ID, { cycleId: source.cycleId, planningSnapshotId: source.planningSnapshotId,
      confirmationRequestId: randomUUID(), countedAt: new Date(), counts: itemIds.map((inventoryItemId, index) => ({ inventoryItemId, countedQuantity: index ? "14" : "2100" })) });
    await count(h.db, itemIds[0], "2200");
    await operations(h.db).startCycle(OWNER_ID, { cycleId: source.cycleId });
    const { input: useInput } = await fixture.prepareConsumptionFixture(h.db, OWNER_ID, source.cycleId);
    useInput.items = useInput.items.map((item, index) => ({ ...item, usedQuantity: index ? "6" : "2150", basis: "OWNER_REPORTED", reason: "Measured" }));
    const s = { ...source, itemIds, input: useInput };
    const [item] = await h.setup`SELECT id FROM cycle_shopping_items WHERE inventory_item_id = ${s.itemIds[0]} AND bake_cycle_id = ${s.cycleId}`;
    assert.ok(item);
    const input = { cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, shoppingItemId: item.id,
      purchaseRequestId: randomUUID(), packCount: 1, totalPriceSatang: 500, occurredAt: new Date() };
    const purchase = db => shopping(db).recordPurchase(OWNER_ID, input);
    const use = db => consumption(db).confirmUse(OWNER_ID, s.input);
    const results = await ordered(h, purchaseFirst ? purchase : use, purchaseFirst ? use : purchase);
    const [used, purchased] = purchaseFirst ? results.reverse() : results;
    assert.ifError(purchased.error);
    if (purchaseFirst) {
      assert.equal(used.error?.kind, "STALE_DATA");
      assert.deepEqual(await state(h), { operations: 0, revisions: 0, movements: 0, pointers: 0 });
      await consumption(h.db).confirmUse(OWNER_ID, { ...s.input, expectedLedger: await tokens(h.db, s.itemIds) });
    } else assert.ifError(used.error);
    assert.deepEqual(await balance(h, s.itemIds), ["1050", "8"]);
    const [purchases] = await h.observer`SELECT count(*)::int AS n FROM inventory_movements WHERE type = 'PURCHASE'`;
    assert.equal(purchases.n, 1);
  }));
}

// A second legitimate locked plan sharing both inventory items. Initial stock
// checks are completed before either source starts, as required in production.
async function relatedSources(h) {
  const first = await scenario(h, { start: false });
  const cycleId = randomUUID(), orderId = randomUUID();
  await h.setup`INSERT INTO bake_cycles (id, owner_id, name, status, target_production_date, primary_delivery_date)
    VALUES (${cycleId}, ${OWNER_ID}, 'Related production', 'OPEN', '2026-08-29', '2026-08-30')`;
  await h.setup`INSERT INTO orders (id, owner_id, bake_cycle_id, customer_id, confirmed_delivery_date, delivery_method_id, delivery_location, fulfillment_status)
    SELECT ${orderId}, owner_id, ${cycleId}, customer_id, confirmed_delivery_date, delivery_method_id, delivery_location, 'CONFIRMED'
    FROM orders WHERE bake_cycle_id = ${first.cycleId} AND fulfillment_status = 'CONFIRMED' ORDER BY id LIMIT 1`;
  await h.setup`INSERT INTO order_items (owner_id, order_id, product_id, quantity, unit_price_satang, position)
    SELECT owner_id, ${orderId}, product_id, 1, unit_price_satang, 0 FROM order_items WHERE order_id IN
    (SELECT id FROM orders WHERE bake_cycle_id = ${first.cycleId}) ORDER BY id LIMIT 1`;
  const preview = await planningQueries(h.db).preview(OWNER_ID, cycleId);
  assert.deepEqual(preview.blockers, []);
  await planning(h.db).lock(OWNER_ID, { cycleId, lockRequestId: randomUUID(), inputFingerprint: preview.inputFingerprint, overrides: [] });
  await fixture.confirmConsumptionStock(h.db, OWNER_ID, cycleId);
  await count(h.db, first.itemIds[0], "2200");
  await count(h.db, first.itemIds[1], "14");
  await operations(h.db).startCycle(OWNER_ID, { cycleId: first.cycleId });
  const { input } = await fixture.prepareConsumptionFixture(h.db, OWNER_ID, first.cycleId);
  input.items = input.items.map((item, index) => ({ ...item, usedQuantity: index ? "6" : "2150", basis: "OWNER_REPORTED", reason: "Measured" }));
  return { ...first, input, relatedCycleId: cycleId };
}
for (const startFirst of [false, true]) {
  test(`selective settlement/new related context, ${startFirst ? "start" : "settlement"} first`, { timeout: 60000 }, async () => database(async h => {
    const s = await relatedSources(h);
    const { cycleId, planningSnapshotId, contextId, items } = s.input;
    const intent = { requestId: randomUUID(), contexts: [{ cycleId, planningSnapshotId, contextId, items, confirmTakenOutOfUse: true }],
      counts: [{ inventoryItemId: s.itemIds[0], remainingQuantity: "25" }], expectedLedger: s.input.expectedLedger, reason: "Physical stock" };
    const settle = db => consumption(db).settleUse(OWNER_ID, intent);
    const start = db => operations(db).startCycle(OWNER_ID, { cycleId: s.relatedCycleId });
    const results = await ordered(h, startFirst ? start : settle, startFirst ? settle : start);
    const [settled, started] = startFirst ? results.reverse() : results;
    assert.ifError(started.error);
    if (startFirst) {
      assert.equal(settled.error?.kind, "STALE_DATA");
      assert.deepEqual(await state(h), { operations: 0, revisions: 0, movements: 0, pointers: 0 });
      assert.deepEqual(await balance(h, s.itemIds), ["2200", "14"]);
    } else {
      assert.ifError(settled.error);
      assert.deepEqual(await state(h), { operations: 1, revisions: 1, movements: 2, pointers: 1 });
      assert.deepEqual(await balance(h, s.itemIds), ["25", "8"]);
    }
    const [pending] = await h.observer`SELECT count(*)::int AS n FROM cycle_consumption_contexts WHERE current_revision_id IS NULL`;
    assert.equal(pending.n, startFirst ? 2 : 1);
  }));
}

test("opposite item orders across independent Cycles serialize without deadlock", { timeout: 60000 }, async () => database(async h => {
  const s = await relatedSources(h);
  await operations(h.db).startCycle(OWNER_ID, { cycleId: s.relatedCycleId });
  const { input } = await fixture.prepareConsumptionFixture(h.db, OWNER_ID, s.relatedCycleId);
  input.items = input.items.map(item => ({ ...item, usedQuantity: "1", basis: "OWNER_REPORTED", reason: "Measured" })).reverse();
  input.expectedLedger = [...input.expectedLedger].reverse();
  // Block the higher item so A demonstrably holds the lower item while still
  // acquiring its multi-item lock set. B's reversed input MUST wait on A's
  // lower item, not acquire higher-first; this catches an inverted item order.
  await h.setup`BEGIN`;
  const [{ pid: blockerPid }] = await h.setup`SELECT pg_backend_pid() AS pid`;
  await h.setup`SELECT id FROM inventory_items WHERE id=${s.itemIds[1]} FOR UPDATE`;
  let firstPending, secondPending;
  let first, second;
  try {
    firstPending = outcome(consumption(h.firstDb).confirmUse(OWNER_ID, s.input));
    await blocked(h, h.firstPid, blockerPid, firstPending);
    secondPending = outcome(consumption(h.secondDb).confirmUse(OWNER_ID, input));
    await blocked(h, h.secondPid, h.firstPid, secondPending);
    assert.deepEqual(await state(h), { operations: 0, revisions: 0, movements: 0, pointers: 0 });
    await h.setup`ROLLBACK`;
    first = await firstPending; second = await secondPending;
  } finally { await h.setup`ROLLBACK`; if (firstPending) await firstPending; if (secondPending) await secondPending; }
  assert.ifError(first.error); assert.equal(second.error?.kind, "STALE_DATA");
  await consumption(h.db).confirmUse(OWNER_ID, { ...input, expectedLedger: await tokens(h.db, s.itemIds) });
  assert.deepEqual(await balance(h, s.itemIds), ["49", "7"]);
  assert.deepEqual(await state(h), { operations: 2, revisions: 2, movements: 4, pointers: 2 });
}));

test("direct child-first movement mutation rejects 55P03 without inverted blocking", { timeout: 60000 }, async () => database(async h => {
  const s = await scenario(h);
  await h.first`BEGIN`;
  try {
    await h.first`SELECT id FROM inventory_items WHERE id = ${s.itemIds[0]} FOR UPDATE`;
    await h.second`BEGIN`;
    await h.second`SELECT inventory_item_id FROM inventory_ledger_states WHERE inventory_item_id = ${s.itemIds[0]} FOR UPDATE`;
    const before = await tokens(drizzle(h.observer), s.itemIds);
    const result = await outcome(h.second`INSERT INTO inventory_movements (owner_id, inventory_item_id, type, quantity_delta_in_base_unit, occurred_at)
      VALUES (${OWNER_ID}, ${s.itemIds[0]}, 'PURCHASE', 1, now())`);
    assert.equal(result.error?.code, "55P03");
    assert.deepEqual(await tokens(drizzle(h.observer), s.itemIds), before);
    const [wait] = await h.observer`SELECT pg_blocking_pids(${h.secondPid}) AS blockers`;
    assert.deepEqual(wait.blockers, []);
    console.log("OBSERVER_CHILD_FIRST rejected=55P03 no_wait metadata_unchanged");
  } finally { await h.second`ROLLBACK`; await h.first`ROLLBACK`; }
}));
async function blocked(h, waitingPid, holdingPid, pending) {
  let settled = false; void pending.then(() => { settled = true; });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await h.observer`SELECT pg_blocking_pids(${waitingPid}) AS blockers`;
    if (row.blockers.includes(holdingPid)) {
      console.log(`OBSERVER_BLOCKED waiting=${waitingPid} holding=${holdingPid}`); return;
    }
    assert.equal(settled, false, "contender completed before the required lock barrier");
    await setImmediate(); // yield only; pg_blocking_pids, not elapsed time, proves order
  }
  assert.fail("required PostgreSQL lock wait was not observed");
}
async function tokens(db, itemIds) {
  return (await readStockLedger(db, OWNER_ID, itemIds)).map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId }));
}
async function state(h) {
  const [row] = await h.observer`SELECT
    (SELECT count(*)::int FROM consumption_operations) AS operations,
    (SELECT count(*)::int FROM consumption_revisions) AS revisions,
    (SELECT count(*)::int FROM inventory_movements WHERE type = 'CONSUMPTION') AS movements,
    (SELECT count(*)::int FROM cycle_consumption_contexts WHERE current_revision_id IS NOT NULL) AS pointers`;
  return row;
}
async function scenario(h, options) {
  const source = await fixture.seedConsumptionScenario(h.db, options);
  if (options?.start === false) return source;
  const { input } = await fixture.prepareConsumptionFixture(h.db, OWNER_ID, source.cycleId);
  assert.deepEqual((await readStockLedger(h.db, OWNER_ID, source.itemIds)).map(row => row.balance), ["2200", "14"]);
  // Hand-selected actual quantities leave flour=50, boxes=8 from 2200/14.
  input.items = input.items.map((item, index) => ({ ...item, usedQuantity: index === 0 ? "2150" : "6", basis: "OWNER_REPORTED", reason: "Measured actual use" }));
  return { ...source, input };
}

for (const reverse of [false, true]) for (const sameKey of [true, false]) {
  test(`use/use ${sameKey ? "exact retry" : "different keys"}, writer ${reverse ? "B" : "A"} first`, { timeout: 60000 }, async () => database(async h => {
    const s = await scenario(h);
    const firstDb = reverse ? h.secondDb : h.firstDb;
    const secondDb = reverse ? h.firstDb : h.secondDb;
    const held = holdCommit(firstDb);
    const first = outcome(consumption(held.db).confirmUse(OWNER_ID, s.input));
    try {
      await Promise.race([held.entered.promise, first.then(r => { if (r.error) throw r.error; })]);
      assert.deepEqual(await state(h), { operations: 0, revisions: 0, movements: 0, pointers: 0 });
      const retryInput = { ...s.input, requestId: sameKey ? s.input.requestId : randomUUID(), items: [...s.input.items].reverse() };
      const second = outcome(consumption(secondDb).confirmUse(OWNER_ID, retryInput));
      await blocked(h, reverse ? h.firstPid : h.secondPid, reverse ? h.secondPid : h.firstPid, second);
      held.release.resolve();
      const a = await first, b = await second;
      assert.ifError(a.error);
      if (sameKey) { assert.ifError(b.error); assert.equal(b.value.replayed, true); assert.deepEqual(b.value.revisionIds, a.value.revisionIds); assert.equal(b.value.operationId, a.value.operationId); }
      else assert.equal(b.error?.kind, "STALE_DATA");
      assert.deepEqual(await state(h), { operations: 1, revisions: 1, movements: 2, pointers: 1 });
      const ledger = await readStockLedger(drizzle(h.observer), OWNER_ID, s.itemIds);
      assert.deepEqual(ledger.map(row => row.balance), ["50", "8"]);
      console.log(`OBSERVER_COMMITTED ${JSON.stringify(await state(h))} balances=50,8`);
    } finally { held.release.resolve(); await first; }
  }));
}
