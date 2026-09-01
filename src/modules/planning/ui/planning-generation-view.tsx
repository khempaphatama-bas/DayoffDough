import Decimal from "decimal.js";
import Link from "next/link";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import type {
  PlanningGenerationSummary,
  PlanningGenerationView as PlanningGenerationViewData,
} from "@/modules/planning/application/planning-queries";
import type { PlanningMaterialRequirement } from "@/modules/planning/domain/types";
import { formatUnitLabel } from "@/modules/units/domain/units";

function formatBangkokDateTime(value: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function formatQuantity(value: Decimal.Value): string {
  return new Decimal(value).toString();
}

function formatCostPerDenominator(
  costSatang: number,
  denominator: Decimal.Value,
): string | null {
  const parsed = new Decimal(denominator);
  if (!parsed.gt(0)) return null;
  return new Decimal(costSatang).div(parsed).div(100).toFixed(2);
}

type MaterialGroup = Readonly<{
  inventoryItemId: string;
  inventoryItemName: string;
  baseUnit: PlanningMaterialRequirement["baseUnit"];
  total: Decimal;
  contributions: ReadonlyArray<PlanningMaterialRequirement>;
}>;

function groupMaterials(
  requirements: ReadonlyArray<PlanningMaterialRequirement>,
): ReadonlyArray<MaterialGroup> {
  const grouped = new Map<string, MaterialGroup>();
  for (const requirement of requirements) {
    const key = `${requirement.inventoryItemId}:${requirement.baseUnit}`;
    const existing = grouped.get(key);
    grouped.set(key, {
      inventoryItemId: requirement.inventoryItemId,
      inventoryItemName: requirement.inventoryItemName,
      baseUnit: requirement.baseUnit,
      total: (existing?.total ?? new Decimal(0)).plus(
        requirement.plannedRequirement,
      ),
      contributions: [...(existing?.contributions ?? []), requirement],
    });
  }
  return [...grouped.values()];
}

export function PlanningGenerationView({
  cycleId,
  generation,
  generations,
}: Readonly<{
  cycleId: string;
  generation: PlanningGenerationViewData;
  generations: ReadonlyArray<PlanningGenerationSummary>;
}>) {
  const productNames = new Map(
    generation.productPlans.map((plan) => [plan.productId, plan.productName]),
  );
  const costs = new Map(
    generation.productCosts.map((cost) => [cost.productId, cost]),
  );
  const materials = groupMaterials(generation.materialRequirements);

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-stone-900">
            รุ่น {generation.generation}
          </h2>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">
            {generation.status === "ACTIVE" ? "ใช้งานอยู่" : "แทนที่แล้ว"}
          </span>
        </div>
        <p className="text-sm text-stone-600">
          ล็อกเมื่อ {formatBangkokDateTime(generation.lockedAt)}
        </p>
      </section>

      <nav
        aria-label="ประวัติรุ่นแผนการผลิต"
        className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-lg font-bold text-stone-900">ประวัติแผน</h2>
        <ul className="grid gap-3">
          {generations.map((summary) => (
            <li className="rounded-2xl bg-stone-50 p-3" key={summary.id}>
              <Link
                aria-current={
                  summary.generation === generation.generation
                    ? "page"
                    : undefined
                }
                className="inline-flex min-h-11 items-center font-bold text-amber-900"
                href={`/cycles/${cycleId}/planning?generation=${summary.generation}`}
              >
                รุ่น {summary.generation} · {summary.status === "ACTIVE" ? "ใช้งานอยู่" : "แทนที่แล้ว"}
              </Link>
              {summary.status === "SUPERSEDED" ? (
                <div className="grid gap-1 text-sm text-stone-600">
                  {summary.unlockReason ? (
                    <p>เหตุผลที่ปลดล็อก: {summary.unlockReason}</p>
                  ) : null}
                  {summary.unlockedAt ? (
                    <p>ปลดล็อกเมื่อ {formatBangkokDateTime(summary.unlockedAt)}</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </nav>

      {generation.warnings.length > 0 ? (
        <section
          aria-labelledby="accepted-warning-heading"
          className="grid gap-3 rounded-3xl border border-amber-300 bg-amber-50 p-5"
        >
          <h2 className="font-bold text-amber-950" id="accepted-warning-heading">
            คำเตือนที่ยอมรับตอนล็อกแผน
          </h2>
          <ul className="grid gap-2 text-sm text-amber-950">
            {generation.warnings.map((warning, index) => (
              <li key={`${warning.code}:${warning.sourceEntityId ?? "cycle"}:${index}`}>
                {warning.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="generation-product-heading" className="grid gap-4">
        <h2 className="text-xl font-bold text-stone-900" id="generation-product-heading">
          แผนรายสินค้า
        </h2>
        {generation.productPlans.map((plan) => {
          const unit = formatUnitLabel(plan.sellingUnit);
          const difference = new Decimal(plan.outputDifference);
          const cost = costs.get(plan.productId);
          const completeCost = cost?.completeProductionCostSatang ?? null;
          const perBatch = completeCost === null
            ? null
            : formatCostPerDenominator(completeCost, plan.selectedBatchCount);
          const perPlannedUnit = completeCost === null
            ? null
            : formatCostPerDenominator(completeCost, plan.plannedOutput);
          const perOrderedUnit = completeCost === null
            ? null
            : formatCostPerDenominator(completeCost, plan.orderedQuantity);
          return (
            <article
              aria-label={plan.productName}
              className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
              key={plan.productId}
            >
              <h3 className="text-lg font-bold text-stone-900">{plan.productName}</h3>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-stone-500">ยอดสั่ง</dt><dd className="font-semibold">ยอดสั่ง {plan.orderedQuantity} {unit}</dd></div>
                <div><dt className="text-stone-500">แบตช์แนะนำ</dt><dd className="font-semibold">แบตช์แนะนำ {plan.suggestedBatchCount}</dd></div>
                <div><dt className="text-stone-500">แบตช์ที่ล็อก</dt><dd className="font-semibold">แบตช์ที่ล็อก {plan.selectedBatchCount}</dd></div>
                <div><dt className="text-stone-500">ผลผลิตตามแผน</dt><dd className="font-semibold">ผลผลิตตามแผน {plan.plannedOutput} {unit}</dd></div>
                <div>
                  <dt className="text-stone-500">ส่วนต่าง</dt>
                  <dd className="font-semibold">
                    {difference.isNegative()
                      ? `ขาด ${difference.abs().toString()} ${unit}`
                      : `ส่วนต่าง ${difference.toString()} ${unit}`}
                  </dd>
                </div>
              </dl>
              {plan.overrideReason ? (
                <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  เหตุผลที่ปรับแบตช์: {plan.overrideReason}
                </p>
              ) : null}
              {cost ? (
                <div className="grid gap-1 border-t border-stone-100 pt-3 text-sm">
                  <p>ยอดต้นทุนที่ทราบแล้ว ฿{formatSatangAsBaht(cost.knownProductionCostSatang)}</p>
                  {perBatch ? <p>ต้นทุนต่อแบตช์ ฿{perBatch}</p> : null}
                  {perPlannedUnit ? <p>ต้นทุนต่อหน่วยตามแผน ฿{perPlannedUnit}</p> : null}
                  {perOrderedUnit ? <p>ต้นทุนต่อหน่วยที่สั่ง ฿{perOrderedUnit}</p> : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <section className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-stone-900">วัตถุดิบที่ต้องใช้</h2>
        {materials.map((material) => (
          <details
            aria-label={material.inventoryItemName}
            className="rounded-2xl border border-stone-200 px-4"
            key={`${material.inventoryItemId}:${material.baseUnit}`}
            open
            role="group"
          >
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-semibold">
              <span>{material.inventoryItemName}</span>
              <span>รวม {formatQuantity(material.total)} {formatUnitLabel(material.baseUnit)}</span>
            </summary>
            <ul className="grid gap-2 border-t border-stone-100 py-3 text-sm">
              {material.contributions.map((requirement) => (
                <li key={requirement.recipeIngredientId}>
                  {productNames.get(requirement.productId) ?? "สินค้าในแผน"}{" "}
                  {formatQuantity(requirement.plannedRequirement)} {formatUnitLabel(requirement.baseUnit)}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>

      <section className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-stone-900">บรรจุภัณฑ์ที่ต้องใช้</h2>
        <ul className="grid gap-2 text-sm">
          {generation.packagingRequirements.map((requirement) => (
            <li key={requirement.packagingRuleId}>
              {requirement.inventoryItemName} {formatQuantity(requirement.plannedRequirement)}{" "}
              {formatUnitLabel(requirement.baseUnit)}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2 rounded-3xl bg-stone-900 p-5 text-white">
        <h2 className="text-xl font-bold">ต้นทุนแผนการผลิต</h2>
        {!generation.cycleCost.costComplete ? (
          <span className="w-fit rounded-full bg-amber-200 px-3 py-1 text-sm font-bold text-amber-950">
            ต้นทุนไม่สมบูรณ์
          </span>
        ) : null}
        {generation.cycleCost.completeProductionCostSatang === null ? (
          <p className="text-lg font-bold">
            ยอดต้นทุนที่ทราบแล้ว ฿{formatSatangAsBaht(generation.cycleCost.knownProductionCostSatang)}
          </p>
        ) : (
          <p className="text-lg font-bold">
            ต้นทุนรวม ฿{formatSatangAsBaht(generation.cycleCost.completeProductionCostSatang)}
          </p>
        )}
      </section>
    </div>
  );
}
