"use client";

import {
  Boxes,
  CalendarRange,
  ClipboardList,
  Ellipsis,
  House,
  PackageOpen,
  Settings,
  Truck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/app-meta";

const DESKTOP_ROUTES = [
  "/dashboard",
  "/cycles",
  "/orders",
  "/customers",
  "/inventory",
  "/products",
  "/production/templates",
  "/delivery",
  "/settings",
] as const;

const MOBILE_ROUTES = [
  "/dashboard",
  "/cycles",
  "/orders",
  "/inventory",
  "/more",
] as const;

type RouteHref =
  | (typeof DESKTOP_ROUTES)[number]
  | (typeof MOBILE_ROUTES)[number];

type AppRoute = Readonly<{
  href: RouteHref;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}>;

const ROUTE_META: Readonly<Record<RouteHref, AppRoute>> = {
  "/dashboard": {
    href: "/dashboard",
    label: "หน้าหลัก",
    shortLabel: "หน้าหลัก",
    icon: House,
  },
  "/cycles": {
    href: "/cycles",
    label: "รอบผลิต",
    shortLabel: "รอบผลิต",
    icon: CalendarRange,
  },
  "/orders": {
    href: "/orders",
    label: "ออเดอร์",
    shortLabel: "ออเดอร์",
    icon: ClipboardList,
  },
  "/customers": {
    href: "/customers",
    label: "ลูกค้า",
    shortLabel: "ลูกค้า",
    icon: UsersRound,
  },
  "/inventory": {
    href: "/inventory",
    label: "วัตถุดิบ",
    shortLabel: "วัตถุดิบ",
    icon: Boxes,
  },
  "/products": {
    href: "/products",
    label: "สินค้าและสูตร",
    shortLabel: "สินค้า",
    icon: PackageOpen,
  },
  "/production/templates": {
    href: "/production/templates",
    label: "เทมเพลตการผลิต",
    shortLabel: "เทมเพลต",
    icon: ClipboardList,
  },
  "/delivery": {
    href: "/delivery",
    label: "การจัดส่ง",
    shortLabel: "จัดส่ง",
    icon: Truck,
  },
  "/settings": {
    href: "/settings",
    label: "ตั้งค่าร้าน",
    shortLabel: "ตั้งค่า",
    icon: Settings,
  },
  "/more": {
    href: "/more",
    label: "เพิ่มเติม",
    shortLabel: "เพิ่มเติม",
    icon: Ellipsis,
  },
};

const MORE_DESTINATIONS = [
  "/customers",
  "/products",
  "/production/templates",
  "/delivery",
  "/settings",
] as const;

function isCurrentRoute(currentPath: string, href: RouteHref): boolean {
  if (href === "/more") {
    return (
      currentPath === href ||
      currentPath.startsWith(`${href}/`) ||
      MORE_DESTINATIONS.some(
        (destination) =>
          currentPath === destination ||
          currentPath.startsWith(`${destination}/`),
      )
    );
  }
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

function Shell({
  children,
  currentPath,
}: Readonly<{ children: ReactNode; currentPath: string }>) {
  return (
    <div className="min-h-screen bg-[#f7f3ec] text-stone-800">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-stone-200 bg-[#fffdf9] px-5 py-7 md:flex md:flex-col">
        <Link className="rounded-xl px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700" href="/dashboard">
          <span className="block text-xs font-bold uppercase tracking-[0.18em] text-amber-800">Bakery back office</span>
          <span className="mt-1 block text-xl font-bold tracking-tight text-stone-900">{APP_NAME}</span>
        </Link>
        <nav aria-label="เมนูหลัก" className="mt-8 grid gap-2">
          {DESKTOP_ROUTES.map((href) => {
            const route = ROUTE_META[href];
            const active = isCurrentRoute(currentPath, route.href);
            const Icon = route.icon;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 ${active ? "bg-amber-100 text-amber-950" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}
                href={route.href}
                key={route.href}
              >
                <Icon aria-hidden="true" size={20} strokeWidth={1.9} />
                {route.label}
              </Link>
            );
          })}
        </nav>
        <p className="mt-auto rounded-2xl bg-stone-100 px-4 py-3 text-xs leading-5 text-stone-500">ระบบภายในสำหรับเจ้าของร้าน</p>
      </aside>

      <div className="pb-24 md:pb-0 md:pl-72">{children}</div>

      <nav aria-label="เมนูมือถือ" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white/95 px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur md:hidden">
        {MOBILE_ROUTES.map((href) => {
          const route = ROUTE_META[href];
          const active = isCurrentRoute(currentPath, route.href);
          const Icon = route.icon;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              aria-label={route.label}
              className={`flex min-h-14 min-w-11 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.68rem] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 ${active ? "text-amber-900" : "text-stone-500"}`}
              href={route.href}
              key={route.href}
            >
              <Icon aria-hidden="true" size={21} strokeWidth={active ? 2.3 : 1.8} />
              <span aria-hidden="true">{route.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function PathAwareShell({ children }: Readonly<{ children: ReactNode }>) {
  return <Shell currentPath={usePathname()}>{children}</Shell>;
}

export function AppShell({
  children,
  currentPath,
}: Readonly<{ children: ReactNode; currentPath?: string }>) {
  return currentPath ? (
    <Shell currentPath={currentPath}>{children}</Shell>
  ) : (
    <PathAwareShell>{children}</PathAwareShell>
  );
}
