import { expect, test, type Page } from "@playwright/test";
import {
  confirmCycleStock,
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
  recordCyclePurchase,
} from "../fixtures/owner";

const SERVER_ACTION_TIMEOUT = 30_000;

function bangkokDateTimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function lockCurrentPlan(page: Page, productName: string): Promise<void> {
  await expect(page.getByLabel(`จำนวนแบตช์ ${productName}`)).toHaveValue("2");
  await page.getByLabel("วัตถุดิบที่ต้องใช้", { exact: true }).click();
  await expect(page.getByRole("main")).toContainText("2200 g");
  await page.getByLabel("บรรจุภัณฑ์ที่ต้องใช้", { exact: true }).click();
  await expect(page.getByRole("main")).toContainText("12 ชิ้น");

  const planningUrl = page.url();
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === new URL(planningUrl).pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await page.getByRole("button", { name: "ยืนยันล็อกรอบ" }).press("Enter");
  const locked = await response;
  expect(locked.ok()).toBe(true);
  expect(await locked.finished()).toBeNull();
}

async function openPlanningFromCycle(page: Page): Promise<void> {
  const planningUrl = /\/cycles\/[^/]+\/planning$/;
  const link = page.getByRole("link", { name: "ตรวจแผนและล็อกรอบ" });
  await link.press("Enter");
  await expect(page).toHaveURL(planningUrl, { timeout: SERVER_ACTION_TIMEOUT });
}

async function unlockCurrentPlan(page: Page, cycleUrl: string): Promise<void> {
  await page.getByLabel("เหตุผลที่ปลดล็อก").fill("สร้างแผนรุ่นใหม่เพื่อเช็กสต๊อกซ้ำ");
  await page
    .getByLabel("พิมพ์คำว่า ปลดล็อก เพื่อยืนยัน")
    .fill("ปลดล็อก");
  const planningUrl = page.url();
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === new URL(planningUrl).pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await page.getByRole("button", { name: "ปลดล็อกรอบ" }).press("Enter");
  const unlocked = await response;
  expect(unlocked.ok()).toBe(true);
  expect(await unlocked.finished()).toBeNull();
  await page.goto(cycleUrl);
  await expect(
    page.getByRole("link", { name: "ตรวจแผนและล็อกรอบ" }),
  ).toBeVisible({ timeout: SERVER_ACTION_TIMEOUT });
}

test("owner counts stock, records over-purchase, and keeps generation history", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(SERVER_ACTION_TIMEOUT);
  page.setDefaultNavigationTimeout(SERVER_ACTION_TIMEOUT);

  const runId = `shopping-${testInfo.project.name}-${Date.now()}`;
  const flourName = `แป้งขนมปัง ${runId}`;
  const bagName = `ถุงขนม ${runId}`;
  const productName = `Focaccia ${runId}`;
  const deliveryMethodName = `Delivery ${runId}`;
  const customerName = `ลูกค้ารายการซื้อ ${runId}`;
  const cycleName = `รอบรายการซื้อ ${runId}`;
  const storeName = `ร้านวัตถุดิบ ${runId}`;

  await loginAsOwner(page);
  await configureShopSettings(page);
  await createInventoryItem(page, {
    name: flourName,
    category: "INGREDIENT",
    purchaseLabel: "ถุง",
    packQuantity: "1000",
  });
  await createInventoryItem(page, {
    name: bagName,
    category: "PACKAGING",
    baseUnit: "piece",
    purchaseLabel: "แพ็ก",
    packQuantity: "100",
  });
  await createProduct(page, {
    name: productName,
    sellingPriceBaht: "200",
  });
  await createRecipeVersion(page, productName, {
    versionCode: `v1-${runId}`,
    yieldQuantity: "6",
    ingredientName: flourName,
    ingredientQuantity: "1000",
    laborMinutes: "30",
    utilityCostBaht: "20",
    wastePercent: "10",
  });
  await createProductionTemplate(page, {
    name: `Production ${productName}`,
    scope: "PRODUCT",
    productName,
    activities: [{
      name: "เตรียมและอบ",
      offsetDaysFromDelivery: "-1",
      defaultTime: "05:00",
      estimatedDurationMinutes: "60",
    }],
    activate: true,
  });
  await createDeliveryMethod(page, {
    name: deliveryMethodName,
    customerFeeBaht: "0",
    internalCostBaht: "0",
  });
  await createPackagingRule(page, {
    productName,
    inventoryItemName: bagName,
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
    productionDate: "2030-03-10",
    deliveryDate: "2030-03-11",
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

  await page.goto(cycleUrl);
  await openPlanningFromCycle(page);
  await lockCurrentPlan(page, productName);

  const shoppingUrl = `${cycleUrl}/shopping`;
  await page.goto(shoppingUrl);
  await expect(
    page.getByRole("heading", { name: "เช็กสต๊อกและรายการซื้อ" }),
  ).toBeVisible();
  await confirmCycleStock(page, [
    { itemName: flourName, quantity: "1000" },
    { itemName: bagName, quantity: "12" },
  ]);

  const summary = page.getByRole("region", { name: "สรุปรายการซื้อ" });
  await expect(summary).toContainText("รายการต้องซื้อ 1");
  const countHistory = page.getByRole("region", { name: "ผลการนับสต๊อก" });
  await expect(countHistory).toContainText(`${flourName} นับได้ 1000 g`);
  await expect(countHistory).toContainText(`${bagName} นับได้ 12 ชิ้น`);
  const flourCard = page.getByRole("article", { name: flourName });
  await expect(flourCard).toContainText("ขาด 1200 g");
  await expect(flourCard).toContainText("แนะนำ 2 ถุง · 2000 g");
  await expect(page.getByRole("article", { name: bagName })).toHaveCount(0);

  const firstPurchaseAt = bangkokDateTimeLocal(new Date(Date.now() - 120_000));
  await recordCyclePurchase(page, {
    itemName: flourName,
    packCount: "1",
    totalPriceBaht: "55.00",
    purchasedFrom: storeName,
    occurredAt: firstPurchaseAt,
  });
  await expect(flourCard).toContainText("ซื้อบางส่วน");
  await expect(flourCard).toContainText("ซื้อแล้ว 1000 g");
  await expect(flourCard).toContainText("เหลือ 200 g");
  await expect(flourCard).toContainText("ซื้อ 1000 g · 1 ถุง · ฿55.00");

  const secondPurchaseAt = bangkokDateTimeLocal(new Date(Date.now() - 60_000));
  await recordCyclePurchase(page, {
    itemName: flourName,
    packCount: "1",
    totalPriceBaht: "57.00",
    purchasedFrom: storeName,
    occurredAt: secondPurchaseAt,
  });
  await expect(flourCard).toContainText("ซื้อครบ");
  await expect(flourCard).toContainText("ซื้อแล้ว 2000 g");
  await expect(flourCard).toContainText("เหลือ 0 g");
  await expect(flourCard).toContainText("ซื้อเกินความต้องการ 800 g");
  await expect(flourCard).toContainText("ซื้อ 1000 g · 1 ถุง · ฿57.00");

  await page.goto("/inventory");
  await page.getByLabel("ค้นหารายการ").fill(flourName);
  await page
    .getByRole("link", { name: flourName, exact: true })
    .filter({ visible: true })
    .press("Enter");
  await expect(page.getByRole("heading", { name: flourName })).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "สต๊อกคงเหลือ" }),
  ).toContainText("3000 g");
  await expect(
    page.getByRole("article").filter({ hasText: "ราคาต่อแพ็กล่าสุด" }),
  ).toContainText("฿57.00");
  const latestPrice = page
    .getByRole("listitem")
    .filter({ hasText: "฿57.00" })
    .filter({ hasText: "1000 g ต่อแพ็ก" });
  await expect(latestPrice).toContainText(storeName);

  await page.goto(cycleUrl);
  await page.getByRole("link", { name: "ดูแผนการผลิต" }).press("Enter");
  await expect(page).toHaveURL(/\/cycles\/[^/]+\/planning$/, {
    timeout: SERVER_ACTION_TIMEOUT,
  });
  await unlockCurrentPlan(page, cycleUrl);
  await openPlanningFromCycle(page);
  await lockCurrentPlan(page, productName);

  await page.goto(`${shoppingUrl}?generation=1`);
  await expect(
    page.getByRole("heading", { name: "แผนรุ่น 1", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("ประวัติ · อ่านอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("region", { name: "ผลการนับสต๊อก" })).toContainText(
    `${flourName} นับได้ 1000 g`,
  );
  const historicalFlour = page.getByRole("article", { name: flourName });
  await expect(historicalFlour).toContainText("ซื้อ 1000 g · 1 ถุง · ฿55.00");
  await expect(historicalFlour).toContainText("ซื้อ 1000 g · 1 ถุง · ฿57.00");
  await expect(historicalFlour.getByLabel("จำนวนแพ็กที่ซื้อ")).toHaveCount(0);
  await expect(
    historicalFlour.getByRole("button", {
      name: /^(บันทึกการซื้อ|เพิ่มการซื้ออีกครั้ง)$/,
    }),
  ).toHaveCount(0);

  await page.goto(shoppingUrl);
  await expect(
    page.getByRole("heading", { name: "แผนรุ่น 2", exact: true }),
  ).toBeVisible();
  await confirmCycleStock(page, [
    { itemName: flourName, quantity: "3000" },
    { itemName: bagName, quantity: "12" },
  ]);
  await expect(page.getByRole("region", { name: "สรุปรายการซื้อ" })).toContainText(
    "รายการต้องซื้อ 0",
  );
  await expect(
    page.getByRole("heading", { name: "สต๊อกเพียงพอสำหรับรอบนี้" }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: flourName })).toHaveCount(0);
});
