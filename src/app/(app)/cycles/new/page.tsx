import Link from "next/link";
import { requireOwner } from "@/lib/auth/require-owner";
import { CycleForm } from "@/modules/cycles/ui/cycle-form";

export default async function NewCyclePage() {
  await requireOwner();

  return (
    <main className="mx-auto grid max-w-4xl gap-7 px-5 py-8">
      <header>
        <Link
          className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-800"
          href="/cycles"
        >
          ← รอบอบ
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">
          สร้างรอบอบ
        </h1>
        <p className="mt-2 text-stone-600">
          รอบใหม่จะเปิดรับออเดอร์เป็นค่าเริ่มต้น หรือเก็บเป็นแบบร่างก่อนได้
        </p>
      </header>
      <CycleForm />
    </main>
  );
}
