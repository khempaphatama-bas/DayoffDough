import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addInventoryPrice, configureShopSettings, createBakeCycle, createCustomer, createDeliveryMethod,
  createInventoryItem, createOrder, createProduct, createProductionTemplate,
  createRecipeVersion, loginAsOwner,
} from "../fixtures/owner";

const TIMEOUT = 30_000;

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(0);
}

// Wait for this page's Server Action, not an unrelated background request.
async function action(page: Page, scope: Page | Locator, name: string) {
  const pathname = new URL(page.url()).pathname;
  const response = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname === pathname, { timeout: TIMEOUT });
  await scope.getByRole("button", { name, exact: true }).filter({ visible: true }).click();
  const result = await response;
  expect(result.ok()).toBe(true);
  expect(await result.finished()).toBeNull();
}

test("owner explicitly packs, delivers and completes a cycle before collecting its balance", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  page.setDefaultTimeout(TIMEOUT);
  const run = `operations-${testInfo.project.name}-${Date.now()}`;
  const productName = `ขนม ${run}`;
  const flourName = `แป้ง ${run}`;
  const deliveryMethodName = `ส่ง ${run}`;
  const timed = `Z นัดเช้า ${run}`;
  const untimed = `A ไม่ระบุเวลา ${run}`;
  // Keep the full, deliberately long option text: native select sizing must fit a phone.
  const cycleName = `รอบ ${run}`;
  await loginAsOwner(page);
  await configureShopSettings(page);
  await createInventoryItem(page, { name: flourName, category: "INGREDIENT", purchaseLabel: "ถุง", packQuantity: "1000" });
  await addInventoryPrice(page, flourName, { packPriceBaht: "50" });
  await createProduct(page, { name: productName, sellingPriceBaht: "100" });
  await createRecipeVersion(page, productName, { versionCode: run, yieldQuantity: "6", ingredientName: flourName, ingredientQuantity: "500" });
  await createProductionTemplate(page, { name: `สูตร ${run}`, scope: "PRODUCT", productName, activate: true, activities: [
    { name: `เตรียม ${run}`, offsetDaysFromDelivery: "-1", defaultTime: "08:00", estimatedDurationMinutes: "30" },
    { name: `อบ ${run}`, offsetDaysFromDelivery: "0", defaultTime: "09:00", estimatedDurationMinutes: "40" },
  ] });
  await createDeliveryMethod(page, { name: deliveryMethodName, customerFeeBaht: "0", internalCostBaht: "0" });
  for (const name of [untimed, timed]) await createCustomer(page, { name, deliveryMethodName, deliveryLocation: "กรุงเทพฯ" });
  await createBakeCycle(page, { name: cycleName, productionDate: "2030-05-10", deliveryDate: "2030-05-11" });
  const cycleUrl = page.url();
  for (const customerName of [untimed, timed]) {
    await createOrder(page, { customerName, cycleName, productName, totalQuantity: 4, discountBaht: "0", amountPaidBaht: "0", ...(customerName === timed ? { confirmedDeliveryTime: "08:30" } : {}) });
    await expect(page.getByLabel("เวลานัดส่ง")).toHaveValue(customerName === timed ? "08:30" : "");
    await page.getByLabel("วันส่งยืนยัน", { exact: true }).fill("2030-05-11");
    await action(page, page.getByRole("main"), "บันทึกการแก้ไข");
  }
  await page.goto(`${cycleUrl}/planning`);
  await action(page, page, "ยืนยันล็อกรอบ");
  await page.goto(`${cycleUrl}/operations`);
  const board = page.getByRole("region", { name: "เตรียมและแพ็กออเดอร์", exact: true });
  const order = (name: string) => board.getByRole("article", { name: `ออเดอร์ ${name}`, exact: true });
  await expect(board.getByRole("article").nth(0)).toHaveAccessibleName(`ออเดอร์ ${timed}`);
  await expect(board.getByRole("article").nth(1)).toHaveAccessibleName(`ออเดอร์ ${untimed}`);
  await expect(page.getByRole("combobox", { name: "เลือกรอบผลิต", exact: true }).getByRole("option", { selected: true })).toContainText(cycleName);
  await expectNoHorizontalOverflow(page);
  await expect(order(timed)).toContainText("08:30");
  await expect(order(timed)).toContainText("2030-05-11");
  await expect(order(untimed)).toContainText("ยังไม่กำหนดเวลา");
  await expect(board.getByRole("spinbutton")).toHaveCount(0);
  await action(page, page, "เริ่มรอบผลิต");
  const confirm = board.getByRole("region", { name: "รอยืนยันออเดอร์", exact: true });
  if (await confirm.count()) {
    for (const name of [timed, untimed]) await confirm.getByLabel(`เลือกยืนยันออเดอร์ ${name}`, { exact: true }).check();
    await action(page, confirm, "ยืนยันออเดอร์ 2 ออเดอร์");
  }
  const start = board.getByRole("region", { name: "รอเริ่มทำออเดอร์", exact: true });
  for (const name of [timed, untimed]) await start.getByLabel(`เลือกเริ่มทำออเดอร์ ${name}`, { exact: true }).check();
  await action(page, start, "เริ่มทำออเดอร์ 2 ออเดอร์");
  await expect(order(timed).getByRole("button", { name: "ยืนยันแพ็กครบ" })).toHaveCount(0);
  const partial = order(timed).locator("form").filter({ hasText: "บรรทัดที่สอง" });
  await partial.getByRole("spinbutton").fill("1");
  await action(page, partial, `บันทึกจำนวนแพ็ก ${productName}`);
  await expect(partial).toContainText("แพ็กแล้ว 1");
  await partial.getByRole("spinbutton").fill("4");
  await expect(partial.getByRole("alert")).toContainText("จำนวนที่แพ็กต้องอยู่ระหว่าง 0 ถึง 3");
  await expect(partial.getByRole("button", { name: `บันทึกจำนวนแพ็ก ${productName}` })).toBeDisabled();
  await expect(partial.getByRole("spinbutton")).toHaveValue("4");
  for (const name of [timed, untimed]) {
    for (const [line, quantity] of [["บรรทัดแรก", 1], ["บรรทัดที่สอง", 3]] as const) {
      const form = order(name).locator("form").filter({ hasText: line });
      await form.getByRole("spinbutton").fill(String(quantity));
      await action(page, form, `บันทึกจำนวนแพ็ก ${productName}`);
      await expect(form).toContainText(`แพ็กแล้ว ${quantity}`);
    }
    await expect(order(name)).toContainText("กำลังผลิต");
    await action(page, order(name), "ยืนยันแพ็กครบ");
    await expect(order(name)).toContainText("แพ็กเสร็จแล้ว");
  }
  const payments = page.getByRole("region", { name: "รับชำระเงิน", exact: true });
  const payment = (name: string) => payments.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await payment(timed).getByLabel("รับเพิ่ม", { exact: true }).fill("100");
  await action(page, payment(timed), "บันทึกรับเงิน");
  await expect(payment(timed)).toContainText("คงเหลือ 300.00 บาท");
  await action(page, payment(untimed), "ชำระครบ");
  await expect(payment(untimed)).toContainText("ชำระแล้ว");
  await page.goto(`${cycleUrl}/planning`);
  await page.getByLabel("เหตุผลที่ปลดล็อก").fill("ทดสอบป้องกันหลังเริ่มออเดอร์");
  await page.getByLabel("พิมพ์คำว่า ปลดล็อก เพื่อยืนยัน").fill("ปลดล็อก");
  await action(page, page, "ปลดล็อกรอบ");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("ปลดล็อกรอบไม่ได้ เพราะเริ่มทำออเดอร์แล้ว");
  await page.goto(`${cycleUrl}/operations`);
  await expect(page.getByRole("button", { name: "จบรอบผลิต", exact: true })).toBeDisabled();
  const timeline = page.getByRole("region", { name: "งานตามเวลา", exact: true });
  await timeline.getByText(/^วันถัดไป \(/).click();
  const tasks = timeline.getByRole("article");
  expect(await tasks.count()).toBeGreaterThanOrEqual(2);
  const taskNames = await tasks.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")!));
  for (const [index, name] of taskNames.entries()) {
    const task = timeline.getByRole("article", { name, exact: true });
    if (index === 0) {
      await task.getByRole("button", { name: "ข้ามงาน", exact: true }).click();
      const form = timeline.locator("form").filter({ has: page.getByLabel("เหตุผลที่ข้าม", { exact: true }) });
      await expect(form.getByLabel("เหตุผลที่ข้าม")).toHaveAttribute("required", "");
      await form.getByLabel("เหตุผลที่ข้าม").fill("ตรวจเตรียมไว้แล้วก่อนเริ่มรอบ");
      await action(page, form, "บันทึกงาน");
      // Re-read persisted state instead of depending on the editor/disclosure surviving revalidation.
      await page.goto(`${cycleUrl}/operations`);
      await timeline.getByText(/^วันถัดไป \(/).click();
      await expect(timeline.getByRole("article", { name, exact: true })).toContainText("เหตุผลที่ข้าม: ตรวจเตรียมไว้แล้วก่อนเริ่มรอบ");
    } else {
      await action(page, task, "ทำเสร็จแล้ว");
      await page.goto(`${cycleUrl}/operations`);
      await timeline.getByText(/^วันถัดไป \(/).click();
      await expect(task).toContainText("ทำเสร็จแล้ว");
      await expect(task.getByRole("button", { name: "ทำเสร็จแล้ว", exact: true })).toHaveCount(0);
    }
  }
  await expect(timeline).toContainText("งานทั้งหมดเสร็จแล้ว");
  await expect(page.getByRole("button", { name: "จบรอบผลิต", exact: true })).toBeDisabled();
  const delivery = board.getByRole("region", { name: "พร้อมจัดส่ง", exact: true });
  for (const name of [timed, untimed]) await delivery.getByLabel(`เลือกจัดส่ง ${name}`, { exact: true }).check();
  await delivery.getByRole("button", { name: "ยืนยันส่งสำเร็จ 2 ออเดอร์", exact: true }).click();
  const deliveryDialog = page.getByRole("dialog", { name: "ยืนยันส่งสำเร็จ 2 ออเดอร์" });
  await expect(deliveryDialog).toContainText("ยอดค้าง 1 ออเดอร์ · 300.00 บาท");
  for (const name of [timed, untimed]) await expect(deliveryDialog).toContainText(name);
  await action(page, deliveryDialog, "ยืนยันจัดส่ง");
  await expect(board.getByRole("region", { name: "ส่งสำเร็จแล้ว", exact: true }).getByRole("article")).toHaveCount(2);
  await expect(board.getByRole("spinbutton")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "จบรอบผลิต", exact: true }).click();
  const completion = page.getByRole("dialog", { name: "ยืนยันจบรอบผลิต", exact: true });
  await expect(completion).toContainText("งานค้าง 0 งาน · ออเดอร์ยังไม่ส่ง 0 ใบ");
  await expect(completion).toContainText("ยอดค้าง 1 ออเดอร์ · 300.00 บาท");
  await action(page, completion, "ยืนยันจบรอบผลิต");
  await expect(page.getByRole("main")).toContainText("จบรอบผลิตแล้ว · ยังบันทึกยอดชำระได้");
  await expect(timeline.getByRole("button")).toHaveCount(0);
  await expect(board.getByRole("button")).toHaveCount(0);
  await action(page, payment(timed), "ชำระครบ");
  await expect(payment(timed)).toContainText("คงเหลือ 0.00 บาท");
  await expect(payment(timed)).toContainText("ชำระแล้ว");
});
