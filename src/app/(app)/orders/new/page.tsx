import Link from "next/link";
import { createQuickCustomerAction } from "@/app/(app)/customers/actions";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createOrderService } from "@/modules/orders/application/orders";
import type { OrderFormValues } from "@/modules/orders/domain/order-form";
import { OrderForm } from "@/modules/orders/ui/order-form";

type OrdersNewPageProps = Readonly<{
  searchParams: Promise<{
    cycleId?: string | ReadonlyArray<string>;
  }>;
}>;

export default async function OrdersNewPage({
  searchParams,
}: OrdersNewPageProps) {
  const owner = await requireOwner();
  const [query, options] = await Promise.all([
    searchParams,
    createOrderService(db).formOptions(owner.id),
  ]);
  const requestedCycleId =
    typeof query.cycleId === "string" ? query.cycleId : "";
  const selectedCycleId = options.bakeCycles.some(
    (cycle) => cycle.id === requestedCycleId,
  )
    ? requestedCycleId
    : "";
  const initialValues: OrderFormValues = {
    customerId: "",
    bakeCycleId: selectedCycleId,
    sourceChannel: "",
    requestedDeliveryDate: "",
    confirmedDeliveryDate: "",
    deliveryMethodId: "",
    deliveryFeeChargedBaht: "0.00",
    deliveryCostBaht: "0.00",
    deliveryFeePayer: "CUSTOMER",
    discountBaht: "0.00",
    amountPaidBaht: "0.00",
    deliveryLocation: "",
    deliveryNote: "",
    specialInstructions: "",
    items: [
      {
        productId: "",
        quantity: "1",
        unitPriceBaht: "0.00",
        lineNote: "",
      },
    ],
  };

  return (
    <main className="mx-auto grid max-w-5xl gap-7 px-5 py-8">
      <header>
        <Link
          className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-800"
          href="/orders"
        >
          ← ออเดอร์
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">
          สร้างออเดอร์
        </h1>
        <p className="mt-2 text-stone-600">
          เพิ่มสินค้าได้หลายรายการและตรวจยอดรวมได้ทันที ก่อนบันทึกเข้ารอบผลิต
        </p>
      </header>
      <OrderForm
        createQuickCustomer={createQuickCustomerAction}
        initialValues={initialValues}
        mode="create"
        options={options}
      />
    </main>
  );
}
