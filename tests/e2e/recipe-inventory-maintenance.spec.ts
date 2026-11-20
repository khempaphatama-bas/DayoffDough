import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import postgres from "postgres";
import {
  activateRecipeVersion, addInventoryPrice, configureShopSettings, confirmCycleStock,
  createBakeCycle, createCustomer, createDeliveryMethod, createInventoryItem, createOrder,
  createProduct, createProductionTemplate, loginAsOwner, recordCyclePurchase, verifiedOwnerId,
} from "../fixtures/owner";
import {
  choosePlanned, consumptionUsageForm, expectViewportFit, inventoryUrl,
  ownerAction, startScenario,
} from "../helpers/consumption-ui";
import { isolatedLocalFixtureTarget } from "../helpers/local-product-fixture";

const nonStock = "ไม่คิดต้นทุนและไม่ต้องนับสต๊อก";
type Line = { name: string; unit: "g" | "ml"; amount: string };
const editor = (page: Page) => page.locator("form").filter({ has: page.getByLabel("รหัสเวอร์ชัน", { exact: true }) });
const card = (page: Page, code: string) => page.getByRole("article", { name: code, exact: true });
const ingredient = (form: Locator, index: number) => form.getByRole("combobox", { name: `วัตถุดิบ ${index}`, exact: true });
const quantity = (form: Locator, index: number) => form.getByRole("spinbutton", { name: `ปริมาณวัตถุดิบ ${index}`, exact: true });

test.beforeEach(({ baseURL, page }) => {
  if (baseURL !== "http://127.0.0.1:3215" || !process.env.RECIPE_INVENTORY_LOCAL_PG_URL
    || process.env.SUPABASE_DATABASE_URL !== process.env.RECIPE_INVENTORY_LOCAL_PG_URL
    || process.env.SUPABASE_DATABASE_CA_PEM !== undefined) {
    throw new Error("Use playwright.recipe-inventory.local.config.ts for isolated maintenance verification");
  }
  page.setDefaultTimeout(30_000);
});

async function shot(target: Locator, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await target.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

async function openProduct(page: Page, name: string) {
  await page.goto("/products");
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function addLine(form: Locator, index: number, line: Line) {
  if (index > 1) await form.getByRole("button", { name: "เพิ่มวัตถุดิบ", exact: true }).click();
  await ingredient(form, index).selectOption({ label: `${line.name} (${line.unit})` });
  await quantity(form, index).fill(line.amount);
}

async function saveRecipe(page: Page, code: string) {
  await editor(page).getByLabel("รหัสเวอร์ชัน", { exact: true }).fill(code);
  await ownerAction(page, editor(page), "บันทึกเวอร์ชันสูตร");
  await expect(card(page, code)).toContainText("บันทึกแล้ว ยังไม่ได้ใช้งาน");
  await expect(editor(page).getByRole("status")).toContainText("บันทึกเวอร์ชันสูตรแล้ว ยังไม่ได้เปิดใช้งาน");
}

async function newRecipe(page: Page, code: string, lines: readonly Line[]) {
  await page.getByRole("button", { name: "เพิ่มเวอร์ชันสูตร", exact: true }).click();
  const form = editor(page);
  await form.getByLabel("ผลผลิตต่อสูตร", { exact: true }).fill("2");
  await form.getByLabel("เวลาแรงงานต่อสูตร (นาที)", { exact: true }).fill("3");
  await form.getByLabel("ค่าไฟหรือแก๊สต่อสูตร (บาท)", { exact: true }).fill("4.50");
  await form.getByLabel("ค่าเผื่อสูญเสีย (%)", { exact: true }).fill("0");
  await form.getByRole("textbox", { name: "วิธีทำ", exact: true }).fill("ผสม พัก แล้วอบ");
  for (const [index, line] of lines.entries()) await addLine(form, index + 1, line);
  await saveRecipe(page, code);
}

async function copyRecipe(page: Page, code: string) {
  const link = card(page, code).getByRole("link", { name: "ใช้สูตรนี้เป็นต้นแบบ", exact: true });
  const target = await link.getAttribute("href");
  expect(target).toMatch(/^\?template=[0-9a-f-]+(?:&restartTemplate=1)?#recipe-editor$/);
  await link.click();
  await expect(page).toHaveURL(url => `${url.search}${url.hash}` === target);
  await expect(editor(page)).toContainText(`ใช้สูตร ${code} เป็นต้นแบบ`);
}

async function prepItems(page: Page, run: string) {
  const water = `น้ำกรอง ${run}`, ice = `น้ำแข็งบด ${run}`;
  await createInventoryItem(page, { name: water, category: "INGREDIENT", ingredientKind: "WATER" });
  await createInventoryItem(page, { name: ice, category: "INGREDIENT", ingredientKind: "ICE" });
  return { water, ice, lines: [{ name: water, unit: "ml", amount: "250" }, { name: ice, unit: "g", amount: "100" }] as const };
}

async function flourItem(page: Page, name: string) {
  await createInventoryItem(page, { name, category: "INGREDIENT", purchaseLabel: "ถุง", packQuantity: "1000" });
}

test("copies_recipe_and_keeps_five_selectable", async ({ page }, info) => {
  const run = `copy-${info.project.name}-${Date.now()}`;
  const flour = `แป้งขนมปัง ${run}`, product = `ฟอคคาเซีย ${run}`;
  await loginAsOwner(page);
  await flourItem(page, flour);
  const prep = await prepItems(page, run);
  const waterUrl = await inventoryUrl(page, prep.water);
  await page.goto(waterUrl);
  await expect(page.getByRole("main")).toContainText(nonStock);
  await expect(page.getByRole("main")).toContainText("น้ำ · หน่วยฐาน ml");
  await expect(page.getByRole("button", { name: "บันทึกราคา", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "บันทึกยอดนับ", exact: true })).toHaveCount(0);
  await shot(page.getByRole("main"), info, "prep-water-detail");
  await createProduct(page, { name: product, sellingPriceBaht: "100" });
  await openProduct(page, product);
  await newRecipe(page, "v1", [{ name: flour, unit: "g", amount: "20" }, ...prep.lines]);
  await activateRecipeVersion(page, "v1");

  await copyRecipe(page, "v1");
  const form = editor(page);
  const instructions = form.getByRole("textbox", { name: "วิธีทำ", exact: true });
  const yieldInput = form.getByLabel("ผลผลิตต่อสูตร", { exact: true });
  await expect(yieldInput).toHaveValue("2");
  await expect(instructions).toHaveValue("ผสม พัก แล้วอบ");
  await expect(form.getByLabel("เวลาแรงงานต่อสูตร (นาที)", { exact: true })).toHaveValue("3");
  await expect(form.getByLabel("ค่าไฟหรือแก๊สต่อสูตร (บาท)", { exact: true })).toHaveValue("4.50");
  await expect(form.getByLabel("ค่าเผื่อสูญเสีย (%)", { exact: true })).toHaveValue("0");
  const template = page.url();
  await yieldInput.fill("99");
  await instructions.fill("ร่างที่ยังไม่บันทึก");
  await copyRecipe(page, "v1");
  expect(page.url()).not.toBe(template);
  await expect(yieldInput).toHaveValue("2");
  await expect(instructions).toHaveValue("ผสม พัก แล้วอบ");
  await instructions.fill("ร่างที่สอง");
  await copyRecipe(page, "v1");
  expect(page.url()).toBe(template);
  await expect(instructions).toHaveValue("ผสม พัก แล้วอบ");
  await expectViewportFit(page, "recipe copy");
  await shot(form, info, "recipe-template-editor");

  for (let n = 2; n <= 5; n++) {
    if (n > 2) await copyRecipe(page, "v1");
    await saveRecipe(page, `v${n}`);
  }
  const selectable = page.getByRole("region", { name: "เวอร์ชันสูตร", exact: true });
  await expect(selectable.getByRole("article")).toHaveCount(5);
  await expect(page.getByRole("region", { name: "ประวัติสูตร", exact: true })).toHaveCount(0);
  await copyRecipe(page, "v1");
  const currentLines = await form.locator('select[name^="ingredientId_"] option:checked').allTextContents();
  const flourIndex = currentLines.indexOf(`${flour} (g)`) + 1;
  const iceIndex = currentLines.indexOf(`${prep.ice} (g)`) + 1;
  expect(flourIndex).toBeGreaterThan(0);
  expect(iceIndex).toBeGreaterThan(0);
  await quantity(form, flourIndex).fill("35");
  await form.getByRole("button", { name: `ลบวัตถุดิบ ${iceIndex}`, exact: true }).click();
  await addLine(form, 3, { name: prep.ice, unit: "g", amount: "175" });
  await instructions.fill("ผสมสูตรปรับใหม่");
  await saveRecipe(page, "v6");
  await expect(form.getByRole("status")).toContainText("สูตร v2 ถูกย้ายไปที่ประวัติ");
  await expect(selectable.getByRole("article")).toHaveCount(5);
  await expect(card(page, "v1")).toContainText("สูตรที่ใช้งานอยู่");
  await expect(card(page, "v1").getByRole("listitem").filter({ hasText: prep.ice })).toContainText("100 g");
  await expect(card(page, "v6").getByRole("listitem").filter({ hasText: prep.ice })).toContainText("175 g");
  await expect(card(page, "v6").getByRole("listitem").filter({ hasText: flour })).toContainText("35 g");
  const history = page.getByRole("region", { name: "ประวัติสูตร", exact: true });
  const old = history.getByRole("article", { name: "v2", exact: true });
  await expect(old).toContainText("เก็บเข้าประวัติแล้ว");
  await expect(old).toContainText("ผสม พัก แล้วอบ");
  await expect(old.getByRole("listitem").filter({ hasText: prep.water })).toContainText("250 ml");
  await expect(old.getByRole("button", { name: "เปิดใช้เวอร์ชันนี้", exact: true })).toHaveCount(0);
  await expect(old.getByRole("link", { name: "ใช้สูตรนี้เป็นต้นแบบ", exact: true })).toBeVisible();
  await shot(history, info, "recipe-history");
});

async function readyRound(page: Page, run: string, product: string) {
  const delivery = `ส่ง ${run}`, customer = `ลูกค้า ${run}`, cycle = `รอบ ${run}`;
  await createProductionTemplate(page, { name: `อบ ${run}`, scope: "PRODUCT", productName: product, activate: true,
    activities: [{ name: `อบ ${run}`, offsetDaysFromDelivery: "-1", defaultTime: "08:00", estimatedDurationMinutes: "20" }] });
  await createDeliveryMethod(page, { name: delivery, customerFeeBaht: "0", internalCostBaht: "0" });
  await createCustomer(page, { name: customer, deliveryMethodName: delivery, deliveryLocation: "กรุงเทพฯ" });
  await createBakeCycle(page, { name: cycle, productionDate: "2030-06-10", deliveryDate: "2030-06-11" });
  const url = new URL(page.url()).pathname;
  await createOrder(page, { customerName: customer, cycleName: cycle, productName: product, totalQuantity: 2, discountBaht: "0", amountPaidBaht: "0" });
  await page.getByLabel("วันส่งยืนยัน", { exact: true }).fill("2030-06-11");
  await ownerAction(page, page, "บันทึกการแก้ไข");
  return url;
}

async function assertRoundRows(page: Page, cycleUrl: string, names: { water: string; ice: string; flour?: string }) {
  const ownerId = await verifiedOwnerId(page);
  const cycleId = /^\/cycles\/([0-9a-f-]{36})$/.exec(cycleUrl)?.[1];
  const target = isolatedLocalFixtureTarget();
  if (!cycleId || !/^\/recipe_inventory_test_[a-z0-9_]+$/.test(new URL(target).pathname)) {
    throw new Error("Round verification requires the isolated maintenance test database and exact cycle URL");
  }
  const sql = postgres(target, { max: 1, ssl: false, connect_timeout: 5 });
  try {
    const items = await sql`SELECT id, name, ingredient_kind AS kind FROM inventory_items WHERE owner_id = ${ownerId}
      AND name IN ${sql([names.water, names.ice, ...(names.flour ? [names.flour] : [])])}`;
    expect(items).toHaveLength(names.flour ? 3 : 2);
    const water = items.find(item => item.name === names.water)!;
    const ice = items.find(item => item.name === names.ice)!;
    const flour = items.find(item => item.name === names.flour);
    expect([water.kind, ice.kind]).toEqual(["WATER", "ICE"]);
    const tracked = flour ? [{ id: flour.id }] : [];
    const rounds = await sql`SELECT cycle.status, snapshot.id, snapshot.cost_complete AS "costComplete",
      context.id AS context, context.current_revision_id AS revision FROM bake_cycles cycle
      JOIN cycle_planning_snapshots snapshot ON snapshot.owner_id = cycle.owner_id AND snapshot.id = cycle.active_planning_snapshot_id
      JOIN cycle_consumption_contexts context ON context.owner_id = cycle.owner_id AND context.planning_snapshot_id = snapshot.id
      WHERE cycle.owner_id = ${ownerId} AND cycle.id = ${cycleId}`;
    expect(rounds).toHaveLength(1);
    const round = rounds[0]!;
    expect(round).toMatchObject({ status: "IN_PRODUCTION", costComplete: !flour, revision: expect.any(String) });
    const [material, priceSnapshot, packaging, counts, shopping, purchased, usage, revisionItems, prices, movements, warnings] = await Promise.all([
      sql`SELECT inventory_item_id AS id FROM cycle_material_requirements WHERE owner_id = ${ownerId} AND planning_snapshot_id = ${round.id}`,
      sql`SELECT inventory_item_id AS id FROM cycle_inventory_price_snapshots WHERE owner_id = ${ownerId} AND planning_snapshot_id = ${round.id}`,
      sql`SELECT inventory_item_id AS id FROM cycle_packaging_requirements WHERE owner_id = ${ownerId} AND planning_snapshot_id = ${round.id}`,
      sql`SELECT inventory_item_id AS id FROM cycle_inventory_counts WHERE owner_id = ${ownerId} AND planning_snapshot_id = ${round.id}`,
      sql`SELECT inventory_item_id AS id FROM cycle_shopping_items WHERE owner_id = ${ownerId} AND planning_snapshot_id = ${round.id}`,
      sql`SELECT inventory_item_id AS id FROM cycle_purchase_entries WHERE owner_id = ${ownerId} AND planning_snapshot_id = ${round.id}`,
      sql`SELECT inventory_item_id AS id FROM cycle_consumption_items WHERE owner_id = ${ownerId} AND context_id = ${round.context}`,
      sql`SELECT inventory_item_id AS id FROM consumption_revision_items WHERE owner_id = ${ownerId} AND revision_id = ${round.revision}`,
      sql`SELECT id FROM inventory_prices WHERE owner_id = ${ownerId} AND inventory_item_id IN (${water.id}, ${ice.id})`,
      sql`SELECT id FROM inventory_movements WHERE owner_id = ${ownerId} AND inventory_item_id IN (${water.id}, ${ice.id})`,
      sql`SELECT source_entity_id AS id FROM cycle_planning_warnings WHERE owner_id = ${ownerId} AND planning_snapshot_id = ${round.id}
        AND code = 'MISSING_INVENTORY_PRICE'`,
    ]);
    for (const rows of [material, priceSnapshot, counts, shopping, purchased, usage, revisionItems, warnings]) {
      expect([...rows]).toEqual(tracked);
    }
    for (const rows of [packaging, prices, movements]) expect(rows).toHaveLength(0);
  } finally { await sql.end({ timeout: 2 }); }
}

test("mixed_and_prep_only_rounds", async ({ page }, info) => {
  test.setTimeout(420_000);
  const run = `rounds-${info.project.name}-${Date.now()}`;
  await loginAsOwner(page);
  await configureShopSettings(page);
  const flour = `แป้งไม่มีราคา ${run}`;
  await flourItem(page, flour);
  const prep = await prepItems(page, run);
  for (const mixed of [true, false]) {
    const kind = mixed ? "mixed" : "prep", code = `สูตร-${kind}`;
    const name = `${kind}-${run}`, product = `ขนม ${name}`;
    await createProduct(page, { name: product, sellingPriceBaht: "100" });
    await openProduct(page, product);
    await newRecipe(page, code, mixed ? [{ name: flour, unit: "g", amount: "20" }, ...prep.lines] : prep.lines);
    await activateRecipeVersion(page, code);
    await expect(card(page, code).getByText(nonStock, { exact: true })).toHaveCount(2);
    const cycleUrl = await readyRound(page, name, product);
    await page.goto(`${cycleUrl}/planning`);
    const main = page.getByRole("main");
    await page.getByLabel("วัตถุดิบที่ต้องใช้", { exact: true }).click();
    const warnings = page.getByRole("alert", { name: "คำเตือน", exact: true });
    const priceWarnings = warnings.getByRole("listitem").filter({ hasText: "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน" });
    if (mixed) {
      await expect(main.getByRole("listitem").filter({ hasText: flour })).toContainText("ยังไม่มีราคา");
      await expect(priceWarnings).toHaveCount(1);
      await expect(main.getByText("ต้นทุนไม่สมบูรณ์", { exact: true })).toBeVisible();
    } else {
      await expect(priceWarnings).toHaveCount(0);
      await expect(main.getByText("ต้นทุนไม่สมบูรณ์", { exact: true })).toHaveCount(0);
    }
    for (const name of [prep.water, prep.ice]) await expect(main).not.toContainText(name);
    await expect(page.getByRole("button", { name: "ยืนยันล็อกรอบ", exact: true })).toBeEnabled();
    await ownerAction(page, page, "ยืนยันล็อกรอบ");
    await page.goto(`${cycleUrl}/shopping`);
    if (mixed) {
      await expect(page.getByLabel(/^จำนวนที่นับจริง /)).toHaveCount(1);
      await confirmCycleStock(page, [{ itemName: flour, quantity: "0" }]);
      await expect(page.getByRole("article", { name: flour, exact: true })).toBeVisible();
      for (const name of [prep.water, prep.ice]) await expect(main).not.toContainText(name);
      await recordCyclePurchase(page, { itemName: flour, packCount: "1", totalPriceBaht: "55", purchasedFrom: "ร้านทดสอบ", occurredAt: "2026-11-01T10:00" });
    } else {
      await expect(page.getByRole("heading", { name: "รอบนี้ไม่มีรายการที่ต้องนับสต๊อก", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "ยืนยันสต๊อกและสร้างรายการซื้อ", exact: true })).toHaveCount(0);
      await expect(page.getByLabel(/^จำนวนที่นับจริง /)).toHaveCount(0);
    }
    await startScenario(page, cycleUrl);
    await page.goto(`${cycleUrl}/consumption`);
    const usage = consumptionUsageForm(page);
    await expect(usage.getByLabel(/^จำนวนใช้ /)).toHaveCount(mixed ? 1 : 0);
    if (mixed) {
      await choosePlanned(usage);
      await expect(usage.getByLabel(`จำนวนใช้ ${flour}`, { exact: true })).toHaveValue("20");
    } else {
      await expect(usage.getByRole("button", { name: "ยืนยันยอดใช้", exact: true })).toBeDisabled();
      await usage.getByRole("checkbox", { name: "ยืนยันว่ารุ่นนี้ไม่มีรายการต้องใช้", exact: true }).check();
      await usage.getByLabel("เหตุผลการบันทึก", { exact: true }).fill("มีเฉพาะน้ำและน้ำแข็งในสูตร");
    }
    await usage.getByRole("checkbox", { name: "ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว", exact: true }).check();
    await ownerAction(page, usage, "ยืนยันยอดใช้");
    await page.reload();
    const history = page.getByRole("region", { name: "ประวัติยอดใช้ที่บันทึกแล้ว", exact: true });
    await expect(history.getByRole("article")).toHaveCount(1);
    await expect(history.getByRole("listitem")).toHaveCount(mixed ? 1 : 0);
    if (mixed) await expect(history).toContainText("ยอดใช้ 20 · ผลสต๊อก -20 · DIRECT");
    else await expect(history).toContainText("มีเฉพาะน้ำและน้ำแข็งในสูตร");
    await assertRoundRows(page, cycleUrl, { ...prep, ...(mixed ? { flour } : {}) });
  }
});

test("edits_and_disables_inventory_with_clear_feedback", async ({ page }, info) => {
  const run = `edit-${info.project.name}-${Date.now()}`;
  const flour = `แป้ง ${run}`, renamed = `แป้งแก้ชื่อ ${run}`, product = `ขนม ${run}`;
  await loginAsOwner(page);
  await flourItem(page, flour);
  const url = await inventoryUrl(page, flour);
  await addInventoryPrice(page, flour, { packPriceBaht: "55" });
  await page.goto(url);
  await page.getByRole("spinbutton", { name: "จำนวนที่นับได้ (g)", exact: true }).fill("200");
  await ownerAction(page, page, "บันทึกยอดนับ");
  await expect(page.getByText("อัปเดตยอดสต๊อกแล้ว", { exact: true })).toBeVisible();
  const prep = await prepItems(page, run);
  await createProduct(page, { name: product, sellingPriceBaht: "100" });
  const productUrl = await openProduct(page, product);
  await newRecipe(page, "current", [{ name: flour, unit: "g", amount: "20" }]);
  await activateRecipeVersion(page, "current");
  await page.goto(url);
  const edit = page.locator("form").filter({ has: page.getByLabel("ชื่อรายการ", { exact: true }) });
  await expect(edit.getByRole("combobox", { name: "หน่วยฐาน", exact: true })).toBeDisabled();
  await edit.getByLabel("ชื่อรายการ", { exact: true }).fill(renamed);
  await edit.getByLabel("ชื่อหน่วยซื้อ", { exact: true }).fill("ถุงใหญ่");
  await edit.getByLabel("ปริมาณต่อแพ็ก", { exact: true }).fill("1500");
  await edit.getByLabel("สต๊อกขั้นต่ำ", { exact: true }).fill("125");
  const notes = edit.getByRole("textbox", { name: "หมายเหตุ", exact: true });
  await notes.fill("ใช้ถุงใหญ่ครั้งถัดไป");
  await expectViewportFit(page, "inventory edit");
  await shot(edit, info, "inventory-edit");
  // Trial and real clicks require pointer hit testing; fixed mobile navigation
  // must not intercept the actions after Playwright scrolls them into view.
  await edit.getByRole("button", { name: "บันทึกรายการ", exact: true }).click({ trial: true });
  await ownerAction(page, edit, "บันทึกรายการ");
  await expect(edit.getByText("บันทึกรายการแล้ว", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expect(edit.getByLabel("ชื่อหน่วยซื้อ", { exact: true })).toHaveValue("ถุงใหญ่");
  await expect(edit.getByLabel("ปริมาณต่อแพ็ก", { exact: true })).toHaveValue("1500");
  await expect(edit.getByLabel("สต๊อกขั้นต่ำ", { exact: true })).toHaveValue("125");
  await expect(notes).toHaveValue("ใช้ถุงใหญ่ครั้งถัดไป");
  const priceHistory = page.getByRole("listitem").filter({ hasText: "฿55.00" });
  await expect(priceHistory).toContainText("1000 g ต่อแพ็ก");
  await expect(page.getByRole("article").filter({ hasText: "สต๊อกคงเหลือ" })).toContainText("200 g");
  const disable = page.getByRole("button", { name: "ปิดใช้งาน", exact: true });
  await disable.click({ trial: true });
  await disable.click();
  await ownerAction(page, page, "ยืนยันปิดใช้งาน");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("ให้เปลี่ยนวัตถุดิบในสูตรที่ใช้งานก่อนปิดใช้งาน");
  await page.goto(productUrl);
  await newRecipe(page, "replacement", [prep.lines[0]]);
  await activateRecipeVersion(page, "replacement");
  await page.goto(url);
  await disable.click();
  await ownerAction(page, page, "ยืนยันปิดใช้งาน");
  await page.reload();
  await expect(page.getByText("ปิดใช้งาน", { exact: true })).toBeVisible();
  await expect(priceHistory).toContainText("1000 g ต่อแพ็ก");
  await expect(page.getByRole("button", { name: "บันทึกราคา", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "บันทึกยอดนับ", exact: true })).toHaveCount(0);
  expect(await inventoryUrl(page, renamed)).toBe(url);
  await page.goto(productUrl);
  await page.getByRole("button", { name: "เพิ่มเวอร์ชันสูตร", exact: true }).click();
  await expect(ingredient(editor(page), 1).getByRole("option", { name: `${renamed} (g)`, exact: true })).toHaveCount(0);
  await expect(card(page, "current").getByRole("listitem").filter({ hasText: renamed })).toContainText("ปิดใช้งานแล้ว");
});
