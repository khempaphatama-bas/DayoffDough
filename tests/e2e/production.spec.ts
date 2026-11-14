import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addInventoryPrice,
  configureShopSettings,
  confirmCycleStock,
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
  const saved = await response;
  expect(saved.ok()).toBe(true);
  expect(await saved.finished()).toBeNull();
}

async function getProductSelect(container: Locator): Promise<Locator> {
  const productSelect = container.locator('select[name="productId"]');
  await expect(productSelect).toHaveCount(1);
  await expect(productSelect).toBeVisible({ timeout: SERVER_ACTION_TIMEOUT });
  return productSelect;
}

async function getExactOptionValue(
  select: Locator,
  visibleName: string,
): Promise<string> {
  return select.evaluate((element, optionName) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error("Product combobox is not a select element");
    }
    const matches = Array.from(element.options).filter(
      (option) => option.textContent?.trim() === optionName,
    );
    if (matches.length === 0) {
      throw new Error(`Product option not found: "${optionName}"`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Expected exactly one Product option named "${optionName}", found ${matches.length}`,
      );
    }
    return matches[0]!.value;
  }, visibleName);
}

async function expectExactSelectedOption(
  select: Locator,
  optionValue: string,
  visibleName: string,
): Promise<void> {
  await expect(select).toHaveValue(optionValue);
  const checkedOption = select.locator("option:checked");
  await expect(checkedOption).toHaveCount(1);
  await expect(checkedOption).toHaveAttribute("value", optionValue);
  await expect(checkedOption).toHaveText(visibleName);
}

test("owner runs the complete production timeline lifecycle", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  page.setDefaultTimeout(SERVER_ACTION_TIMEOUT);
  page.setDefaultNavigationTimeout(SERVER_ACTION_TIMEOUT);
  const runId = `production-${testInfo.project.name}-${Date.now()}`;
  const flourName = `แป้งผลิต ${runId}`;
  const boxName = `กล่องผลิต ${runId}`;
  const productName = `ขนมผลิต ${runId}`;
  const alternateProductName = `ขนมสำรอง ${runId}`;
  const deliveryMethodName = `จัดส่งผลิต ${runId}`;
  const customerName = `ลูกค้าผลิต ${runId}`;
  const cycleName = `รอบผลิตไทม์ไลน์ ${runId}`;
  const editedTitle = `อบแก้ไขแล้ว ${runId}`;
  const retainedManualTitle = `งานคงไว้รุ่นเก่า ${runId}`;
  const deletedManualTitle = `งานลบทิ้ง ${runId}`;

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
  await createProduct(page, {
    name: alternateProductName,
    sellingPriceBaht: "180",
  });
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
    confirmedDeliveryTime: "10:15",
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
  await expect(
    page.getByRole("heading", { name: "Production Timeline", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`เตรียมแป้ง ${runId}`);
  await expect(page.getByRole("main")).toContainText(`อบขนม ${runId}`);
  await expect(
    page.getByRole("article", { name: new RegExp(`ตรวจรอบ ${runId}`) }),
  ).toContainText("งานระดับรอบ");
  await expect(page.getByRole("main")).toContainText("2 แบตช์");

  const generatedTask = page.getByRole("article", { name: new RegExp(`เตรียมแป้ง ${runId}`) });
  await generatedTask.getByRole("button", { name: "แก้ไขงาน" }).click();
  const generatedForm = page.locator("form").filter({ hasText: "ชื่องาน" }).first();
  await generatedForm.getByLabel("ชื่องาน").fill(editedTitle);
  const generatedProductSelect = await getProductSelect(generatedForm);
  const alternateProductValue = await getExactOptionValue(
    generatedProductSelect,
    alternateProductName,
  );
  await generatedProductSelect.selectOption({ value: alternateProductValue });
  await expectExactSelectedOption(
    generatedProductSelect,
    alternateProductValue,
    alternateProductName,
  );
  await generatedForm.getByLabel("จำนวนแบตช์").fill("1.5");
  await generatedForm.getByLabel("เวลาที่กำหนด").fill("2030-04-10T07:30");
  await generatedForm.getByLabel("ระยะเวลา (นาที)").fill("50");
  await generatedForm.getByLabel("ลำดับ").fill("2");
  await generatedForm.getByLabel("หมายเหตุ").fill("ปรับตามเตาใหม่");
  await generatedForm.getByLabel("สถานะ").selectOption("DONE");
  await submitCurrentPageAction(page, generatedForm, "บันทึกงาน");
  await page.goto(`${cycleUrl}/production`);
  const editedTask = page.getByRole("article", { name: new RegExp(editedTitle) });
  await expect(editedTask).toContainText(alternateProductName);
  await expect(editedTask).toContainText("1.5 แบตช์");
  await expect(editedTask).toContainText("07:30");
  await expect(editedTask).toContainText("50 นาที");
  await expect(editedTask).toContainText("ทำเสร็จแล้ว");
  await expect(editedTask).toContainText("ปรับตามเตาใหม่");
  await editedTask.getByRole("button", { name: "แก้ไขงาน" }).click();
  const editedVerificationForm = page.locator("form").filter({ hasText: "ชื่องาน" }).first();
  await expect(editedVerificationForm.getByLabel("ชื่องาน")).toHaveValue(editedTitle);
  const persistedProductSelect = await getProductSelect(editedVerificationForm);
  const persistedAlternateProductValue = await getExactOptionValue(
    persistedProductSelect,
    alternateProductName,
  );
  expect(persistedAlternateProductValue).toBe(alternateProductValue);
  await expectExactSelectedOption(
    persistedProductSelect,
    alternateProductValue,
    alternateProductName,
  );
  await expect(editedVerificationForm.getByLabel("จำนวนแบตช์")).toHaveValue("1.5");
  await expect(editedVerificationForm.getByLabel("เวลาที่กำหนด")).toHaveValue("2030-04-10T07:30");
  await expect(editedVerificationForm.getByLabel("ระยะเวลา (นาที)")).toHaveValue("50");
  await expect(editedVerificationForm.getByLabel("ลำดับ")).toHaveValue("2");
  await expect(editedVerificationForm.getByLabel("สถานะ")).toHaveValue("DONE");
  await expect(editedVerificationForm.getByLabel("หมายเหตุ")).toHaveValue("ปรับตามเตาใหม่");
  await editedVerificationForm.getByRole("button", { name: "ยกเลิก" }).click();

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
  const retainedManualForm = page.getByRole("main").locator("form").last();
  await retainedManualForm.getByLabel("ชื่องาน").fill(retainedManualTitle);
  await retainedManualForm.getByLabel("เวลาที่กำหนด").fill("2030-04-09T06:00");
  await retainedManualForm.getByLabel("ระยะเวลา (นาที)").fill("15");
  await retainedManualForm.getByLabel("หมายเหตุ").fill("เก็บไว้ตรวจการไม่คัดลอก");
  await submitCurrentPageAction(page, retainedManualForm, "สร้างงาน");
  await page.goto(`${cycleUrl}/production`);
  const retainedManualTask = page.getByRole("article", { name: new RegExp(retainedManualTitle) });
  await expect(retainedManualTask).toBeVisible();

  await page.getByRole("button", { name: "เพิ่มงานเอง" }).click();
  const deletedManualForm = page.getByRole("main").locator("form").last();
  await deletedManualForm.getByLabel("ชื่องาน").fill(deletedManualTitle);
  await deletedManualForm.getByLabel("เวลาที่กำหนด").fill("2030-04-09T06:30");
  await deletedManualForm.getByLabel("ระยะเวลา (นาที)").fill("15");
  await deletedManualForm.getByLabel("หมายเหตุ").fill("ลบได้ก่อนเริ่ม");
  await submitCurrentPageAction(page, deletedManualForm, "สร้างงาน");
  await page.goto(`${cycleUrl}/production`);
  const deletedManualTask = page.getByRole("article", { name: new RegExp(deletedManualTitle) });
  await expect(deletedManualTask).toBeVisible();
  await expect(deletedManualTask.getByRole("button", { name: "ลบงาน" })).toBeVisible();
  const deleteResponse = currentPageAction(page);
  await deletedManualTask.getByRole("button", { name: "ลบงาน" }).click();
  const deleted = await deleteResponse;
  expect(deleted.ok()).toBe(true);
  expect(await deleted.finished()).toBeNull();
  await page.goto(`${cycleUrl}/production`);
  await expect(page.getByRole("article", { name: new RegExp(deletedManualTitle) })).toHaveCount(0);

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

  // V1 uses the active generation's explicit stock check, not a legacy opt-out.
  await page.goto(`${cycleUrl}/shopping`);
  await confirmCycleStock(page, [{ itemName: flourName, quantity: "5000" }, { itemName: boxName, quantity: "100" }]);

  await page.goto(`${cycleUrl}/production`);
  await expect(page.getByRole("heading", { name: /รุ่น 2/ })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`เตรียมแป้ง ${runId}`);
  await expect(page.getByRole("main")).not.toContainText(editedTitle);
  await expect(page.getByRole("main")).not.toContainText(retainedManualTitle);
  await expect(page.getByRole("main")).not.toContainText(deletedManualTitle);
  const historyLink = page.getByRole("link", { name: "รุ่น 1 · แทนที่แล้ว" });
  await expect(historyLink).toBeVisible();
  await historyLink.press("Enter");
  await expect(page.getByRole("heading", { name: /รุ่น 1/ })).toBeVisible();
  await expect(page.getByText("อ่านอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("main")).toContainText(editedTitle);
  await expect(page.getByRole("main")).toContainText(retainedManualTitle);
  await expect(page.getByRole("main")).toContainText("ปรับตามเตาใหม่");
  await expect(page.getByRole("main")).toContainText("เหตุผลที่ข้าม: เปลี่ยนสูตรแล้ว");
  await expect(page.getByRole("button", { name: "แก้ไขงาน" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "เพิ่มงานเอง" })).toHaveCount(0);
});
