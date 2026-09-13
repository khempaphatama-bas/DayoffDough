import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addInventoryPrice,
  configureShopSettings,
  createBakeCycle,
  createCustomer,
  createDeliveryMethod,
  createInventoryItem,
  createOrder,
  createPackagingRule,
  createProduct,
  createProductionTemplate,
  createRecipeVersion,
  loginAsOwner,
} from "../fixtures/owner";

const SERVER_ACTION_TIMEOUT = 30_000;

function currentPageAction(page: Page) {
  const pathname = new URL(page.url()).pathname;
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
}

async function submitCurrentPageAction(
  page: Page,
  container: Page | Locator,
  buttonName: string,
): Promise<void> {
  const response = currentPageAction(page);
  await container.getByRole("button", { name: buttonName, exact: true }).click();
  expect((await response).ok()).toBe(true);
}

test("owner runs the complete production timeline lifecycle", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  page.setDefaultTimeout(SERVER_ACTION_TIMEOUT);
  page.setDefaultNavigationTimeout(SERVER_ACTION_TIMEOUT);
  const runId = `production-${testInfo.project.name}-${Date.now()}`;
  const flourName = `แป้งผลิต ${runId}`;
  const boxName = `กล่องผลิต ${runId}`;
  const productName = `ขนมผลิต ${runId}`;
  const deliveryMethodName = `จัดส่งผลิต ${runId}`;
  const customerName = `ลูกค้าผลิต ${runId}`;
  const cycleName = `รอบผลิตไทม์ไลน์ ${runId}`;
  const editedTitle = `อบแก้ไขแล้ว ${runId}`;
  const manualTitle = `งานเพิ่มเอง ${runId}`;

  await loginAsOwner(page);
  await configureShopSettings(page);
  await createInventoryItem(page, {
    name: flourName,
    category: "INGREDIENT",
    purchaseLabel: "ถุง",
    packQuantity: "1000",
  });
  await addInventoryPrice(page, flourName, { packPriceBaht: "55" });
  await createInventoryItem(page, {
    name: boxName,
    category: "PACKAGING",
    baseUnit: "piece",
    purchaseLabel: "แพ็ก",
    packQuantity: "100",
  });
  await addInventoryPrice(page, boxName, { packPriceBaht: "50" });
  await createProduct(page, { name: productName, sellingPriceBaht: "220" });
  await createRecipeVersion(page, productName, {
    versionCode: `v1-${runId}`,
    yieldQuantity: "6",
    ingredientName: flourName,
    ingredientQuantity: "1000",
    laborMinutes: "30",
    utilityCostBaht: "20",
  });
  await createDeliveryMethod(page, {
    name: deliveryMethodName,
    customerFeeBaht: "0",
    internalCostBaht: "0",
  });
  await createPackagingRule(page, {
    productName,
    inventoryItemName: boxName,
    basis: "PER_PRODUCT_UNIT",
    quantity: "1",
  });
  await createCustomer(page, {
    name: customerName,
    deliveryMethodName,
    deliveryLocation: "บางรัก กรุงเทพฯ",
  });
  await createBakeCycle(page, {
    name: cycleName,
    productionDate: "2030-04-10",
    deliveryDate: "2030-04-11",
  });
  const cycleUrl = page.url();
  await createOrder(page, {
    customerName,
    cycleName,
    productName,
    totalQuantity: 10,
    discountBaht: "0",
    amountPaidBaht: "0",
  });

  await page.goto(`${cycleUrl}/planning`);
  await expect(page.getByRole("main")).toContainText(
    "สินค้ายังไม่มีเทมเพลตการผลิตที่พร้อมใช้",
  );
  await expect(page.getByRole("button", { name: "ยืนยันล็อกรอบ" })).toBeDisabled();

  await createProductionTemplate(page, {
    name: `เทมเพลตสินค้า ${runId}`,
    scope: "PRODUCT",
    productName,
    activities: [
      {
        name: `เตรียมแป้ง ${runId}`,
        offsetDaysFromDelivery: "-1",
        defaultTime: "08:00",
        estimatedDurationMinutes: "45",
      },
      {
        name: `อบขนม ${runId}`,
        offsetDaysFromDelivery: "-1",
        defaultTime: "10:00",
        estimatedDurationMinutes: "60",
      },
    ],
    activate: true,
  });
  await createProductionTemplate(page, {
    name: `เทมเพลตรอบ ${runId}`,
    scope: "CYCLE",
    activities: [{
      name: `ตรวจรอบ ${runId}`,
      offsetDaysFromDelivery: "-2",
      defaultTime: "09:00",
      estimatedDurationMinutes: "20",
    }],
    activate: true,
  });

  await page.goto(`${cycleUrl}/planning`);
  await expect(page.getByRole("button", { name: "ยืนยันล็อกรอบ" })).toBeEnabled();
  await submitCurrentPageAction(page, page, "ยืนยันล็อกรอบ");
  await page.goto(`${cycleUrl}/production`);
  await expect(page.getByRole("heading", { name: "Production Timeline" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`เตรียมแป้ง ${runId}`);
  await expect(page.getByRole("main")).toContainText(`อบขนม ${runId}`);
  await expect(page.getByRole("main")).toContainText("2 แบตช์");

  const generatedTask = page.getByRole("article", { name: new RegExp(`เตรียมแป้ง ${runId}`) });
  await generatedTask.getByRole("button", { name: "แก้ไขงาน" }).click();
  const generatedForm = page.locator("form").filter({ hasText: "ชื่องาน" }).first();
  await generatedForm.getByLabel("ชื่องาน").fill(editedTitle);
  await generatedForm.getByLabel("สินค้า").selectOption({ label: productName });
  await generatedForm.getByLabel("จำนวนแบตช์").fill("1.5");
  await generatedForm.getByLabel("เวลาที่กำหนด").fill("2030-04-10T07:30");
  await generatedForm.getByLabel("ระยะเวลา (นาที)").fill("50");
  await generatedForm.getByLabel("ลำดับ").fill("2");
  await generatedForm.getByLabel("หมายเหตุ").fill("ปรับตามเตาใหม่");
  await generatedForm.getByLabel("สถานะ").selectOption("DONE");
  await submitCurrentPageAction(page, generatedForm, "บันทึกงาน");
  await page.goto(`${cycleUrl}/production`);
  await expect(page.getByRole("article", { name: new RegExp(editedTitle) })).toContainText("ทำเสร็จแล้ว");
  await expect(page.getByRole("article", { name: new RegExp(editedTitle) })).toContainText("ปรับตามเตาใหม่");

  const skippedTask = page.getByRole("article", { name: new RegExp(`อบขนม ${runId}`) });
  await skippedTask.getByRole("button", { name: "แก้ไขงาน" }).click();
  const skippedForm = page.locator("form").filter({ hasText: "ชื่องาน" }).first();
  await skippedForm.getByLabel("สถานะ").selectOption("SKIPPED");
  const skipReason = skippedForm.getByLabel("เหตุผลที่ข้าม");
  await expect(skipReason).toHaveAttribute("required", "");
  await skippedForm.getByRole("button", { name: "บันทึกงาน" }).click();
  await expect(skipReason).toBeFocused();
  await skipReason.fill("เปลี่ยนสูตรแล้ว");
  await submitCurrentPageAction(page, skippedForm, "บันทึกงาน");
  await page.goto(`${cycleUrl}/production`);
  await expect(page.getByRole("main")).toContainText("เหตุผลที่ข้าม: เปลี่ยนสูตรแล้ว");

  await page.getByRole("button", { name: "เพิ่มงานเอง" }).click();
  const manualForm = page.getByRole("main").locator("form").last();
  await manualForm.getByLabel("ชื่องาน").fill(manualTitle);
  await manualForm.getByLabel("เวลาที่กำหนด").fill("2030-04-09T06:00");
  await manualForm.getByLabel("ระยะเวลา (นาที)").fill("15");
  await manualForm.getByLabel("หมายเหตุ").fill("ลบได้ก่อนเริ่ม");
  await submitCurrentPageAction(page, manualForm, "สร้างงาน");
  await page.goto(`${cycleUrl}/production`);
  const manualTask = page.getByRole("article", { name: new RegExp(manualTitle) });
  await expect(manualTask).toBeVisible();
  await expect(manualTask.getByRole("button", { name: "ลบงาน" })).toBeVisible();
  const deleteResponse = currentPageAction(page);
  await manualTask.getByRole("button", { name: "ลบงาน" }).click();
  expect((await deleteResponse).ok()).toBe(true);
  await page.goto(`${cycleUrl}/production`);
  await expect(page.getByRole("article", { name: new RegExp(manualTitle) })).toHaveCount(0);

  await page.goto(cycleUrl);
  await page.getByRole("link", { name: "ดูแผนการผลิต" }).press("Enter");
  await expect(page).toHaveURL(/\/cycles\/[^/]+\/planning$/, {
    timeout: SERVER_ACTION_TIMEOUT,
  });
  await page.getByLabel("เหตุผลที่ปลดล็อก").fill("ปรับปรุงไทม์ไลน์");
  await page.getByLabel("พิมพ์คำว่า ปลดล็อก เพื่อยืนยัน").fill("ปลดล็อก");
  await submitCurrentPageAction(page, page, "ปลดล็อกรอบ");
  await page.goto(`${cycleUrl}/planning`);
  await submitCurrentPageAction(page, page, "ยืนยันล็อกรอบ");

  await page.goto(`${cycleUrl}/production`);
  await expect(page.getByRole("heading", { name: /รุ่น 2/ })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`เตรียมแป้ง ${runId}`);
  await expect(page.getByRole("main")).not.toContainText(editedTitle);
  await expect(page.getByRole("main")).not.toContainText(manualTitle);
  const historyLink = page.getByRole("link", { name: "รุ่น 1 · แทนที่แล้ว" });
  await expect(historyLink).toBeVisible();
  await historyLink.press("Enter");
  await expect(page.getByRole("heading", { name: /รุ่น 1/ })).toBeVisible();
  await expect(page.getByText("อ่านอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("button", { name: "แก้ไขงาน" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "เพิ่มงานเอง" })).toHaveCount(0);
});
