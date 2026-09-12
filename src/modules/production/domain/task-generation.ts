import type {
  CycleTaskDraft,
  ProductionTemplateSource,
  TaskGenerationProduct,
} from "./types";

const BANGKOK_TIMEZONE = "Asia/Bangkok";
const BANGKOK_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1_000;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type ScheduleTaskAtInput = Readonly<{
  primaryDeliveryDate: string;
  offsetDaysFromDelivery: number;
  defaultTime: string;
  timezone: string;
}>;

export type BuildCycleTaskDraftsInput = Readonly<{
  primaryDeliveryDate: string;
  timezone: string;
  templates: ReadonlyArray<ProductionTemplateSource>;
  products: ReadonlyArray<TaskGenerationProduct>;
}>;

function parseDeliveryDate(value: string) {
  const match = datePattern.exec(value);
  if (!match) throw new Error("primaryDeliveryDate must use YYYY-MM-DD");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("primaryDeliveryDate must be a valid calendar date");
  }
  return { year, month, day };
}

function parseTime(value: string) {
  const match = timePattern.exec(value);
  if (!match) throw new Error("defaultTime must use HH:mm");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function scheduleTaskAt(input: ScheduleTaskAtInput): Date {
  if (input.timezone !== BANGKOK_TIMEZONE) {
    throw new Error("Only Asia/Bangkok is supported");
  }
  if (!Number.isSafeInteger(input.offsetDaysFromDelivery)) {
    throw new Error("offsetDaysFromDelivery must be an integer");
  }

  const { year, month, day } = parseDeliveryDate(input.primaryDeliveryDate);
  const { hour, minute } = parseTime(input.defaultTime);
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day + input.offsetDaysFromDelivery,
      hour,
      minute,
    ) - BANGKOK_OFFSET_MILLISECONDS,
  );
}

function buildDraft(
  template: ProductionTemplateSource,
  activity: ProductionTemplateSource["activities"][number],
  input: Pick<BuildCycleTaskDraftsInput, "primaryDeliveryDate" | "timezone">,
  product: TaskGenerationProduct | null,
): CycleTaskDraft {
  return {
    origin: "TEMPLATE",
    sourceTemplateId: template.id,
    sourceActivityId: activity.id,
    sourceTemplateScope: template.scope,
    sourceProductId: product?.productId ?? null,
    sourceTemplateName: template.name,
    sourceActivityName: activity.name,
    sourceProductName: product?.productName ?? null,
    title: activity.name,
    productId: product?.productId ?? null,
    productName: product?.productName ?? null,
    batchCount: product?.selectedBatchCount ?? null,
    scheduledAt: scheduleTaskAt({
      primaryDeliveryDate: input.primaryDeliveryDate,
      offsetDaysFromDelivery: activity.offsetDaysFromDelivery,
      defaultTime: activity.defaultTime,
      timezone: input.timezone,
    }),
    estimatedDurationMinutes: activity.estimatedDurationMinutes,
    notes: activity.notes,
    sequence: activity.sequence,
    status: "PENDING",
    skipReason: null,
  };
}

export function buildCycleTaskDrafts(
  input: BuildCycleTaskDraftsInput,
): readonly CycleTaskDraft[] {
  const drafts: CycleTaskDraft[] = [];
  for (const template of input.templates) {
    if (template.scope === "CYCLE") {
      for (const activity of template.activities) {
        drafts.push(buildDraft(template, activity, input, null));
      }
      continue;
    }

    for (const product of input.products) {
      if (template.productId !== product.productId) continue;
      for (const activity of template.activities) {
        drafts.push(buildDraft(template, activity, input, product));
      }
    }
  }
  return drafts.sort(sortCycleTasks);
}

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sortCycleTasks(
  left: CycleTaskDraft,
  right: CycleTaskDraft,
): number {
  const scheduledAtComparison = left.scheduledAt.getTime() - right.scheduledAt.getTime();
  if (scheduledAtComparison !== 0) return scheduledAtComparison;

  const sequenceComparison = left.sequence - right.sequence;
  if (sequenceComparison !== 0) return sequenceComparison;

  const productNameComparison = compareText(
    left.productName ?? "",
    right.productName ?? "",
  );
  if (productNameComparison !== 0) return productNameComparison;

  const templateComparison = compareText(
    left.sourceTemplateId,
    right.sourceTemplateId,
  );
  if (templateComparison !== 0) return templateComparison;

  const activityComparison = compareText(
    left.sourceActivityId,
    right.sourceActivityId,
  );
  if (activityComparison !== 0) return activityComparison;

  return compareText(left.sourceProductId ?? "", right.sourceProductId ?? "");
}
