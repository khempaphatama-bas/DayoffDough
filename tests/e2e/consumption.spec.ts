import { expect, test } from "@playwright/test";
import {
  addInventoryPrice, configureShopSettings, createBakeCycle, createCustomer,
  createDeliveryMethod, createInventoryItem, createOrder, createProduct,
  createProductionTemplate, createRecipeVersion, loginAsOwner, recordCyclePurchase, verifiedOwnerId,
} from "../fixtures/owner";
import { prepareLocalEmptyRecipe } from "../helpers/local-product-fixture";
import {
  assertLocalLineage, choosePlanned, consumptionScenario, countStock, expectStock, expectViewportFit,
  intentId, ownerAction, startScenario, consumptionUsageForm,
} from "../helpers/consumption-ui";

test.beforeEach(({ page }) => { page.setDefaultTimeout(30_000); });

test("recipe native options keep form and controls inside the viewport", async ({ page }, info) => {
  const run = `geometry-${info.project.name}-${Date.now()}`;
  const name = `แป้งขนมปังสำหรับอบสูตรพิเศษ Whole wheat bread flour long English label ${run}`;
  const product = `สูตร ${run}`;
  await loginAsOwner(page);
  await createInventoryItem(page, { name, category: "INGREDIENT", purchaseLabel: "ถุง", packQuantity: "50" });
  await createProduct(page, { name: product, sellingPriceBaht: "100" });
  await page.getByRole("link", { name: product, exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มเวอร์ชันสูตร", exact: true }).click();
  await page.getByLabel("รหัสเวอร์ชัน").fill(run);
  await page.getByLabel("ผลผลิตต่อสูตร").fill("2");
  await page.getByRole("combobox", { name: "วัตถุดิบ 1", exact: true }).selectOption({ label: `${name} (g)` });
  await page.getByRole("spinbutton", { name: "ปริมาณวัตถุดิบ 1", exact: true }).fill("20");
  console.log("RECIPE_GEOMETRY", JSON.stringify(await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
    rectangles: [...document.querySelectorAll("main form, main form fieldset, main form input, main form select, main form button")]
      .filter(element => element.getBoundingClientRect().width > 0).map(element => {
        const r = element.getBoundingClientRect();
        return { tag: element.tagName, left: r.left, right: r.right, width: r.width };
      }),
  }))));
  await expectViewportFit(page, "recipe native options");
  await ownerAction(page, page, "บันทึกเวอร์ชันสูตร");
  await expect(page.getByRole("main")).toContainText("บันทึกเวอร์ชันสูตรแล้ว");
});

test("template native options and sticky save fit the viewport", async ({ page }, info) => {
  const run = `template-geometry-${info.project.name}-${Date.now()}`;
  const product = `ขนมปังโฮลวีต Whole wheat sourdough bread with long native product option ${run}`;
  await loginAsOwner(page);
  await createProduct(page, { name: product, sellingPriceBaht: "100" });
  await page.goto("/production/templates/new");
  await page.getByLabel("ชื่อเทมเพลต").fill(run);
  await page.getByLabel("ใช้กับ").selectOption("PRODUCT");
  await page.locator('select[name="productId"]').selectOption({ label: product });
  await page.getByLabel("ชื่อกิจกรรม 1", { exact: true }).fill("อบและตรวจขนม");
  const save = page.getByRole("button", { name: "บันทึกเทมเพลต", exact: true });
  await save.scrollIntoViewIfNeeded();
  console.log("TEMPLATE_GEOMETRY", JSON.stringify(await page.evaluate(() => {
    const save = document.querySelector('main button[type="submit"]')!;
    const r = save.getBoundingClientRect();
    return { viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
      hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.tagName ?? null,
      rectangles: [...document.querySelectorAll("main form, main form section, main form article, main form input, main form select, main button[type=submit]")]
        .filter(element => element.getBoundingClientRect().width > 0).map(element => {
          const rect = element.getBoundingClientRect();
          return { tag: element.tagName, left: rect.left, right: rect.right, width: rect.width };
        }) };
  })));
  await expectViewportFit(page, "template native options");
  await ownerAction(page, page, "บันทึกเทมเพลต");
  await expect(page).toHaveURL(/\/production\/templates\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: run, exact: true })).toBeVisible();
});

test("order native options and sticky save fit the viewport", async ({ page }, info) => {
  const run = `order-geometry-${info.project.name}-${Date.now()}`;
  const product = `ขนมปังโฮลวีต Whole wheat sourdough bread with long native product option ${run}`;
  const delivery = `ส่ง ${run}`, customer = `ลูกค้า ${run}`;
  await loginAsOwner(page);
  await createProduct(page, { name: product, sellingPriceBaht: "100" });
  await createDeliveryMethod(page, { name: delivery, customerFeeBaht: "0", internalCostBaht: "0" });
  await createCustomer(page, { name: customer, deliveryMethodName: delivery, deliveryLocation: "กรุงเทพฯ" });
  await createBakeCycle(page, { name: run, productionDate: "2030-06-10", deliveryDate: "2030-06-11" });
  await page.goto("/orders/new");
  await page.getByRole("combobox", { name: "ลูกค้า", exact: true }).selectOption({ label: customer });
  const cycleOption = page.getByRole("combobox", { name: "รอบผลิต", exact: true }).getByRole("option").filter({ hasText: run });
  await page.getByRole("combobox", { name: "รอบผลิต", exact: true }).selectOption({ label: (await cycleOption.textContent())!.trim() });
  await page.getByRole("combobox", { name: "สินค้า รายการที่ 1", exact: true }).selectOption({ label: product });
  await page.getByRole("spinbutton", { name: "จำนวน รายการที่ 1", exact: true }).fill("1");
  console.log("ORDER_GEOMETRY", JSON.stringify(await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
    rectangles: [...document.querySelectorAll("main form, main form section, main form article, main form select")]
      .map(element => { const r = element.getBoundingClientRect(); return { tag: element.tagName, left: r.left, right: r.right, width: r.width }; }),
  }))));
  await expectViewportFit(page, "order native options");
  await ownerAction(page, page, "บันทึกออเดอร์");
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "แก้ไขออเดอร์", exact: true })).toBeVisible();
});

test("historical correction after a count keeps current stock and fits the viewport", async ({ page }, info) => {
  test.setTimeout(480_000);
  const s = await consumptionScenario(page, `use-${info.project.name}-${Date.now()}`, { flour: "10", boxes: "10" });
  await page.goto(`${s.cycleUrl}/shopping`);
  await recordCyclePurchase(page, { itemName: s.flour, packCount: "1", totalPriceBaht: "50", purchasedFrom: "ร้านทดสอบ", occurredAt: "2026-11-01T10:00" });
  await expectStock(page, s.flourUrl, "60");
  await startScenario(page, s.cycleUrl);
  await page.goto(`${s.cycleUrl}/consumption`);
  await expectViewportFit(page, "initial long-label usage");
  const confirm = consumptionUsageForm(page);
  const firstId = await intentId(confirm);
  await choosePlanned(confirm);
  await expect(confirm.getByLabel(`จำนวนใช้ ${s.flour}`, { exact: true })).toHaveValue("20");
  await expect(confirm.getByLabel(`จำนวนใช้ ${s.boxes}`, { exact: true })).toHaveValue("2");
  await expect(confirm.getByRole("combobox").first().getByRole("option")).toHaveCount(2);
  await confirm.getByRole("checkbox").check();
  await confirm.getByLabel(`จำนวนใช้ ${s.flour}`, { exact: true }).fill("61");
  await confirm.getByLabel(`เหตุผล ${s.flour}`, { exact: true }).fill("ทดสอบยอดเกินสต๊อก");
  await ownerAction(page, confirm, "ยืนยันยอดใช้");
  await expect(confirm.getByRole("alert")).toContainText("สต๊อกไม่เพียงพอ");
  const failedUse = JSON.parse(await confirm.locator('input[name="payload"]').inputValue()) as { items: { inventoryItemId: string; basis: string; usedQuantity: string }[] };
  const flourId = s.flourUrl.split("/").at(-1);
  console.log("FAILED_USE_DRAFT", JSON.stringify({ basis: failedUse.items.find(item => item.inventoryItemId === flourId)!.basis,
    visibleBasis: await confirm.getByLabel(`ที่มาของยอดใช้ ${s.flour}`, { exact: true }).inputValue(),
    confirmed: await confirm.getByRole("checkbox").isChecked(), sameIntent: await intentId(confirm) === firstId }));
  expect(await intentId(confirm)).toBe(firstId);
  await expect(confirm.getByLabel(`จำนวนใช้ ${s.flour}`, { exact: true })).toHaveValue("61");
  await expect(confirm.getByLabel(`ที่มาของยอดใช้ ${s.flour}`, { exact: true })).toHaveValue("OWNER_REPORTED");
  await expect(confirm.getByLabel(`เหตุผล ${s.flour}`, { exact: true })).toHaveValue("ทดสอบยอดเกินสต๊อก");
  await expect(confirm.getByRole("checkbox")).toBeChecked();
  await expect(page.getByRole("region", { name: "ประวัติยอดใช้ที่บันทึกแล้ว" }).getByRole("article")).toHaveCount(0);
  await expectViewportFit(page, "ordinary shortage error retention");
  await choosePlanned(confirm);
  await confirm.getByLabel(`เหตุผล ${s.flour}`, { exact: true }).fill("");
  await ownerAction(page, confirm, "ยืนยันยอดใช้");
  await page.reload();
  const history = page.getByRole("region", { name: "ประวัติยอดใช้ที่บันทึกแล้ว" });
  await expect(history.getByRole("article")).toHaveCount(1);
  await expect(history).toContainText("ยอดใช้ 20 · ผลสต๊อก -20 · DIRECT");
  await expectStock(page, s.flourUrl, "40"); // Over-purchase remains; not all50 purchased is consumed.
  await expectStock(page, s.boxesUrl, "8", "piece");
  const ids = [firstId];
  // Three consecutive saves must create fresh intents and committed revisions.
  for (const [quantity, revision] of [["18", 2], ["19", 3]] as const) {
    await page.goto(`${s.cycleUrl}/consumption`);
    const edit = consumptionUsageForm(page, true);
    ids.push(await intentId(edit));
    await edit.getByLabel(`จำนวนใช้ ${s.flour}`, { exact: true }).fill(quantity);
    await edit.getByLabel(`เหตุผล ${s.flour}`, { exact: true }).fill(`ชั่งใหม่ ${quantity}`);
    await edit.getByLabel("เหตุผลการแก้ไข", { exact: true }).fill(`แก้ยอดครั้งที่ ${revision}`);
    await expectViewportFit(page, "edit");
    await ownerAction(page, edit, "บันทึกการแก้ไข");
    await page.reload();
    await expect(history.getByRole("article")).toHaveCount(revision);
    await expect(consumptionUsageForm(page, true).getByLabel(`จำนวนใช้ ${s.flour}`, { exact: true })).toHaveValue(quantity);
  }
  expect(new Set(ids).size).toBe(3);
  await expectStock(page, s.flourUrl, "41");
  await page.goto(`${s.cycleUrl}/operations`);
  const board = page.getByRole("region", { name: "เตรียมและแพ็กออเดอร์", exact: true });
  const order = board.getByRole("article", { name: `ออเดอร์ ${s.customer}`, exact: true });
  const confirmation = board.getByRole("region", { name: "รอยืนยันออเดอร์", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("checkbox").check();
  await ownerAction(page, confirmation, "ยืนยันออเดอร์ 1 ออเดอร์");
  const start = board.getByRole("region", { name: "รอเริ่มทำออเดอร์", exact: true });
  await start.getByRole("checkbox").check();
  await ownerAction(page, start, "เริ่มทำออเดอร์ 1 ออเดอร์");
  for (const line of ["บรรทัดแรก", "บรรทัดที่สอง"]) {
    const form = order.locator("form").filter({ hasText: line });
    await form.getByRole("spinbutton").fill("1");
    await ownerAction(page, form, `บันทึกจำนวนแพ็ก ${s.product}`);
  }
  await ownerAction(page, order, "ยืนยันแพ็กครบ");
  const timeline = page.getByRole("region", { name: "งานตามเวลา", exact: true });
  // The cycle-level templates from other E2E scenarios remain legitimate tasks.
  for (const detail of await timeline.locator("details").all()) {
    if (await detail.getAttribute("open") === null) await detail.locator("summary").click();
  }
  for (const task of await timeline.getByRole("article").all()) await ownerAction(page, task, "ทำเสร็จแล้ว");
  const delivery = board.getByRole("region", { name: "พร้อมจัดส่ง", exact: true });
  await delivery.getByRole("checkbox").check();
  await delivery.getByRole("button", { name: "ยืนยันส่งสำเร็จ 1 ออเดอร์", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันส่งสำเร็จ 1 ออเดอร์", exact: true });
  await expect(dialog).toContainText("ยอดค้าง 1 ออเดอร์ · 200.00 บาท");
  await ownerAction(page, dialog, "ยืนยันจัดส่ง");
  const finish = page.getByRole("button", { name: "จบรอบผลิต", exact: true });
  await finish.focus();
  await finish.press("Enter");
  const complete = page.getByRole("dialog", { name: "ยืนยันจบรอบผลิต", exact: true });
  await expect(complete.getByRole("button", { name: "ยกเลิก", exact: true })).toBeFocused();
  await complete.press("Escape");
  await expect(complete).toHaveCount(0);
  await expect(finish).toBeFocused();
  await finish.press("Enter");
  await expect(complete).toContainText("ยอดค้าง 1 ออเดอร์ · 200.00 บาท");
  await ownerAction(page, complete, "ยืนยันจบรอบผลิต");
  await expect(page.getByRole("main")).toContainText("จบรอบผลิตแล้ว · ยังบันทึกยอดชำระได้");
  await countStock(page, s.flourUrl, "25");
  await page.goto(`${s.cycleUrl}/consumption`);
  const correction = consumptionUsageForm(page, true);
  await correction.getByLabel(`จำนวนใช้ ${s.flour}`, { exact: true }).fill("17");
  await correction.getByLabel(`เหตุผล ${s.flour}`, { exact: true }).fill("ตรวจประวัติหลังนับใหม่");
  await correction.getByLabel("เหตุผลการแก้ไข", { exact: true }).fill("แก้ประวัติไม่คืนสต๊อก");
  await expect(correction.getByText("แก้ประวัติเท่านั้น ไม่ปรับสต๊อกปัจจุบัน", { exact: true })).toBeVisible();
  await expectViewportFit(page, "post-count edit");
  await ownerAction(page, correction, "บันทึกการแก้ไข");
  await page.reload();
  await expect(history.getByRole("article")).toHaveCount(4);
  await expect(history).toContainText("ยอดใช้ 17 · ผลสต๊อก 0 · HISTORY_ONLY");
  await expectViewportFit(page, "immutable history");
  await expectStock(page, s.flourUrl, "25");
  await assertLocalLineage(page, s.cycleUrl, s.fingerprint);
});

test("cancelled production requires explicit actual and zero use without status-driven stock return", async ({ page }, info) => {
  test.setTimeout(480_000);
  const s = await consumptionScenario(page, `cancel-${info.project.name}-${Date.now()}`);
  await startScenario(page, s.cycleUrl);
  await page.goto(s.cycleUrl);
  await page.getByRole("form", { name: "เปลี่ยนสถานะรอบผลิต" }).getByRole("combobox").selectOption("CANCELLED");
  page.once("dialog", dialog => dialog.accept());
  await ownerAction(page, page.getByRole("form", { name: "เปลี่ยนสถานะรอบผลิต" }), "อัปเดตสถานะ");
  await expectStock(page, s.flourUrl, "100");
  await page.goto(`${s.cycleUrl}/consumption`);
  const form = consumptionUsageForm(page);
  for (const name of [s.flour, s.boxes]) {
    await expect(form.getByLabel(`จำนวนใช้ ${name}`, { exact: true })).toHaveValue("");
    const basis = form.getByLabel(`ที่มาของยอดใช้ ${name}`, { exact: true });
    await expect(basis).toHaveValue("OWNER_REPORTED");
    await expect(basis.getByRole("option")).toHaveCount(1);
  }
  await expect(form.getByRole("button", { name: "ยืนยันยอดใช้", exact: true })).toBeDisabled();
  await form.getByLabel(`จำนวนใช้ ${s.flour}`, { exact: true }).fill("5");
  await form.getByLabel(`จำนวนใช้ ${s.boxes}`, { exact: true }).fill("0");
  await form.getByLabel(`เหตุผล ${s.flour}`, { exact: true }).fill("อบไปบางส่วนก่อนยกเลิก");
  await form.getByLabel(`เหตุผล ${s.boxes}`, { exact: true }).fill("ไม่ได้แพ็ก");
  await form.getByRole("checkbox").check();
  await expectViewportFit(page, "cancelled actual");
  await ownerAction(page, form, "ยืนยันยอดใช้");
  await page.reload();
  const history = page.getByRole("region", { name: "ประวัติยอดใช้ที่บันทึกแล้ว" });
  await expect(history).toContainText("ยอดใช้ 5 · ผลสต๊อก -5 · DIRECT");
  await expect(history).toContainText("ยอดใช้ 0 · ผลสต๊อก 0 · DIRECT");
  await expectStock(page, s.flourUrl, "95");
  await expectStock(page, s.boxesUrl, "10", "piece");
  await assertLocalLineage(page, s.cycleUrl, s.fingerprint);
});

test("pending COUNT settles flour only, rolls back a boxes shortage and refreshes stale previews", async ({ page }, info) => {
  test.setTimeout(480_000);
  const s = await consumptionScenario(page, `settle-${info.project.name}-${Date.now()}`, { flour: "10", boxes: "2" });
  await startScenario(page, s.cycleUrl);
  await page.goto(s.flourUrl);
  await expect(page.getByRole("button", { name: "บันทึกยอดนับ", exact: true })).toBeDisabled();
  await expect(page.getByRole("main")).toContainText("มีรอบค้างยอดใช้");
  await page.getByRole("link", { name: "นับของเหลือและเคลียร์ยอดใช้", exact: true }).click();
  await expect(page).toHaveURL(/\/consumption\?mode=settle&countItem=[0-9a-f-]+$/);
  const selectedUrl = page.url();
  await expectViewportFit(page, "settlement initial");
  const selection = page.getByRole("form", { name: "เลือกรายการนับของเหลือ", exact: true });
  await selection.getByRole("checkbox", { name: `นับของเหลือ ${s.boxes}`, exact: true }).check();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("เปลี่ยนรายการนับแล้ว");
  const settle = page.getByRole("form", { name: "นับของเหลือและเคลียร์ยอดใช้", exact: true });
  await expect(settle.locator('input[name="payload"]')).toBeDisabled();
  await selection.getByRole("button", { name: "ดูตัวอย่างและเริ่มรายการนับใหม่", exact: true }).click();
  await expect(settle.getByLabel(new RegExp(`^ของเหลือหลังใช้ ${s.boxes}`))).toHaveValue("");
  await selection.getByRole("checkbox", { name: `นับของเหลือ ${s.boxes}`, exact: true }).uncheck();
  await selection.getByRole("button", { name: "ดูตัวอย่างและเริ่มรายการนับใหม่", exact: true }).click();
  await expect(settle.getByLabel(new RegExp(`^ของเหลือหลังใช้ ${s.boxes}`))).toHaveCount(0);
  async function fillSettlement(boxes: string) {
    await choosePlanned(settle);
    await settle.getByLabel(`จำนวนใช้ ${s.boxes}`, { exact: true }).fill(boxes);
    await settle.getByLabel(`เหตุผล ${s.boxes}`, { exact: true }).fill("ตรวจยอดกล่อง");
    await settle.getByLabel(new RegExp(`^ของเหลือหลังใช้ ${s.flour}`)).fill("25");
    await settle.getByLabel("เหตุผลการนับและเคลียร์ยอดใช้", { exact: true }).fill("นับของเหลือหลังอบ");
    await settle.getByRole("checkbox").check();
  }
  await fillSettlement("3");
  const shortageId = await intentId(settle);
  await ownerAction(page, settle, "บันทึกยอดใช้และของเหลือพร้อมกัน");
  await expect(settle.getByRole("alert")).toBeVisible();
  const failedSettlement = JSON.parse(await settle.locator('input[name="payload"]').inputValue()) as { contexts: { items: { inventoryItemId: string; basis: string }[] }[] };
  const boxesId = s.boxesUrl.split("/").at(-1);
  console.log("FAILED_SETTLEMENT_DRAFT", JSON.stringify({ basis: failedSettlement.contexts.flatMap(context => context.items).find(item => item.inventoryItemId === boxesId)!.basis,
    visibleBasis: await settle.getByLabel(`ที่มาของยอดใช้ ${s.boxes}`, { exact: true }).inputValue(),
    confirmed: await settle.getByRole("checkbox").isChecked(), sameIntent: await intentId(settle) === shortageId }));
  await expect(settle.getByLabel(`ที่มาของยอดใช้ ${s.boxes}`, { exact: true })).toHaveValue("OWNER_REPORTED");
  await expect(settle.getByRole("checkbox")).toBeChecked();
  expect(await intentId(settle)).toBe(shortageId);
  await expect(settle.getByLabel(`จำนวนใช้ ${s.boxes}`, { exact: true })).toHaveValue("3");
  await expect(settle.getByLabel(new RegExp(`^ของเหลือหลังใช้ ${s.flour}`))).toHaveValue("25");
  await expectViewportFit(page, "settlement shortage error");
  await expectStock(page, s.flourUrl, "10");
  await expectStock(page, s.boxesUrl, "2", "piece");
  await page.goto(`${s.cycleUrl}/consumption`);
  await expect(page.getByRole("region", { name: "ประวัติยอดใช้ที่บันทึกแล้ว" }).getByRole("article")).toHaveCount(0);
  await page.goto(selectedUrl);
  await fillSettlement("2");
  const staleId = await intentId(settle);
  const other = await page.context().newPage();
  await other.goto(`${s.cycleUrl}/shopping`);
  await recordCyclePurchase(other, { itemName: s.flour, packCount: "1", totalPriceBaht: "50", purchasedFrom: "ร้านทดสอบ", occurredAt: "2026-11-01T10:00" });
  await other.close();
  await ownerAction(page, settle, "บันทึกยอดใช้และของเหลือพร้อมกัน");
  await expect(settle.getByRole("alert")).toBeVisible();
  expect(await intentId(settle)).toBe(staleId);
  await expect(settle.getByLabel(`จำนวนใช้ ${s.boxes}`, { exact: true })).toHaveValue("2");
  await expectViewportFit(page, "settlement stale error");
  await settle.getByRole("link", { name: "เปิดข้อมูลล่าสุดและเริ่มรายการใหม่", exact: true }).click();
  expect(await intentId(settle)).not.toBe(staleId);
  await expect(settle.getByLabel(new RegExp(`^ของเหลือหลังใช้ ${s.flour}`))).toHaveValue("");
  await fillSettlement("2");
  await expect(settle).toContainText("DIRECT รวม -2");
  await ownerAction(page, settle, "บันทึกยอดใช้และของเหลือพร้อมกัน");
  await page.goto(`${s.cycleUrl}/consumption`);
  const history = page.getByRole("region", { name: "ประวัติยอดใช้ที่บันทึกแล้ว" });
  await expect(history.getByRole("article")).toHaveCount(1);
  await expect(history).toContainText("ยอดใช้ 20 · ผลสต๊อก 0 · COUNT_SETTLED");
  await expect(history).toContainText("ยอดใช้ 2 · ผลสต๊อก -2 · DIRECT");
  await expectViewportFit(page, "settled history");
  await expectStock(page, s.flourUrl, "25");
  await expect(page.getByRole("button", { name: "บันทึกยอดนับ", exact: true })).toBeEnabled();
  await expectStock(page, s.boxesUrl, "0", "piece");
  await assertLocalLineage(page, s.cycleUrl, s.fingerprint);
});

test("zero-item production needs both explicit confirmations and a reason before recording", async ({ page }, info) => {
  test.setTimeout(480_000);
  const run = `consumption-empty-${info.project.name}-${Date.now()}`;
  const ingredient = `แป้ง ${run}`, delivery = `ส่ง ${run}`, customer = `ลูกค้า ${run}`;
  await loginAsOwner(page);
  const ownerId = await verifiedOwnerId(page);
  await configureShopSettings(page);
  await createInventoryItem(page, { name: ingredient, category: "INGREDIENT", purchaseLabel: "ถุง", packQuantity: "50" });
  await addInventoryPrice(page, ingredient, { packPriceBaht: "50" });
  await createProduct(page, { name: run, sellingPriceBaht: "100" });
  const productHref = await page.getByRole("link", { name: run, exact: true }).getAttribute("href");
  const productId = /^\/products\/([0-9a-f-]+)$/.exec(productHref ?? "")?.[1];
  expect(productId).toBeDefined();
  await createRecipeVersion(page, run, { versionCode: run, yieldQuantity: "2", ingredientName: ingredient, ingredientQuantity: "20", wastePercent: "0" });
  // R45 sole master-precondition exception; no order/plan/context exists yet.
  // All actual workflow actions below remain authenticated visible UI.
  await prepareLocalEmptyRecipe({ ownerId, productId: productId!, name: run, versionCode: run });
  await createProductionTemplate(page, { name: `อบ ${run}`, scope: "PRODUCT", productName: run, activate: true,
    activities: [{ name: `อบ ${run}`, offsetDaysFromDelivery: "-1", defaultTime: "08:00", estimatedDurationMinutes: "20" }] });
  await createDeliveryMethod(page, { name: delivery, customerFeeBaht: "0", internalCostBaht: "0" });
  await createCustomer(page, { name: customer, deliveryMethodName: delivery, deliveryLocation: "กรุงเทพฯ" });
  await createBakeCycle(page, { name: run, productionDate: "2030-06-10", deliveryDate: "2030-06-11" });
  const cycleUrl = new URL(page.url()).pathname;
  await createOrder(page, { customerName: customer, cycleName: run, productName: run, totalQuantity: 2, discountBaht: "0", amountPaidBaht: "0" });
  await page.goto(`${cycleUrl}/planning`);
  await ownerAction(page, page, "ยืนยันล็อกรอบ");
  const fingerprint = await assertLocalLineage(page, cycleUrl);
  // Exact empty required set is the only initial-stock-check exception.
  await startScenario(page, cycleUrl);
  await page.goto(`${cycleUrl}/consumption`);
  const form = consumptionUsageForm(page), save = form.getByRole("button", { name: "ยืนยันยอดใช้", exact: true });
  await expect(form.getByRole("combobox")).toHaveCount(0);
  await expect(save).toBeDisabled();
  await form.getByRole("checkbox", { name: "ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว", exact: true }).check();
  await expect(save).toBeDisabled();
  await form.getByRole("checkbox", { name: "ยืนยันว่ารุ่นนี้ไม่มีรายการต้องใช้", exact: true }).check();
  await expect(save).toBeDisabled();
  await form.getByLabel("เหตุผลการบันทึก", { exact: true }).fill("ยืนยันแผนไม่มีรายการใช้ ไม่สร้างรายการจากหมวดสต๊อก");
  await expectViewportFit(page, "empty confirmation");
  await ownerAction(page, form, "ยืนยันยอดใช้");
  await page.reload();
  const history = page.getByRole("region", { name: "ประวัติยอดใช้ที่บันทึกแล้ว" });
  await expect(history.getByRole("article")).toHaveCount(1);
  await expect(history.getByRole("listitem")).toHaveCount(0);
  await expect(history).toContainText("ยืนยันแผนไม่มีรายการใช้ ไม่สร้างรายการจากหมวดสต๊อก");
  await assertLocalLineage(page, cycleUrl, fingerprint);
});
