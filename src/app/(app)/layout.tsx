import type { ReactNode } from "react";
import { SampleBanner } from "@/components/catalog/Catalog";
import { AppShell } from "@/components/shell/AppShell";
import { getCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const catalog = await getCatalog();
  return (
    <>
      {catalog?.source === "sample" ? <SampleBanner /> : null}
      <AppShell>{children}</AppShell>
    </>
  );
}
