import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  type Customer,
  createCustomerService,
} from "@/modules/customers/application/customers";
import { CustomerForm } from "@/modules/customers/ui/customer-form";
import { createDeliveryService } from "@/modules/delivery/application/delivery";
import { createOrderService } from "@/modules/orders/application/orders";
import { OrderList } from "@/modules/orders/ui/order-list";

export default async function CustomerDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  let customer: Customer;
  try {
    customer = await createCustomerService(db).get(owner.id, id);
  } catch (error) {
    if (error instanceof Error && error.message === "Customer not found") {
      notFound();
    }
    throw error;
  }
  const [deliveryConfiguration, orderHistory] = await Promise.all([
    createDeliveryService(db).listDeliveryConfiguration(owner.id),
    createOrderService(db).list(owner.id, { customerId: id }),
  ]);
  const deliveryMethods = deliveryConfiguration.methods.filter(
    (method) =>
      method.active || method.id === customer.defaultDeliveryMethodId,
  );

  return (
    <main className="mx-auto grid max-w-4xl gap-7 px-5 py-8">
      <header>
        <Link
          className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-800"
          href="/customers"
        >
          ← ลูกค้า
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">
          {customer.name}
        </h1>
        <p className="mt-2 text-stone-600">
          แก้ไขข้อมูลติดต่อ ค่าเริ่มต้นการจัดส่ง และสถานะการใช้งาน
        </p>
      </header>
      <CustomerForm customer={customer} deliveryMethods={deliveryMethods} />
      <section className="grid gap-4">
        <h2 className="text-2xl font-bold text-stone-900">ประวัติออเดอร์</h2>
        <OrderList orders={orderHistory} />
      </section>
    </main>
  );
}
