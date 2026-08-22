# Day Off Dough OS Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated responsive application foundation and every master-data capability required by later Bake Cycle work.

**Architecture:** Use a Next.js modular monolith with authenticated server-rendered routes. Keep units, money, and validation in pure domain modules; keep persistence behind owner-scoped repositories; use PostgreSQL through Drizzle in production and PGlite for isolated integration tests.

**Tech Stack:** Node.js 24.x, pnpm 11.x, Next.js App Router, React, TypeScript strict mode, Tailwind CSS, Supabase SSR Auth and PostgreSQL, Drizzle ORM, Zod, Decimal.js, Vitest, Testing Library, PGlite, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-day-off-dough-os-mvp-design.md`

## Global Constraints

- Read the spec and `docs/superpowers/plans/2026-08-22-day-off-dough-os-roadmap.md` before changing code.
- The primary user is one owner identified by `OWNER_EMAIL`; do not add registration or role-management screens.
- Use Node.js 24.x and pnpm 11.x; commit `pnpm-lock.yaml`.
- Store money as integer satang; never use JavaScript floating-point arithmetic for money or quantities.
- Store quantity and conversion columns as PostgreSQL `numeric`; convert them to Decimal.js values inside domain functions.
- All master-data records are scoped by Supabase Auth user UUID in `owner_id`.
- Do not expose the database through browser-side service-role credentials.
- Use server actions only as adapters; validation and business rules belong in modules under `src/modules`.
- Use Thai UI copy for user-facing pages and English names for source identifiers.
- Support 390px phone and 1440px desktop viewports.
- Do not add Bake Cycle, Order, shopping, timeline, reporting, social, payment, or carrier features in Phase 1.
- Follow TDD: failing test, observed failure, minimal implementation, passing test, then commit.

---

## File Structure Map

```text
src/
  app/
    (app)/
      layout.tsx                 authenticated application shell
      dashboard/page.tsx        master-data readiness dashboard
      inventory/page.tsx        inventory and price-history UI
      products/page.tsx         product list UI
      products/[id]/page.tsx    recipe-version editor
      delivery/page.tsx         delivery preset UI
      settings/page.tsx         shop settings UI
    login/
      actions.ts                 login server action adapter
      page.tsx                   owner login form
    globals.css                 responsive visual tokens and base styles
    layout.tsx                  document shell
    page.tsx                    redirect to dashboard
  components/
    app-shell.tsx               responsive desktop/mobile navigation
    form-field.tsx              accessible field wrapper
    submit-button.tsx           pending-state submit button
  lib/
    auth/
      owner-policy.ts           pure owner-email policy
      require-owner.ts          authenticated owner guard
    db/
      client.ts                 production Drizzle connection
      schema.ts                 schema re-exports
    env/
      client.ts                 public environment validation
      server.ts                 server environment validation
    supabase/
      client.ts                 browser Supabase client
      proxy.ts                  cookie refresh adapter
      server.ts                 server Supabase client
    app-meta.ts                 application identity
  modules/
    units/
      domain/units.ts           dimensions and deterministic conversion
      domain/units.test.ts
    settings/
      db/schema.ts              shop settings table
      application/settings.ts   owner-scoped settings use cases
      application/settings.test.ts
    inventory/
      db/schema.ts              items, prices, and movements
      domain/cost.ts            exact pack/unit price calculations
      domain/cost.test.ts
      application/inventory.ts  owner-scoped inventory use cases
      application/inventory.test.ts
      ui/inventory-form.tsx
      ui/price-form.tsx
    products/
      db/schema.ts              products, recipes, versions, ingredients
      application/products.ts   product and recipe use cases
      application/products.test.ts
      ui/product-form.tsx
      ui/recipe-version-form.tsx
    delivery/
      db/schema.ts              delivery presets and packaging rules
      application/delivery.ts   delivery and packaging use cases
      application/delivery.test.ts
      ui/delivery-method-form.tsx
      ui/packaging-rule-form.tsx
  proxy.ts                      Next.js auth-session proxy entrypoint
tests/
  e2e/
    auth.spec.ts                route protection and login shell
    master-data.spec.ts         phone and desktop master-data flow
  fixtures/
    owner.ts                    deterministic owner fixture
  helpers/
    test-db.ts                  isolated PGlite database and migrations
drizzle/
  *.sql                         generated committed migrations
```

Files remain focused by business capability. Later phases add new module directories instead of placing Bake Cycle logic inside the master-data modules.

---

### Task 1: Project scaffold and verification harness

**Files:**

- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `.gitignore`
- Create: `tests/setup.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/lib/app-meta.ts`
- Test: `src/lib/app-meta.test.ts`

**Interfaces:**

- Consumes: Approved spec only.
- Produces: `APP_NAME: "Day Off Dough OS"`, scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:run`, `test:e2e`, `db:generate`, and a strict `@/*` import alias.

- [ ] **Step 1: Verify the bundled runtime**

Run:

```bash
export PATH="/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
node --version
pnpm --version
```

Expected: Node prints `v24.19.0` or a newer 24.x release; pnpm prints `11.19.0` or a newer 11.x release.

- [ ] **Step 2: Initialize the package and install dependencies**

Run:

```bash
pnpm init
pnpm add next@latest react@latest react-dom@latest @supabase/ssr@latest @supabase/supabase-js@latest drizzle-orm@latest postgres@latest zod@latest decimal.js@latest react-hook-form@latest @hookform/resolvers@latest lucide-react@latest
pnpm add -D typescript@latest @types/node@latest @types/react@latest @types/react-dom@latest tailwindcss@latest @tailwindcss/postcss@latest eslint@latest eslint-config-next@latest drizzle-kit@latest dotenv@latest vitest@latest jsdom@latest @vitejs/plugin-react@latest @testing-library/react@latest @testing-library/jest-dom@latest @testing-library/user-event@latest @electric-sql/pglite@latest @playwright/test@latest
pnpm pkg set private=true --json
pnpm pkg set type=module
pnpm pkg set scripts.dev="next dev"
pnpm pkg set scripts.build="next build"
pnpm pkg set scripts.lint="eslint ."
pnpm pkg set scripts.typecheck="tsc --noEmit"
pnpm pkg set scripts.test="vitest"
pnpm pkg set scripts.test:run="vitest run"
pnpm pkg set scripts.test:e2e="playwright test"
pnpm pkg set scripts.db:generate="drizzle-kit generate"
```

Expected: `package.json` and `pnpm-lock.yaml` exist and no package-install command fails.

- [ ] **Step 3: Create strict framework configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@tests/*": ["./tests/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

Create `postcss.config.mjs`:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

Create `eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", "coverage/**", "playwright-report/**", "test-results/**"]),
]);
```

Create `vitest.config.ts`:

```ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
      "@tests": path.resolve(process.cwd(), "tests"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

Create `tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3000", trace: "on-first-retry" },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

Create `.gitignore` with `.next/`, `node_modules/`, `.env*`, `!.env.example`, `coverage/`, `playwright-report/`, and `test-results/`.

- [ ] **Step 4: Write the failing application identity test**

Create `src/lib/app-meta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { APP_NAME, APP_TIMEZONE, APP_CURRENCY } from "@/lib/app-meta";

describe("application metadata", () => {
  it("uses the approved bakery identity and locale defaults", () => {
    expect(APP_NAME).toBe("Day Off Dough OS");
    expect(APP_TIMEZONE).toBe("Asia/Bangkok");
    expect(APP_CURRENCY).toBe("THB");
  });
});
```

- [ ] **Step 5: Run the test and observe the expected failure**

Run: `pnpm test:run src/lib/app-meta.test.ts`

Expected: FAIL because `@/lib/app-meta` does not exist.

- [ ] **Step 6: Add the application identity and root shell**

Create `src/lib/app-meta.ts`:

```ts
export const APP_NAME = "Day Off Dough OS";
export const APP_TIMEZONE = "Asia/Bangkok";
export const APP_CURRENCY = "THB";
```

Create `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/app-meta";
import "./globals.css";

export const metadata: Metadata = { title: APP_NAME };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
```

Create `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function HomePage(): never {
  redirect("/dashboard");
}
```

Create `src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  color-scheme: light;
  background: #f7f3ec;
  color: #342d27;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
}
```

- [ ] **Step 7: Run baseline verification**

Run:

```bash
pnpm test:run src/lib/app-meta.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all four commands exit 0.

- [ ] **Step 8: Commit the scaffold**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts playwright.config.ts .gitignore src tests
git commit -m "chore: scaffold Day Off Dough OS"
```

---

### Task 2: Exact units, quantities, and unit-cost primitives

**Files:**

- Create: `src/modules/units/domain/units.ts`
- Test: `src/modules/units/domain/units.test.ts`
- Create: `src/modules/inventory/domain/cost.ts`
- Test: `src/modules/inventory/domain/cost.test.ts`

**Interfaces:**

- Consumes: Decimal.js installed in Task 1.
- Produces: `UnitCode`, `UnitDimension`, `convertQuantity(value, from, to): Decimal`, `calculateUnitCostSatang(packPriceSatang, packBaseQuantity): Decimal`.

- [ ] **Step 1: Write failing unit-conversion tests**

Create `src/modules/units/domain/units.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { convertQuantity, UnitConversionError } from "./units";

describe("convertQuantity", () => {
  it("converts kilograms to grams exactly", () => {
    expect(convertQuantity("1.25", "kg", "g").toString()).toBe("1250");
  });

  it("converts litres to millilitres exactly", () => {
    expect(convertQuantity("0.75", "l", "ml").toString()).toBe("750");
  });

  it("rejects cross-dimension conversion", () => {
    expect(() => convertQuantity("1", "g", "ml")).toThrow(UnitConversionError);
  });
});
```

- [ ] **Step 2: Run the unit test and observe failure**

Run: `pnpm test:run src/modules/units/domain/units.test.ts`

Expected: FAIL because `units.ts` does not exist.

- [ ] **Step 3: Implement deterministic units**

Create `src/modules/units/domain/units.ts`:

```ts
import Decimal from "decimal.js";

export type UnitDimension = "mass" | "volume" | "count";
export type UnitCode = "mg" | "g" | "kg" | "ml" | "l" | "piece";

type UnitDefinition = Readonly<{
  dimension: UnitDimension;
  toBaseFactor: Decimal.Value;
}>;

const UNITS: Record<UnitCode, UnitDefinition> = {
  mg: { dimension: "mass", toBaseFactor: "0.001" },
  g: { dimension: "mass", toBaseFactor: "1" },
  kg: { dimension: "mass", toBaseFactor: "1000" },
  ml: { dimension: "volume", toBaseFactor: "1" },
  l: { dimension: "volume", toBaseFactor: "1000" },
  piece: { dimension: "count", toBaseFactor: "1" },
};

export class UnitConversionError extends Error {}

export function convertQuantity(
  value: Decimal.Value,
  from: UnitCode,
  to: UnitCode,
): Decimal {
  const source = UNITS[from];
  const target = UNITS[to];
  if (source.dimension !== target.dimension) {
    throw new UnitConversionError(`Cannot convert ${from} to ${to}`);
  }
  return new Decimal(value).mul(source.toBaseFactor).div(target.toBaseFactor);
}
```

- [ ] **Step 4: Add failing pack-price tests**

Create `src/modules/inventory/domain/cost.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calculateUnitCostSatang } from "./cost";

describe("calculateUnitCostSatang", () => {
  it("calculates satang per gram without binary floating-point drift", () => {
    expect(calculateUnitCostSatang(5500, "1000").toString()).toBe("5.5");
  });

  it("rejects an empty purchase pack", () => {
    expect(() => calculateUnitCostSatang(5500, "0")).toThrow(
      "Pack base quantity must be greater than zero",
    );
  });
});
```

- [ ] **Step 5: Implement exact unit cost**

Create `src/modules/inventory/domain/cost.ts`:

```ts
import Decimal from "decimal.js";

export function calculateUnitCostSatang(
  packPriceSatang: number,
  packBaseQuantity: Decimal.Value,
): Decimal {
  if (!Number.isSafeInteger(packPriceSatang) || packPriceSatang < 0) {
    throw new Error("Pack price must be a non-negative safe integer");
  }
  const quantity = new Decimal(packBaseQuantity);
  if (quantity.lte(0)) {
    throw new Error("Pack base quantity must be greater than zero");
  }
  return new Decimal(packPriceSatang).div(quantity);
}
```

- [ ] **Step 6: Verify and commit the primitives**

Run:

```bash
pnpm test:run src/modules/units/domain/units.test.ts src/modules/inventory/domain/cost.test.ts
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

Commit:

```bash
git add src/modules/units src/modules/inventory/domain
git commit -m "feat: add exact unit and cost primitives"
```

---

### Task 3: Owner-only Supabase authentication and protected shell

**Files:**

- Modify: `.env.example`
- Create: `src/lib/env/client.ts`
- Create: `src/lib/env/server.ts`
- Create: `src/lib/auth/owner-policy.ts`
- Test: `src/lib/auth/owner-policy.test.ts`
- Create: `src/lib/auth/require-owner.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/proxy.ts`
- Create: `src/proxy.ts`
- Create: `src/app/login/actions.ts`
- Create: `src/app/login/login-form.tsx`
- Create: `src/app/login/page.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/dashboard/page.tsx`
- Test: `tests/e2e/auth.spec.ts`

**Interfaces:**

- Consumes: Supabase SSR packages and `APP_NAME`.
- Produces: `OwnerIdentity { id: string; email: string }`, `requireOwner(): Promise<OwnerIdentity>`, and authenticated routes under `src/app/(app)`.

- [ ] **Step 1: Define environment contracts**

Add these keys to `.env.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example
SUPABASE_DATABASE_URL=postgresql://postgres.example:password@host:6543/postgres
OWNER_EMAIL=owner@example.com
```

Create `src/lib/env/client.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export function getClientEnv() {
  return schema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
```

Create `src/lib/env/server.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  SUPABASE_DATABASE_URL: z.string().url(),
  OWNER_EMAIL: z.string().email().transform((email) => email.toLowerCase()),
});

export function getServerEnv() {
  return schema.parse({
    SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
    OWNER_EMAIL: process.env.OWNER_EMAIL,
  });
}
```

Only server modules may import `getServerEnv`.

- [ ] **Step 2: Write the failing owner-policy test**

Create `src/lib/auth/owner-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertOwnerEmail, OwnerAccessError } from "./owner-policy";

describe("assertOwnerEmail", () => {
  it("normalizes and accepts the configured owner", () => {
    expect(assertOwnerEmail(" OWNER@EXAMPLE.COM ", "owner@example.com")).toBe(
      "owner@example.com",
    );
  });

  it("rejects every other account", () => {
    expect(() => assertOwnerEmail("staff@example.com", "owner@example.com")).toThrow(
      OwnerAccessError,
    );
  });
});
```

- [ ] **Step 3: Observe the test failure and implement the policy**

Run: `pnpm test:run src/lib/auth/owner-policy.test.ts`

Expected: FAIL because the policy module does not exist.

Create `src/lib/auth/owner-policy.ts`:

```ts
export class OwnerAccessError extends Error {}

export function assertOwnerEmail(sessionEmail: string, ownerEmail: string): string {
  const normalizedSession = sessionEmail.trim().toLowerCase();
  const normalizedOwner = ownerEmail.trim().toLowerCase();
  if (normalizedSession !== normalizedOwner) {
    throw new OwnerAccessError("Account is not the configured owner");
  }
  return normalizedSession;
}
```

- [ ] **Step 4: Add Supabase SSR adapters and owner guard**

Create `src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";
import { getClientEnv } from "@/lib/env/client";

export function createClient() {
  const env = getClientEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
```

Create `src/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getClientEnv } from "@/lib/env/client";

export async function createClient() {
  const env = getClientEnv();
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            return;
          }
        },
      },
    },
  );
}
```

Create `src/lib/supabase/proxy.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getClientEnv } from "@/lib/env/client";

export async function updateSession(request: NextRequest) {
  const env = getClientEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
  await supabase.auth.getClaims();
  return response;
}
```

Create `src/proxy.ts`:

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

Create `src/lib/auth/require-owner.ts` with this exported type and function:

```ts
import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";
import { assertOwnerEmail } from "./owner-policy";

export type OwnerIdentity = Readonly<{
  id: string;
  email: string;
}>;

export async function requireOwner(): Promise<OwnerIdentity> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims?.sub;
  const email = data?.claims?.email;
  if (error || typeof subject !== "string" || typeof email !== "string") {
    redirect("/login");
  }
  return { id: subject, email: assertOwnerEmail(email, getServerEnv().OWNER_EMAIL) };
}
```

- [ ] **Step 5: Add password login without public registration**

Create `src/app/login/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { assertOwnerEmail } from "@/lib/auth/owner-policy";
import { getServerEnv } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";

export type LoginState = Readonly<{ error: string | null }>;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function loginOwner(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const input = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!input.success) return { error: "กรุณากรอกอีเมลและรหัสผ่านให้ครบ" };
  try {
    assertOwnerEmail(input.data.email, getServerEnv().OWNER_EMAIL);
  } catch {
    return { error: "บัญชีนี้ไม่มีสิทธิ์เข้าใช้งาน" };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(input.data);
  if (error) return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  redirect("/dashboard");
}
```

Create a client component `src/app/login/login-form.tsx` using `useActionState(loginOwner, { error: null })`, labeled email/password inputs, an error region with `role="alert"`, and a submit button labeled `เข้าสู่ระบบ`. Render it from `src/app/login/page.tsx` below an `เข้าสู่ระบบ` heading. Do not add sign-up, password-reset, OAuth, or social-login links.

- [ ] **Step 6: Protect the application route group**

Make `src/app/(app)/layout.tsx` call `requireOwner()` before rendering children. Add a minimal `/dashboard` heading so authentication can be verified before the full shell exists.

- [ ] **Step 7: Write and run the auth browser test**

Create `tests/e2e/auth.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("redirects an anonymous visitor to the owner login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "เข้าสู่ระบบ" })).toBeVisible();
});
```

Run:

```bash
pnpm test:run src/lib/auth/owner-policy.test.ts
pnpm test:e2e tests/e2e/auth.spec.ts --project=phone
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit authentication**

```bash
git add .env.example src/lib/env src/lib/auth src/lib/supabase src/proxy.ts src/app/login 'src/app/(app)' tests/e2e/auth.spec.ts
git commit -m "feat: protect the app with owner authentication"
```

---

### Task 4: Database foundation and shop settings

**Files:**

- Create: `drizzle.config.ts`
- Create: `src/lib/db/client.ts`
- Create: `src/lib/db/types.ts`
- Create: `src/lib/db/schema.ts`
- Create: `src/modules/settings/db/schema.ts`
- Create: `src/modules/settings/application/settings.ts`
- Test: `src/modules/settings/application/settings.test.ts`
- Create: `src/modules/settings/ui/settings-form.tsx`
- Create: `tests/helpers/test-db.ts`
- Create: `tests/fixtures/owner.ts`
- Create: `drizzle/0000_shop_settings.sql`
- Create: `src/app/(app)/settings/actions.ts`
- Create: `src/app/(app)/settings/page.tsx`

**Interfaces:**

- Consumes: `OwnerIdentity.id`, PostgreSQL connection environment, unit domain types.
- Produces: `ShopSettings`, `createSettingsService(db)`, and a reusable `DatabaseClient` type.

- [ ] **Step 1: Define database and test adapters**

Create `src/lib/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/lib/env/server";
import * as schema from "@/lib/db/schema";

const queryClient = postgres(getServerEnv().SUPABASE_DATABASE_URL, { prepare: false });
export const db = drizzle(queryClient, { schema });
```

Create `src/lib/db/types.ts`:

```ts
import type { db } from "./client";

export type DatabaseClient = typeof db;
```

Create `drizzle.config.ts`:

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.SUPABASE_DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
});
```

Create `tests/fixtures/owner.ts`:

```ts
export const OWNER_ID = "00000000-0000-4000-8000-000000000001";
export const OTHER_OWNER_ID = "00000000-0000-4000-8000-000000000002";
```

Create `tests/helpers/test-db.ts` using PGlite and `drizzle-orm/pglite`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { DatabaseClient } from "@/lib/db/types";
import * as schema from "@/lib/db/schema";

export async function createTestDatabase(): Promise<{
  db: DatabaseClient;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const testDb = drizzle(client, { schema });
  await migrate(testDb, { migrationsFolder: "drizzle" });
  return {
    db: testDb as unknown as DatabaseClient,
    close: async () => client.close(),
  };
}
```

Keep the production-to-test cast in this adapter only. Application modules receive `DatabaseClient` and never import PGlite.

- [ ] **Step 2: Write the failing owner-scope settings test**

Create `src/modules/settings/application/settings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createSettingsService } from "./settings";

describe("shop settings", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => {
    await context.close();
  });

  it("keeps settings isolated by owner", async () => {
    const service = createSettingsService(context.db);
    await service.upsert("00000000-0000-4000-8000-000000000001", {
      laborRateSatangPerHour: 12000,
      timezone: "Asia/Bangkok",
      currency: "THB",
      defaultWasteAllowancePercent: "3",
    });

    expect(await service.get("00000000-0000-4000-8000-000000000002")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the settings test and observe failure**

Run: `pnpm test:run src/modules/settings/application/settings.test.ts`

Expected: FAIL because the schema and service do not exist.

- [ ] **Step 4: Implement the settings schema and service**

Define one `shop_settings` row per `owner_id` with:

```ts
export type ShopSettingsInput = Readonly<{
  laborRateSatangPerHour: number;
  timezone: "Asia/Bangkok";
  currency: "THB";
  defaultWasteAllowancePercent: string;
}>;
```

Define `shop_settings.owner_id` as a UUID primary key, money as integer, waste allowance as `numeric(7, 4)`, timezone/currency as bounded text, and `updated_at` as timestamptz. Re-export the table from `src/lib/db/schema.ts`.

Use Zod to require a safe non-negative integer labor rate and a decimal waste percentage between 0 and 100. Implement `createSettingsService(db: DatabaseClient)` returning `get(ownerId)` and `upsert(ownerId, input)`. Both functions must receive `ownerId` explicitly; no repository function may list unscoped rows.

- [ ] **Step 5: Generate and inspect the migration**

Run:

```bash
pnpm db:generate
rg -n "shop_settings|owner_id|labor_rate_satang_per_hour" drizzle
```

After generation, append `ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;` to the migration and do not create anonymous Data API policies.

Expected: migration includes a unique or primary constraint for `owner_id`, enables RLS, and has no float/double column for money or percentages.

- [ ] **Step 6: Add the authenticated settings page**

The page calls `requireOwner()`, loads settings through the service, and renders fields for labor rate, default waste allowance, timezone, and currency. The server action re-validates all fields and never trusts an owner ID submitted by the browser.

- [ ] **Step 7: Verify and commit settings**

Run:

```bash
pnpm test:run src/modules/settings/application/settings.test.ts
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

Commit:

```bash
git add drizzle.config.ts drizzle src/lib/db src/modules/settings tests/helpers tests/fixtures 'src/app/(app)/settings'
git commit -m "feat: add owner-scoped shop settings"
```

---

### Task 5: Inventory items, price history, and stock reconciliation

**Files:**

- Create: `src/modules/inventory/db/schema.ts`
- Create: `src/modules/inventory/application/inventory.ts`
- Test: `src/modules/inventory/application/inventory.test.ts`
- Create: `src/modules/inventory/ui/inventory-form.tsx`
- Create: `src/modules/inventory/ui/price-form.tsx`
- Create: `src/app/(app)/inventory/actions.ts`
- Create: `src/app/(app)/inventory/page.tsx`
- Create: `src/app/(app)/inventory/[id]/page.tsx`
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0001_inventory.sql`

**Interfaces:**

- Consumes: `DatabaseClient`, `OwnerIdentity.id`, `UnitCode`, and `calculateUnitCostSatang`.
- Produces: `InventoryItem`, `InventoryPrice`, `InventoryMovement`, `createInventoryService(db)` with `createItem`, `addPrice`, `recordCount`, `listItems`, `getItemDetail`.

- [ ] **Step 1: Write failing inventory service tests**

Create `inventory.test.ts` with this setup and these exact cases:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createInventoryService } from "./inventory";

describe("inventory service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createInventoryService>;

  beforeEach(async () => {
    context = await createTestDatabase();
    service = createInventoryService(context.db);
  });

  afterEach(async () => {
    await context.close();
  });

  it("stores price history and returns the latest effective unit cost", async () => {
    const item = await service.createItem(OWNER_ID, {
      name: "NS Wonder",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "500",
    });
    await service.addPrice(OWNER_ID, item.id, {
      packPriceSatang: 5500,
      packBaseQuantity: "1000",
      effectiveAt: new Date("2026-08-01T00:00:00+07:00"),
    });
    const detail = await service.getItemDetail(OWNER_ID, item.id);
    expect(detail.latestUnitCostSatang?.toString()).toBe("5.5");
  });

  it("reconciles a physical count without leaking another owner's stock", async () => {
    const item = await service.createItem(OWNER_ID, {
      name: "Bread bag",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก 100 ใบ",
      baseQuantityPerPurchasePack: "100",
      minimumStockQuantity: "20",
    });
    await service.recordCount(OWNER_ID, item.id, "750", new Date("2026-08-22"));
    expect((await service.getItemDetail(OWNER_ID, item.id)).stockBalance).toBe("750");
    await expect(service.getItemDetail(OTHER_OWNER_ID, item.id)).rejects.toThrow(
      "Inventory item not found",
    );
  });
});
```

- [ ] **Step 2: Run the tests and observe failure**

Run: `pnpm test:run src/modules/inventory/application/inventory.test.ts`

Expected: FAIL because inventory schema and service do not exist.

- [ ] **Step 3: Implement inventory schemas**

Create owner-scoped `inventory_items`, `inventory_prices`, and `inventory_movements` tables. Use enums matching the spec:

```ts
export const inventoryCategory = ["INGREDIENT", "PACKAGING", "CONSUMABLE"] as const;
export const inventoryMovementType = ["COUNT", "PURCHASE", "CONSUMPTION", "CORRECTION"] as const;
```

Use integer for satang, numeric strings for quantities, timestamptz for effective dates, and foreign keys that prevent an owner from attaching a price or movement to another owner's item at the application layer.

Enable RLS for all three tables in the generated migration and create no anonymous policies; application access uses the authenticated backend and explicit `ownerId` filters.

- [ ] **Step 4: Implement owner-scoped inventory use cases**

`recordCount` must read the current balance and insert a `COUNT` movement whose delta equals `counted - current` inside one transaction. `addPrice` must preserve history and never overwrite a prior price. `getItemDetail` must select the latest price effective at the requested timestamp.

- [ ] **Step 5: Generate migration and run integration tests**

Run:

```bash
pnpm db:generate
pnpm test:run src/modules/inventory/application/inventory.test.ts
```

Expected: tests pass against a fresh PGlite database migrated from committed SQL.

- [ ] **Step 6: Add inventory and price-history UI**

Build:

- `/inventory`: filterable list with name, category, balance, base unit, latest pack price, and active state.
- `/inventory/[id]`: details, price history, add-price form, and physical-count form.
- Server actions that derive owner ID from `requireOwner()` and revalidate affected paths.

On phone, display cards; on desktop, display a table. Missing prices must display `ยังไม่มีราคา`, not `฿0`.

- [ ] **Step 7: Verify and commit inventory**

Run:

```bash
pnpm test:run src/modules/inventory
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

Commit:

```bash
git add drizzle src/lib/db/schema.ts src/modules/inventory 'src/app/(app)/inventory'
git commit -m "feat: add inventory and price history"
```

---

### Task 6: Products, recipe versions, and ingredients

**Files:**

- Create: `src/modules/products/db/schema.ts`
- Create: `src/modules/products/application/products.ts`
- Test: `src/modules/products/application/products.test.ts`
- Create: `src/modules/products/ui/product-form.tsx`
- Create: `src/modules/products/ui/recipe-version-form.tsx`
- Create: `src/app/(app)/products/actions.ts`
- Create: `src/app/(app)/products/page.tsx`
- Create: `src/app/(app)/products/[id]/page.tsx`
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0002_products_recipes.sql`

**Interfaces:**

- Consumes: `DatabaseClient`, owner-scoped inventory item IDs, `UnitCode`.
- Produces: `Product`, `Recipe`, `RecipeVersion`, `RecipeIngredient`, `createProductService(db)` with `createProduct`, `createRecipeVersion`, `activateRecipeVersion`, `getProductDetail`, `listProducts`.

- [ ] **Step 1: Write failing recipe-version tests**

Create `products.test.ts` with a fresh migrated database per test:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import {
  createProductService,
  type CreateRecipeVersionInput,
} from "./products";

describe("product and recipe service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let inventoryService: ReturnType<typeof createInventoryService>;
  let productService: ReturnType<typeof createProductService>;
  let flour: { id: string };
  let product: { id: string };

  beforeEach(async () => {
    context = await createTestDatabase();
    inventoryService = createInventoryService(context.db);
    productService = createProductService(context.db);
    flour = await inventoryService.createItem(OWNER_ID, {
      name: "NS Wonder",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    product = await productService.createProduct(OWNER_ID, {
      name: "Focaccia",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 22000,
    });
  });

  afterEach(async () => context.close());

  function validInput(): CreateRecipeVersionInput {
    return {
      versionCode: "DOD-FOC-001",
      baseYieldQuantity: "1",
      yieldUnit: "piece",
      laborMinutesPerBatch: 45,
      utilityCostSatangPerBatch: 3500,
      wasteAllowancePercent: "3",
      ingredients: [{ inventoryItemId: flour.id, quantityInBaseUnit: "390" }],
      instructions: "Mix, ferment, bake, cool",
    };
  }

  it("creates an immutable recipe version with positive sellable yield", async () => {
    const version = await productService.createRecipeVersion(
      OWNER_ID,
      product.id,
      validInput(),
    );
    expect(version.versionCode).toBe("DOD-FOC-001");
  });

  it("rejects a zero base yield", async () => {
    await expect(
      productService.createRecipeVersion(OWNER_ID, product.id, {
        ...validInput(),
        baseYieldQuantity: "0",
      }),
    ).rejects.toThrow("Base yield must be greater than zero");
  });

  it("does not allow an ingredient owned by another account", async () => {
    const foreignFlour = await inventoryService.createItem(OTHER_OWNER_ID, {
      name: "Foreign flour",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    await expect(
      productService.createRecipeVersion(OWNER_ID, product.id, {
        ...validInput(),
        ingredients: [
          { inventoryItemId: foreignFlour.id, quantityInBaseUnit: "390" },
        ],
      }),
    ).rejects.toThrow("Ingredient not found");
  });
});
```

- [ ] **Step 2: Run tests and observe failure**

Run: `pnpm test:run src/modules/products/application/products.test.ts`

Expected: FAIL because product and recipe modules do not exist.

- [ ] **Step 3: Implement product and recipe schemas**

Create `products`, `recipes`, `recipe_versions`, and `recipe_ingredients`. Enforce unique product names per owner, unique version codes per recipe, positive base yield, non-negative labor/utility/waste values, and immutable ingredient/version rows after activation.

Enable RLS for all four tables in the generated migration and create no anonymous policies.

Do not delete an active version. `activateRecipeVersion` updates `products.active_recipe_version_id` only after validating that product, recipe, version, and ingredients belong to the same owner.

- [ ] **Step 4: Implement product use cases**

Use this input contract:

```ts
export type CreateRecipeVersionInput = Readonly<{
  versionCode: string;
  baseYieldQuantity: string;
  yieldUnit: UnitCode;
  laborMinutesPerBatch: number;
  utilityCostSatangPerBatch: number;
  wasteAllowancePercent: string | null;
  ingredients: ReadonlyArray<{
    inventoryItemId: string;
    quantityInBaseUnit: string;
  }>;
  instructions: string;
}>;
```

Validate with Zod, write the version and its ingredients in one transaction, and return a stable detail DTO rather than Drizzle row internals.

- [ ] **Step 5: Generate migration and run integration tests**

Run:

```bash
pnpm db:generate
pnpm test:run src/modules/products/application/products.test.ts
```

Expected: all product tests pass on a freshly migrated database.

- [ ] **Step 6: Add product and recipe-version UI**

Build product list/create UI and product detail with:

- Default selling unit and price in satang-formatted baht input.
- Version history with active badge.
- Recipe-version form with repeatable ingredient rows.
- Yield, labor minutes, utility cost, waste allowance, and instructions.
- Explicit activate-version action with confirmation.

Never edit an activated version in place; create a new version from its values.

- [ ] **Step 7: Verify and commit products**

Run:

```bash
pnpm test:run src/modules/products
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

Commit:

```bash
git add drizzle src/lib/db/schema.ts src/modules/products 'src/app/(app)/products'
git commit -m "feat: add products and recipe versions"
```

---

### Task 7: Delivery presets and packaging rules

**Files:**

- Create: `src/modules/delivery/db/schema.ts`
- Create: `src/modules/delivery/application/delivery.ts`
- Test: `src/modules/delivery/application/delivery.test.ts`
- Create: `src/modules/delivery/ui/delivery-method-form.tsx`
- Create: `src/modules/delivery/ui/packaging-rule-form.tsx`
- Create: `src/app/(app)/delivery/actions.ts`
- Create: `src/app/(app)/delivery/page.tsx`
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0003_delivery_packaging.sql`

**Interfaces:**

- Consumes: Product IDs, inventory packaging/consumable IDs, owner identity.
- Produces: `DeliveryMethod`, `ProductPackagingRule`, `createDeliveryService(db)` with `createMethod`, `updateMethod`, `createPackagingRule`, `listDeliveryConfiguration`.

- [ ] **Step 1: Write failing packaging-rule tests**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { createProductService } from "@/modules/products/application/products";
import { createDeliveryService } from "./delivery";

describe("delivery and packaging configuration", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createDeliveryService>;
  let focaccia: { id: string };
  let focacciaBag: { id: string };
  let shippingBox: { id: string };
  let flour: { id: string };
  let kex: { id: string };

  beforeEach(async () => {
    context = await createTestDatabase();
    const inventory = createInventoryService(context.db);
    const products = createProductService(context.db);
    service = createDeliveryService(context.db);
    focaccia = await products.createProduct(OWNER_ID, {
      name: "Focaccia",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 22000,
    });
    focacciaBag = await inventory.createItem(OWNER_ID, {
      name: "Focaccia bag",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก 50 ใบ",
      baseQuantityPerPurchasePack: "50",
      minimumStockQuantity: "10",
    });
    shippingBox = await inventory.createItem(OWNER_ID, {
      name: "Shipping box",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก 20 ใบ",
      baseQuantityPerPurchasePack: "20",
      minimumStockQuantity: "5",
    });
    flour = await inventory.createItem(OWNER_ID, {
      name: "Flour",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    kex = await service.createMethod(OWNER_ID, {
      name: "KEX Same Day",
      defaultCustomerFeeSatang: 12000,
      defaultInternalCostSatang: 12000,
    });
  });

  afterEach(async () => context.close());

  it("accepts a per-product-unit packaging rule", async () => {
    const rule = await service.createPackagingRule(OWNER_ID, {
      scope: "PRODUCT",
      productId: focaccia.id,
      deliveryMethodId: null,
      inventoryItemId: focacciaBag.id,
      consumptionBasis: "PER_PRODUCT_UNIT",
      quantityInBaseUnit: "1",
    });
    expect(rule.consumptionBasis).toBe("PER_PRODUCT_UNIT");
  });

  it("rejects a delivery rule with a product-only basis", async () => {
    await expect(
      service.createPackagingRule(OWNER_ID, {
        scope: "DELIVERY_METHOD",
        productId: null,
        deliveryMethodId: kex.id,
        inventoryItemId: shippingBox.id,
        consumptionBasis: "PER_PRODUCT_UNIT",
        quantityInBaseUnit: "1",
      }),
    ).rejects.toThrow("Invalid packaging rule combination");
  });

  it("rejects ingredient inventory as packaging", async () => {
    await expect(
      service.createPackagingRule(OWNER_ID, {
        scope: "PRODUCT",
        productId: focaccia.id,
        deliveryMethodId: null,
        inventoryItemId: flour.id,
        consumptionBasis: "PER_PRODUCT_UNIT",
        quantityInBaseUnit: "1",
      }),
    ).rejects.toThrow("Packaging item must be PACKAGING or CONSUMABLE");
  });
});
```

- [ ] **Step 2: Run tests and observe failure**

Run: `pnpm test:run src/modules/delivery/application/delivery.test.ts`

Expected: FAIL because the delivery module does not exist.

- [ ] **Step 3: Implement schema and exact validation matrix**

Create owner-scoped delivery methods with default customer fee and internal cost as non-negative integer satang. Create packaging rules and allow only:

```ts
const VALID_PACKAGING_COMBINATIONS = [
  ["PRODUCT", "PER_PRODUCT_UNIT"],
  ["PRODUCT", "PER_ORDER"],
  ["DELIVERY_METHOD", "PER_DELIVERY"],
] as const;
```

Require exactly one of `productId` and `deliveryMethodId` based on scope. Reject ingredient inventory items.

Enable RLS for delivery and packaging tables in the generated migration and create no anonymous policies.

- [ ] **Step 4: Generate migration and run service tests**

Run:

```bash
pnpm db:generate
pnpm test:run src/modules/delivery/application/delivery.test.ts
```

Expected: all delivery tests pass.

- [ ] **Step 5: Build delivery and packaging configuration UI**

Create `/delivery` with delivery presets and packaging rules. Provide initial seed guidance in the empty state for Delivery and KEX Same Day, but do not insert prices without owner confirmation. Both default customer fee and internal cost remain editable.

- [ ] **Step 6: Verify and commit delivery configuration**

Run:

```bash
pnpm test:run src/modules/delivery
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

Commit:

```bash
git add drizzle src/lib/db/schema.ts src/modules/delivery 'src/app/(app)/delivery'
git commit -m "feat: add delivery and packaging presets"
```

---

### Task 8: Responsive application shell and readiness dashboard

**Files:**

- Create: `src/components/app-shell.tsx`
- Create: `src/components/form-field.tsx`
- Create: `src/components/submit-button.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/app-shell.test.tsx`

**Interfaces:**

- Consumes: Authenticated route group and master-data list/count services.
- Produces: Global routes `/dashboard`, `/inventory`, `/products`, `/delivery`, `/settings` with phone bottom navigation and desktop sidebar.

- [ ] **Step 1: Write the failing navigation component test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("exposes all Phase 1 destinations with accessible names", () => {
    render(<AppShell currentPath="/dashboard"><div>content</div></AppShell>);
    expect(screen.getAllByRole("link", { name: "หน้าหลัก" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "วัตถุดิบ" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "สินค้าและสูตร" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "การจัดส่ง" }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test and observe failure**

Run: `pnpm test:run src/components/app-shell.test.tsx`

Expected: FAIL because `AppShell` does not exist.

- [ ] **Step 3: Implement calm responsive navigation**

Use semantic navigation, visible focus states, 44px minimum touch targets, warm neutral background, one restrained accent color, and no mascot. Render a fixed bottom bar below 768px and a sidebar at 768px and above.

Do not duplicate navigation data; define one typed route array and render it into both layouts.

- [ ] **Step 4: Implement the master-data readiness dashboard**

Load owner-scoped counts and render these cards:

- ตั้งค่าร้าน
- วัตถุดิบและบรรจุภัณฑ์
- สินค้า
- สูตรที่เปิดใช้งาน
- วิธีจัดส่ง

Each card links to its setup page and shows `พร้อม` or the specific missing count. Do not show Bake Cycle or sales analytics in Phase 1.

When settings, at least one inventory item with a price, at least one product with an active recipe, and at least one delivery method all exist, show the exact message `ข้อมูลตั้งต้นพร้อมใช้งาน`.

- [ ] **Step 5: Verify component and responsive build**

Run:

```bash
pnpm test:run src/components/app-shell.test.tsx
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the shell**

```bash
git add src/components 'src/app/(app)' src/app/globals.css
git commit -m "feat: add responsive master-data shell"
```

---

### Task 9: Phase 1 end-to-end verification and handoff

**Files:**

- Create: `tests/e2e/master-data.spec.ts`
- Modify: `tests/fixtures/owner.ts`
- Create: `README.md`
- Modify: `.env.example`

**Interfaces:**

- Consumes: All Phase 1 UI and application services.
- Produces: A repeatable authenticated smoke flow and setup documentation for Phase 2.

- [ ] **Step 1: Add deterministic owner test setup**

Document two supported E2E modes in `README.md`:

1. Local Supabase project with a pre-created `OWNER_EMAIL` user.
2. Remote development Supabase project using non-production credentials.

The test setup must read `E2E_OWNER_EMAIL` and `E2E_OWNER_PASSWORD`. Do not commit credentials and do not provide a public sign-up route.

- [ ] **Step 2: Write the failing master-data browser flow**

Create `tests/e2e/master-data.spec.ts` covering this exact sequence:

```ts
import { expect, test } from "@playwright/test";
import {
  addInventoryPrice,
  createDeliveryMethod,
  createInventoryItem,
  createProduct,
  createRecipeVersion,
  loginAsOwner,
} from "../fixtures/owner";

test("owner prepares the bakery master data", async ({ page }) => {
  await loginAsOwner(page);
  await createInventoryItem(page, {
    name: "NS Wonder",
    category: "INGREDIENT",
    purchaseLabel: "ถุง 1 kg",
    packQuantity: "1000",
  });
  await addInventoryPrice(page, "NS Wonder", { packPriceBaht: "55" });
  await createProduct(page, { name: "Focaccia", sellingPriceBaht: "220" });
  await createRecipeVersion(page, "Focaccia", {
    versionCode: "DOD-FOC-001",
    yieldQuantity: "1",
    ingredientName: "NS Wonder",
    ingredientQuantity: "390",
  });
  await createDeliveryMethod(page, {
    name: "KEX Same Day",
    customerFeeBaht: "120",
    internalCostBaht: "120",
  });
  await expect(page.getByText("ข้อมูลตั้งต้นพร้อมใช้งาน")).toBeVisible();
});
```

Add these role- and label-based helpers to `tests/fixtures/owner.ts`:

```ts
import { expect, type Page } from "@playwright/test";

function requiredEnv(name: "E2E_OWNER_EMAIL" | "E2E_OWNER_PASSWORD"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for authenticated E2E tests`);
  return value;
}

export async function loginAsOwner(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(requiredEnv("E2E_OWNER_EMAIL"));
  await page.getByLabel("รหัสผ่าน").fill(requiredEnv("E2E_OWNER_PASSWORD"));
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function createInventoryItem(
  page: Page,
  input: Readonly<{
    name: string;
    category: "INGREDIENT" | "PACKAGING" | "CONSUMABLE";
    purchaseLabel: string;
    packQuantity: string;
  }>,
): Promise<void> {
  await page.getByRole("link", { name: "วัตถุดิบ" }).first().click();
  await page.getByRole("button", { name: "เพิ่มรายการ" }).click();
  await page.getByLabel("ชื่อรายการ").fill(input.name);
  await page.getByLabel("ประเภท").selectOption(input.category);
  await page.getByLabel("หน่วยฐาน").selectOption("g");
  await page.getByLabel("ชื่อหน่วยซื้อ").fill(input.purchaseLabel);
  await page.getByLabel("ปริมาณต่อแพ็ก").fill(input.packQuantity);
  await page.getByRole("button", { name: "บันทึกรายการ" }).click();
  await expect(page.getByText(input.name)).toBeVisible();
}

export async function addInventoryPrice(
  page: Page,
  itemName: string,
  input: Readonly<{ packPriceBaht: string }>,
): Promise<void> {
  await page.getByRole("link", { name: itemName }).click();
  await page.getByLabel("ราคาต่อแพ็ก").fill(input.packPriceBaht);
  await page.getByRole("button", { name: "บันทึกราคา" }).click();
  await expect(page.getByText(`฿${input.packPriceBaht}`)).toBeVisible();
}

export async function createProduct(
  page: Page,
  input: Readonly<{ name: string; sellingPriceBaht: string }>,
): Promise<void> {
  await page.getByRole("link", { name: "สินค้าและสูตร" }).first().click();
  await page.getByRole("button", { name: "เพิ่มสินค้า" }).click();
  await page.getByLabel("ชื่อสินค้า").fill(input.name);
  await page.getByLabel("หน่วยขาย").selectOption("piece");
  await page.getByLabel("ราคาขาย").fill(input.sellingPriceBaht);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
}

export async function createRecipeVersion(
  page: Page,
  productName: string,
  input: Readonly<{
    versionCode: string;
    yieldQuantity: string;
    ingredientName: string;
    ingredientQuantity: string;
  }>,
): Promise<void> {
  await page.getByRole("link", { name: productName }).click();
  await page.getByRole("button", { name: "เพิ่มเวอร์ชันสูตร" }).click();
  await page.getByLabel("รหัสเวอร์ชัน").fill(input.versionCode);
  await page.getByLabel("ผลผลิตต่อสูตร").fill(input.yieldQuantity);
  await page.getByLabel("วัตถุดิบ 1").selectOption({ label: input.ingredientName });
  await page.getByLabel("ปริมาณวัตถุดิบ 1").fill(input.ingredientQuantity);
  await page.getByRole("button", { name: "บันทึกเวอร์ชันสูตร" }).click();
  await page.getByRole("button", { name: "เปิดใช้เวอร์ชันนี้" }).click();
  await expect(page.getByText("สูตรที่ใช้งานอยู่")).toBeVisible();
}

export async function createDeliveryMethod(
  page: Page,
  input: Readonly<{
    name: string;
    customerFeeBaht: string;
    internalCostBaht: string;
  }>,
): Promise<void> {
  await page.getByRole("link", { name: "การจัดส่ง" }).first().click();
  await page.getByRole("button", { name: "เพิ่มวิธีส่ง" }).click();
  await page.getByLabel("ชื่อวิธีส่ง").fill(input.name);
  await page.getByLabel("ค่าส่งที่เรียกเก็บ").fill(input.customerFeeBaht);
  await page.getByLabel("ต้นทุนขนส่ง").fill(input.internalCostBaht);
  await page.getByRole("button", { name: "บันทึกวิธีส่ง" }).click();
  await expect(page.getByText(input.name)).toBeVisible();
}
```

Do not use CSS-class selectors. The UI tasks above must preserve these accessible labels unless the test and UI are changed together in the same reviewed commit.

- [ ] **Step 3: Run phone and desktop E2E tests**

Run:

```bash
pnpm test:e2e tests/e2e/auth.spec.ts tests/e2e/master-data.spec.ts --project=phone
pnpm test:e2e tests/e2e/master-data.spec.ts --project=desktop
```

Expected: all browser tests pass. Capture a trace on first retry only.

- [ ] **Step 4: Run the full Phase 1 gate**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm test:e2e --project=phone
pnpm test:e2e --project=desktop
```

Expected: every command exits 0 with no skipped business-critical test.

- [ ] **Step 5: Confirm migration reproducibility**

Create a fresh PGlite test database, apply every migration from `drizzle/`, and run all application integration tests. Expected: no manual SQL step is required.

- [ ] **Step 6: Commit the Phase 1 gate**

```bash
git add tests README.md .env.example
git commit -m "test: verify Phase 1 master-data workflow"
```

- [ ] **Step 7: Record Phase 1 completion evidence**

Add the exact command output summary and commit SHA to the execution handoff. Do not mark Phase 1 complete if any command above was not run or failed.
