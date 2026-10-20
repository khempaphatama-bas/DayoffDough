import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createOperationsQueryService } from "@/modules/operations/application/operations-queries";
import { OperationsStateError, type CycleOperationsView } from "@/modules/operations/domain/types";
import { OperationsHeader } from "@/modules/operations/ui/operations-header";
import { OperationsTaskTimeline } from "@/modules/operations/ui/operations-task-timeline";
import { OperationsOrderBoard } from "@/modules/operations/ui/operations-order-board";
import { OperationsPaymentBoard } from "@/modules/operations/ui/operations-payment-board";
import { CycleCompletionForm } from "@/modules/operations/ui/cycle-completion-form";

export default async function OperationsPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  let view: CycleOperationsView;
  try {
    view = await createOperationsQueryService(db).getCycleOperations(owner.id, id);
  } catch (error) {
    if (error instanceof OperationsStateError && error.kind === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-5 py-8">
      <h1 className="text-3xl font-bold">Operations</h1>
      <OperationsHeader view={view} />
      {view.kind === "READY" ? (
        <>
          <OperationsTaskTimeline view={view} />
          <OperationsOrderBoard view={view} />
          <OperationsPaymentBoard view={view} />
          <CycleCompletionForm view={view} />
        </>
      ) : (
        <p className="rounded-2xl border border-stone-200 bg-white p-5">
          รอบนี้ยังไม่มี Operations generation กรุณาตรวจแผนการผลิต
        </p>
      )}
    </main>
  );
}
