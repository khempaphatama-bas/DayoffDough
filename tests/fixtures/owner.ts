import { expect, type Page } from "@playwright/test";

export const OWNER_ID = "00000000-0000-4000-8000-000000000001";
export const OTHER_OWNER_ID = "00000000-0000-4000-8000-000000000002";

function requiredEnv(name: "E2E_OWNER_EMAIL" | "E2E_OWNER_PASSWORD"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for authenticated E2E tests`);
  return value;
}

async function clickVisibleLink(page: Page, name: string): Promise<void> {
  const links = page.getByRole("link", { name, exact: true });
  for (let index = 0; index < (await links.count()); index += 1) {
    const link = links.nth(index);
    if (await link.isVisible()) {
      await link.click();
      return;
    }
  }
  throw new Error(`Visible link not found: ${name}`);
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
  await expect(page.getByText("บันทึกการตั้งค่าร้านแล้ว")).toBeVisible();
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
  await expect(page.getByText(input.name).filter({ visible: true }).first()).toBeVisible();
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
  ).toBeVisible();
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
  await expect(page.getByText(input.name).filter({ visible: true }).first()).toBeVisible();
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
  await expect(page.getByText("สูตรที่ใช้งานอยู่")).toBeVisible();
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
  await page.getByRole("button", { name: "บันทึกวิธีส่ง" }).click();
  await expect(
    page.getByRole("button", { name: `บันทึกการแก้ไข ${input.name}` }),
  ).toBeVisible();
}
