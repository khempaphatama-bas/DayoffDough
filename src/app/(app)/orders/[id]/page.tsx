import Link from "next/link";
import { notFound } from "next/navigation";
import { createQuickCustomerAction } from "@/app/(app)/customers/actions";
import {
  cancelOrderAction,
  markOrderRefundedAction,
  restoreOrderPaymentTrackingAction,
  updateFulfillmentStatusAction,
} from "@/app/(app)/orders/actions";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  createOrderService,
  type OrderDetail,
} from "@/modules/orders/application/orders";
import type { OrderFormValues } from "@/modules/orders/domain/order-form";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import { OrderForm } from "@/modules/orders/ui/order-form";
import {
  OrderStatusActions,
} from "@/modules/orders/ui/order-status-actions";
import {
  ORDER_FULFILLMENT_STATUS_LABELS,
  ORDER_PAYMENT_STATUS_LABELS,
} from "@/modules/orders/ui/order-status-labels";

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
  const productionFrozen =
    order.cycleStatus !== "DRAFT" && order.cycleStatus !== "OPEN";

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
      {productionFrozen ? (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950">
          รอบผลิตถูกล็อกแล้ว แก้ได้เฉพาะยอดชำระและสถานะที่ไม่กระทบการผลิต
        </p>
      ) : null}
      <section className="grid gap-5 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.7fr)]">
        <div>
          <h2 className="text-xl font-bold text-stone-900">สรุปออเดอร์</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-stone-500">ลูกค้า</dt>
              <dd className="mt-1 font-semibold text-stone-900">
                {order.customerName}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">รอบผลิต</dt>
              <dd className="mt-1 font-semibold text-stone-900">
                {order.cycleName}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">วิธีจัดส่ง</dt>
              <dd className="mt-1 font-semibold text-stone-900">
                {order.deliveryMethodName ?? "ยังไม่กำหนด"}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">ยอดสุทธิ</dt>
              <dd className="mt-1 text-lg font-bold text-stone-900">
                ฿{formatSatangAsBaht(order.totals.grandTotalSatang)}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">ชำระแล้ว</dt>
              <dd className="mt-1 text-lg font-bold text-stone-900">
                ฿{formatSatangAsBaht(order.amountPaidSatang)}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">คงเหลือ</dt>
              <dd className="mt-1 text-lg font-bold text-stone-900">
                ฿{formatSatangAsBaht(order.totals.balanceSatang)}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">การชำระเงิน</dt>
              <dd className="mt-1 font-semibold text-stone-900">
                {ORDER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">การจัดเตรียม</dt>
              <dd className="mt-1 font-semibold text-stone-900">
                {ORDER_FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]}
              </dd>
            </div>
          </dl>
        </div>
        <OrderStatusActions
          cancelOrder={cancelOrderAction}
          cycleStatus={order.cycleStatus}
          fulfillmentStatus={order.fulfillmentStatus}
          markOrderRefunded={markOrderRefundedAction}
          orderId={order.id}
          paymentStatus={order.paymentStatus}
          restoreOrderPaymentTracking={restoreOrderPaymentTrackingAction}
          updateFulfillmentStatus={updateFulfillmentStatusAction}
        />
      </section>
      <OrderForm
        createQuickCustomer={createQuickCustomerAction}
        initialValues={initialValues}
        mode="edit"
        options={options}
        orderId={order.id}
        productionFrozen={productionFrozen}
      />
    </main>
  );
}
