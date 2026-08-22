import { expect, test } from "@playwright/test";
import {
  addInventoryPrice,
  configureShopSettings,
  createDeliveryMethod,
  createInventoryItem,
  createProduct,
  createRecipeVersion,
  loginAsOwner,
} from "../fixtures/owner";

test("owner prepares the bakery master data", async ({ page }) => {
  test.setTimeout(120_000);
  const runId = Date.now().toString();
  const ingredientName = `NS Wonder ${runId}`;
  const productName = `Focaccia ${runId}`;

  await loginAsOwner(page);
  await configureShopSettings(page);
  await createInventoryItem(page, {
    name: ingredientName,
    category: "INGREDIENT",
    purchaseLabel: "ถุง 1 kg",
    packQuantity: "1000",
  });
  await addInventoryPrice(page, ingredientName, { packPriceBaht: "55" });
  await createProduct(page, { name: productName, sellingPriceBaht: "220" });
  await createRecipeVersion(page, productName, {
    versionCode: `DOD-FOC-${runId}`,
    yieldQuantity: "1",
    ingredientName,
    ingredientQuantity: "390",
  });
  await createDeliveryMethod(page, {
    name: `KEX Same Day ${runId}`,
    customerFeeBaht: "120",
    internalCostBaht: "120",
  });
  await page.goto("/dashboard");
  await expect(page.getByText("ข้อมูลตั้งต้นพร้อมใช้งาน")).toBeVisible();
});
