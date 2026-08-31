"use client";

import Decimal from "decimal.js";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import {
  lockCycleAction,
  type PlanningActionState,
} from "@/app/(app)/cycles/[id]/planning/actions";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import type {
  PlanningIssue,
  PlanningPreview,
  PlanningProductPlan,
} from "@/modules/planning/domain/types";
import { formatUnitLabel } from "@/modules/units/domain/units";

const INITIAL_STATE: PlanningActionState = {
  error: null,
  fieldErrors: {},
  stale: false,
};
const BATCH_PATTERN = /^(?:\d+|\d*\.\d{1,6})$/;

function initialSelected(preview: PlanningPreview): Record<string, string> {
  return Object.fromEntries(
    preview.productPlans.map((plan) => [
      plan.productId,
      String(plan.suggestedBatchCount),
    ]),
  );
}

function validBatch(value: string): boolean {
  return (
    BATCH_PATTERN.test(value) &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0
  );
}

function calculatedOutput(
  plan: PlanningProductPlan,
  selected: string,
): Readonly<{ output: string; difference: string }> | null {
  if (!validBatch(selected)) return null;
  const output = new Decimal(plan.yieldInSellingUnit).mul(selected);
  return {
    output: output.toString(),
    difference: output.minus(plan.orderedQuantity).toString(),
  };
}

function IssueList({
  issues,
  label,
  tone,
}: Readonly<{
  issues: ReadonlyArray<PlanningIssue>;
  label: string;
  tone: "blocker" | "warning";
}>) {
  if (issues.length === 0) return null;
  return (
    <section
      aria-label={label}
      className={
        tone === "blocker"
          ? "rounded-2xl border border-red-300 bg-red-50 p-4 text-red-950"
          : "rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
      }
      role="alert"
    >
      <h2 className="font-bold">{label}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.sourceEntityId ?? "cycle"}-${index}`}>
            {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PlanningPreviewForm({
  preview,
}: Readonly<{ preview: PlanningPreview }>) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    lockCycleAction,
    INITIAL_STATE,
  );
  const [selectedByProductId, setSelectedByProductId] = useState<
    Record<string, string>
  >(() => initialSelected(preview));
  const [reasonByProductId, setReasonByProductId] = useState<
    Record<string, string>
  >({});
  const [lockRequestId, setLockRequestId] = useState(() =>
    crypto.randomUUID(),
  );
  const previousFingerprint = useRef(preview.inputFingerprint);

  useEffect(() => {
    if (state.stale) router.refresh();
  }, [router, state.stale]);

  useEffect(() => {
    if (previousFingerprint.current === preview.inputFingerprint) return;
    previousFingerprint.current = preview.inputFingerprint;
    setSelectedByProductId(initialSelected(preview));
    setReasonByProductId({});
    setLockRequestId(crypto.randomUUID());
  }, [preview]);

  const overrides = preview.productPlans.flatMap((plan) => {
    const selected = selectedByProductId[plan.productId] ?? "";
    return selected === String(plan.suggestedBatchCount)
      ? []
      : [
          {
            productId: plan.productId,
            selectedBatchCount: selected,
            reason: reasonByProductId[plan.productId]?.trim() ?? "",
          },
        ];
  });
  const inputsValid = preview.productPlans.every((plan) => {
    const selected = selectedByProductId[plan.productId] ?? "";
    if (!validBatch(selected)) return false;
    return (
      selected === String(plan.suggestedBatchCount) ||
      (reasonByProductId[plan.productId]?.trim().length ?? 0) > 0
    );
  });
  const cannotSubmit =
    preview.blockers.length > 0 || !inputsValid || pending;
  const payload = JSON.stringify({
    cycleId: preview.cycle.id,
    inputFingerprint: preview.inputFingerprint,
    lockRequestId,
    overrides,
  });

  function preventInvalidSubmit(event: FormEvent<HTMLFormElement>) {
    if (cannotSubmit) event.preventDefault();
  }

  return (
    <form
      action={formAction}
      className="grid gap-5 pb-24 md:pb-0"
      onSubmit={preventInvalidSubmit}
    >
      <IssueList issues={preview.blockers} label="รายการที่ต้องแก้" tone="blocker" />
      <IssueList issues={preview.warnings} label="คำเตือน" tone="warning" />

      <input name="payload" type="hidden" value={payload} />

      <section aria-labelledby="product-plan-heading" className="grid gap-4">
        <h2 className="text-2xl font-bold text-stone-900" id="product-plan-heading">
          แผนการผลิต
        </h2>
        {preview.productPlans.map((plan) => {
          const selected = selectedByProductId[plan.productId] ?? "";
          const isOverride = selected !== String(plan.suggestedBatchCount);
          const calculated = calculatedOutput(plan, selected);
          const unit = formatUnitLabel(plan.sellingUnit);
          const batchError =
            state.fieldErrors[`selectedBatchCount.${plan.productId}`];
          const reasonError = state.fieldErrors[`reason.${plan.productId}`];
          const batchInvalid = !validBatch(selected);
          const productCost = preview.productCosts.find(
            (cost) => cost.productId === plan.productId,
          );
          return (
            <article
              className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
              key={plan.productId}
            >
              <div>
                <h3 className="text-xl font-bold text-stone-900">
                  {plan.productName}
                </h3>
                <p className="mt-1 text-sm text-stone-600">
                  ยอดสั่ง {plan.orderedQuantity} {unit} · แนะนำ {plan.suggestedBatchCount} แบตช์
                </p>
              </div>
              <label className="grid gap-2 text-sm font-semibold text-stone-700">
                จำนวนแบตช์ {plan.productName}
                <input
                  aria-describedby={
                    batchInvalid || batchError
                      ? `batch-error-${plan.productId}`
                      : undefined
                  }
                  aria-invalid={batchInvalid || Boolean(batchError)}
                  className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
                  inputMode="decimal"
                  onChange={(event) =>
                    setSelectedByProductId((current) => ({
                      ...current,
                      [plan.productId]: event.target.value,
                    }))
                  }
                  required
                  type="text"
                  value={selected}
                />
              </label>
              {batchInvalid || batchError ? (
                <p className="text-sm text-red-700" id={`batch-error-${plan.productId}`}>
                  {batchError ??
                    "จำนวนแบตช์ต้องเป็นเลขบวก ทศนิยมไม่เกิน 6 ตำแหน่ง"}
                </p>
              ) : null}
              {isOverride ? (
                <label className="grid gap-2 text-sm font-semibold text-stone-700">
                  เหตุผลที่ปรับ {plan.productName}
                  <input
                    aria-describedby={reasonError ? `reason-error-${plan.productId}` : undefined}
                    className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
                    maxLength={2000}
                    onChange={(event) =>
                      setReasonByProductId((current) => ({
                        ...current,
                        [plan.productId]: event.target.value,
                      }))
                    }
                    required
                    type="text"
                    value={reasonByProductId[plan.productId] ?? ""}
                  />
                </label>
              ) : null}
              {reasonError ? (
                <p className="text-sm text-red-700" id={`reason-error-${plan.productId}`}>
                  {reasonError}
                </p>
              ) : null}
              <dl className="grid gap-2 rounded-2xl bg-stone-50 p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-stone-500">ผลผลิตตามแผน</dt>
                  <dd className="font-bold text-stone-900">
                    ผลผลิตตามแผน {calculated?.output ?? "—"} {unit}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">ส่วนต่างจากยอดสั่ง</dt>
                  <dd className="font-bold text-stone-900">
                    ส่วนต่าง {calculated?.difference ?? "—"} {unit}
                  </dd>
                </div>
              </dl>
              {productCost ? (
                <div className="rounded-2xl border border-stone-200 p-4 text-sm">
                  <p className="font-bold text-stone-900">
                    ต้นทุนที่ทราบของ {plan.productName} ฿
                    {formatSatangAsBaht(
                      productCost.knownProductionCostSatang,
                    )}
                  </p>
                  {!productCost.costComplete ? (
                    <p className="mt-1 text-amber-800">
                      ต้นทุนสินค้ายังไม่สมบูรณ์ · ขาดราคา {productCost.missingPriceCount} รายการ
                    </p>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <details className="rounded-2xl border border-stone-200 bg-white px-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-bold text-stone-900">
          วัตถุดิบที่ต้องใช้
        </summary>
        <ul className="grid gap-2 border-t border-stone-100 py-4 text-sm">
          {preview.materialRequirements.map((requirement) => (
            <li className="flex justify-between gap-4" key={requirement.recipeIngredientId}>
              <span>{requirement.inventoryItemName}</span>
              <span className="font-semibold">
                {requirement.plannedRequirement} {formatUnitLabel(requirement.baseUnit)} ·{" "}
                {requirement.baseCostSatang === null
                  ? "ยังไม่มีราคา"
                  : `฿${formatSatangAsBaht(requirement.baseCostSatang)}`}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-2xl border border-stone-200 bg-white px-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-bold text-stone-900">
          บรรจุภัณฑ์ที่ต้องใช้
        </summary>
        <ul className="grid gap-2 border-t border-stone-100 py-4 text-sm">
          {preview.packagingRequirements.map((requirement) => (
            <li className="flex justify-between gap-4" key={requirement.packagingRuleId}>
              <span>{requirement.inventoryItemName}</span>
              <span className="font-semibold">
                {requirement.plannedRequirement} {formatUnitLabel(requirement.baseUnit)} ·{" "}
                {requirement.costSatang === null
                  ? "ยังไม่มีราคา"
                  : `฿${formatSatangAsBaht(requirement.costSatang)}`}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <section
        aria-labelledby="planning-cost-heading"
        className="grid gap-3 rounded-3xl bg-stone-900 p-5 text-white"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold" id="planning-cost-heading">
            ต้นทุนแผนการผลิต
          </h2>
          {!preview.cycleCost.costComplete ? (
            <span className="rounded-full bg-amber-200 px-3 py-1 text-sm font-bold text-amber-950">
              ต้นทุนไม่สมบูรณ์
            </span>
          ) : null}
        </div>
        <p className="text-lg font-bold">
          ต้นทุนที่คำนวณได้ ฿
          {formatSatangAsBaht(preview.cycleCost.knownProductionCostSatang)}
        </p>
        {preview.cycleCost.completeProductionCostSatang !== null ? (
          <p>
            ต้นทุนรวม ฿
            {formatSatangAsBaht(preview.cycleCost.completeProductionCostSatang)}
          </p>
        ) : (
          <p className="text-sm text-stone-300">
            ยังขาดราคา {preview.cycleCost.missingPriceCount} รายการ
          </p>
        )}
      </section>

      {state.error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}

      <div
        className="sticky bottom-20 z-20 -mx-5 border-t border-stone-200 bg-stone-50/95 p-4 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0"
        data-testid="planning-lock-action"
      >
        <button
          className="min-h-12 w-full rounded-xl bg-amber-800 px-6 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={cannotSubmit}
          type="submit"
        >
          {pending ? "กำลังล็อกรอบ…" : "ยืนยันล็อกรอบ"}
        </button>
      </div>
    </form>
  );
}
