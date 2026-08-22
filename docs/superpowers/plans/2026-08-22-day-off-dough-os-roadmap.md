# Day Off Dough OS Delivery Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Day Off Dough OS MVP as five independently testable phases, each ending in a usable vertical capability.

**Architecture:** Build one responsive modular monolith. Next.js owns the authenticated UI and server-side application layer; PostgreSQL stores relational data; pure TypeScript domain modules own calculations so critical rules can be tested without the UI or database.

**Tech Stack:** Node.js 24.x, pnpm 11.x, Next.js App Router, React, TypeScript strict mode, Tailwind CSS, Supabase Auth and PostgreSQL, Drizzle ORM, Zod, Decimal.js, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-day-off-dough-os-mvp-design.md`

## Global Constraints

- The primary user is one bakery owner; do not add multi-user roles.
- Orders are entered manually; do not integrate Instagram, Facebook, payments, or carriers.
- Store money as integer satang and quantities/conversion factors as exact decimals.
- Perform business-critical calculations on the server through pure domain functions.
- Use one primary delivery date per Bake Cycle.
- Treat missing costs as incomplete data, never as zero.
- Preserve locked and completed cycle history with planning and final snapshots.
- Support phone and desktop layouts; prioritize phone workflows used during baking.
- Do not add features listed under the spec's MVP non-goals.
- Use TDD for every business rule and run lint, typecheck, unit tests, and relevant browser tests before each phase is complete.

---

## Program Decomposition

| Phase | Detailed plan | Independently testable outcome |
|---|---|---|
| 1. Foundation and master data | `docs/superpowers/plans/2026-08-22-day-off-dough-os-phase-1-foundation.md` | Owner can sign in and maintain shop settings, units, inventory prices, products, recipe versions, packaging rules, and delivery presets. |
| 2. Bake Cycles and orders | Write after Phase 1 is integrated so file paths match the real codebase. | Owner can create a cycle, enter multi-item orders, calculate totals, and see aggregated product demand. |
| 3. Production, costing, inventory, shopping | Write after Phase 2 is integrated. | Owner can lock a cycle, calculate batches/materials/costs, count stock, and generate a shopping list. |
| 4. Timeline and operations | Write after Phase 3 is integrated. | Owner can configure production templates, generate cycle tasks, and run production/packing/delivery from a phone. |
| 5. Cycle closure and hardening | Write after Phase 4 is integrated. | Owner can confirm consumption, create final snapshots, view cycle profit, export CSV, and recover data safely. |

Each later plan must begin by reading the spec, this roadmap, and the code produced by the preceding phase. Do not pre-commit exact later-phase file paths before those boundaries exist in working code.

## Phase Gates

### Phase 1 Gate

- Authentication protects every app route.
- Master-data tables are owner-scoped.
- Unit conversions and unit-cost calculations pass deterministic tests.
- Owner can maintain every master-data record needed by an Order or Bake Cycle.
- Mobile and desktop navigation work in Playwright.

### Phase 2 Gate

- One order belongs to exactly one Bake Cycle and contains multiple items.
- Price and delivery defaults are copied into the order and remain editable per order.
- Payment and fulfillment states are separate.
- Cancelled orders do not contribute to production demand.
- Order totals and cycle aggregation have unit and integration coverage.

### Phase 3 Gate

- Locking a cycle validates recipe/yield/unit blockers in one transaction.
- Batch rounding never creates a fractional batch silently.
- Material and packaging requirements use base units.
- Missing prices mark costs incomplete.
- Inventory counts generate non-negative shopping quantities and suggested pack counts.
- Planning snapshots remain unchanged when master data changes.

### Phase 4 Gate

- Product and cycle templates generate dated tasks from the primary delivery date.
- Generated tasks are snapshots and can be edited without changing templates.
- Phone production views are usable without dense tables.
- Production, packing, payment, and delivery statuses can change without unlocking the cycle.

### Phase 5 Gate

- Owner explicitly confirms planned or actual inventory consumption.
- Completed cycles receive immutable final snapshots.
- Estimated values are labeled when actual values are absent.
- Revenue, delivery, production cost, gross profit, and margin formulas pass tests.
- CSV exports cover customers, orders, inventory, recipes, and cycle summaries.
- Full critical flow passes Playwright on phone and desktop viewports.

## Release Rule

Do not start a later phase while an earlier phase has failing verification or unresolved review findings. A phase may ship behind authentication when its gate is satisfied, even though later modules are not yet present.
