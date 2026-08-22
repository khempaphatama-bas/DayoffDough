import Link from "next/link";
import type { OrderListFilters } from "@/modules/orders/application/orders";
import {
  ORDER_FULFILLMENT_STATUS_LABELS,
  ORDER_PAYMENT_STATUS_LABELS,
} from "@/modules/orders/ui/order-status-labels";

type FilterCycle = Readonly<{ id: string; cycleNumber: number; name: string }>;
type FilterCustomer = Readonly<{ id: string; name: string; active: boolean }>;

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal";

export function OrderFilters({
  filters,
  cycles,
  customers,
}: Readonly<{
  filters: OrderListFilters;
  cycles: ReadonlyArray<FilterCycle>;
  customers: ReadonlyArray<FilterCustomer>;
}>) {
  return (
    <form
      className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-5"
      method="get"
    >
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ค้นหา
        <input
          className={INPUT_CLASS}
          defaultValue={filters.query ?? ""}
          name="query"
          placeholder="ชื่อลูกค้าหรือข้อมูลจัดส่ง"
          type="search"
        />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        รอบผลิต
        <select
          className={INPUT_CLASS}
          defaultValue={filters.bakeCycleId ?? ""}
          name="bakeCycleId"
        >
          <option value="">ทุกรอบ</option>
          {cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              #{cycle.cycleNumber} {cycle.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ลูกค้า
        <select
          className={INPUT_CLASS}
          defaultValue={filters.customerId ?? ""}
          name="customerId"
        >
          <option value="">ทุกคน</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}{customer.active ? "" : " (ปิดใช้งาน)"}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        การชำระเงิน
        <select
          className={INPUT_CLASS}
          defaultValue={filters.paymentStatus ?? ""}
          name="paymentStatus"
        >
          <option value="">ทั้งหมด</option>
          {Object.entries(ORDER_PAYMENT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        การจัดเตรียม
        <select
          className={INPUT_CLASS}
          defaultValue={filters.fulfillmentStatus ?? ""}
          name="fulfillmentStatus"
        >
          <option value="">ทั้งหมด</option>
          {Object.entries(ORDER_FULFILLMENT_STATUS_LABELS).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-5">
        <button
          className="min-h-11 rounded-xl bg-stone-900 px-5 font-semibold text-white"
          type="submit"
        >
          ใช้ตัวกรอง
        </button>
        <Link
          className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 px-5 font-semibold text-stone-700"
          href="/orders"
        >
          ล้างตัวกรอง
        </Link>
      </div>
    </form>
  );
}
