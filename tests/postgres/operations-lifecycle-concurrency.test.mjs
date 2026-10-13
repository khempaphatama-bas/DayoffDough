import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const OWNER_ID = "71000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "72000000-0000-4000-8000-000000000001";
const CYCLE_ID = "73000000-0000-4000-8000-000000000001";
const ORDER_ID = "75000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "76000000-0000-4000-8000-000000000001";
const GENERATION_ID = "77000000-0000-4000-8000-000000000001";
const TASK_ID = "78000000-0000-4000-8000-000000000001";
const TASK_REQUEST_ID = "79000000-0000-4000-8000-000000000001";

function localAdminUrl() {
  const raw = process.env.TASK7_LOCAL_PG_ADMIN_URL;
  assert.ok(raw, "TASK7_LOCAL_PG_ADMIN_URL must name an isolated local PostgreSQL instance");
  const url = new URL(raw);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port && Number(url.port) > 0, "an explicit loopback port is required");
  assert.equal(url.pathname, "/postgres");
  return url;
}

function client(url) {
  return postgres(url.toString(), {
    max: 1,
    connect_timeout: 5,
    connection: { application_name: "dayoffdough-task7-race" },
  });
}

async function waitForWriterBlockingCycle(observer, writerPid, cyclePid, cycleOutcome) {
  const deadline = Date.now() + 4_000;
  let cycleSettled = false;
  void cycleOutcome.then(() => { cycleSettled = true; });
  while (Date.now() < deadline) {
    const [{ blockers }] = await observer`
      SELECT pg_blocking_pids(${cyclePid}) AS blockers
    `;
    if (blockers.includes(writerPid)) return "blocked";
    if (cycleSettled) return "cycle_finished_before_order_commit";
    await delay(20);
  }
  return "no_observed_lock_wait";
}

test("direct Order start serializes with concurrent Cycle unlock", { timeout: 20_000 }, async () => {
  const adminUrl = localAdminUrl();
  const databaseName = `dayoffdough_task7_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const admin = client(adminUrl);
  let migrationClient;
  let orderConnection;
  let cycleConnection;
  let observer;
  let orderOpen = false;
  let cycleOpen = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    migrationClient = client(databaseUrl);
    await migrate(drizzle(migrationClient), { migrationsFolder: "drizzle" });
    await migrationClient`
      INSERT INTO customers (id, owner_id, name)
      VALUES (${CUSTOMER_ID}, ${OWNER_ID}, 'Race customer')
    `;
    await migrationClient`
      INSERT INTO bake_cycles (
        id, owner_id, name, status, target_production_date, primary_delivery_date
      ) VALUES (${CYCLE_ID}, ${OWNER_ID}, 'Race cycle', 'IN_PRODUCTION', '2026-09-26', '2026-09-27')
    `;
    await migrationClient`
      INSERT INTO orders (id, owner_id, customer_id, bake_cycle_id, fulfillment_status)
      VALUES (${ORDER_ID}, ${OWNER_ID}, ${CUSTOMER_ID}, ${CYCLE_ID}, 'CONFIRMED')
    `;

    orderConnection = client(databaseUrl);
    cycleConnection = client(databaseUrl);
    observer = client(databaseUrl);
    await orderConnection`BEGIN`;
    orderOpen = true;
    await orderConnection`SET LOCAL statement_timeout = '10s'`;
    await orderConnection`SET LOCAL lock_timeout = '7s'`;
    const [{ pid: orderPid }] = await orderConnection`SELECT pg_backend_pid() AS pid`;
    await orderConnection`
      UPDATE orders SET fulfillment_status = 'IN_PRODUCTION' WHERE id = ${ORDER_ID}
    `;

    await cycleConnection`BEGIN`;
    cycleOpen = true;
    await cycleConnection`SET LOCAL statement_timeout = '10s'`;
    await cycleConnection`SET LOCAL lock_timeout = '7s'`;
    const [{ pid: cyclePid }] = await cycleConnection`SELECT pg_backend_pid() AS pid`;
    const cycleOutcome = (async () => {
      try {
        await cycleConnection`
          UPDATE bake_cycles SET status = 'OPEN' WHERE id = ${CYCLE_ID}
        `;
        await cycleConnection`COMMIT`;
        cycleOpen = false;
        return { kind: "committed" };
      } catch (error) {
        await cycleConnection`ROLLBACK`;
        cycleOpen = false;
        return { kind: "rejected", error };
      }
    })();

    const observed = await waitForWriterBlockingCycle(observer, orderPid, cyclePid, cycleOutcome);
    await orderConnection`COMMIT`;
    orderOpen = false;
    const cycleResult = await cycleOutcome;
    const [state] = await observer`
      SELECT c.status AS cycle_status, o.fulfillment_status AS order_status
      FROM bake_cycles AS c JOIN orders AS o ON o.bake_cycle_id = c.id
      WHERE c.id = ${CYCLE_ID} AND o.id = ${ORDER_ID}
    `;

    assert.equal(observed, "blocked", "Cycle unlock must wait for the uncommitted Order transition");
    assert.equal(cycleResult.kind, "rejected", "Cycle unlock must reject after Order start commits");
    assert.match(cycleResult.error.message, /cycle unlock blocked by operations/);
    assert.deepEqual(state, { cycle_status: "IN_PRODUCTION", order_status: "IN_PRODUCTION" });
  } finally {
    if (orderOpen && orderConnection) await orderConnection`ROLLBACK`;
    if (cycleOpen && cycleConnection) await cycleConnection`ROLLBACK`;
    await Promise.allSettled([
      migrationClient?.end(), orderConnection?.end(), cycleConnection?.end(), observer?.end(),
    ]);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});

async function runTaskCompletionRace(kind) {
  const adminUrl = localAdminUrl();
  const databaseName = `dayoffdough_task7_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const admin = client(adminUrl);
  let migrationClient;
  let writer;
  let cycleConnection;
  let observer;
  let writerOpen = false;
  let cycleOpen = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    migrationClient = client(databaseUrl);
    await migrate(drizzle(migrationClient), { migrationsFolder: "drizzle" });
    await migrationClient`
      INSERT INTO bake_cycles (
        id, owner_id, name, status, target_production_date, primary_delivery_date
      ) VALUES (${CYCLE_ID}, ${OWNER_ID}, 'Task race cycle', 'IN_PRODUCTION', '2026-09-26', '2026-09-27')
    `;
    await migrationClient`
      INSERT INTO cycle_planning_snapshots (
        id, owner_id, bake_cycle_id, generation, status, lock_request_id,
        input_fingerprint, cycle_number, cycle_name, target_production_date,
        primary_delivery_date, labor_rate_satang_per_hour,
        default_waste_allowance_percent, timezone, currency, cost_complete, locked_at
      ) VALUES (
        ${SNAPSHOT_ID}, ${OWNER_ID}, ${CYCLE_ID}, 1, 'ACTIVE', ${TASK_REQUEST_ID},
        ${"a".repeat(64)}, 1, 'Task race cycle', '2026-09-26',
        '2026-09-27', 0, 0, 'Asia/Bangkok', 'THB', true, now()
      )
    `;
    await migrationClient`
      INSERT INTO cycle_task_generations (
        id, owner_id, bake_cycle_id, planning_snapshot_id, generation,
        primary_delivery_date, timezone
      ) VALUES (
        ${GENERATION_ID}, ${OWNER_ID}, ${CYCLE_ID}, ${SNAPSHOT_ID}, 1,
        '2026-09-27', 'Asia/Bangkok'
      )
    `;
    await migrationClient`
      UPDATE bake_cycles SET active_planning_snapshot_id = ${SNAPSHOT_ID}
      WHERE id = ${CYCLE_ID}
    `;
    if (kind === "status_regression") {
      await migrationClient`
        INSERT INTO cycle_tasks (
          id, owner_id, cycle_task_generation_id, origin, creation_request_id,
          title, scheduled_at, estimated_duration_minutes, sequence, status
        ) VALUES (
          ${TASK_ID}, ${OWNER_ID}, ${GENERATION_ID}, 'MANUAL',
          ${"79000000-0000-4000-8000-000000000002"}, 'Existing task', now(), 10, 1, 'DONE'
        )
      `;
    }

    writer = client(databaseUrl);
    cycleConnection = client(databaseUrl);
    observer = client(databaseUrl);
    await writer`BEGIN`;
    writerOpen = true;
    await writer`SET LOCAL statement_timeout = '10s'`;
    await writer`SET LOCAL lock_timeout = '7s'`;
    const [{ pid: writerPid }] = await writer`SELECT pg_backend_pid() AS pid`;
    if (kind === "status_regression") {
      await writer`UPDATE cycle_tasks SET status = 'IN_PROGRESS' WHERE id = ${TASK_ID}`;
    } else {
      await writer`
        INSERT INTO cycle_tasks (
          id, owner_id, cycle_task_generation_id, origin, creation_request_id,
          title, scheduled_at, estimated_duration_minutes, sequence, status
        ) VALUES (
          ${TASK_ID}, ${OWNER_ID}, ${GENERATION_ID}, 'MANUAL',
          ${"79000000-0000-4000-8000-000000000002"}, 'New task', now(), 10, 1, 'PENDING'
        )
      `;
    }

    await cycleConnection`BEGIN`;
    cycleOpen = true;
    await cycleConnection`SET LOCAL statement_timeout = '10s'`;
    await cycleConnection`SET LOCAL lock_timeout = '7s'`;
    const [{ pid: cyclePid }] = await cycleConnection`SELECT pg_backend_pid() AS pid`;
    const cycleOutcome = (async () => {
      try {
        await cycleConnection`UPDATE bake_cycles SET status = 'COMPLETED' WHERE id = ${CYCLE_ID}`;
        await cycleConnection`COMMIT`;
        cycleOpen = false;
        return { kind: "committed" };
      } catch (error) {
        await cycleConnection`ROLLBACK`;
        cycleOpen = false;
        return { kind: "rejected", error };
      }
    })();

    const observed = await waitForWriterBlockingCycle(observer, writerPid, cyclePid, cycleOutcome);
    await writer`COMMIT`;
    writerOpen = false;
    const cycleResult = await cycleOutcome;
    const [cycle] = await observer`SELECT status FROM bake_cycles WHERE id = ${CYCLE_ID}`;
    const [task] = await observer`SELECT status FROM cycle_tasks WHERE id = ${TASK_ID}`;

    assert.equal(observed, "blocked", "Cycle completion must wait for the uncommitted Task write");
    assert.equal(cycleResult.kind, "rejected", "Cycle completion must reject after unfinished Task commit");
    assert.match(cycleResult.error.message, /cycle completion blocked by unfinished work/);
    assert.equal(cycle.status, "IN_PRODUCTION");
    assert.equal(task.status, kind === "status_regression" ? "IN_PROGRESS" : "PENDING");
  } finally {
    if (writerOpen && writer) await writer`ROLLBACK`;
    if (cycleOpen && cycleConnection) await cycleConnection`ROLLBACK`;
    await Promise.allSettled([
      migrationClient?.end(), writer?.end(), cycleConnection?.end(), observer?.end(),
    ]);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
}

test("direct Task status regression serializes with Cycle completion", { timeout: 20_000 }, async () => {
  await runTaskCompletionRace("status_regression");
});

test("direct manual Task insertion serializes with Cycle completion", { timeout: 20_000 }, async () => {
  await runTaskCompletionRace("manual_insert");
});
