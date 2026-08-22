import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { customers } from "@/modules/customers/db/schema";
import { deliveryMethods } from "@/modules/delivery/db/schema";

export type CustomerInput = Readonly<{
  name: string;
  contactHandle?: string;
  phone?: string;
  defaultDeliveryMethodId: string | null;
  defaultDeliveryLocation?: string;
  defaultDeliveryNote?: string;
  notes?: string;
}>;

export type Customer = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  contactHandle: string | null;
  phone: string | null;
  defaultDeliveryMethodId: string | null;
  defaultDeliveryLocation: string | null;
  defaultDeliveryNote: string | null;
  notes: string | null;
  active: boolean;
}>;

export type CustomerFilters = Readonly<{
  query?: string;
  active?: boolean;
}>;

const uuidSchema = z.string().uuid();
const customerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactHandle: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(200).optional(),
  defaultDeliveryMethodId: uuidSchema.nullable(),
  defaultDeliveryLocation: z.string().trim().max(2000).optional(),
  defaultDeliveryNote: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
});
const customerUpdateSchema = customerSchema.extend({ active: z.boolean() });
const customerFiltersSchema = z.object({
  query: z.string().trim().max(200).optional(),
  active: z.boolean().optional(),
});

function toCustomer(row: typeof customers.$inferSelect): Customer {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    contactHandle: row.contactHandle,
    phone: row.phone,
    defaultDeliveryMethodId: row.defaultDeliveryMethodId,
    defaultDeliveryLocation: row.defaultDeliveryLocation,
    defaultDeliveryNote: row.defaultDeliveryNote,
    notes: row.notes,
    active: row.active,
  };
}

export function createCustomerService(db: DatabaseClient) {
  async function requireOwnedDeliveryMethod(
    ownerId: string,
    deliveryMethodId: string | null,
  ): Promise<void> {
    if (deliveryMethodId === null) return;
    const [method] = await db
      .select({ id: deliveryMethods.id })
      .from(deliveryMethods)
      .where(
        and(
          eq(deliveryMethods.ownerId, ownerId),
          eq(deliveryMethods.id, deliveryMethodId),
        ),
      )
      .limit(1);
    if (!method) throw new Error("Delivery method not found");
  }

  return {
    async create(ownerId: string, input: CustomerInput): Promise<Customer> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsed = customerSchema.safeParse(input);
      if (!parsedOwnerId.success || !parsed.success) {
        throw new Error("Invalid customer");
      }
      await requireOwnedDeliveryMethod(
        parsedOwnerId.data,
        parsed.data.defaultDeliveryMethodId,
      );
      const [row] = await db
        .insert(customers)
        .values({
          ownerId: parsedOwnerId.data,
          ...parsed.data,
          contactHandle: parsed.data.contactHandle ?? null,
          phone: parsed.data.phone ?? null,
          defaultDeliveryLocation: parsed.data.defaultDeliveryLocation ?? null,
          defaultDeliveryNote: parsed.data.defaultDeliveryNote ?? null,
          notes: parsed.data.notes ?? null,
        })
        .returning();
      if (!row) throw new Error("Failed to create customer");
      return toCustomer(row);
    },

    async update(
      ownerId: string,
      customerId: string,
      input: CustomerInput & Readonly<{ active: boolean }>,
    ): Promise<Customer> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCustomerId = uuidSchema.safeParse(customerId);
      const parsed = customerUpdateSchema.safeParse(input);
      if (
        !parsedOwnerId.success ||
        !parsedCustomerId.success ||
        !parsed.success
      ) {
        throw new Error("Invalid customer");
      }
      await requireOwnedDeliveryMethod(
        parsedOwnerId.data,
        parsed.data.defaultDeliveryMethodId,
      );
      const [row] = await db
        .update(customers)
        .set({
          ...parsed.data,
          contactHandle: parsed.data.contactHandle ?? null,
          phone: parsed.data.phone ?? null,
          defaultDeliveryLocation: parsed.data.defaultDeliveryLocation ?? null,
          defaultDeliveryNote: parsed.data.defaultDeliveryNote ?? null,
          notes: parsed.data.notes ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customers.ownerId, parsedOwnerId.data),
            eq(customers.id, parsedCustomerId.data),
          ),
        )
        .returning();
      if (!row) throw new Error("Customer not found");
      return toCustomer(row);
    },

    async get(ownerId: string, customerId: string): Promise<Customer> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCustomerId = uuidSchema.safeParse(customerId);
      if (!parsedOwnerId.success || !parsedCustomerId.success) {
        throw new Error("Customer not found");
      }
      const [row] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.ownerId, parsedOwnerId.data),
            eq(customers.id, parsedCustomerId.data),
          ),
        )
        .limit(1);
      if (!row) throw new Error("Customer not found");
      return toCustomer(row);
    },

    async list(
      ownerId: string,
      filters: CustomerFilters = {},
    ): Promise<ReadonlyArray<Customer>> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedFilters = customerFiltersSchema.safeParse(filters);
      if (!parsedOwnerId.success || !parsedFilters.success) {
        throw new Error("Invalid customer filters");
      }
      const query = parsedFilters.data.query;
      const rows = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.ownerId, parsedOwnerId.data),
            parsedFilters.data.active === undefined
              ? undefined
              : eq(customers.active, parsedFilters.data.active),
            query
              ? or(
                  ilike(customers.name, `%${query}%`),
                  ilike(customers.contactHandle, `%${query}%`),
                  ilike(customers.phone, `%${query}%`),
                )
              : undefined,
          ),
        )
        .orderBy(desc(customers.active), asc(customers.name));
      return rows.map(toCustomer);
    },
  };
}
