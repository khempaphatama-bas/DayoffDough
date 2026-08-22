# Day Off Dough OS — Phase 2 Orders and Bake Cycles Design

**Date:** 2026-08-23
**Status:** Approved in conversation
**Audience:** Product owner and implementation team

## Goal

Build the first end-to-end order workflow for a single bakery owner: create a production cycle, record multi-item customer orders, calculate the amount due, and see the total quantity of each product that must be produced in that cycle.

The design keeps the Bake Cycle as the operating axis of the system while separating customer, cycle, and order responsibilities so later planning features can build on stable boundaries.

## Scope

Phase 2 includes:

- customer records and reusable delivery defaults;
- Bake Cycle creation, listing, status tracking, and live summaries;
- multi-item order creation, viewing, editing, filtering, and cancellation;
- delivery method, delivery fee, internal delivery cost, and payer tracking per order;
- order subtotal, discount, grand total, amount paid, balance, and payment status;
- fulfillment status independent from payment status;
- live production aggregation by product for each Bake Cycle;
- owner-only authorization and database ownership constraints;
- responsive phone and desktop workflows.

## Deferred to Phase 3

The following are deliberately excluded:

- locking a Bake Cycle;
- immutable planning snapshots;
- recipe scaling, ingredient demand, packaging demand, and shopping lists;
- stock sufficiency and shortage calculations;
- production timeline generation;
- profit reporting.

The schema may reserve a `LOCKED` Bake Cycle status for forward compatibility, but Phase 2 exposes no lock action and creates no snapshot.

## Architecture

Use a modular monolith with three new business modules:

- `customers`: customer master data and delivery defaults;
- `cycles`: Bake Cycle lifecycle and live cycle summaries;
- `orders`: order entry, financial calculations, fulfillment, and production aggregation.

Each module follows the existing Phase 1 shape: database schema, pure domain logic where applicable, application services, and route-level UI. Cross-module access goes through explicit application queries and owner-scoped foreign keys. No browser component receives a database credential or privileged key.

The primary relationship model is:

```text
Customer   1 ── many Orders
Bake Cycle 1 ── many Orders
Order      1 ── many Order Items
Product    1 ── many Order Items
```

Every order belongs to exactly one customer and one Bake Cycle. An order contains at least one item.

## Data Model

All new tables use UUID primary keys, `owner_id`, timestamps, owner-scoped indexes, and composite owner foreign keys consistent with Phase 1.

### `customers`

- `id`
- `owner_id`
- `name`
- `contact_handle`
- `phone`
- `default_delivery_method_id`, nullable
- `default_delivery_location`, nullable
- `default_delivery_note`, nullable
- `notes`, nullable
- `active`, default true
- `created_at`, `updated_at`

Customer names are not globally unique because different customers can share a name. Deactivation is used instead of hard deletion when history exists.

### `bake_cycles`

- `id`
- `owner_id`
- `cycle_number`, database-generated and unique
- `name`
- `status`: `DRAFT | OPEN | LOCKED | IN_PRODUCTION | COMPLETED | CANCELLED`
- `order_cutoff_at`, nullable
- `target_production_date`
- `primary_delivery_date`
- `notes`, nullable
- `created_at`, `updated_at`

Phase 2 uses `DRAFT`, `OPEN`, `IN_PRODUCTION`, `COMPLETED`, and `CANCELLED`. `LOCKED` remains inactive until Phase 3.

### `orders`

- `id`
- `owner_id`
- `customer_id`
- `bake_cycle_id`
- `source_channel`: `INSTAGRAM | FACEBOOK | PHONE | OTHER`, nullable
- `requested_delivery_date`, nullable
- `confirmed_delivery_date`, nullable
- `delivery_method_id`, nullable
- `delivery_fee_charged_satang`, default 0
- `delivery_cost_satang`, default 0
- `delivery_fee_payer`: `CUSTOMER | BAKERY | SHARED`
- `discount_satang`, default 0
- `amount_paid_satang`, default 0
- `delivery_location`, nullable
- `delivery_note`, nullable
- `special_instructions`, nullable
- `payment_status`: `UNPAID | PARTIAL | PAID | REFUNDED`
- `fulfillment_status`: `NEW | CONFIRMED | IN_PRODUCTION | PACKED | DELIVERED | CANCELLED`
- `created_at`, `updated_at`

The order keeps copied delivery values. Later edits to the customer or delivery method master do not rewrite existing orders.

### Existing `delivery_methods` extension

Add `requires_delivery_location`, default true. The owner can turn it off for pickup or other methods that do not need a destination. This supplies the rule used by the order form's missing-destination warning without inferring behavior from a delivery method's name.

### `order_items`

- `id`
- `owner_id`
- `order_id`
- `product_id`
- `quantity`
- `unit_price_satang`
- `line_note`, nullable
- `created_at`, `updated_at`

The item price is copied from `products.default_unit_price_satang` when a product is selected and remains editable for that order. Later product price changes do not affect historical orders.

### Integrity and indexes

- Composite foreign keys include `owner_id` to prevent cross-owner relationships.
- Monetary columns have non-negative checks.
- Item quantity must be a positive integer.
- Orders are indexed by owner and Bake Cycle, customer, payment status, fulfillment status, and creation date.
- Bake Cycles are indexed by owner, status, production date, and delivery date.
- Referenced customers, products, delivery methods, cycles, and orders use restricted deletion. Operational removal is represented by deactivation or cancellation.

## Business Rules

### Totals

```text
subtotal = sum(item quantity × item unit price)
grand total = subtotal − discount + delivery fee charged
balance = grand total − amount paid
```

Subtotal, grand total, and balance are derived values rather than independent editable fields. This prevents stored totals from drifting away from item lines.

Validation rules:

- quantity is greater than zero;
- unit price, discount, delivery fees, delivery cost, and amount paid are non-negative;
- discount cannot make grand total negative;
- an order requires a customer, a Bake Cycle, and at least one item;
- a delivery method that requires destination information produces a clear warning when the destination is missing;
- overpayment is allowed but produces a visible warning.

### Payment status

For non-refunded orders, the application recalculates status whenever financial values change:

- `UNPAID` when amount paid is zero;
- `PARTIAL` when amount paid is greater than zero but below grand total;
- `PAID` when amount paid is equal to or above grand total;
- `REFUNDED` only through an explicit owner action.

Editing an order marked `REFUNDED` does not silently change it back to another status. The owner must explicitly restore normal payment tracking.

### Fulfillment status

The normal path is:

```text
NEW → CONFIRMED → IN_PRODUCTION → PACKED → DELIVERED
```

The owner may move forward by more than one step because the application has one operator. Cancellation requires confirmation and changes the status to `CANCELLED`; the row and its items remain for history.

### Bake Cycle status

The normal Phase 2 path is:

```text
DRAFT → OPEN → IN_PRODUCTION → COMPLETED
```

New cycles default to `OPEN` for the single-owner workflow. The owner can explicitly save a cycle as `DRAFT`. Orders may be created or corrected in `DRAFT` and `OPEN`. Later states remain editable in Phase 2 because there is no lock, but the UI warns before changing order contents in `IN_PRODUCTION` or `COMPLETED`. A `CANCELLED` cycle rejects new orders. `LOCKED` becomes active only with Phase 3 snapshots.

### Production aggregation

The Bake Cycle summary groups non-cancelled Order Items by product and sums quantities. Orders with fulfillment status `CANCELLED` contribute zero. Because Phase 2 has no lock or snapshot, this is a live calculation and changes immediately after an order is created, edited, moved to another cycle, or cancelled.

## User Experience

Add three primary navigation entries:

- รอบผลิต (Bake Cycles)
- ออเดอร์ (Orders)
- ลูกค้า (Customers)

### Recurring workflow

1. Create a Bake Cycle with its cutoff, production, and delivery dates.
2. Open the cycle and choose “เพิ่มออเดอร์”.
3. Select an existing customer or create one inline.
4. Add one or more products, quantities, prices, and item notes.
5. Confirm delivery details, discount, delivery charge, and amount paid.
6. Review totals and save explicitly.
7. Return to the cycle detail to see order totals and the live production quantity by product.

### Routes and pages

- `/cycles`: current and historical cycles with status, dates, order count, and sales total;
- `/cycles/new`: create a cycle;
- `/cycles/[id]`: cycle metadata, production aggregation, order list, and totals;
- `/orders`: searchable/filterable list by cycle, customer, payment, and fulfillment status;
- `/orders/new`: single-page multi-item order form, optionally preselected by `cycleId`;
- `/orders/[id]`: order detail and edit screen with cancellation action;
- `/customers`: searchable active/inactive customer list;
- `/customers/[id]`: customer edit screen and order history.

The order form updates calculated totals immediately in the browser but saves only after an explicit submit. On phones, form sections stack vertically and the primary save/add-order actions remain easy to reach. Desktop layouts use the additional width for cycle summaries and order line tables without changing the workflow.

## Application Operations

Application services provide owner-scoped operations rather than exposing general table access:

- create, update, deactivate, list, and retrieve customers;
- create, update, list, retrieve, and change the operational status of Bake Cycles;
- create and update an order with all its items in one transaction;
- list and retrieve orders with filters;
- cancel an order without deleting it;
- calculate cycle financial and production summaries.

Order header and item writes are atomic. If validation or any database write fails, the entire transaction rolls back.

## Error Handling

- Validate with shared schemas in both the browser and server boundary.
- Treat server-side validation and owner authorization as authoritative.
- Return field-specific Thai messages near the invalid input.
- Preserve the form state after a failed save.
- Disable duplicate submissions while a request is pending.
- Show a page-level recovery message for unavailable records or database errors without exposing credentials or raw database details.
- Use confirmation dialogs for cancellation and other irreversible status changes.

## Security

- Every route and mutation requires the authenticated owner identity.
- The authenticated email must match `OWNER_EMAIL`.
- Every query and write is scoped by `owner_id` obtained from the verified session, never from a browser form.
- Row Level Security remains enabled for all new tables as defense in depth.
- Database credentials stay server-only; no service-role key or database URL is placed in `NEXT_PUBLIC_*` variables.
- Composite owner foreign keys and server authorization protect against cross-owner references even though the MVP currently has one owner.

## Testing Strategy

### Domain tests

- subtotal, discount, delivery fee, grand total, balance, and overpayment;
- automatic payment status boundaries;
- cancelled-order exclusion from production aggregation;
- production grouping across multiple orders and products.

### Application and integration tests

- customer, cycle, and order create/update flows;
- multi-item order transaction behavior;
- copied product price and delivery defaults remain stable after master data changes;
- filtering and owner scoping;
- cancellation preserves history and updates live aggregation;
- invalid monetary values, missing relationships, and empty orders are rejected.

### End-to-end tests

Run the owner workflow on phone and desktop viewports:

1. sign in;
2. create a customer and Bake Cycle;
3. create a multi-item order;
4. verify financial totals and production aggregation;
5. update payment and fulfillment statuses;
6. cancel the order and verify it disappears from production totals but remains in order history.

The delivery gate is passing lint, typecheck, unit/integration tests, production build, and Playwright E2E tests.

## Acceptance Criteria

Phase 2 is complete when:

- an order belongs to exactly one Bake Cycle and one customer;
- an order supports multiple product lines with copied, editable historical prices;
- customer and delivery-method defaults are copied into new orders and remain independently editable;
- totals and payment status update correctly;
- payment and fulfillment statuses are separate;
- cancelled orders remain visible but are excluded from production aggregation;
- cycle detail shows correct live order, sales, and per-product production totals;
- only the configured owner can access or mutate the data;
- the full verification gate passes on phone and desktop.
