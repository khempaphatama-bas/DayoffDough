import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { products } from "@/modules/products/db/schema";
import {
  productionTemplateActivities,
  productionTemplates,
} from "../db/schema";
import { productionTemplateInputSchema } from "../domain/forms";
import type {
  ProductionTemplateActivityInput,
  ProductionTemplateInput,
  ProductionTemplateScope,
} from "../domain/types";

type Clock = Readonly<{ now(): Date }>;

const systemClock: Clock = { now: () => new Date() };
const uuidSchema = z.string().uuid();
type DatabaseExecutor = Pick<DatabaseClient, "select" | "insert" | "update">;

export class TemplateStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateStateError";
  }
}

export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateValidationError";
  }
}

export type ProductionTemplateSummary = Readonly<{
  id: string;
  name: string;
  scope: "CYCLE" | "PRODUCT";
  productId: string | null;
  productName: string | null;
  active: boolean;
  activeActivityCount: number;
}>;

export type ProductionTemplateDetail = ProductionTemplateSummary &
  Readonly<{
    activities: ReadonlyArray<
      ProductionTemplateActivityInput & Readonly<{ id: string }>
    >;
  }>;

export type ProductionTemplateListView = Readonly<{
  cycleTemplates: ReadonlyArray<ProductionTemplateSummary>;
  productTemplates: ReadonlyArray<ProductionTemplateSummary>;
  productsMissingReadyTemplate: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;

function validateOwnerId(ownerId: string): string {
  const parsed = uuidSchema.safeParse(ownerId);
  if (!parsed.success) throw new TemplateValidationError("Invalid owner");
  return parsed.data;
}

function validateTemplateId(templateId: string): string {
  const parsed = uuidSchema.safeParse(templateId);
  if (!parsed.success) throw new TemplateStateError("Template not found");
  return parsed.data;
}

function validateInput(input: ProductionTemplateInput): ProductionTemplateInput {
  const parsed = productionTemplateInputSchema.safeParse(input);
  if (!parsed.success) throw new TemplateValidationError("Invalid production template");
  if (parsed.data.name.length > 160 || parsed.data.activities.some((activity) => (
    activity.name.length > 160 || (activity.notes?.length ?? 0) > 2_000
  ))) {
    throw new TemplateValidationError("Invalid production template");
  }

  const activityIds = parsed.data.activities
    .map((activity) => activity.id)
    .filter((id): id is string => id !== null);
  if (new Set(activityIds).size !== activityIds.length) {
    throw new TemplateValidationError("Activity ids must be unique");
  }
  const activeSequences = parsed.data.activities
    .filter((activity) => activity.active)
    .map((activity) => activity.sequence);
  if (new Set(activeSequences).size !== activeSequences.length) {
    throw new TemplateValidationError("Active activity sequences must be unique");
  }
  return parsed.data;
}

function toActivity(
  row: typeof productionTemplateActivities.$inferSelect,
): ProductionTemplateActivityInput & Readonly<{ id: string }> {
  return {
    id: row.id,
    name: row.name,
    offsetDaysFromDelivery: row.offsetDaysFromDelivery,
    defaultTime: row.defaultTime.slice(0, 5),
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    sequence: row.sequence,
    notes: row.notes,
    active: row.active,
  };
}

function toSummary(
  row: typeof productionTemplates.$inferSelect,
  productName: string | null,
  activeActivityCount: number,
): ProductionTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope as ProductionTemplateScope,
    productId: row.productId,
    productName,
    active: row.active,
    activeActivityCount,
  };
}

async function requireOwnedProduct(
  db: DatabaseExecutor,
  ownerId: string,
  productId: string,
) {
  const [product] = await db
    .select({ id: products.id, active: products.active })
    .from(products)
    .where(and(eq(products.ownerId, ownerId), eq(products.id, productId)))
    .limit(1);
  if (!product || !product.active) {
    throw new TemplateValidationError("Product must be active and owned");
  }
}

async function requireOwnedTemplate(
  db: DatabaseExecutor,
  ownerId: string,
  templateId: string,
  lock = false,
) {
  const query = db
    .select()
    .from(productionTemplates)
    .where(
      and(
        eq(productionTemplates.ownerId, ownerId),
        eq(productionTemplates.id, templateId),
      ),
    )
    .limit(1);
  const [template] = lock ? await query.for("update") : await query;
  if (!template) throw new TemplateStateError("Template not found");
  return template;
}

async function loadDetail(
  db: DatabaseExecutor,
  ownerId: string,
  templateId: string,
): Promise<ProductionTemplateDetail> {
  const [template] = await db
    .select({
      template: productionTemplates,
      productName: products.name,
    })
    .from(productionTemplates)
    .leftJoin(
      products,
      and(
        eq(products.ownerId, productionTemplates.ownerId),
        eq(products.id, productionTemplates.productId),
      ),
    )
    .where(
      and(
        eq(productionTemplates.ownerId, ownerId),
        eq(productionTemplates.id, templateId),
      ),
    )
    .limit(1);
  if (!template) throw new TemplateStateError("Template not found");

  const activities = await db
    .select()
    .from(productionTemplateActivities)
    .where(
      and(
        eq(productionTemplateActivities.ownerId, ownerId),
        eq(productionTemplateActivities.productionTemplateId, templateId),
      ),
    )
    .orderBy(asc(productionTemplateActivities.sequence), asc(productionTemplateActivities.id));
  return {
    ...toSummary(
      template.template,
      template.productName,
      activities.filter((activity) => activity.active).length,
    ),
    activities: activities.map(toActivity),
  };
}

async function lockScopeTemplates(
  db: DatabaseExecutor,
  ownerId: string,
  scope: ProductionTemplateScope,
  productId: string | null,
) {
  return db
    .select()
    .from(productionTemplates)
    .where(
      and(
        eq(productionTemplates.ownerId, ownerId),
        eq(productionTemplates.scope, scope),
        scope === "PRODUCT" ? eq(productionTemplates.productId, productId!) : undefined,
      ),
    )
    .orderBy(asc(productionTemplates.id))
    .for("update");
}

export function createProductionTemplateService(
  db: DatabaseClient,
  clock: Clock = systemClock,
) {
  return {
    async list(ownerId: string): Promise<ProductionTemplateListView> {
      const parsedOwnerId = validateOwnerId(ownerId);
      const [templateRows, activityRows, activeProducts] = await Promise.all([
        db
          .select({ template: productionTemplates, productName: products.name })
          .from(productionTemplates)
          .leftJoin(
            products,
            and(
              eq(products.ownerId, productionTemplates.ownerId),
              eq(products.id, productionTemplates.productId),
            ),
          )
          .where(eq(productionTemplates.ownerId, parsedOwnerId))
          .orderBy(asc(productionTemplates.name), asc(productionTemplates.id)),
        db
          .select()
          .from(productionTemplateActivities)
          .where(eq(productionTemplateActivities.ownerId, parsedOwnerId)),
        db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(and(eq(products.ownerId, parsedOwnerId), eq(products.active, true)))
          .orderBy(asc(products.name), asc(products.id)),
      ]);
      const activeCounts = new Map<string, number>();
      for (const activity of activityRows) {
        if (activity.active) {
          activeCounts.set(
            activity.productionTemplateId,
            (activeCounts.get(activity.productionTemplateId) ?? 0) + 1,
          );
        }
      }
      const summaries = templateRows.map(({ template, productName }) =>
        toSummary(template, productName, activeCounts.get(template.id) ?? 0),
      );
      const readyProductIds = new Set(
        summaries
          .filter((template) => template.scope === "PRODUCT" && template.active && template.activeActivityCount > 0)
          .map((template) => template.productId),
      );
      return {
        cycleTemplates: summaries.filter((template) => template.scope === "CYCLE"),
        productTemplates: summaries.filter((template) => template.scope === "PRODUCT"),
        productsMissingReadyTemplate: activeProducts.filter(
          (product) => !readyProductIds.has(product.id),
        ),
      };
    },

    async get(ownerId: string, templateId: string): Promise<ProductionTemplateDetail> {
      return loadDetail(db, validateOwnerId(ownerId), validateTemplateId(templateId));
    },

    async create(
      ownerId: string,
      input: ProductionTemplateInput,
    ): Promise<ProductionTemplateDetail> {
      const parsedOwnerId = validateOwnerId(ownerId);
      const parsed = validateInput(input);
      const templateId = await db.transaction(async (tx) => {
        if (parsed.scope === "PRODUCT" && parsed.productId) {
          await requireOwnedProduct(tx, parsedOwnerId, parsed.productId);
        }
        const [template] = await tx
          .insert(productionTemplates)
          .values({
            ownerId: parsedOwnerId,
            name: parsed.name,
            scope: parsed.scope,
            productId: parsed.productId,
            active: false,
            createdAt: clock.now(),
            updatedAt: clock.now(),
          })
          .returning({ id: productionTemplates.id });
        if (!template) throw new TemplateStateError("Failed to create template");
        if (parsed.activities.length > 0) {
          await tx.insert(productionTemplateActivities).values(
            parsed.activities.map((activity) => ({
              ownerId: parsedOwnerId,
              productionTemplateId: template.id,
              name: activity.name,
              offsetDaysFromDelivery: activity.offsetDaysFromDelivery,
              defaultTime: activity.defaultTime,
              estimatedDurationMinutes: activity.estimatedDurationMinutes,
              sequence: activity.sequence,
              notes: activity.notes,
              active: activity.active,
              createdAt: clock.now(),
              updatedAt: clock.now(),
            })),
          );
        }
        return template.id;
      });
      return loadDetail(db, parsedOwnerId, templateId);
    },

    async update(
      ownerId: string,
      templateId: string,
      input: ProductionTemplateInput,
    ): Promise<ProductionTemplateDetail> {
      const parsedOwnerId = validateOwnerId(ownerId);
      const parsedTemplateId = validateTemplateId(templateId);
      const parsed = validateInput(input);
      await db.transaction(async (tx) => {
        const existingTemplate = await requireOwnedTemplate(
          tx,
          parsedOwnerId,
          parsedTemplateId,
          true,
        );
        if (
          existingTemplate.active &&
          (existingTemplate.scope !== parsed.scope || existingTemplate.productId !== parsed.productId)
        ) {
          throw new TemplateStateError("Deactivate the template before changing its scope");
        }
        if (parsed.scope === "PRODUCT" && parsed.productId) {
          await requireOwnedProduct(tx, parsedOwnerId, parsed.productId);
        }
        const existingActivities = await tx
          .select()
          .from(productionTemplateActivities)
          .where(
            and(
              eq(productionTemplateActivities.ownerId, parsedOwnerId),
              eq(productionTemplateActivities.productionTemplateId, parsedTemplateId),
            ),
          )
          .orderBy(asc(productionTemplateActivities.id))
          .for("update");
        const existingIds = new Set(existingActivities.map((activity) => activity.id));
        if (parsed.activities.some((activity) => activity.id && !existingIds.has(activity.id))) {
          throw new TemplateValidationError("Activity does not belong to this template");
        }
        if (existingTemplate.active && !parsed.activities.some((activity) => activity.active)) {
          throw new TemplateStateError("An active template needs an active activity");
        }

        await tx
          .update(productionTemplates)
          .set({
            name: parsed.name,
            scope: parsed.scope,
            productId: parsed.productId,
            updatedAt: clock.now(),
          })
          .where(
            and(
              eq(productionTemplates.ownerId, parsedOwnerId),
              eq(productionTemplates.id, parsedTemplateId),
            ),
          );
        if (existingActivities.length > 0) {
          await tx
            .update(productionTemplateActivities)
            .set({ active: false, updatedAt: clock.now() })
            .where(
              and(
                eq(productionTemplateActivities.ownerId, parsedOwnerId),
                eq(productionTemplateActivities.productionTemplateId, parsedTemplateId),
              ),
            );
        }
        for (const activity of parsed.activities) {
          const values = {
            name: activity.name,
            offsetDaysFromDelivery: activity.offsetDaysFromDelivery,
            defaultTime: activity.defaultTime,
            estimatedDurationMinutes: activity.estimatedDurationMinutes,
            sequence: activity.sequence,
            notes: activity.notes,
            active: activity.active,
            updatedAt: clock.now(),
          };
          if (activity.id) {
            await tx
              .update(productionTemplateActivities)
              .set(values)
              .where(
                and(
                  eq(productionTemplateActivities.ownerId, parsedOwnerId),
                  eq(productionTemplateActivities.productionTemplateId, parsedTemplateId),
                  eq(productionTemplateActivities.id, activity.id),
                ),
              );
          } else {
            await tx.insert(productionTemplateActivities).values({
              ownerId: parsedOwnerId,
              productionTemplateId: parsedTemplateId,
              ...values,
              createdAt: clock.now(),
            });
          }
        }
      });
      return loadDetail(db, parsedOwnerId, parsedTemplateId);
    },

    async duplicate(ownerId: string, templateId: string): Promise<ProductionTemplateDetail> {
      const parsedOwnerId = validateOwnerId(ownerId);
      const parsedTemplateId = validateTemplateId(templateId);
      const copiedId = await db.transaction(async (tx) => {
        const source = await requireOwnedTemplate(tx, parsedOwnerId, parsedTemplateId, true);
        const activities = await tx
          .select()
          .from(productionTemplateActivities)
          .where(
            and(
              eq(productionTemplateActivities.ownerId, parsedOwnerId),
              eq(productionTemplateActivities.productionTemplateId, parsedTemplateId),
            ),
          )
          .orderBy(asc(productionTemplateActivities.sequence), asc(productionTemplateActivities.id))
          .for("update");
        const copyName = `${source.name.trim()} สำเนา`;
        if (copyName.length > 160) {
          throw new TemplateValidationError("Template copy name is too long");
        }
        const [copy] = await tx
          .insert(productionTemplates)
          .values({
            ownerId: parsedOwnerId,
            name: copyName,
            scope: source.scope,
            productId: source.productId,
            active: false,
            createdAt: clock.now(),
            updatedAt: clock.now(),
          })
          .returning({ id: productionTemplates.id });
        if (!copy) throw new TemplateStateError("Failed to duplicate template");
        if (activities.length > 0) {
          await tx.insert(productionTemplateActivities).values(
            activities.map((activity) => ({
              ownerId: parsedOwnerId,
              productionTemplateId: copy.id,
              name: activity.name,
              offsetDaysFromDelivery: activity.offsetDaysFromDelivery,
              defaultTime: activity.defaultTime,
              estimatedDurationMinutes: activity.estimatedDurationMinutes,
              sequence: activity.sequence,
              notes: activity.notes,
              active: activity.active,
              createdAt: clock.now(),
              updatedAt: clock.now(),
            })),
          );
        }
        return copy.id;
      });
      return loadDetail(db, parsedOwnerId, copiedId);
    },

    async setActive(
      ownerId: string,
      templateId: string,
      active: boolean,
    ): Promise<ProductionTemplateDetail> {
      const parsedOwnerId = validateOwnerId(ownerId);
      const parsedTemplateId = validateTemplateId(templateId);
      if (typeof active !== "boolean") {
        throw new TemplateValidationError("Invalid active state");
      }
      await db.transaction(async (tx) => {
        const selected = await requireOwnedTemplate(tx, parsedOwnerId, parsedTemplateId);
        if (selected.scope === "PRODUCT" && selected.productId) {
          await requireOwnedProduct(tx, parsedOwnerId, selected.productId);
        }
        const scopeTemplates = await lockScopeTemplates(
          tx,
          parsedOwnerId,
          selected.scope as ProductionTemplateScope,
          selected.productId,
        );
        const lockedSelected = scopeTemplates.find((template) => template.id === parsedTemplateId);
        if (!lockedSelected) throw new TemplateStateError("Template not found");
        if (active) {
          const [readyActivity] = await tx
            .select({ id: productionTemplateActivities.id })
            .from(productionTemplateActivities)
            .where(
              and(
                eq(productionTemplateActivities.ownerId, parsedOwnerId),
                eq(productionTemplateActivities.productionTemplateId, parsedTemplateId),
                eq(productionTemplateActivities.active, true),
              ),
            )
            .limit(1)
            .for("update");
          if (!readyActivity) {
            throw new TemplateStateError("An active template needs an active activity");
          }
          for (const template of scopeTemplates) {
            if (template.active && template.id !== parsedTemplateId) {
              await tx
                .update(productionTemplates)
                .set({ active: false, updatedAt: clock.now() })
                .where(
                  and(
                    eq(productionTemplates.ownerId, parsedOwnerId),
                    eq(productionTemplates.id, template.id),
                  ),
                );
            }
          }
        }
        await tx
          .update(productionTemplates)
          .set({ active, updatedAt: clock.now() })
          .where(
            and(
              eq(productionTemplates.ownerId, parsedOwnerId),
              eq(productionTemplates.id, parsedTemplateId),
            ),
          );
      });
      return loadDetail(db, parsedOwnerId, parsedTemplateId);
    },
  };
}
