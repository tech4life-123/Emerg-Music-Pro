import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { NotConfigured } from "@/components/states/States";
import { evaluateAccess, getViewer } from "@/lib/auth/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

/**
 * Server-side gate for the whole admin area. Anyone who is not an administrator (signed out, listener, artist) gets the
 * ordinary 404, so the area does not advertise itself. Queries below also run as the user, so RLS says no again if this were bypassed.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = evaluateAccess(await getViewer(), ["admin"]);
  if (!access.ok) {
    if (access.reason === "unconfigured") return (<><h1>Administration</h1><NotConfigured what="The admin area" /></>);
    notFound();
  }
  return (<><p className="muted"><Link href="/">Back to the app</Link></p><h1>Administration</h1><AdminNav />{children}</>);
}
