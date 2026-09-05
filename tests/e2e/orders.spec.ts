import { expect, test, type Page } from "@playwright/test";
import {
  createBakeCycle,
  createCustomer,
  createDeliveryMethod,
  createOrder,
  createProduct,
  loginAsOwner,
} from "../fixtures/owner";

const SERVER_ACTION_TIMEOUT = 30_000;

async function submitOrderActionAndReload(
  page: Page,
  orderUrl: string,
  buttonName: string,
): Promise<void> {
  const actionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === new URL(orderUrl).pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const response = await actionResponse;
  expect(response.ok()).toBe(true);
  await page.goto(orderUrl);
  await expect(
    page.getByRole("heading", { name: "แก้ไขออเดอร์" }),
  ).toBeVisible({ timeout: SERVER_ACTION_TIMEOUT });
}

test("owner creates and cancels a duplicate-line order without losing history", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const runId = `orders-${testInfo.project.name}-${Date.now()}`;
  const productName = `Focaccia ${runId}`;
  const deliveryMethodName = `KEX Same Day ${runId}`;
  const customerName = `May ${runId}`;
  const cycleName = `รอบส่ง ${runId}`;

  await loginAsOwner(page);
  await createProduct(page, {
    name: productName,
    sellingPriceBaht: "220",
  });
  await createDeliveryMethod(page, {
    name: deliveryMethodName,
    customerFeeBaht: "120",
    internalCostBaht: "120",
  });
  await createCustomer(page, {
    name: customerName,
    deliveryMethodName,
    deliveryLocation: "บางรัก กรุงเทพฯ",
  });
  await createBakeCycle(page, {
    name: cycleName,
    productionDate: "2030-01-10",
    deliveryDate: "2030-01-11",
  });
  await createOrder(page, {
    customerName,
    cycleName,
    productName,
    totalQuantity: 3,
    discountBaht: "20",
    amountPaidBaht: "200",
  });
  const orderUrl = page.url();

  const firstProduct = page.getByRole("combobox", {
    name: "สินค้า รายการที่ 1",
    exact: true,
  });
  const secondProduct = page.getByRole("combobox", {
    name: "สินค้า รายการที่ 2",
    exact: true,
  });
  await expect(firstProduct).not.toHaveValue("");
  await expect(secondProduct).toHaveValue(await firstProduct.inputValue());
  await expect(
    page.getByRole("spinbutton", { name: "จำนวน รายการที่ 1", exact: true }),
  ).toHaveValue("1");
  await expect(
    page.getByRole("spinbutton", { name: "จำนวน รายการที่ 2", exact: true }),
  ).toHaveValue("2");

  const orderPage = page.getByRole("main");
  await expect(orderPage).toContainText("ยอดสินค้า ฿660.00");
  await expect(orderPage).toContainText("ค่าส่ง ฿120.00");
  await expect(orderPage).toContainText("ยอดสุทธิ ฿760.00");
  await expect(orderPage).toContainText("คงเหลือ ฿560.00");
  await expect(orderPage).toContainText("ชำระบางส่วน");

  const statusActions = page.getByRole("region", {
    name: "จัดการสถานะออเดอร์",
  });
  await submitOrderActionAndReload(page, orderUrl, "แพ็กเสร็จแล้ว");
  await expect(
    statusActions.getByRole("button", { name: "แพ็กเสร็จแล้ว" }),
  ).toHaveCount(0);
  await expect(orderPage).toContainText("การจัดเตรียมแพ็กเสร็จแล้ว");

  await submitOrderActionAndReload(page, orderUrl, "บันทึกคืนเงิน");
  await expect(
    statusActions.getByRole("button", {
      name: "กลับมาติดตามการชำระเงิน",
    }),
  ).toBeVisible();
  await expect(orderPage).toContainText("การชำระเงินคืนเงินแล้ว");

  await submitOrderActionAndReload(
    page,
    orderUrl,
    "กลับมาติดตามการชำระเงิน",
  );
  await expect(
    statusActions.getByRole("button", { name: "บันทึกคืนเงิน" }),
  ).toBeVisible();
  await expect(orderPage).toContainText("การชำระเงินชำระบางส่วน");
  await expect(orderPage).toContainText("คงเหลือ฿560.00");

  await page
    .getByRole("link", { name: "รอบผลิต", exact: true })
    .filter({ visible: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/cycles$/, {
    timeout: SERVER_ACTION_TIMEOUT,
  });
  await expect(
    page.getByRole("heading", { name: "รอบอบ", exact: true }),
  ).toBeVisible({ timeout: SERVER_ACTION_TIMEOUT });
  await page
    .getByRole("link", { name: cycleName, exact: true })
    .press("Enter");
  await expect(page.getByRole("heading", { name: cycleName })).toBeVisible({
    timeout: SERVER_ACTION_TIMEOUT,
  });
  await expect(page.getByRole("main")).toContainText(productName);
  await expect(page.getByRole("main")).toContainText("3 ชิ้น");

  const historyOrder = page
    .getByRole("article")
    .filter({ hasText: customerName });
  await expect(historyOrder).toContainText("2 รายการสินค้า");
  await historyOrder
    .getByRole("link", { name: "แก้ไขออเดอร์" })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "แก้ไขออเดอร์" }),
  ).toBeVisible({ timeout: SERVER_ACTION_TIMEOUT });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("ยืนยันยกเลิกออเดอร์นี้หรือไม่?");
    await dialog.accept();
  });
  const cancelResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === new URL(orderUrl).pathname,
    { timeout: SERVER_ACTION_TIMEOUT },
  );
  await page.getByRole("button", { name: "ยกเลิกออเดอร์" }).click();
  const cancelled = await cancelResponse;
  expect(cancelled.ok()).toBe(true);
  await page.goto("/cycles");
  await expect(
    page.getByRole("heading", { name: "รอบอบ", exact: true }),
  ).toBeVisible({ timeout: SERVER_ACTION_TIMEOUT });
  await page
    .getByRole("link", { name: cycleName, exact: true })
    .press("Enter");
  await expect(page.getByRole("heading", { name: cycleName })).toBeVisible({
    timeout: SERVER_ACTION_TIMEOUT,
  });

  const cancelledHistoryOrder = page
    .getByRole("article")
    .filter({ hasText: customerName });
  await expect(cancelledHistoryOrder).toContainText("2 รายการสินค้า");
  await expect(cancelledHistoryOrder).toContainText("ยกเลิก");
  await expect(page.getByRole("main")).toContainText(
    "ยังไม่มีสินค้าที่ต้องผลิต",
  );
});
