import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  type CustomerFilters,
  createCustomerService,
} from "@/modules/customers/application/customers";
import { CustomerForm } from "@/modules/customers/ui/customer-form";
import { CustomerList } from "@/modules/customers/ui/customer-list";
import { createDeliveryService } from "@/modules/delivery/application/delivery";

type CustomerSearchParams = Readonly<{
  query?: string | ReadonlyArray<string>;
  active?: string | ReadonlyArray<string>;
}>;

function firstValue(value: string | ReadonlyArray<string> | undefined): string {
  return typeof value === "string" ? value : value?.[0] ?? "";
}

export default async function CustomerPage({
  searchParams,
}: Readonly<{ searchParams: Promise<CustomerSearchParams> }>) {
  const owner = await requireOwner();
  const search = await searchParams;
  const query = firstValue(search.query);
  const activeValue = firstValue(search.active);
  const active =
    activeValue === "true" ? true : activeValue === "false" ? false : undefined;
  const filters: CustomerFilters = {
    query,
    ...(active === undefined ? {} : { active }),
  };
  const [customerRows, deliveryConfiguration] = await Promise.all([
    createCustomerService(db).list(owner.id, filters),
    createDeliveryService(db).listDeliveryConfiguration(owner.id),
  ]);

  return (
    <main className="mx-auto grid max-w-6xl gap-7 px-5 py-8">
      <header>
        <p className="mb-2 text-sm font-semibold text-amber-800">
          ข้อมูลสำหรับรับออเดอร์
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900">
          ลูกค้า
        </h1>
        <p className="mt-2 text-stone-600">
          เก็บช่องทางติดต่อและค่าเริ่มต้นการจัดส่งของลูกค้าแต่ละคน
        </p>
      </header>
      <section className="grid gap-4">
        <h2 className="text-2xl font-bold text-stone-900">เพิ่มลูกค้า</h2>
        <CustomerForm
          deliveryMethods={deliveryConfiguration.methods.filter(
            (method) => method.active,
          )}
        />
      </section>
      <CustomerList
        active={
          active === undefined ? "all" : active ? "true" : "false"
        }
        customers={customerRows}
        deliveryMethods={deliveryConfiguration.methods}
        query={query}
      />
    </main>
  );
}
