import Link from "next/link";
import { notFound } from "next/navigation";
import { createQuickCustomerAction } from "@/app/(app)/customers/actions";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  createOrderService,
  type OrderDetail,
} from "@/modules/orders/application/orders";
import type { OrderFormValues } from "@/modules/orders/domain/order-form";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import { OrderForm } from "@/modules/orders/ui/order-form";

export default async function OrderDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  const service = createOrderService(db);
  let order: OrderDetail;
  try {
    order = await service.get(owner.id, id);
  } catch (error) {
    if (error instanceof Error && error.message === "Order not found") {
      notFound();
    }
    throw error;
  }

  const options = await service.formOptions(owner.id, {
    customerId: order.customerId,
    bakeCycleId: order.bakeCycleId,
    productIds: [...new Set(order.items.map((item) => item.productId))],
    deliveryMethodId: order.deliveryMethodId,
  });
  const initialValues: OrderFormValues = {
    customerId: order.customerId,
    bakeCycleId: order.bakeCycleId,
    sourceChannel: order.sourceChannel ?? "",
    requestedDeliveryDate: order.requestedDeliveryDate ?? "",
    confirmedDeliveryDate: order.confirmedDeliveryDate ?? "",
    deliveryMethodId: order.deliveryMethodId ?? "",
    deliveryFeeChargedBaht: formatSatangAsBaht(
      order.deliveryFeeChargedSatang,
    ),
    deliveryCostBaht: formatSatangAsBaht(order.deliveryCostSatang),
    deliveryFeePayer: order.deliveryFeePayer,
    discountBaht: formatSatangAsBaht(order.discountSatang),
    amountPaidBaht: formatSatangAsBaht(order.amountPaidSatang),
    deliveryLocation: order.deliveryLocation ?? "",
    deliveryNote: order.deliveryNote ?? "",
    specialInstructions: order.specialInstructions ?? "",
    items: order.items.map((item) => ({
      productId: item.productId,
      quantity: String(item.quantity),
      unitPriceBaht: formatSatangAsBaht(item.unitPriceSatang),
      lineNote: item.lineNote ?? "",
    })),
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
          แก้ไขออเดอร์
        </h1>
        <p className="mt-2 text-stone-600">
          {order.customerName} · {order.cycleName}
        </p>
      </header>
      <OrderForm
        createQuickCustomer={createQuickCustomerAction}
        initialValues={initialValues}
        mode="edit"
        options={options}
        orderId={order.id}
      />
    </main>
  );
}
