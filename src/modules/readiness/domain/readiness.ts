export type MasterDataReadinessInput = Readonly<{
  settingsConfigured: boolean;
  inventoryItemCount: number;
  inventoryPricedCount: number;
  productCount: number;
  activeRecipeCount: number;
  deliveryMethodCount: number;
}>;

export type ReadinessCard = Readonly<{
  key: "settings" | "inventory" | "products" | "recipes" | "delivery";
  label: string;
  href: "/settings" | "/inventory" | "/products" | "/delivery";
  status: string;
  ready: boolean;
}>;

export type MasterDataReadiness = Readonly<{
  ready: boolean;
  message: string;
  cards: ReadonlyArray<ReadinessCard>;
}>;

export function evaluateMasterDataReadiness(
  input: MasterDataReadinessInput,
): MasterDataReadiness {
  const inventoryMissingPrice = Math.max(
    input.inventoryItemCount - input.inventoryPricedCount,
    0,
  );
  const productsMissingRecipe = Math.max(
    input.productCount - input.activeRecipeCount,
    0,
  );
  const cards: ReadonlyArray<ReadinessCard> = [
    {
      key: "settings",
      label: "ตั้งค่าร้าน",
      href: "/settings",
      ready: input.settingsConfigured,
      status: input.settingsConfigured ? "พร้อม" : "ยังไม่ได้ตั้งค่า",
    },
    {
      key: "inventory",
      label: "วัตถุดิบและบรรจุภัณฑ์",
      href: "/inventory",
      ready: input.inventoryItemCount > 0 && inventoryMissingPrice === 0,
      status:
        input.inventoryItemCount === 0
          ? "ยังไม่มีรายการ"
          : inventoryMissingPrice > 0
            ? `${inventoryMissingPrice} รายการยังไม่มีราคา`
            : "พร้อม",
    },
    {
      key: "products",
      label: "สินค้า",
      href: "/products",
      ready: input.productCount > 0,
      status: input.productCount > 0 ? `${input.productCount} รายการ` : "ยังไม่มีสินค้า",
    },
    {
      key: "recipes",
      label: "สูตรที่เปิดใช้งาน",
      href: "/products",
      ready: input.productCount > 0 && productsMissingRecipe === 0,
      status:
        input.productCount === 0
          ? "ต้องเพิ่มสินค้าก่อน"
          : productsMissingRecipe > 0
            ? `${productsMissingRecipe} สินค้ายังไม่มีสูตรที่เปิดใช้`
            : "พร้อม",
    },
    {
      key: "delivery",
      label: "วิธีจัดส่ง",
      href: "/delivery",
      ready: input.deliveryMethodCount > 0,
      status:
        input.deliveryMethodCount > 0
          ? `${input.deliveryMethodCount} วิธี`
          : "ยังไม่มีวิธีส่ง",
    },
  ];
  const ready =
    input.settingsConfigured &&
    input.inventoryPricedCount > 0 &&
    input.activeRecipeCount > 0 &&
    input.deliveryMethodCount > 0;
  return {
    ready,
    message: ready ? "ข้อมูลตั้งต้นพร้อมใช้งาน" : "ยังมีข้อมูลตั้งต้นที่ต้องจัดการ",
    cards,
  };
}
