import { expect, test } from "@playwright/test";
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
  createRecipeVersion,
  loginAsOwner,
} from "../fixtures/owner";

const SERVER_ACTION_TIMEOUT = 30_000;

test("owner locks, unlocks, and re-locks immutable planning generations", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const runId = `planning-${testInfo.project.name}-${Date.now()}`;
  const flourName = `แป้งขนมปัง ${runId}`;
  const boxName = `กล่องฟอคคาเซีย ${runId}`;
  const productName = `Focaccia ${runId}`;
  const deliveryMethodName = `KEX Same Day ${runId}`;
  const customerName = `ลูกค้าวางแผน ${runId}`;
  const cycleName = `รอบวางแผน ${runId}`;
  const overrideReason = "ยอมรับผลิตขาดเพื่อทดสอบแผน";
  const unlockReason = "เพิ่มราคาและปรับยอดสั่ง";

  await loginAsOwner(page);
  await configureShopSettings(page);

  await createInventoryItem(page, {
    name: flourName,
    category: "INGREDIENT",
    purchaseLabel: "ถุง",
    packQuantity: "1000",
  });
  await addInventoryPrice(page, flourName, { packPriceBaht: "55" });

  const boxInput = {
    name: boxName,
    category: "PACKAGING" as const,
    baseUnit: "piece" as const,
    purchaseLabel: "แพ็ก",
    packQuantity: "100",
  };
  await createInventoryItem(page, boxInput);

  await createProduct(page, {
    name: productName,
    sellingPriceBaht: "200",
  });
  const recipeInput = {
    versionCode: `v1-${runId}`,
    yieldQuantity: "6",
    ingredientName: flourName,
    ingredientQuantity: "1000",
    laborMinutes: "30",
    utilityCostBaht: "20",
    wastePercent: "10",
  };
  await createRecipeVersion(page, productName, recipeInput);

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
    productionDate: "2030-02-10",
    deliveryDate: "2030-02-11",
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
  const orderUrl = page.url();

  await page.goto(cycleUrl);
  await page
    .getByRole("link", { name: "ตรวจแผนและล็อกรอบ" })
    .press("Enter");
  await expect(page).toHaveURL(/\/cycles\/[^/]+\/planning$/, {
    timeout: SERVER_ACTION_TIMEOUT,
  });
  await expect(
    page.getByRole("heading", { name: "วางแผนการผลิต" }),
  ).toBeVisible();

  const preview = page.getByRole("main");
  await expect(preview).toContainText(
    `ยอดสั่ง 10 ชิ้น · แนะนำ 2 แบตช์`,
  );
  await expect(page.getByLabel(`จำนวนแบตช์ ${productName}`)).toHaveValue("2");
  await page.getByLabel("วัตถุดิบที่ต้องใช้", { exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: flourName }),
  ).toContainText("2200 g");
  await page.getByLabel("บรรจุภัณฑ์ที่ต้องใช้", { exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: boxName }),
  ).toContainText("12 ชิ้น · ยังไม่มีราคา");
  const previewWarnings = page.getByRole("alert", { name: "คำเตือน" });
  await expect(previewWarnings).toContainText(
    "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน",
  );
  await expect(previewWarnings).toContainText("มีออเดอร์ที่ยังไม่ชำระเงิน");
  await expect(preview).toContainText("ต้นทุนไม่สมบูรณ์");

  await page.getByLabel(`จำนวนแบตช์ ${productName}`).fill("1.5");
  await expect(preview).toContainText("ผลผลิตตามแผน 9 ชิ้น");
  await expect(preview).toContainText("ส่วนต่าง -1 ชิ้น");
  await expect(previewWarnings).toContainText("แผนนี้ผลิตได้น้อยกว่ายอดสั่ง");
  const overrideReasonInput = page.getByLabel(`เหตุผลที่ปรับ ${productName}`);
  await expect(overrideReasonInput).toHaveAttribute("required", "");
  await expect(
    page.getByRole("button", { name: "ยืนยันล็อกรอบ" }),
  ).toBeDisabled();
  await overrideReasonInput.fill(overrideReason);
  const firstPlanningUrl = page.url();
  const firstLockResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === new URL(firstPlanningUrl).pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await page.getByRole("button", { name: "ยืนยันล็อกรอบ" }).click();
  const firstLock = await firstLockResponse;
  expect(firstLock.ok()).toBe(true);
  await page.goto(`${firstPlanningUrl}?generation=1`);
  await expect(
    page.getByRole("heading", { name: "รุ่น 1", exact: true }),
  ).toBeVisible({ timeout: SERVER_ACTION_TIMEOUT });

  const generationOne = page.getByRole("main");
  await expect(generationOne).toContainText("ต้นทุนไม่สมบูรณ์");
  await expect(generationOne).toContainText("ยอดต้นทุนที่ทราบแล้ว ฿210.75");
  const generationOneProduct = page.getByRole("article", {
    name: productName,
  });
  await expect(generationOneProduct).toContainText("ยอดสั่ง 10 ชิ้น");
  await expect(generationOneProduct).toContainText("แบตช์ที่ล็อก 1.5");
  await expect(generationOneProduct).toContainText("ผลผลิตตามแผน 9 ชิ้น");
  await expect(generationOneProduct).toContainText("ขาด 1 ชิ้น");
  const generationOneMaterial = page.getByRole("group", { name: flourName });
  await expect(generationOneMaterial).toContainText("รวม 1650 g");
  const acceptedWarnings = page.getByRole("region", {
    name: "คำเตือนที่ยอมรับตอนล็อกแผน",
  });
  await expect(acceptedWarnings).toContainText(
    "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน",
  );
  await expect(acceptedWarnings).toContainText(
    "แผนนี้ผลิตได้น้อยกว่ายอดสั่ง",
  );

  await page.goto(orderUrl);
  await expect(page.getByRole("main")).toContainText(
    "รอบผลิตถูกล็อกแล้ว แก้ได้เฉพาะยอดชำระและสถานะที่ไม่กระทบการผลิต",
  );
  await expect(
    page.getByRole("combobox", { name: "ลูกค้า", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("spinbutton", { name: "จำนวน รายการที่ 2", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "วิธีจัดส่ง", exact: true }),
  ).toBeDisabled();
  const amountPaid = page.getByLabel("ยอดชำระแล้ว (บาท)");
  await expect(amountPaid).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "ยกเลิกออเดอร์" }),
  ).toHaveCount(0);
  await amountPaid.fill("100");
  const paymentSave = page
    .getByRole("button", { name: /^(บันทึกยอดชำระ|กำลังบันทึก…)$/ })
    .filter({ visible: true });
  const paymentResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === new URL(orderUrl).pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await paymentSave.click();
  const savedPayment = await paymentResponse;
  expect(savedPayment.ok()).toBe(true);
  await page.goto(orderUrl);
  await expect(page.getByRole("main")).toContainText("ชำระบางส่วน", {
    timeout: SERVER_ACTION_TIMEOUT,
  });

  await page.goto(cycleUrl);
  await page.getByRole("link", { name: "ดูแผนการผลิต" }).press("Enter");
  await page.getByLabel("เหตุผลที่ปลดล็อก").fill(unlockReason);
  await page
    .getByLabel("พิมพ์คำว่า ปลดล็อก เพื่อยืนยัน")
    .fill("ปลดล็อก");
  const planningUrl = page.url();
  const unlockResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === new URL(planningUrl).pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await page.getByRole("button", { name: "ปลดล็อกรอบ" }).click();
  const unlocked = await unlockResponse;
  expect(unlocked.ok()).toBe(true);
  await page.goto(cycleUrl);
  await expect(page.getByRole("heading", { name: cycleName })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "ตรวจแผนและล็อกรอบ" }),
  ).toBeVisible();

  await page.goto("/inventory");
  await page.getByLabel("ค้นหารายการ").fill(boxName);
  await addInventoryPrice(page, boxName, { packPriceBaht: "50" });

  await page.goto(orderUrl);
  const secondQuantity = page.getByRole("spinbutton", {
    name: "จำนวน รายการที่ 2",
    exact: true,
  });
  await expect(secondQuantity).toBeEnabled();
  await secondQuantity.fill("11");
  const orderSave = page
    .getByRole("button", { name: /^(บันทึกการแก้ไข|กำลังบันทึก…)$/ })
    .filter({ visible: true });
  const orderResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === new URL(orderUrl).pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await orderSave.click();
  const savedOrder = await orderResponse;
  expect(savedOrder.ok()).toBe(true);
  await page.goto(orderUrl);
  await expect(secondQuantity).toHaveValue("11");

  await page.goto(cycleUrl);
  await page
    .getByRole("link", { name: "ตรวจแผนและล็อกรอบ" })
    .press("Enter");
  await expect(page).toHaveURL(/\/cycles\/[^/]+\/planning$/, {
    timeout: SERVER_ACTION_TIMEOUT,
  });
  await expect(page.getByLabel(`จำนวนแบตช์ ${productName}`)).toHaveValue(
    "2",
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await expect(page.getByRole("main")).toContainText("ยอดสั่ง 12 ชิ้น");
  await page.getByLabel("วัตถุดิบที่ต้องใช้", { exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: flourName }),
  ).toContainText("2200 g");
  await expect(page.getByRole("main")).not.toContainText("ต้นทุนไม่สมบูรณ์");
  const secondPlanningUrl = page.url();
  const secondLockResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === new URL(secondPlanningUrl).pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await page.getByRole("button", { name: "ยืนยันล็อกรอบ" }).click();
  const secondLock = await secondLockResponse;
  expect(secondLock.ok()).toBe(true);
  await page.goto(`${secondPlanningUrl}?generation=2`);
  await expect(
    page.getByRole("heading", { name: "รุ่น 2", exact: true }),
  ).toBeVisible({ timeout: SERVER_ACTION_TIMEOUT });
  await expect(
    page.getByRole("link", { name: "รุ่น 2 · ใช้งานอยู่" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main")).toContainText("ต้นทุนรวม ฿287.00");
  await expect(page.getByRole("main")).not.toContainText("ต้นทุนไม่สมบูรณ์");

  await page
    .getByRole("link", { name: "รุ่น 1 · แทนที่แล้ว" })
    .press("Enter");
  await expect(page).toHaveURL(/\?generation=1$/, {
    timeout: SERVER_ACTION_TIMEOUT,
  });
  await expect(
    page.getByRole("heading", { name: "รุ่น 1", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("ต้นทุนไม่สมบูรณ์");
  await expect(page.getByRole("main")).toContainText(
    "ยอดต้นทุนที่ทราบแล้ว ฿210.75",
  );
  await expect(page.getByRole("main")).toContainText(
    "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน",
  );
  await expect(page.getByRole("article", { name: productName })).toContainText(
    "ยอดสั่ง 10 ชิ้น",
  );
  await expect(page.getByRole("group", { name: flourName })).toContainText(
    "รวม 1650 g",
  );
  await expect(page.getByRole("main")).toContainText(`${boxName} 9 ชิ้น`);
});
