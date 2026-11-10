import Link from "next/link";
import { formatUnitLabel } from "@/modules/units/domain/units";
import type { ConsumptionRevisionView } from "../domain/types";

export function UsageHistory({ revisions }: Readonly<{ revisions: readonly ConsumptionRevisionView[] }>) {
  return (
    <section className="grid min-w-0 gap-4 [overflow-wrap:anywhere]" aria-label="ประวัติยอดใช้ที่บันทึกแล้ว">
      <h2 className="text-xl font-bold text-stone-900">ประวัติยอดใช้ที่บันทึกแล้ว</h2>
      {revisions.length === 0 ? <p className="text-sm text-stone-500">ยังไม่มีบันทึกยอดใช้</p> : null}
      {revisions.map(revision => (
        <article className="grid min-w-0 gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm" key={revision.id}>
          <h3 className="text-lg font-bold text-stone-900">บันทึกครั้งที่ {revision.revisionNumber}</h3>
          <p className="text-sm text-stone-500">{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(revision.confirmedAt)}</p>
          {revision.reason ? <p className="break-words text-sm [overflow-wrap:anywhere]">{revision.reason}</p> : null}
          <ul className="grid min-w-0 gap-3">
            {revision.items.map(item => (
              <li className="grid min-w-0 gap-1 rounded-2xl bg-stone-50 p-4 text-sm" key={item.inventoryItemId}>
                <h4 className="break-words font-bold text-stone-900 [overflow-wrap:anywhere]">{item.inventoryItemName}</h4>
                <p>ตามแผน {item.plannedQuantity} {formatUnitLabel(item.baseUnit)}</p>
                <p>{item.basis === "PLANNED" ? "ตามแผน (ประมาณการ)" : "เจ้าของบันทึกใช้จริง"}</p>
                <p className="break-words">ยอดใช้ {item.usedQuantity} · ผลสต๊อก {item.quantityDelta} · {item.mode}</p>
                {item.reason ? <p className="break-words [overflow-wrap:anywhere]">{item.reason}</p> : null}
                {item.mode === "HISTORY_ONLY" ? <>
                  <p>แก้ประวัติเท่านั้น ไม่ปรับสต๊อกปัจจุบัน</p>
                  <Link className="inline-flex min-h-11 items-center font-bold text-amber-900 underline" href={`/inventory/${item.inventoryItemId}`}>เปิดสต๊อกปัจจุบัน {item.inventoryItemName}</Link>
                </> : null}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
