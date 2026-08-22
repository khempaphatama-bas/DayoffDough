# Day Off Dough OS Phase 2 Orders and Bake Cycles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Let the bakery owner create customers and Bake Cycles, enter editable multi-item orders, track payment and fulfillment separately, and see live product demand per cycle.

**Architecture:** Extend the existing Next.js modular monolith with owner-scoped customers, cycles, and orders modules. Keep financial and aggregation rules in pure TypeScript, keep database access in application services, render database-backed pages as Server Components, and isolate interactive forms in small Client Components that call authenticated Server Actions.

**Tech Stack:** Node.js 24.x, pnpm 11.x, Next.js 16.3 App Router, React 19, TypeScript strict mode, Tailwind CSS 4, Supabase Auth and PostgreSQL, Drizzle ORM, Zod 4, Decimal.js, React Hook Form, Vitest, Testing Library, PGlite, Playwright.

**Spec:** docs/superpowers/specs/2026-08-23-day-off-dough-os-phase-2-orders-design.md

## Global Constraints

- The primary user is one bakery owner; do not add registration, roles, teams, or public write endpoints.
- Orders are entered manually; do not integrate Instagram, Facebook, payments, KEX, or another carrier API.
- Store money as integer satang. Accept baht strings only at the form boundary and convert them with parseBahtToSatang.
- Every Server Action must call requireOwner. Every service query and mutation must scope by the verified ownerId.
- Keep database credentials server-only and do not add service-role or database values to NEXT_PUBLIC variables.
- Enable Row Level Security on every new table and add no anonymous Data API policy.
- Use composite owner foreign keys so records owned by different users cannot be linked.
- Use one primary delivery date per Bake Cycle.
- Cancelled orders remain historical records and contribute zero production demand.
- Locking, planning snapshots, recipe scaling, material demand, shopping lists, production timelines, and profit reporting remain Phase 3 or later.
- Next.js 16 params and searchParams are Promises and must be awaited.
- Pages and database reads remain Server Components. Add use client only to interactive form, filter, confirmation, and error-boundary components.
- Model expected Server Action failures as serializable return values. Call redirect only after try/catch because redirect throws a framework control-flow exception.
- Support Pixel 7 and desktop layouts. Keep primary phone controls at least 44px high.
- Use TDD for business and persistence rules. Do not change production code before observing the relevant test fail.
- Do not commit credentials or print values from .env.local.

---

## File Map

### Database and shared schema

- Modify src/modules/delivery/db/schema.ts — add delivery-location requirement.
- Create src/modules/customers/db/schema.ts — customer master records.
- Create src/modules/cycles/db/schema.ts — Bake Cycle records and statuses.
- Create src/modules/orders/db/schema.ts — order headers, items, and order enums.
- Modify src/lib/db/schema.ts — export every Phase 2 table and enum for Drizzle and PGlite.
- Create src/modules/orders/db/schema.test.ts — database constraint and owner-boundary coverage.
- Generate drizzle/0004_phase_2_orders.sql, drizzle/meta/0004_snapshot.json, and update drizzle/meta/_journal.json.

### Domain

- Create src/modules/orders/domain/totals.ts and totals.test.ts — totals, balance, overpayment, and payment state.
- Create src/modules/orders/domain/production-demand.ts and production-demand.test.ts — live product aggregation excluding cancelled orders.
- Create src/modules/orders/domain/order-form.ts and order-form.test.ts — browser/server shared form schema and baht conversion.

### Application services

- Modify src/modules/delivery/application/delivery.ts and delivery.test.ts — persist requiresDeliveryLocation.
- Create src/modules/customers/application/customers.ts and customers.test.ts.
- Create src/modules/cycles/application/cycles.ts and cycles.test.ts.
- Create src/modules/orders/application/orders.ts and orders.test.ts.

### Server Actions and UI

- Create src/app/(app)/customers/actions.ts, page.tsx, and [id]/page.tsx.
- Create src/modules/customers/ui/customer-form.tsx and customer-list.tsx.
- Create src/app/(app)/cycles/actions.ts, page.tsx, new/page.tsx, and [id]/page.tsx.
- Create src/modules/cycles/ui/cycle-form.tsx and cycle-list.tsx.
- Create src/app/(app)/orders/actions.ts, page.tsx, new/page.tsx, and [id]/page.tsx.
- Create src/modules/orders/ui/order-form.tsx, order-form.test.tsx, order-list.tsx, order-filters.tsx, order-status-actions.tsx, and order-status-actions.test.tsx.
- Modify src/modules/delivery/ui/delivery-method-form.tsx.
- Modify src/app/(app)/delivery/actions.ts.

### Navigation, dashboard, and verification

- Modify src/components/app-shell.tsx and app-shell.test.tsx.
- Create src/app/(app)/more/page.tsx for secondary phone destinations.
- Modify src/app/(app)/dashboard/page.tsx.
- Create src/app/(app)/error.tsx and error.test.tsx.
- Modify tests/fixtures/owner.ts.
- Create tests/e2e/orders.spec.ts.
- Modify README.md.

---

### Task 1: Phase 2 relational schema and migration

**Files:**

- Create: src/modules/customers/db/schema.ts
- Create: src/modules/cycles/db/schema.ts
- Create: src/modules/orders/db/schema.ts
- Create: src/modules/orders/db/schema.test.ts
- Modify: src/modules/delivery/db/schema.ts
- Modify: src/lib/db/schema.ts
- Create: drizzle/0004_phase_2_orders.sql
- Create: drizzle/meta/0004_snapshot.json
- Modify: drizzle/meta/_journal.json

**Interfaces:**

- Produces: customers, bakeCycles, orders, orderItems tables.
- Produces: bakeCycleStatus, orderSourceChannel, deliveryFeePayer, orderPaymentStatus, orderFulfillmentStatus readonly enum arrays.
- Produces: requiresDeliveryLocation on deliveryMethods.
- Consumes: products and deliveryMethods from Phase 1.

- [ ] **Step 1: Write a failing schema integration test**

Create src/modules/orders/db/schema.test.ts. The test must insert one valid delivery method, product, customer, cycle, order, and item, then prove the generated cycle number exists, quantity zero is rejected, and a cross-owner customer reference is rejected.

~~~ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { customers } from "@/modules/customers/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { deliveryMethods } from "@/modules/delivery/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { products } from "@/modules/products/db/schema";

describe("Phase 2 order schema", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("stores a valid owner-scoped multi-item order", async () => {
    const [method] = await context.db.insert(deliveryMethods).values({
      ownerId: OWNER_ID,
      name: "KEX Same Day",
      defaultCustomerFeeSatang: 12000,
      defaultInternalCostSatang: 12000,
      requiresDeliveryLocation: true,
    }).returning();
    const [product] = await context.db.insert(products).values({
      ownerId: OWNER_ID,
      name: "Focaccia",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 22000,
    }).returning();
    const [customer] = await context.db.insert(customers).values({
      ownerId: OWNER_ID,
      name: "May",
      defaultDeliveryMethodId: method!.id,
    }).returning();
    const [cycle] = await context.db.insert(bakeCycles).values({
      ownerId: OWNER_ID,
      name: "รอบส่ง 30 ส.ค.",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    }).returning();
    const [order] = await context.db.insert(orders).values({
      ownerId: OWNER_ID,
      customerId: customer!.id,
      bakeCycleId: cycle!.id,
      deliveryMethodId: method!.id,
    }).returning();
    await context.db.insert(orderItems).values({
      ownerId: OWNER_ID,
      orderId: order!.id,
      productId: product!.id,
      quantity: 2,
      unitPriceSatang: 22000,
    });

    expect(cycle!.cycleNumber).toBeGreaterThan(0);
  });

  it("rejects zero item quantity and cross-owner relationships", async () => {
    const [foreignCustomer] = await context.db.insert(customers).values({
      ownerId: OTHER_OWNER_ID,
      name: "Other owner customer",
    }).returning();
    const [cycle] = await context.db.insert(bakeCycles).values({
      ownerId: OWNER_ID,
      name: "Owner cycle",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    }).returning();

    await expect(context.db.insert(orders).values({
      ownerId: OWNER_ID,
      customerId: foreignCustomer!.id,
      bakeCycleId: cycle!.id,
    })).rejects.toThrow();
  });
});
~~~

- [ ] **Step 2: Run the test and verify it fails**

Run:

~~~bash
pnpm test:run -- src/modules/orders/db/schema.test.ts
~~~

Expected: FAIL because the Phase 2 schema modules and requiresDeliveryLocation do not exist.

- [ ] **Step 3: Define exact enums and tables**

In the three new schema files, use varchar lengths of 160 for names, 200 for phone/contact values, 2000 for notes, UUID primary keys, ownerId, createdAt, and updatedAt. Use these enum values exactly:

~~~ts
export const bakeCycleStatus = [
  "DRAFT", "OPEN", "LOCKED", "IN_PRODUCTION", "COMPLETED", "CANCELLED",
] as const;

export const orderSourceChannel = [
  "INSTAGRAM", "FACEBOOK", "PHONE", "OTHER",
] as const;
export const deliveryFeePayer = ["CUSTOMER", "BAKERY", "SHARED"] as const;
export const orderPaymentStatus = [
  "UNPAID", "PARTIAL", "PAID", "REFUNDED",
] as const;
export const orderFulfillmentStatus = [
  "NEW", "CONFIRMED", "IN_PRODUCTION", "PACKED", "DELIVERED", "CANCELLED",
] as const;
~~~

Define date-only columns with date mode string, orderCutoffAt with timezone timestamp mode date, cycleNumber with serial, and the defaults below:

~~~ts
status: bakeCycleStatusEnum("status").notNull().default("OPEN")
deliveryFeeChargedSatang: integer("delivery_fee_charged_satang").notNull().default(0)
deliveryCostSatang: integer("delivery_cost_satang").notNull().default(0)
deliveryFeePayer: deliveryFeePayerEnum("delivery_fee_payer").notNull().default("CUSTOMER")
discountSatang: integer("discount_satang").notNull().default(0)
amountPaidSatang: integer("amount_paid_satang").notNull().default(0)
paymentStatus: orderPaymentStatusEnum("payment_status").notNull().default("UNPAID")
fulfillmentStatus: orderFulfillmentStatusEnum("fulfillment_status").notNull().default("NEW")
~~~

Add ownerId plus id unique constraints on customers, bakeCycles, and orders. Every Phase 2 foreign key must use ownerId and the referenced id. Use onDelete restrict. Add non-negative checks to all money fields and a positive check to orderItems.quantity.

Add these indexes and uniqueness rules:

- customers on ownerId plus name;
- bakeCycles unique cycleNumber and index ownerId plus status plus primaryDeliveryDate;
- orders on ownerId plus bakeCycleId plus createdAt;
- orders on ownerId plus customerId plus createdAt;
- orders on ownerId plus paymentStatus plus fulfillmentStatus;
- orderItems on ownerId plus orderId.

Add this field to deliveryMethods:

~~~ts
requiresDeliveryLocation: boolean("requires_delivery_location")
  .notNull()
  .default(true),
~~~

Export every new table and enum from src/lib/db/schema.ts so createTestDatabase migrates and types the complete schema.

- [ ] **Step 4: Generate and inspect the migration**

Run:

~~~bash
pnpm exec drizzle-kit generate --name=phase_2_orders
~~~

Expected generated files: drizzle/0004_phase_2_orders.sql, drizzle/meta/0004_snapshot.json, and an updated journal.

At the end of the SQL migration, ensure these statements exist exactly once:

~~~sql
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bake_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
~~~

Do not create anonymous, authenticated, or email-based Data API policies. The application continues using the server-only PostgreSQL connection and verified ownerId.

- [ ] **Step 5: Complete and run schema tests**

Extend the second test by creating an owner product/order and asserting an order item with quantity 0 rejects. Also assert requiresDeliveryLocation defaults to true when omitted.

Run:

~~~bash
pnpm test:run -- src/modules/orders/db/schema.test.ts
pnpm typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Apply the migration to the configured development database**

Run:

~~~bash
pnpm db:migrate
~~~

Expected: migration 0004 applies successfully. Do not print the database URL.

- [ ] **Step 7: Commit**

~~~bash
git add src/modules/customers/db/schema.ts src/modules/cycles/db/schema.ts src/modules/orders/db/schema.ts src/modules/orders/db/schema.test.ts src/modules/delivery/db/schema.ts src/lib/db/schema.ts drizzle
git commit -m "feat: add phase 2 order schema"
~~~

### Task 2: Pure order totals and production demand

**Files:**

- Create: src/modules/orders/domain/totals.ts
- Create: src/modules/orders/domain/totals.test.ts
- Create: src/modules/orders/domain/production-demand.ts
- Create: src/modules/orders/domain/production-demand.test.ts

**Interfaces:**

- Produces: calculateOrderTotals(input: OrderTotalsInput): OrderTotals.
- Produces: derivePaymentStatus(grandTotalSatang: number, amountPaidSatang: number): CalculatedPaymentStatus.
- Produces: aggregateProductionDemand(lines: ReadonlyArray<ProductionDemandLine>): ReadonlyArray<ProductDemand>.
- Consumes: integer satang and integer item quantities.

- [ ] **Step 1: Write failing totals tests**

Create totals.test.ts with these exact cases:

~~~ts
import { describe, expect, it } from "vitest";
import { calculateOrderTotals, derivePaymentStatus } from "./totals";

describe("order totals", () => {
  it("calculates items, discount, delivery, balance, and partial payment", () => {
    expect(calculateOrderTotals({
      items: [
        { quantity: 2, unitPriceSatang: 22000 },
        { quantity: 1, unitPriceSatang: 8000 },
      ],
      discountSatang: 2000,
      deliveryFeeChargedSatang: 12000,
      amountPaidSatang: 20000,
    })).toEqual({
      subtotalSatang: 52000,
      grandTotalSatang: 62000,
      balanceSatang: 42000,
      overpaidSatang: 0,
      paymentStatus: "PARTIAL",
    });
  });

  it.each([
    [0, 10000, "UNPAID"],
    [1, 10000, "PARTIAL"],
    [10000, 10000, "PAID"],
    [12000, 10000, "PAID"],
  ] as const)("derives payment from %i paid against %i", (paid, total, status) => {
    expect(derivePaymentStatus(total, paid)).toBe(status);
  });

  it("reports overpayment and rejects a discount larger than items plus delivery", () => {
    expect(calculateOrderTotals({
      items: [{ quantity: 1, unitPriceSatang: 10000 }],
      discountSatang: 0,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 12000,
    }).overpaidSatang).toBe(2000);

    expect(() => calculateOrderTotals({
      items: [{ quantity: 1, unitPriceSatang: 1000 }],
      discountSatang: 2000,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 0,
    })).toThrow("Discount makes grand total negative");
  });
});
~~~

- [ ] **Step 2: Write failing production-demand tests**

~~~ts
import { describe, expect, it } from "vitest";
import { aggregateProductionDemand } from "./production-demand";

describe("cycle production demand", () => {
  it("groups products and excludes cancelled orders", () => {
    expect(aggregateProductionDemand([
      { productId: "p1", productName: "Focaccia", quantity: 2, fulfillmentStatus: "NEW" },
      { productId: "p1", productName: "Focaccia", quantity: 3, fulfillmentStatus: "PACKED" },
      { productId: "p2", productName: "Scone", quantity: 4, fulfillmentStatus: "CANCELLED" },
      { productId: "p2", productName: "Scone", quantity: 1, fulfillmentStatus: "CONFIRMED" },
    ])).toEqual([
      { productId: "p1", productName: "Focaccia", quantity: 5 },
      { productId: "p2", productName: "Scone", quantity: 1 },
    ]);
  });
});
~~~

- [ ] **Step 3: Run both tests and verify they fail**

Run:

~~~bash
pnpm test:run -- src/modules/orders/domain/totals.test.ts src/modules/orders/domain/production-demand.test.ts
~~~

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement totals with safe-integer validation**

Use these public types and behavior:

~~~ts
export type CalculatedPaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type OrderTotalsInput = Readonly<{
  items: ReadonlyArray<Readonly<{ quantity: number; unitPriceSatang: number }>>;
  discountSatang: number;
  deliveryFeeChargedSatang: number;
  amountPaidSatang: number;
}>;
export type OrderTotals = Readonly<{
  subtotalSatang: number;
  grandTotalSatang: number;
  balanceSatang: number;
  overpaidSatang: number;
  paymentStatus: CalculatedPaymentStatus;
}>;
~~~

Validate every number with Number.isSafeInteger. Require positive quantities and non-negative money. Sum using checked integer arithmetic, throw the exact discount error from the test, define balanceSatang as Math.max(grandTotal - paid, 0), and overpaidSatang as Math.max(paid - grandTotal, 0). When paid is zero, derive UNPAID even if grand total is zero.

- [ ] **Step 5: Implement deterministic demand aggregation**

Use:

~~~ts
export type ProductionDemandLine = Readonly<{
  productId: string;
  productName: string;
  quantity: number;
  fulfillmentStatus:
    | "NEW"
    | "CONFIRMED"
    | "IN_PRODUCTION"
    | "PACKED"
    | "DELIVERED"
    | "CANCELLED";
}>;

export type ProductDemand = Readonly<{
  productId: string;
  productName: string;
  quantity: number;
}>;
~~~

Reject non-positive or unsafe quantities, skip CANCELLED lines, group by productId, and return results sorted by Thai productName with localeCompare using th.

- [ ] **Step 6: Run focused and regression tests**

~~~bash
pnpm test:run -- src/modules/orders/domain
pnpm test:run
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add src/modules/orders/domain/totals.ts src/modules/orders/domain/totals.test.ts src/modules/orders/domain/production-demand.ts src/modules/orders/domain/production-demand.test.ts
git commit -m "feat: calculate order totals and demand"
~~~

### Task 3: Delivery-location setting and customer vertical slice

**Files:**

- Modify: src/modules/delivery/application/delivery.ts
- Modify: src/modules/delivery/application/delivery.test.ts
- Modify: src/app/(app)/delivery/actions.ts
- Modify: src/modules/delivery/ui/delivery-method-form.tsx
- Create: src/modules/customers/application/customers.ts
- Create: src/modules/customers/application/customers.test.ts
- Create: src/app/(app)/customers/actions.ts
- Create: src/app/(app)/customers/page.tsx
- Create: src/app/(app)/customers/[id]/page.tsx
- Create: src/modules/customers/ui/customer-form.tsx
- Create: src/modules/customers/ui/customer-list.tsx

**Interfaces:**

- Produces: CustomerInput, Customer, CustomerFilters, and createCustomerService.
- Produces service methods: create, update, get, and list.
- Produces: createCustomerAction, updateCustomerAction, and createQuickCustomerAction.
- Consumes: deliveryMethods and requiresDeliveryLocation.

- [ ] **Step 1: Extend the failing delivery service test**

In delivery.test.ts, pass requiresDeliveryLocation: false to a pickup method, update it to true, and assert both returned values. Also change the existing KEX seed to pass true explicitly.

~~~ts
it("stores whether a method requires a delivery destination", async () => {
  const pickup = await service.createMethod(OWNER_ID, {
    name: "รับเอง",
    defaultCustomerFeeSatang: 0,
    defaultInternalCostSatang: 0,
    requiresDeliveryLocation: false,
  });
  expect(pickup.requiresDeliveryLocation).toBe(false);

  const updated = await service.updateMethod(OWNER_ID, pickup.id, {
    name: "รับเองหน้าร้าน",
    defaultCustomerFeeSatang: 0,
    defaultInternalCostSatang: 0,
    requiresDeliveryLocation: true,
    active: true,
  });
  expect(updated.requiresDeliveryLocation).toBe(true);
});
~~~

- [ ] **Step 2: Write failing customer service tests**

Create customers.test.ts. Seed a delivery method, create a customer with defaults, assert list search finds it, update it inactive, and verify OTHER_OWNER_ID cannot retrieve it.

~~~ts
it("creates, searches, updates, and owner-scopes customers", async () => {
  const delivery = createDeliveryService(context.db);
  const method = await delivery.createMethod(OWNER_ID, {
    name: "KEX Same Day",
    defaultCustomerFeeSatang: 12000,
    defaultInternalCostSatang: 12000,
    requiresDeliveryLocation: true,
  });
  const created = await service.create(OWNER_ID, {
    name: "คุณเมย์",
    contactHandle: "@may",
    phone: "0812345678",
    defaultDeliveryMethodId: method.id,
    defaultDeliveryLocation: "บางรัก กรุงเทพฯ",
    defaultDeliveryNote: "โทรก่อนส่ง",
    notes: "",
  });

  expect(await service.list(OWNER_ID, { query: "เมย์", active: true }))
    .toEqual([expect.objectContaining({ id: created.id, active: true })]);

  const updated = await service.update(OWNER_ID, created.id, {
    name: "คุณเมย์",
    contactHandle: "@may",
    phone: "0812345678",
    defaultDeliveryMethodId: method.id,
    defaultDeliveryLocation: "บางรัก กรุงเทพฯ",
    defaultDeliveryNote: "โทรก่อนส่ง",
    notes: "",
    active: false,
  });
  expect(updated.active).toBe(false);
  await expect(service.get(OTHER_OWNER_ID, created.id))
    .rejects.toThrow("Customer not found");
});
~~~

- [ ] **Step 3: Run focused tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/delivery/application/delivery.test.ts src/modules/customers/application/customers.test.ts
~~~

Expected: FAIL because the delivery types do not expose the new field and the customer service does not exist.

- [ ] **Step 4: Update delivery application and forms**

Add requiresDeliveryLocation: boolean to DeliveryMethodInput and DeliveryMethod, include it in methodSchema, toMethod, createMethod, and updateMethod.

In both delivery method forms, add this checkbox and send it through the two Server Actions:

~~~tsx
<label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-stone-700">
  <input
    defaultChecked={method?.requiresDeliveryLocation ?? true}
    name="requiresDeliveryLocation"
    type="checkbox"
  />
  ต้องระบุสถานที่จัดส่ง
</label>
~~~

The actions must map the checkbox with:

~~~ts
requiresDeliveryLocation: formData.get("requiresDeliveryLocation") === "on"
~~~

- [ ] **Step 5: Implement the customer service**

Use these public types:

~~~ts
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
~~~

createCustomerService(db) must return:

~~~ts
{
  create(ownerId: string, input: CustomerInput): Promise<Customer>;
  update(
    ownerId: string,
    customerId: string,
    input: CustomerInput & Readonly<{ active: boolean }>,
  ): Promise<Customer>;
  get(ownerId: string, customerId: string): Promise<Customer>;
  list(ownerId: string, filters?: CustomerFilters): Promise<ReadonlyArray<Customer>>;
}
~~~

Validate trimmed names, optional strings, and UUIDs with Zod. When a delivery method is supplied, query it with both ownerId and id before writing. Search name, contactHandle, and phone case-insensitively. Always order by active descending and name ascending.

- [ ] **Step 6: Implement authenticated customer actions and pages**

Define:

~~~ts
export type CustomerActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, ReadonlyArray<string>>>;
  saved: boolean;
}>;
~~~

Every action calls requireOwner before parsing. createCustomerAction revalidates /customers and returns a saved state. updateCustomerAction also revalidates /customers/[id]. createQuickCustomerAction accepts a serializable CustomerInput instead of FormData and returns:

~~~ts
type QuickCustomerResult =
  | Readonly<{ ok: true; customer: Customer }>
  | Readonly<{ ok: false; error: string }>;
~~~

CustomerPage awaits searchParams, passes query and active filters to the service, and fetches delivery methods in parallel. CustomerDetailPage awaits params and calls notFound only for Customer not found.

CustomerForm supports create/edit with these Thai labels: ชื่อลูกค้า, ช่องทางติดต่อ, เบอร์โทร, วิธีส่งประจำ, สถานที่จัดส่งประจำ, หมายเหตุการส่งประจำ, หมายเหตุลูกค้า, and เปิดใช้งาน. CustomerList shows contact details, active state, default method name, and a link to edit.

- [ ] **Step 7: Run customer, delivery, type, and lint checks**

~~~bash
pnpm test:run -- src/modules/delivery/application/delivery.test.ts src/modules/customers/application/customers.test.ts
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add src/modules/delivery src/modules/customers src/app/'(app)'/delivery src/app/'(app)'/customers
git commit -m "feat: manage customer delivery defaults"
~~~

### Task 4: Bake Cycle application and pages

**Files:**

- Create: src/modules/cycles/application/cycles.ts
- Create: src/modules/cycles/application/cycles.test.ts
- Create: src/modules/cycles/ui/cycle-form.tsx
- Create: src/modules/cycles/ui/cycle-list.tsx
- Create: src/app/(app)/cycles/actions.ts
- Create: src/app/(app)/cycles/page.tsx
- Create: src/app/(app)/cycles/new/page.tsx
- Create: src/app/(app)/cycles/[id]/page.tsx

**Interfaces:**

- Produces: BakeCycleInput, BakeCycle, BakeCycleFilters, and createCycleService.
- Produces service methods: create, update, changeStatus, get, and list.
- Produces: createCycleAction, updateCycleAction, and changeCycleStatusAction.

- [ ] **Step 1: Write failing cycle service tests**

Create cycles.test.ts with a fresh PGlite database per test. Cover automatic cycle numbers, OPEN as the service default, Thai name search, owner scoping, metadata updates, every Phase 2 status except LOCKED, and rejection of LOCKED.

~~~ts
it("creates numbered cycles and blocks Phase 3 locking", async () => {
  const first = await service.create(OWNER_ID, {
    name: "รอบส่ง 30 ส.ค.",
    status: "OPEN",
    orderCutoffAt: new Date("2026-08-27T12:00:00+07:00"),
    targetProductionDate: "2026-08-29",
    primaryDeliveryDate: "2026-08-30",
    notes: "",
  });
  const second = await service.create(OWNER_ID, {
    name: "รอบส่ง 6 ก.ย.",
    status: "DRAFT",
    orderCutoffAt: null,
    targetProductionDate: "2026-09-05",
    primaryDeliveryDate: "2026-09-06",
    notes: "",
  });

  expect(second.cycleNumber).toBeGreaterThan(first.cycleNumber);
  await expect(service.changeStatus(OWNER_ID, first.id, "LOCKED"))
    .rejects.toThrow("Cycle locking belongs to Phase 3");
});
~~~

- [ ] **Step 2: Run the test and verify it fails**

~~~bash
pnpm test:run -- src/modules/cycles/application/cycles.test.ts
~~~

Expected: FAIL because the cycle service does not exist.

- [ ] **Step 3: Implement the cycle service**

Use:

~~~ts
export type Phase2CycleStatus =
  | "DRAFT"
  | "OPEN"
  | "IN_PRODUCTION"
  | "COMPLETED"
  | "CANCELLED";

export type BakeCycleInput = Readonly<{
  name: string;
  orderCutoffAt: Date | null;
  targetProductionDate: string;
  primaryDeliveryDate: string;
  notes?: string;
}>;

export type BakeCycleFilters = Readonly<{
  query?: string;
  status?: Phase2CycleStatus;
}>;
~~~

BakeCycle is the persisted shape with id, ownerId, cycleNumber, all input fields, status, createdAt, and updatedAt. createCycleService(db) exposes:

~~~ts
{
  create(
    ownerId: string,
    input: BakeCycleInput & Readonly<{ status: "DRAFT" | "OPEN" }>,
  ): Promise<BakeCycle>;
  update(ownerId: string, cycleId: string, input: BakeCycleInput): Promise<BakeCycle>;
  changeStatus(
    ownerId: string,
    cycleId: string,
    status: Phase2CycleStatus | "LOCKED",
  ): Promise<BakeCycle>;
  get(ownerId: string, cycleId: string): Promise<BakeCycle>;
  list(ownerId: string, filters?: BakeCycleFilters): Promise<ReadonlyArray<BakeCycle>>;
}
~~~

Reject LOCKED with the exact test message. Validate ISO date strings with z.iso.date. Return lists ordered by primaryDeliveryDate descending and cycleNumber descending.

- [ ] **Step 4: Implement cycle actions**

Parse datetime-local order cutoff as a Bangkok offset:

~~~ts
function parseBangkokDateTime(value: string): Date | null {
  return value === "" ? null : new Date(value + ":00+07:00");
}
~~~

createCycleAction must authenticate, validate, create, revalidate /cycles and /dashboard, then redirect to /cycles/[new id] after the try/catch. updateCycleAction returns a saved state on the detail page. changeCycleStatusAction accepts cycleId and status from FormData, authenticates, calls the service, and revalidates /cycles, /cycles/[id], and /dashboard.

- [ ] **Step 5: Implement responsive cycle pages**

CycleForm exposes name, order cutoff, production date, primary delivery date, and notes. New mode also exposes status DRAFT/OPEN and defaults to OPEN; edit mode keeps status changes in the separate status control. CycleList renders cards on phone and a compact grid on desktop with cycle number, status, production date, and delivery date.

The initial detail page contains cycle metadata, status controls for Phase 2, a prominent เพิ่มออเดอร์ link to /orders/new?cycleId=[id], and empty-state sections for order totals and production demand. Task 8 replaces those empty states with live summaries.

Use async params exactly:

~~~tsx
export default async function CycleDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  const cycle = await createCycleService(db).get(owner.id, id);
  return <CycleDetail cycle={cycle} />;
}
~~~

CycleDetail is a Server Component in the same file that renders the complete metadata, status controls, CycleForm, add-order link, and the two empty-state sections described above.

- [ ] **Step 6: Run focused tests and compile checks**

~~~bash
pnpm test:run -- src/modules/cycles/application/cycles.test.ts
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add src/modules/cycles src/app/'(app)'/cycles
git commit -m "feat: manage bake cycles"
~~~

### Task 5: Transactional order application service

**Files:**

- Create: src/modules/orders/application/orders.ts
- Create: src/modules/orders/application/orders.test.ts

**Interfaces:**

- Produces: OrderItemInput, OrderInput, OrderDetail, OrderFormOptions, OrderListFilters.
- Produces: createOrderService with formOptions, create, update, get, list, updateFulfillmentStatus, cancel, markRefunded, and restorePaymentTracking.
- Consumes: calculateOrderTotals and all Phase 1/2 master tables.

- [ ] **Step 1: Write failing multi-item and historical-copy tests**

Seed two products, a delivery method, customer, and OPEN cycle. Create an order with two items and assert:

~~~ts
const created = await service.create(OWNER_ID, {
  customerId: customer.id,
  bakeCycleId: cycle.id,
  sourceChannel: "INSTAGRAM",
  requestedDeliveryDate: "2026-08-30",
  confirmedDeliveryDate: "2026-08-30",
  deliveryMethodId: method.id,
  deliveryFeeChargedSatang: 12000,
  deliveryCostSatang: 12000,
  deliveryFeePayer: "CUSTOMER",
  discountSatang: 2000,
  amountPaidSatang: 20000,
  deliveryLocation: "บางรัก กรุงเทพฯ",
  deliveryNote: "โทรก่อนส่ง",
  specialInstructions: "แยกถุง",
  items: [
    { productId: focaccia.id, quantity: 2, unitPriceSatang: 22000, lineNote: "" },
    { productId: scone.id, quantity: 1, unitPriceSatang: 8000, lineNote: "ไม่อุ่น" },
  ],
});

expect(created.totals).toEqual({
  subtotalSatang: 52000,
  grandTotalSatang: 62000,
  balanceSatang: 42000,
  overpaidSatang: 0,
  paymentStatus: "PARTIAL",
});
expect(created.items).toHaveLength(2);
~~~

After creation, change product master price, customer address, and delivery fees. Fetch the order again and assert its item prices, delivery location, fee charged, and internal delivery cost are unchanged.

- [ ] **Step 2: Write failing transaction and ownership tests**

Test that update replaces all items atomically. Force the replacement to fail with an OTHER_OWNER_ID product after changing the discount; fetch again and assert both the original header and items remain. Test that create rejects a CANCELLED cycle, an empty item list, and a customer/product/delivery method from another owner.

- [ ] **Step 3: Run tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/orders/application/orders.test.ts
~~~

Expected: FAIL because the order application service does not exist.

- [ ] **Step 4: Define order application types**

Use:

~~~ts
export type OrderItemInput = Readonly<{
  productId: string;
  quantity: number;
  unitPriceSatang: number;
  lineNote?: string;
}>;

export type OrderInput = Readonly<{
  customerId: string;
  bakeCycleId: string;
  sourceChannel: "INSTAGRAM" | "FACEBOOK" | "PHONE" | "OTHER" | null;
  requestedDeliveryDate: string | null;
  confirmedDeliveryDate: string | null;
  deliveryMethodId: string | null;
  deliveryFeeChargedSatang: number;
  deliveryCostSatang: number;
  deliveryFeePayer: "CUSTOMER" | "BAKERY" | "SHARED";
  discountSatang: number;
  amountPaidSatang: number;
  deliveryLocation: string;
  deliveryNote: string;
  specialInstructions: string;
  items: ReadonlyArray<OrderItemInput>;
}>;

export type OrderListFilters = Readonly<{
  query?: string;
  bakeCycleId?: string;
  customerId?: string;
  paymentStatus?: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  fulfillmentStatus?: "NEW" | "CONFIRMED" | "IN_PRODUCTION" | "PACKED" | "DELIVERED" | "CANCELLED";
}>;

export type OrderFulfillmentStatus =
  | "NEW"
  | "CONFIRMED"
  | "IN_PRODUCTION"
  | "PACKED"
  | "DELIVERED"
  | "CANCELLED";
~~~

OrderDetail contains the stored order fields, customerName, cycleName, deliveryMethodName, items with productName, and totals from calculateOrderTotals. OrderFormOptions contains active customers with defaults, active products with defaultUnitPriceSatang, active delivery methods with both default fees and requiresDeliveryLocation, and DRAFT/OPEN cycles.

Use this include shape so an edit form can retain historical master records that are now inactive or a cycle that has advanced:

~~~ts
export type OrderFormOptionIncludes = Readonly<{
  customerId: string;
  bakeCycleId: string;
  productIds: ReadonlyArray<string>;
  deliveryMethodId: string | null;
}>;
~~~

- [ ] **Step 5: Implement validated transactional writes**

createOrderService(db) must expose:

~~~ts
{
  formOptions(
    ownerId: string,
    include?: OrderFormOptionIncludes,
  ): Promise<OrderFormOptions>;
  create(ownerId: string, input: OrderInput): Promise<OrderDetail>;
  update(ownerId: string, orderId: string, input: OrderInput): Promise<OrderDetail>;
  get(ownerId: string, orderId: string): Promise<OrderDetail>;
  list(ownerId: string, filters?: OrderListFilters): Promise<ReadonlyArray<OrderDetail>>;
  updateFulfillmentStatus(ownerId: string, orderId: string, status: OrderFulfillmentStatus): Promise<OrderDetail>;
  cancel(ownerId: string, orderId: string): Promise<OrderDetail>;
  markRefunded(ownerId: string, orderId: string): Promise<OrderDetail>;
  restorePaymentTracking(ownerId: string, orderId: string): Promise<OrderDetail>;
}
~~~

Before writing, validate OrderInput with Zod and calculate totals. In one transaction:

1. Load the owner-scoped customer and cycle.
2. Reject CANCELLED cycles.
3. Load every distinct product id and the optional delivery method using ownerId.
4. Reject missing or cross-owner references.
5. Insert or update the order header using the calculated paymentStatus.
6. For update, delete the prior items only after all validation succeeds.
7. Insert all replacement items.
8. Read and return OrderDetail before the transaction commits.

If an existing order is REFUNDED, update keeps REFUNDED. restorePaymentTracking recalculates UNPAID/PARTIAL/PAID from stored values. cancel only sets fulfillmentStatus to CANCELLED; it never deletes rows.

- [ ] **Step 6: Implement owner-scoped reads**

For create mode, formOptions returns only active master records and DRAFT/OPEN cycles. When include is supplied for edit mode, also return the referenced customer, products, delivery method, and cycle even when inactive or in a later state. list filters on the server and orders by createdAt descending. get and list calculate totals from stored item lines rather than trusting duplicated totals. Use batched queries and Maps; do not issue one query per order.

- [ ] **Step 7: Run order and regression tests**

~~~bash
pnpm test:run -- src/modules/orders/application/orders.test.ts src/modules/orders/domain
pnpm test:run
pnpm typecheck
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add src/modules/orders/application
git commit -m "feat: persist transactional orders"
~~~

### Task 6: Single-page multi-item order form

**Files:**

- Create: src/modules/orders/domain/order-form.ts
- Create: src/modules/orders/domain/order-form.test.ts
- Create: src/modules/orders/ui/order-form.tsx
- Create: src/modules/orders/ui/order-form.test.tsx
- Create: src/app/(app)/orders/actions.ts
- Create: src/app/(app)/orders/new/page.tsx
- Create: src/app/(app)/orders/[id]/page.tsx

**Interfaces:**

- Produces: orderFormSchema, OrderFormValues, normalizeOrderForm, and calculateOrderFormTotals.
- Produces: OrderActionState and saveOrderAction.
- Produces: OrderForm with create and edit modes.
- Consumes: OrderFormOptions, OrderDetail, createQuickCustomerAction, and pure totals.

- [ ] **Step 1: Write failing form-domain tests**

Create order-form.test.ts with one valid two-item payload and invalid cases for zero quantity, three-decimal baht, empty items, and negative discount.

~~~ts
it("normalizes a valid baht form into satang order input", () => {
  const values = orderFormSchema.parse({
    customerId: "00000000-0000-4000-8000-000000000010",
    bakeCycleId: "00000000-0000-4000-8000-000000000020",
    sourceChannel: "INSTAGRAM",
    requestedDeliveryDate: "2026-08-30",
    confirmedDeliveryDate: "2026-08-30",
    deliveryMethodId: "00000000-0000-4000-8000-000000000030",
    deliveryFeeChargedBaht: "120",
    deliveryCostBaht: "120",
    deliveryFeePayer: "CUSTOMER",
    discountBaht: "20",
    amountPaidBaht: "200",
    deliveryLocation: "บางรัก กรุงเทพฯ",
    deliveryNote: "โทรก่อนส่ง",
    specialInstructions: "",
    items: [
      {
        productId: "00000000-0000-4000-8000-000000000040",
        quantity: "2",
        unitPriceBaht: "220",
        lineNote: "",
      },
      {
        productId: "00000000-0000-4000-8000-000000000050",
        quantity: "1",
        unitPriceBaht: "80",
        lineNote: "",
      },
    ],
  });

  expect(normalizeOrderForm(values)).toMatchObject({
    deliveryFeeChargedSatang: 12000,
    discountSatang: 2000,
    amountPaidSatang: 20000,
    items: [
      { quantity: 2, unitPriceSatang: 22000 },
      { quantity: 1, unitPriceSatang: 8000 },
    ],
  });
});
~~~

- [ ] **Step 2: Write a failing interactive form test**

Render OrderForm with two product options, one customer with KEX defaults, and a DRAFT cycle. Select the customer, add a second line, choose both products, and assert the live labels show:

- ยอดสินค้า ฿520.00
- ส่วนลด ฿20.00
- ค่าส่ง ฿120.00
- ยอดสุทธิ ฿620.00
- ชำระบางส่วน

Also assert changing to a pickup method with requiresDeliveryLocation false removes the missing-location warning.

- [ ] **Step 3: Run tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/orders/domain/order-form.test.ts src/modules/orders/ui/order-form.test.tsx
~~~

Expected: FAIL because the form schema and component do not exist.

- [ ] **Step 4: Implement the shared form schema**

OrderFormValues stores editable money as baht strings and quantity as a digit string. Use Zod regex checks so money accepts zero to two decimal places and quantity accepts positive integers only.

~~~ts
export type OrderFormValues = Readonly<{
  customerId: string;
  bakeCycleId: string;
  sourceChannel: "" | "INSTAGRAM" | "FACEBOOK" | "PHONE" | "OTHER";
  requestedDeliveryDate: string;
  confirmedDeliveryDate: string;
  deliveryMethodId: string;
  deliveryFeeChargedBaht: string;
  deliveryCostBaht: string;
  deliveryFeePayer: "CUSTOMER" | "BAKERY" | "SHARED";
  discountBaht: string;
  amountPaidBaht: string;
  deliveryLocation: string;
  deliveryNote: string;
  specialInstructions: string;
  items: ReadonlyArray<Readonly<{
    productId: string;
    quantity: string;
    unitPriceBaht: string;
    lineNote: string;
  }>>;
}>;
~~~

normalizeOrderForm converts money with parseBahtToSatang, quantity with Number, empty optional ids/dates to null, and returns an object structurally assignable to OrderInput. calculateOrderFormTotals returns null while fields are incomplete or invalid; otherwise it delegates to calculateOrderTotals.

- [ ] **Step 5: Implement the authenticated save action**

Use:

~~~ts
export type OrderActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
}>;
~~~

saveOrderAction reads payload and optional orderId from FormData, JSON-parses inside try/catch, validates with orderFormSchema, maps every Zod issue to issue.path.join("."), authenticates with requireOwner, and calls service.create or service.update. On expected failure, return Thai error text without discarding client state. On success:

~~~ts
revalidatePath("/orders");
revalidatePath("/cycles");
revalidatePath("/cycles/" + result.bakeCycleId);
revalidatePath("/dashboard");
redirect("/orders/" + result.id);
~~~

The redirect must be after the catch block.

- [ ] **Step 6: Build the controlled OrderForm**

OrderForm props are:

~~~ts
type OrderFormProps = Readonly<{
  mode: "create" | "edit";
  options: OrderFormOptions;
  initialValues: OrderFormValues;
  orderId?: string;
  createQuickCustomer: typeof createQuickCustomerAction;
}>;
~~~

Use useState for the full OrderFormValues object and useActionState for saveOrderAction. Render one form with hidden payload containing JSON.stringify(values). Implement:

1. Existing-customer selection plus a สร้างลูกค้าใหม่ panel.
2. Quick customer creation with useTransition; on success append/select the returned customer without resetting order lines.
3. Customer selection copies default method, location, and delivery note.
4. Delivery-method selection copies both default fees.
5. Dynamic item add/remove controls; changing a product copies its current default price.
6. Immediate totals from calculateOrderFormTotals.
7. An overpayment warning when overpaidSatang is positive.
8. A missing-location warning only when the selected method requires a destination and location is blank.
9. Thai field errors adjacent to the matching control and role alert for the form-level error.
10. A pending-disabled save button so double taps cannot create duplicate orders.
11. A full-width sticky phone save area above the bottom navigation and a normal desktop submit area.

Do not import db, environment modules, or application service implementations into this Client Component. Props must remain React-serializable.

- [ ] **Step 7: Build new and edit Server Component pages**

OrdersNewPage awaits searchParams, fetches formOptions, and preselects a valid cycleId query value. It supplies one blank item with quantity 1 and price 0.

OrderDetailPage awaits params and fetches OrderDetail first. Then call formOptions with the order's customerId, bakeCycleId, distinct productIds, and deliveryMethodId so historical selections remain available. Convert satang to baht strings with formatSatangAsBaht and render OrderForm in edit mode. Call notFound only for the exact Order not found service error.

- [ ] **Step 8: Run form and application checks**

~~~bash
pnpm test:run -- src/modules/orders/domain/order-form.test.ts src/modules/orders/ui/order-form.test.tsx src/modules/orders/application/orders.test.ts
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 9: Commit**

~~~bash
git add src/modules/orders/domain/order-form.ts src/modules/orders/domain/order-form.test.ts src/modules/orders/ui/order-form.tsx src/modules/orders/ui/order-form.test.tsx src/app/'(app)'/orders
git commit -m "feat: add multi-item order form"
~~~

### Task 7: Order list, filters, statuses, cancellation, and customer history

**Files:**

- Modify: src/modules/orders/application/orders.test.ts
- Create: src/modules/orders/ui/order-list.tsx
- Create: src/modules/orders/ui/order-filters.tsx
- Create: src/modules/orders/ui/order-status-actions.tsx
- Create: src/modules/orders/ui/order-status-actions.test.tsx
- Modify: src/app/(app)/orders/actions.ts
- Create: src/app/(app)/orders/page.tsx
- Modify: src/app/(app)/orders/[id]/page.tsx
- Modify: src/app/(app)/customers/[id]/page.tsx

**Interfaces:**

- Produces: updateFulfillmentStatusAction, cancelOrderAction, markOrderRefundedAction, and restoreOrderPaymentTrackingAction.
- Consumes: OrderListFilters and the status mutation methods from Task 5.

- [ ] **Step 1: Add failing application status tests**

Extend orders.test.ts to assert:

1. updateFulfillmentStatus moves NEW directly to PACKED.
2. cancel sets CANCELLED and leaves both items readable.
3. markRefunded keeps REFUNDED after an ordinary order edit.
4. restorePaymentTracking changes REFUNDED back to the calculated UNPAID, PARTIAL, or PAID status.
5. list with customerId, bakeCycleId, paymentStatus, fulfillmentStatus, and customer-name query returns only matching owner rows.

- [ ] **Step 2: Write a failing status-actions component test**

Render OrderStatusActions for a CONFIRMED, PARTIAL order. Assert all buttons have accessible Thai names, cancellation calls window.confirm, declining does not submit, and accepting submits the CANCELLED intent. Use a mocked action prop rather than importing the authenticated Server Action into the unit test.

- [ ] **Step 3: Run tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/orders/application/orders.test.ts src/modules/orders/ui/order-status-actions.test.tsx
~~~

Expected: FAIL until the filters and status UI are implemented.

- [ ] **Step 4: Implement status Server Actions**

Each action authenticates and validates UUID/status values. Revalidate:

- /orders
- /orders/[id]
- /cycles
- /cycles/[order bakeCycleId]
- /customers/[order customerId]
- /dashboard

Return:

~~~ts
export type OrderStatusActionState = Readonly<{
  error: string | null;
  saved: boolean;
}>;
~~~

Cancellation must call service.cancel and must never delete. Refund and restore are explicit separate actions.

- [ ] **Step 5: Implement filters and order list**

OrdersPage awaits searchParams and validates string values before building OrderListFilters. Fetch orders, cycles, and customers in parallel.

OrderFilters is a GET form with labels ค้นหา, รอบผลิต, การชำระเงิน, and การจัดเตรียม plus a clear link. OrderList displays customer, cycle, created date, product count, grand total, payment badge, fulfillment badge, and an edit link. Cancelled cards remain visible with subdued styling.

Use formatSatangAsBaht for all money and format dates with Intl.DateTimeFormat using Asia/Bangkok.

- [ ] **Step 6: Complete order detail and customer history**

Above the edit form, show customer, cycle, total, paid, balance, delivery method, and both statuses. Render OrderStatusActions beside the summary.

In CustomerDetailPage, call orderService.list(owner.id, { customerId: id }) and render an ประวัติออเดอร์ section linking each order, including cancelled rows. Do not query all orders and filter in the page.

- [ ] **Step 7: Run focused and regression checks**

~~~bash
pnpm test:run -- src/modules/orders
pnpm test:run
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add src/modules/orders src/app/'(app)'/orders src/app/'(app)'/customers/'[id]'/page.tsx
git commit -m "feat: track order status and history"
~~~

### Task 8: Live cycle summaries, dashboard, and responsive navigation

**Files:**

- Modify: src/modules/orders/application/orders.ts
- Modify: src/modules/orders/application/orders.test.ts
- Modify: src/app/(app)/cycles/page.tsx
- Modify: src/app/(app)/cycles/[id]/page.tsx
- Modify: src/app/(app)/dashboard/page.tsx
- Modify: src/components/app-shell.tsx
- Modify: src/components/app-shell.test.tsx
- Create: src/app/(app)/more/page.tsx
- Create: src/app/(app)/error.tsx
- Create: src/app/(app)/error.test.tsx

**Interfaces:**

- Produces: CycleOrderSummary and getCycleSummary.
- Produces: listCycleSummaries for list/dashboard batching.
- Consumes: aggregateProductionDemand and stored OrderDetail totals.

- [ ] **Step 1: Write failing cycle-summary tests**

Seed two cycles and three orders. Put two active orders and one cancelled order in the first cycle. Assert:

~~~ts
expect(await service.getCycleSummary(OWNER_ID, firstCycle.id)).toEqual({
  activeOrderCount: 2,
  cancelledOrderCount: 1,
  grandTotalSatang: 62000,
  amountPaidSatang: 20000,
  balanceSatang: 42000,
  demand: [
    { productId: focaccia.id, productName: "Focaccia", quantity: 3 },
    { productId: scone.id, productName: "Scone", quantity: 1 },
  ],
});
~~~

Use fixture values that produce those exact totals. Assert the cancelled order contributes neither money nor demand. Assert listCycleSummaries returns both cycle ids in one call and owner scoping rejects another owner.

- [ ] **Step 2: Extend the failing AppShell test**

Desktop expectations must include รอบผลิต, ออเดอร์, ลูกค้า, วัตถุดิบ, สินค้าและสูตร, การจัดส่ง, and ตั้งค่าร้าน. Phone expectations must include exactly five destinations: หน้าหลัก, รอบผลิต, ออเดอร์, วัตถุดิบ, and เพิ่มเติม. Assert /cycles/uuid marks รอบผลิต current and /customers marks เพิ่มเติม current on phone.

Also write error.test.tsx. Render the authenticated error boundary with an Error and a retry spy, assert the Thai recovery message is visible, click ลองอีกครั้ง, and assert retry was called once.

- [ ] **Step 3: Run tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/orders/application/orders.test.ts src/components/app-shell.test.tsx
~~~

Expected: FAIL because summaries and the new navigation model are missing.

- [ ] **Step 4: Implement batched cycle summaries**

Use:

~~~ts
export type CycleOrderSummary = Readonly<{
  activeOrderCount: number;
  cancelledOrderCount: number;
  grandTotalSatang: number;
  amountPaidSatang: number;
  balanceSatang: number;
  demand: ReadonlyArray<ProductDemand>;
}>;
~~~

getCycleSummary validates that the cycle belongs to ownerId. listCycleSummaries(ownerId, cycleIds) loads all matching order headers, items, and products in batched queries. It calculates each non-cancelled order total, sums money with safe integers, and delegates demand grouping to aggregateProductionDemand. Return zeroed summaries for cycles without orders.

- [ ] **Step 5: Render live cycle list and detail**

CyclesPage fetches cycles and listCycleSummaries, then shows active/cancelled order counts and grand total on every card.

CycleDetailPage replaces the Task 4 empty states with:

- summary cards for active orders, sales, paid, and balance;
- a production section listing product name and total quantity;
- the cycle order list including cancelled history;
- an เพิ่มออเดอร์ action only when status is DRAFT or OPEN;
- an empty-state message ยังไม่มีสินค้าที่ต้องผลิต when demand is empty.

For IN_PRODUCTION or COMPLETED cycles, keep edit links but show the approved warning before order changes. For CANCELLED cycles, show no new-order action.

- [ ] **Step 6: Update dashboard**

Keep the Phase 1 readiness section. Above it, show the nearest OPEN cycle by primary delivery date, with delivery date, active order count, total product units, sales total, and quick actions เพิ่มออเดอร์ and ดูรอบผลิต. If no OPEN cycle exists, show เปิดรอบผลิต with a link to /cycles/new.

- [ ] **Step 7: Implement desktop and phone navigation**

Use separate route arrays:

~~~ts
const DESKTOP_ROUTES = [
  "/dashboard", "/cycles", "/orders", "/customers",
  "/inventory", "/products", "/delivery", "/settings",
] as const;

const MOBILE_ROUTES = [
  "/dashboard", "/cycles", "/orders", "/inventory", "/more",
] as const;
~~~

Keep the phone grid at five columns. /more renders cards linking to Customers, Products and Recipes, Delivery, and Settings. isCurrentRoute treats /customers, /products, /delivery, and /settings as active under เพิ่มเติม on phone while retaining their own desktop active item.

- [ ] **Step 8: Implement authenticated route recovery**

Create src/app/(app)/error.tsx as a Client Component using the Next.js 16 error-boundary signature:

~~~tsx
"use client";

export default function AuthenticatedError({
  error,
  retry,
}: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return (
    <main className="mx-auto grid max-w-xl gap-4 px-5 py-12">
      <h1 className="text-2xl font-bold text-stone-900">เปิดข้อมูลไม่สำเร็จ</h1>
      <p className="text-stone-600">
        กรุณาลองอีกครั้ง หากยังไม่สำเร็จให้ตรวจการเชื่อมต่อแล้วรีเฟรชหน้า
      </p>
      <button
        className="min-h-11 rounded-xl bg-stone-900 px-5 font-semibold text-white"
        onClick={retry}
        type="button"
      >
        ลองอีกครั้ง
      </button>
    </main>
  );
}
~~~

Do not render error.message, database details, environment values, or a stack trace.

- [ ] **Step 9: Run summary, shell, error, and regression checks**

~~~bash
pnpm test:run -- src/modules/orders/application/orders.test.ts src/components/app-shell.test.tsx src/app/'(app)'/error.test.tsx
pnpm test:run
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 10: Commit**

~~~bash
git add src/modules/orders/application src/app/'(app)'/cycles src/app/'(app)'/dashboard src/app/'(app)'/more src/app/'(app)'/error.tsx src/app/'(app)'/error.test.tsx src/components/app-shell.tsx src/components/app-shell.test.tsx
git commit -m "feat: show live cycle operations"
~~~

### Task 9: End-to-end order workflow, documentation, and release gate

**Files:**

- Modify: tests/fixtures/owner.ts
- Create: tests/e2e/orders.spec.ts
- Modify: README.md

**Interfaces:**

- Produces: reusable Playwright helpers for customer, cycle, and order creation.
- Verifies: the complete approved Phase 2 workflow on phone and desktop.

- [ ] **Step 1: Write the failing E2E workflow**

Create orders.spec.ts with a unique runId. In one test:

1. Sign in as owner.
2. Create a product priced at ฿220.
3. Create a KEX method with ฿120 customer fee, ฿120 internal cost, and destination required.
4. Create customer named May [runId] with that method and a delivery location.
5. Create an OPEN Bake Cycle named รอบส่ง [runId].
6. Create a two-line order by adding the same product as two separate form lines with quantities 1 and 2. Duplicate product lines are allowed because line notes may differ.
7. Set discount ฿20 and amount paid ฿200.
8. Assert subtotal ฿660.00, delivery fee ฿120.00, grand total ฿760.00, balance ฿560.00, and PARTIAL status.
9. Open the cycle and assert aggregate demand is 3 units.
10. Cancel the order through the confirmation dialog.
11. Assert the order remains in history with ยกเลิก and cycle demand shows ยังไม่มีสินค้าที่ต้องผลิต.

Use role and label selectors only. Do not depend on generated UUIDs or table structure.

- [ ] **Step 2: Run phone E2E and verify it fails**

~~~bash
pnpm test:e2e --project=phone tests/e2e/orders.spec.ts
~~~

Expected: FAIL at the first missing or incorrect Phase 2 UI behavior.

- [ ] **Step 3: Add reusable fixture helpers**

Add these exact helper signatures to tests/fixtures/owner.ts:

~~~ts
export async function createCustomer(
  page: Page,
  input: Readonly<{
    name: string;
    deliveryMethodName: string;
    deliveryLocation: string;
  }>,
): Promise<void>;

export async function createBakeCycle(
  page: Page,
  input: Readonly<{
    name: string;
    productionDate: string;
    deliveryDate: string;
  }>,
): Promise<void>;

export async function createOrder(
  page: Page,
  input: Readonly<{
    customerName: string;
    cycleName: string;
    productName: string;
    totalQuantity: number;
    discountBaht: string;
    amountPaidBaht: string;
  }>,
): Promise<void>;
~~~

Implement each helper with accessible Thai labels and visible-link selection that works in both navigation layouts.

- [ ] **Step 4: Make E2E deterministic**

Assert the two identical product lines remain separate in order history while aggregation sums them to 3 units. Wait for a URL or visible saved-state change after every Server Action. Keep the test timeout at 120 seconds and never read or log password values.

- [ ] **Step 5: Update README**

Replace the Phase 1-only introduction with a Current features section that includes customers, Bake Cycles, multi-item orders, totals, payment/fulfillment tracking, delivery copies, and live cycle demand. Keep Lock/Snapshot, shopping, production timeline, and profit under Later phases.

Add the four new tables and migration command to the database section. State that cancelled orders remain as history and are excluded from production demand.

- [ ] **Step 6: Run the complete verification gate**

Run each command separately and inspect its final exit status:

~~~bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm test:e2e --project=phone
pnpm test:e2e --project=desktop
~~~

Expected:

- lint exits 0;
- typecheck exits 0;
- all Vitest tests pass;
- Next.js production build exits 0;
- every phone Playwright test passes;
- every desktop Playwright test passes.

- [ ] **Step 7: Inspect migration and repository safety**

~~~bash
git diff --check
git status --short
git diff -- .env.local .env
~~~

Expected: no whitespace errors, only intended Phase 2 files changed, and no environment file diff.

- [ ] **Step 8: Commit**

~~~bash
git add tests/fixtures/owner.ts tests/e2e/orders.spec.ts README.md
git commit -m "test: cover phase 2 owner workflow"
~~~

- [ ] **Step 9: Request code review and finish the branch**

Use superpowers:requesting-code-review against the Phase 2 spec and this plan. Resolve findings with superpowers:receiving-code-review and rerun the affected verification commands. When all findings are resolved and the full gate is green, use superpowers:finishing-a-development-branch to offer local merge, push/PR, keep, or discard choices.
