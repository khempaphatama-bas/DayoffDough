import { expect, type Locator, type Page } from "@playwright/test";

export const OWNER_ID = "00000000-0000-4000-8000-000000000001";
export const OTHER_OWNER_ID = "00000000-0000-4000-8000-000000000002";

function requiredEnv(name: "E2E_OWNER_EMAIL" | "E2E_OWNER_PASSWORD"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for authenticated E2E tests`);
  return value;
}

async function tryClickVisibleLink(page: Page, name: string): Promise<boolean> {
  const links = page.getByRole("link", { name, exact: true });
  for (let index = 0; index < (await links.count()); index += 1) {
    const link = links.nth(index);
    if (await link.isVisible()) {
      await link.click();
      return true;
    }
  }
  return false;
}

async function clickVisibleLink(page: Page, name: string): Promise<void> {
  if (await tryClickVisibleLink(page, name)) return;

  if (["ลูกค้า", "สินค้าและสูตร", "การจัดส่ง", "ตั้งค่าร้าน"].includes(name)) {
    if (!(await tryClickVisibleLink(page, "เพิ่มเติม"))) {
      throw new Error(`Visible link not found: เพิ่มเติม`);
    }
    await expect(page).toHaveURL(/\/more$/);
    await expect(
      page.getByRole("heading", { name: "เพิ่มเติม", exact: true }),
    ).toBeVisible();
    if (await tryClickVisibleLink(page, name)) return;
  }

  throw new Error(`Visible link not found: ${name}`);
}

async function selectOptionContaining(
  select: Locator,
  visibleName: string,
): Promise<void> {
  const option = select
    .getByRole("option")
    .filter({ hasText: visibleName })
    .first();
  const label = (await option.textContent())?.trim();
  if (!label) throw new Error(`Visible option not found: ${visibleName}`);
  await select.selectOption({ label });
}

export async function loginAsOwner(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(requiredEnv("E2E_OWNER_EMAIL"));
  await page.getByLabel("รหัสผ่าน").fill(requiredEnv("E2E_OWNER_PASSWORD"));
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

export async function configureShopSettings(page: Page): Promise<void> {
  await clickVisibleLink(page, "ตั้งค่าร้าน");
  await page.getByLabel("ค่าแรงต่อชั่วโมง (บาท)").fill("120");
  await page.getByLabel("ค่าเผื่อสูญเสียเริ่มต้น (%)").fill("3");
  await page.getByRole("button", { name: "บันทึกการตั้งค่า" }).click();
  await expect(page.getByRole("main")).toContainText(
    "บันทึกการตั้งค่าร้านแล้ว",
    { timeout: 15_000 },
  );
}

export async function createInventoryItem(
  page: Page,
  input: Readonly<{
    name: string;
    category: "INGREDIENT" | "PACKAGING" | "CONSUMABLE";
    purchaseLabel: string;
    packQuantity: string;
  }>,
): Promise<void> {
  await clickVisibleLink(page, "วัตถุดิบ");
  await page.getByRole("button", { name: "เพิ่มรายการ" }).click();
  await page.getByLabel("ชื่อรายการ").fill(input.name);
  await page.getByLabel("ประเภท").selectOption(input.category);
  await page.getByLabel("หน่วยฐาน").selectOption("g");
  await page.getByLabel("ชื่อหน่วยซื้อ").fill(input.purchaseLabel);
  await page.getByLabel("ปริมาณต่อแพ็ก").fill(input.packQuantity);
  await page.getByRole("button", { name: "บันทึกรายการ" }).click();
  await expect(
    page.getByText(input.name).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

export async function addInventoryPrice(
  page: Page,
  itemName: string,
  input: Readonly<{ packPriceBaht: string }>,
): Promise<void> {
  await clickVisibleLink(page, itemName);
  await page.getByLabel("ราคาต่อแพ็ก").fill(input.packPriceBaht);
  await page.getByRole("button", { name: "บันทึกราคา" }).click();
  await expect(
    page.getByText(`฿${Number(input.packPriceBaht).toFixed(2)}`).first(),
  ).toBeVisible({ timeout: 15_000 });
}

export async function createProduct(
  page: Page,
  input: Readonly<{ name: string; sellingPriceBaht: string }>,
): Promise<void> {
  await clickVisibleLink(page, "สินค้าและสูตร");
  await page.getByRole("button", { name: "เพิ่มสินค้า" }).click();
  await page.getByLabel("ชื่อสินค้า").fill(input.name);
  await page.getByLabel("หน่วยขาย").selectOption("piece");
  await page.getByLabel("ราคาขาย").fill(input.sellingPriceBaht);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(
    page.getByText(input.name).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

export async function createRecipeVersion(
  page: Page,
  productName: string,
  input: Readonly<{
    versionCode: string;
    yieldQuantity: string;
    ingredientName: string;
    ingredientQuantity: string;
  }>,
): Promise<void> {
  await clickVisibleLink(page, productName);
  await page.getByRole("button", { name: "เพิ่มเวอร์ชันสูตร" }).click();
  await page.getByLabel("รหัสเวอร์ชัน").fill(input.versionCode);
  await page.getByLabel("ผลผลิตต่อสูตร").fill(input.yieldQuantity);
  await page
    .getByRole("combobox", { name: "วัตถุดิบ 1", exact: true })
    .selectOption({ label: `${input.ingredientName} (g)` });
  await page
    .getByRole("spinbutton", { name: "ปริมาณวัตถุดิบ 1", exact: true })
    .fill(input.ingredientQuantity);
  await page.getByRole("button", { name: "บันทึกเวอร์ชันสูตร" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "เปิดใช้เวอร์ชันนี้" }).click();
  await expect(page.getByText("สูตรที่ใช้งานอยู่")).toBeVisible({
    timeout: 15_000,
  });
}

export async function createDeliveryMethod(
  page: Page,
  input: Readonly<{
    name: string;
    customerFeeBaht: string;
    internalCostBaht: string;
  }>,
): Promise<void> {
  await clickVisibleLink(page, "การจัดส่ง");
  await page.getByRole("button", { name: "เพิ่มวิธีส่ง" }).click();
  await page.getByLabel("ชื่อวิธีส่ง").first().fill(input.name);
  await page.getByLabel("ค่าส่งที่เรียกเก็บ").first().fill(input.customerFeeBaht);
  await page.getByLabel("ต้นทุนขนส่ง").first().fill(input.internalCostBaht);
  await page.getByLabel("ต้องระบุสถานที่จัดส่ง").first().check();
  await page.getByRole("button", { name: "บันทึกวิธีส่ง" }).click();
  await expect(
    page.getByRole("button", { name: `บันทึกการแก้ไข ${input.name}` }),
  ).toBeVisible({ timeout: 15_000 });
}

export async function createCustomer(
  page: Page,
  input: Readonly<{
    name: string;
    deliveryMethodName: string;
    deliveryLocation: string;
  }>,
): Promise<void> {
  await clickVisibleLink(page, "ลูกค้า");
  await expect(page).toHaveURL(/\/customers$/);
  await page.getByLabel("ชื่อลูกค้า").fill(input.name);
  await page
    .getByLabel("วิธีส่งประจำ")
    .selectOption({ label: input.deliveryMethodName });
  await page
    .getByLabel("สถานที่จัดส่งประจำ")
    .fill(input.deliveryLocation);
  await page.getByRole("button", { name: "บันทึกลูกค้า" }).click();
  await expect(page.getByRole("main")).toContainText("บันทึกลูกค้าแล้ว");
  await expect(page.getByRole("main")).toContainText(input.name);
}

export async function createBakeCycle(
  page: Page,
  input: Readonly<{
    name: string;
    productionDate: string;
    deliveryDate: string;
  }>,
): Promise<void> {
  await clickVisibleLink(page, "รอบผลิต");
  await expect(page).toHaveURL(/\/cycles$/);
  await expect(
    page.getByRole("heading", { name: "รอบอบ", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await clickVisibleLink(page, "สร้างรอบอบ");
  await expect(page).toHaveURL(/\/cycles\/new$/);
  await expect(
    page.getByRole("heading", { name: "สร้างรอบอบ", exact: true }),
  ).toBeVisible();
  await page.getByLabel("ชื่อรอบอบ").fill(input.name);
  await page.getByLabel("สถานะเริ่มต้น").selectOption("OPEN");
  await page.getByLabel("วันผลิต").fill(input.productionDate);
  await page.getByLabel("วันส่งหลัก").fill(input.deliveryDate);
  await page.getByRole("button", { name: "สร้างรอบอบ" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname.startsWith("/cycles/") && url.pathname !== "/cycles/new",
  );
  await expect(page.getByRole("heading", { name: input.name })).toBeVisible();
}

export async function createOrder(
  page: Page,
  input: Readonly<{
    customerName: string;
    cycleName: string;
    productName: string;
    totalQuantity: number;
    discountBaht: string;
    amountPaidBaht: string;
  }>,
): Promise<void> {
  if (!Number.isSafeInteger(input.totalQuantity) || input.totalQuantity < 2) {
    throw new Error("totalQuantity must allow two positive order lines");
  }

  await clickVisibleLink(page, "ออเดอร์");
  await expect(page).toHaveURL(/\/orders$/);
  await expect(
    page.getByRole("heading", { name: "ออเดอร์", exact: true }),
  ).toBeVisible();
  await clickVisibleLink(page, "เพิ่มออเดอร์");
  await expect(page).toHaveURL(/\/orders\/new(?:\?.*)?$/);
  await expect(
    page.getByRole("heading", { name: "สร้างออเดอร์", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "ลูกค้า", exact: true })
    .selectOption({ label: input.customerName });
  await selectOptionContaining(
    page.getByRole("combobox", { name: "รอบผลิต", exact: true }),
    input.cycleName,
  );
  await page
    .getByRole("combobox", { name: "สินค้า รายการที่ 1", exact: true })
    .selectOption({ label: input.productName });
  await page
    .getByRole("spinbutton", { name: "จำนวน รายการที่ 1", exact: true })
    .fill("1");
  await page
    .getByLabel("หมายเหตุสินค้า รายการที่ 1", { exact: true })
    .fill("บรรทัดแรก");

  await page.getByRole("button", { name: "เพิ่มรายการสินค้า" }).click();
  await page
    .getByRole("combobox", { name: "สินค้า รายการที่ 2", exact: true })
    .selectOption({ label: input.productName });
  await page
    .getByRole("spinbutton", { name: "จำนวน รายการที่ 2", exact: true })
    .fill(String(input.totalQuantity - 1));
  await page
    .getByLabel("หมายเหตุสินค้า รายการที่ 2", { exact: true })
    .fill("บรรทัดที่สอง");
  await page.getByLabel("ส่วนลด (บาท)").fill(input.discountBaht);
  await page.getByLabel("ยอดชำระแล้ว (บาท)").fill(input.amountPaidBaht);

  await page
    .getByRole("button", { name: "บันทึกออเดอร์" })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(
    (url) => url.pathname.startsWith("/orders/") && url.pathname !== "/orders/new",
    { timeout: 15_000 },
  );
  await expect(
    page.getByRole("heading", { name: "แก้ไขออเดอร์" }),
  ).toBeVisible();
}
