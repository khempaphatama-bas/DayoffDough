import { expect, type Locator, type Page } from "@playwright/test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import {
  addInventoryPrice, configureShopSettings, confirmCycleStock, createBakeCycle,
  createCustomer, createDeliveryMethod, createInventoryItem, createOrder,
  createPackagingRule, createProduct, createProductionTemplate, createRecipeVersion,
  loginAsOwner, verifiedOwnerId,
} from "../fixtures/owner";
import { isolatedLocalFixtureTarget } from "./local-product-fixture";

export async function ownerAction(page: Page, scope: Page | Locator, name: string) {
  isolatedLocalFixtureTarget();
  const pathname = new URL(page.url()).pathname;
  const response = page.waitForResponse(result => result.request().method() === "POST"
    && new URL(result.url()).pathname === pathname, { timeout: 30_000 });
  await scope.getByRole("button", { name, exact: true }).filter({ visible: true }).click();
  const result = await response;
  expect(result.ok()).toBe(true);
  expect(await result.finished()).toBeNull();
}

export async function assertLocalLineage(page: Page, cycleUrl: string, previousFingerprint?: string) {
  const target = isolatedLocalFixtureTarget();
  const ownerId = await verifiedOwnerId(page);
  const cycleId = /^\/cycles\/([0-9a-f-]{36})$/.exec(cycleUrl)?.[1];
  if (!cycleId) throw new Error("Exact local Cycle URL required");
  const connection = postgres(target, { max: 1, connect_timeout: 5 });
  try {
    const receipts = await connection`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`;
    expect(receipts.map(row => row.hash)).toEqual(readMigrationFiles({ migrationsFolder: "drizzle" }).map(row => row.hash));
    expect(receipts).toHaveLength(15);
    const rows = await connection`SELECT cycle.consumption_policy, snapshot.input_fingerprint
      FROM bake_cycles cycle JOIN cycle_planning_snapshots snapshot
        ON snapshot.owner_id = cycle.owner_id AND snapshot.id = cycle.active_planning_snapshot_id
      WHERE cycle.owner_id = ${ownerId} AND cycle.id = ${cycleId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.consumption_policy).toBe("CONSUMPTION_V1");
    const fingerprint = String(rows[0]!.input_fingerprint);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    if (previousFingerprint !== undefined) expect(fingerprint).toBe(previousFingerprint);
    console.log("LOCAL_LINEAGE", previousFingerprint ? "15 migration hashes match; V1; snapshot fingerprint unchanged" : "15 migration hashes match; V1; snapshot fingerprint captured");
    return fingerprint;
  } finally { await connection.end(); }
}

export async function expectViewportFit(page: Page, state: string) {
  await expect(page.locator("main form").filter({ visible: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth
    - document.documentElement.clientWidth), { message: `${state}: document fits` }).toBeLessThanOrEqual(0);
  const bounds = await page.locator("main, main form, main section, main article, main input:not([type=hidden]), main select, main textarea")
    .filter({ visible: true }).evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, left: rect.left, right: rect.right, width: rect.width };
    }));
  expect(bounds.length).toBeGreaterThan(0);
  console.log("VIEWPORT_FIT", JSON.stringify({ state, viewport: page.viewportSize()!.width,
    checked: bounds.length, left: Math.min(...bounds.map(rect => rect.left)), right: Math.max(...bounds.map(rect => rect.right)) }));
  for (const rect of bounds) {
    expect(rect.width, `${state}: ${rect.tag} width`).toBeGreaterThan(0);
    expect(rect.left, `${state}: ${rect.tag} left`).toBeGreaterThanOrEqual(0);
    expect(rect.right, `${state}: ${rect.tag} right`).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
}

export async function inventoryUrl(page: Page, name: string) {
  await page.goto("/inventory");
  await page.getByLabel("ค้นหารายการ").fill(name);
  const link = page.getByRole("link", { name, exact: true }).filter({ visible: true });
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/inventory\/[0-9a-f-]+$/);
  return href!;
}

export async function expectStock(page: Page, url: string, quantity: string, unit = "g") {
  await page.goto(url);
  await expect(page.getByRole("article").filter({ hasText: "สต๊อกคงเหลือ" }).locator("p").last())
    .toHaveText(`${quantity} ${unit}`);
}

export async function countStock(page: Page, url: string, quantity: string) {
  await page.goto(url);
  await page.getByLabel("จำนวนที่นับได้", { exact: true }).fill(quantity);
  await ownerAction(page, page, "บันทึกยอดนับ");
  await expect(page.getByText("อัปเดตยอดสต๊อกแล้ว", { exact: true })).toBeVisible();
  await page.reload();
}

export function consumptionUsageForm(page: Page, correction = false) {
  return page.getByRole("form", { name: correction ? "แก้ไขยอดใช้การผลิต" : "ยืนยันยอดใช้การผลิต", exact: true });
}

export async function intentId(form: Locator): Promise<string> {
  const payload = JSON.parse(await form.locator('input[name="payload"]').inputValue()) as { requestId: string };
  expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
  return payload.requestId;
}

export async function choosePlanned(form: Locator) {
  await expect(form).toBeVisible();
  const selects = form.getByRole("combobox");
  for (const select of await selects.all()) await select.selectOption("PLANNED");
}

export async function confirmPlannedUse(page: Page, cycleUrl: string) {
  await page.goto(`${cycleUrl}/consumption`);
  const form = consumptionUsageForm(page);
  await choosePlanned(form);
  await form.getByRole("checkbox", { name: "ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว", exact: true }).check();
  await ownerAction(page, form, "ยืนยันยอดใช้");
  await page.reload();
  await expect(page.getByRole("region", { name: "ประวัติยอดใช้ที่บันทึกแล้ว" }).getByRole("article")).toHaveCount(1);
}

export async function consumptionScenario(page: Page, run: string, counts = { flour: "100", boxes: "10" }) {
  isolatedLocalFixtureTarget();
  await loginAsOwner(page);
  await configureShopSettings(page);
  // Both labels and native option text are deliberately long, without truncation.
  const flour = `แป้งขนมปังสำหรับอบสูตรพิเศษ Whole wheat bread flour long English label ${run}`;
  const boxes = `กล่องบรรจุขนมสำหรับจัดส่ง Recyclable bakery packaging long label ${run}`;
  const product = `ขนมปังโฮลวีต Whole wheat bread ${run}`;
  const delivery = `ส่ง ${run}`, customer = `ลูกค้า ${run}`, cycle = `รอบ ${run}`;
  await createInventoryItem(page, { name: flour, category: "INGREDIENT", purchaseLabel: "ถุง", packQuantity: "50" });
  await addInventoryPrice(page, flour, { packPriceBaht: "50" });
  await createInventoryItem(page, { name: boxes, category: "PACKAGING", baseUnit: "piece", purchaseLabel: "แพ็ก", packQuantity: "10" });
  await addInventoryPrice(page, boxes, { packPriceBaht: "10" });
  await createProduct(page, { name: product, sellingPriceBaht: "100" });
  await createRecipeVersion(page, product, { versionCode: run, yieldQuantity: "2", ingredientName: flour, ingredientQuantity: "20", wastePercent: "0" });
  await createProductionTemplate(page, { name: `อบ ${run}`, scope: "PRODUCT", productName: product, activate: true,
    activities: [{ name: `อบ ${run}`, offsetDaysFromDelivery: "-1", defaultTime: "08:00", estimatedDurationMinutes: "20" }] });
  await createDeliveryMethod(page, { name: delivery, customerFeeBaht: "0", internalCostBaht: "0" });
  await createPackagingRule(page, { productName: product, inventoryItemName: boxes, basis: "PER_PRODUCT_UNIT", quantity: "1" });
  await createCustomer(page, { name: customer, deliveryMethodName: delivery, deliveryLocation: "กรุงเทพฯ" });
  await createBakeCycle(page, { name: cycle, productionDate: "2030-06-10", deliveryDate: "2030-06-11" });
  const cycleUrl = new URL(page.url()).pathname;
  await createOrder(page, { customerName: customer, cycleName: cycle, productName: product, totalQuantity: 2, discountBaht: "0", amountPaidBaht: "0" });
  await page.getByLabel("วันส่งยืนยัน", { exact: true }).fill("2030-06-11");
  await ownerAction(page, page, "บันทึกการแก้ไข");
  await page.goto(`${cycleUrl}/planning`);
  await ownerAction(page, page, "ยืนยันล็อกรอบ");
  const fingerprint = await assertLocalLineage(page, cycleUrl);
  await page.goto(`${cycleUrl}/operations`);
  await expect(page.getByRole("button", { name: "เริ่มรอบผลิต", exact: true })).toBeDisabled();
  await page.goto(`${cycleUrl}/shopping`);
  await confirmCycleStock(page, [{ itemName: flour, quantity: counts.flour }, { itemName: boxes, quantity: counts.boxes }]);
  const flourUrl = await inventoryUrl(page, flour), boxesUrl = await inventoryUrl(page, boxes);
  return { flour, boxes, product, customer, cycle, cycleUrl, flourUrl, boxesUrl, fingerprint };
}

export async function startScenario(page: Page, cycleUrl: string) {
  await page.goto(`${cycleUrl}/operations`);
  await ownerAction(page, page, "เริ่มรอบผลิต");
  await page.reload();
  await expect(page.getByRole("button", { name: "เริ่มรอบผลิต", exact: true })).toHaveCount(0);
}
