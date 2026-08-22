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
