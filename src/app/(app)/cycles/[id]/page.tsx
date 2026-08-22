import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createCycleService } from "@/modules/cycles/application/cycles";
import { createOrderService } from "@/modules/orders/application/orders";
import { CycleDetail } from "./cycle-detail";

export default async function CycleDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  const orderService = createOrderService(db);
  const [cycle, summary, orders] = await Promise.all([
    createCycleService(db).get(owner.id, id),
    orderService.getCycleSummary(owner.id, id),
    orderService.list(owner.id, { bakeCycleId: id }),
  ]);
  return <CycleDetail cycle={cycle} orders={orders} summary={summary} />;
}
