import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { NotConfigured } from "@/components/states/States";
import { evaluateAccess, getViewer } from "@/lib/auth/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Application review", robots: { index: false, follow: false } };

/** Staff (administrators and moderators) only. Everyone else gets the ordinary 404; queries run as the user, so RLS says no again. */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const access = evaluateAccess(await getViewer(), ["admin", "moderator"]);
  if (!access.ok) {
    if (access.reason === "unconfigured") return (<><h1>Application review</h1><NotConfigured what="Application review" /></>);
    notFound();
  }
  const isAdmin = access.viewer.roles.includes("admin");
  return (<>{isAdmin ? <p className="muted"><Link href="/admin">Back to Administration</Link></p> : null}<h1>Application review</h1>{children}</>);
}
