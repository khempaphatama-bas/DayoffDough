import Link from "next/link";
import type { Customer } from "@/modules/customers/application/customers";

type DeliveryMethodOption = Readonly<{
  id: string;
  name: string;
}>;

export function CustomerList({
  customers,
  deliveryMethods,
  query,
  active,
}: Readonly<{
  customers: ReadonlyArray<Customer>;
  deliveryMethods: ReadonlyArray<DeliveryMethodOption>;
  query: string;
  active: "all" | "true" | "false";
}>) {
  const methodNames = new Map(
    deliveryMethods.map((method) => [method.id, method.name]),
  );

  return (
    <section className="grid gap-4">
      <form className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" method="get">
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ค้นหาลูกค้า
          <input
            className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
            defaultValue={query}
            name="query"
            placeholder="ชื่อ ช่องทางติดต่อ หรือเบอร์โทร"
            type="search"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          สถานะ
          <select
            className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
            defaultValue={active}
            name="active"
          >
            <option value="all">ทั้งหมด</option>
            <option value="true">เปิดใช้งาน</option>
            <option value="false">ปิดใช้งาน</option>
          </select>
        </label>
        <button
          className="min-h-11 self-end rounded-xl border border-stone-800 px-5 font-semibold"
          type="submit"
        >
          ค้นหา
        </button>
      </form>

      {customers.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-8 text-center text-stone-600">
          ยังไม่พบลูกค้าที่ค้นหา
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {customers.map((customer) => {
            const defaultMethod = customer.defaultDeliveryMethodId
              ? methodNames.get(customer.defaultDeliveryMethodId)
              : null;
            return (
              <article
                className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
                key={customer.id}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-bold text-stone-900">{customer.name}</h2>
                    <p className="mt-1 text-sm text-stone-600">
                      {[customer.contactHandle, customer.phone]
                        .filter(Boolean)
                        .join(" · ") || "ยังไม่มีข้อมูลติดต่อ"}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${customer.active ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-500"}`}
                  >
                    {customer.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-stone-500">วิธีส่งประจำ</dt>
                    <dd className="mt-1 font-semibold text-stone-800">
                      {defaultMethod ?? "ยังไม่กำหนด"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">สถานที่จัดส่ง</dt>
                    <dd className="mt-1 text-stone-700">
                      {customer.defaultDeliveryLocation || "ยังไม่กำหนด"}
                    </dd>
                  </div>
                </dl>
                <Link
                  className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-stone-800 px-4 font-semibold"
                  href={`/customers/${customer.id}`}
                >
                  แก้ไขลูกค้า
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
