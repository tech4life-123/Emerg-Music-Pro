import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { NotConfigured, PermissionDenied } from "@/components/states/States";
import { evaluateAccess, getViewer } from "@/lib/auth/viewer";

export const dynamic = "force-dynamic";

/** Server-side gate for the whole admin area. Queries below also run as the user, so RLS says no again if this were bypassed. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = evaluateAccess(await getViewer(), ["admin"]);
  if (!access.ok) {
    return (
      <>
        <h1>Administration</h1>
        {access.reason === "unconfigured" ? <NotConfigured what="The admin area" /> : <PermissionDenied title="Admin access required">This area is only for administrators.</PermissionDenied>}
      </>
    );
  }
  return (<><h1>Administration</h1><AdminNav />{children}</>);
}
