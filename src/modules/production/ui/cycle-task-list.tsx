"use client";

import Link from "next/link";
import { useState } from "react";
import { createUtcCalendarDate } from "@/modules/production/domain/task-generation";
import type { CycleProductionView, CycleTaskView } from "@/modules/production/domain/types";
import { CycleTaskCard } from "./cycle-task-card";
import { CycleTaskForm } from "./cycle-task-form";

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function localDateLabel(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" }).format(createUtcCalendarDate(year!, month! - 1, day!, 5));
}

function formatDateTime(date: Date | null): string {
  return date ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date) : "";
}

function Timeline({ view }: Readonly<{ view: Extract<CycleProductionView, { kind: "CURRENT" | "HISTORY" }> }>) {
  const groups = new Map<string, CycleTaskView[]>();
  for (const task of view.tasks) groups.set(localDateKey(task.scheduledAt), [...(groups.get(localDateKey(task.scheduledAt)) ?? []), task]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-stone-900">ไทม์ไลน์การผลิต · รุ่น {view.generation.generation}</h2>
        {!view.writable ? <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-bold text-stone-700">อ่านอย่างเดียว</span> : null}
      </div>
      {[...groups.entries()].map(([key, tasks]) => (
        <section aria-labelledby={`timeline-day-${key}`} className="grid gap-4" key={key}>
          <h3 className="text-xl font-bold text-stone-900" id={`timeline-day-${key}`}>{localDateLabel(key)}</h3>
          {tasks.map((task) => <CycleTaskCard cycleId={view.cycle.cycleId} generationId={view.generation.id} key={task.id} products={view.products} task={task} writable={view.writable} />)}
        </section>
      ))}
      {view.tasks.length === 0 ? <p className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-700">ยังไม่มีงานในรุ่นนี้</p> : null}
    </>
  );
}

export function CycleTaskList({ view }: Readonly<{ view: CycleProductionView }>) {
  const [showCreate, setShowCreate] = useState(false);
  if (view.kind === "NO_GENERATION") {
    return <p className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-700">{view.reason === "LEGACY_SNAPSHOT" ? "รอบรุ่นนี้ยังไม่มี Production Timeline" : "รอบนี้ยังไม่มีแผน Production Timeline"}</p>;
  }
  return (
    <div className="grid gap-6">
      <Timeline view={view} />
      {view.writable ? (
        showCreate ? <CycleTaskForm mode="create" cycleId={view.cycle.cycleId} taskGenerationId={view.generation.id} products={view.products} onCancel={() => setShowCreate(false)} /> : <button className="min-h-12 rounded-xl bg-amber-800 px-5 font-bold text-white" onClick={() => setShowCreate(true)} type="button">เพิ่มงานเอง</button>
      ) : null}
    </div>
  );
}

export function ProductionGenerationLinks({ view }: Readonly<{ view: Extract<CycleProductionView, { kind: "CURRENT" | "HISTORY" }> }>) {
  return <nav aria-label="ประวัติรุ่น Production Timeline" className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">ประวัติ Production Timeline</h2><ul className="grid gap-2">{view.generations.map((generation) => <li className="rounded-2xl bg-stone-50 p-3" key={generation.planningSnapshotId}><Link aria-current={generation.generation === view.generation.generation ? "page" : undefined} className="inline-flex min-h-11 items-center font-bold text-amber-900" href={generation.planningStatus === "ACTIVE" ? `/cycles/${view.cycle.cycleId}/production` : `/cycles/${view.cycle.cycleId}/production?generation=${generation.generation}`}>รุ่น {generation.generation} · {generation.planningStatus === "ACTIVE" ? "ใช้งานอยู่" : "แทนที่แล้ว"}</Link><div className="grid gap-1 text-sm text-stone-600"><p>ล็อกเมื่อ {formatDateTime(generation.lockedAt)}</p>{generation.unlockReason ? <p>เหตุผลที่ปลดล็อก: {generation.unlockReason}</p> : null}{generation.unlockedAt ? <p>ปลดล็อกเมื่อ {formatDateTime(generation.unlockedAt)}</p> : null}</div></li>)}</ul></nav>;
}
