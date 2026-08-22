import Link from "next/link";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createCustomerService } from "@/modules/customers/application/customers";
import { createCycleService } from "@/modules/cycles/application/cycles";
import {
  createOrderService,
  type OrderListFilters,
} from "@/modules/orders/application/orders";
import { OrderFilters } from "@/modules/orders/ui/order-filters";
import { OrderList } from "@/modules/orders/ui/order-list";

type OrdersSearchParams = Readonly<{
  query?: string | ReadonlyArray<string>;
  bakeCycleId?: string | ReadonlyArray<string>;
  customerId?: string | ReadonlyArray<string>;
  paymentStatus?: string | ReadonlyArray<string>;
  fulfillmentStatus?: string | ReadonlyArray<string>;
}>;

const querySchema = z.string().trim().max(200);
const uuidSchema = z.string().uuid();
const paymentStatusSchema = z.enum(["UNPAID", "PARTIAL", "PAID", "REFUNDED"]);
const fulfillmentStatusSchema = z.enum([
  "NEW",
  "CONFIRMED",
  "IN_PRODUCTION",
  "PACKED",
  "DELIVERED",
  "CANCELLED",
]);

function parseString<Value>(
  value: string | ReadonlyArray<string> | undefined,
  schema: z.ZodType<Value>,
): Value | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export default async function OrdersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<OrdersSearchParams> }>) {
  const owner = await requireOwner();
  const search = await searchParams;
  const query = parseString(search.query, querySchema);
  const bakeCycleId = parseString(search.bakeCycleId, uuidSchema);
  const customerId = parseString(search.customerId, uuidSchema);
  const paymentStatus = parseString(search.paymentStatus, paymentStatusSchema);
  const fulfillmentStatus = parseString(
    search.fulfillmentStatus,
    fulfillmentStatusSchema,
  );
  const filters: OrderListFilters = {
    ...(query ? { query } : {}),
    ...(bakeCycleId ? { bakeCycleId } : {}),
    ...(customerId ? { customerId } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(fulfillmentStatus ? { fulfillmentStatus } : {}),
  };
  const [orders, cycles, customers] = await Promise.all([
    createOrderService(db).list(owner.id, filters),
    createCycleService(db).list(owner.id),
    createCustomerService(db).list(owner.id),
  ]);

  return (
    <main className="mx-auto grid max-w-7xl gap-7 px-5 py-8">
      <header className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <p className="mb-2 text-sm font-semibold text-amber-800">
            งานขายและจัดส่ง
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-stone-900">
            ออเดอร์
          </h1>
          <p className="mt-2 text-stone-600">
            ค้นหา ติดตามการชำระเงิน และจัดเตรียมออเดอร์ในแต่ละรอบผลิต
          </p>
        </div>
        <Link
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-amber-800 px-6 text-lg font-bold text-white shadow-sm"
          href="/orders/new"
        >
          เพิ่มออเดอร์
        </Link>
      </header>
      <OrderFilters customers={customers} cycles={cycles} filters={filters} />
      <section className="grid gap-4">
        <h2 className="text-2xl font-bold text-stone-900">รายการออเดอร์</h2>
        <OrderList orders={orders} />
      </section>
    </main>
  );
}
