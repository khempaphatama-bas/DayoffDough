import Link from "next/link";
import type { OrderDetail } from "@/modules/orders/application/orders";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import {
  ORDER_FULFILLMENT_STATUS_LABELS,
  ORDER_PAYMENT_STATUS_LABELS,
} from "@/modules/orders/ui/order-status-labels";

const createdDateFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Bangkok",
});

function PaymentBadge({ status }: Readonly<{ status: OrderDetail["paymentStatus"] }>) {
  const color =
    status === "PAID"
      ? "bg-emerald-50 text-emerald-800"
      : status === "REFUNDED"
        ? "bg-violet-50 text-violet-800"
        : status === "PARTIAL"
          ? "bg-amber-50 text-amber-800"
          : "bg-stone-100 text-stone-700";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>
      {ORDER_PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}

function FulfillmentBadge({
  status,
}: Readonly<{ status: OrderDetail["fulfillmentStatus"] }>) {
  const color =
    status === "DELIVERED"
      ? "bg-emerald-50 text-emerald-800"
      : status === "CANCELLED"
        ? "bg-red-50 text-red-700"
        : status === "IN_PRODUCTION" || status === "PACKED"
          ? "bg-blue-50 text-blue-800"
          : "bg-stone-100 text-stone-700";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>
      {ORDER_FULFILLMENT_STATUS_LABELS[status]}
    </span>
  );
}

function OrderMeta({ order }: Readonly<{ order: OrderDetail }>) {
  return (
    <>
      <span>{createdDateFormatter.format(order.createdAt)}</span>
      <span>{order.items.length} รายการสินค้า</span>
      <span className="font-bold text-stone-900">
        ฿{formatSatangAsBaht(order.totals.grandTotalSatang)}
      </span>
    </>
  );
}

export function OrderList({
  orders,
}: Readonly<{ orders: ReadonlyArray<OrderDetail> }>) {
  if (orders.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-8 text-center text-stone-600">
        ยังไม่พบออเดอร์ที่ค้นหา
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 lg:hidden">
        {orders.map((order) => (
          <article
            className={`rounded-2xl border border-stone-200 p-5 shadow-sm ${
              order.fulfillmentStatus === "CANCELLED"
                ? "bg-stone-50 opacity-70"
                : "bg-white"
            }`}
            key={order.id}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold text-stone-900">{order.customerName}</h2>
                <p className="mt-1 text-sm text-stone-600">{order.cycleName}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <PaymentBadge status={order.paymentStatus} />
                <FulfillmentBadge status={order.fulfillmentStatus} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-stone-600">
              <OrderMeta order={order} />
            </div>
            <Link
              className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-stone-800 px-4 font-semibold text-stone-900"
              href={`/orders/${order.id}`}
            >
              แก้ไขออเดอร์
            </Link>
          </article>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm lg:block">
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_7rem_7rem_8rem_8rem_8rem] items-center gap-4 border-b border-stone-200 bg-stone-50 px-5 py-3 text-xs font-bold text-stone-500">
          <span>ลูกค้า</span>
          <span>รอบผลิต</span>
          <span>วันที่สร้าง</span>
          <span>สินค้า</span>
          <span>ยอดสุทธิ</span>
          <span>สถานะ</span>
          <span>จัดการ</span>
        </div>
        {orders.map((order) => (
          <article
            className={`grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_7rem_7rem_8rem_8rem_8rem] items-center gap-4 border-b border-stone-100 px-5 py-4 last:border-b-0 ${
              order.fulfillmentStatus === "CANCELLED"
                ? "bg-stone-50 text-stone-500 opacity-70"
                : ""
            }`}
            key={order.id}
          >
            <span className="font-semibold text-stone-900">{order.customerName}</span>
            <span className="text-sm text-stone-700">{order.cycleName}</span>
            <span className="text-sm text-stone-600">
              {createdDateFormatter.format(order.createdAt)}
            </span>
            <span className="text-sm text-stone-600">
              {order.items.length} รายการสินค้า
            </span>
            <span className="font-bold text-stone-900">
              ฿{formatSatangAsBaht(order.totals.grandTotalSatang)}
            </span>
            <div className="grid justify-items-start gap-2">
              <PaymentBadge status={order.paymentStatus} />
              <FulfillmentBadge status={order.fulfillmentStatus} />
            </div>
            <Link
              className="inline-flex min-h-11 items-center font-semibold text-amber-800"
              href={`/orders/${order.id}`}
            >
              แก้ไขออเดอร์
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
