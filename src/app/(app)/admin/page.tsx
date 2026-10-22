import type { Metadata } from "next";
import { EmptyState, NotConfigured, PermissionDenied } from "@/components/states/States";
import { evaluateAccess, getViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const access = evaluateAccess(await getViewer(), ["admin"]);
  return (
    <>
      <h1>Administration</h1>
      {access.ok ? (
        <EmptyState title="The admin dashboard is not built yet">
          You have staff access. The review queue, rights cases and audit log arrive in a later phase.
        </EmptyState>
      ) : access.reason === "unconfigured" ? (
        <NotConfigured what="The admin area" />
      ) : (
        <PermissionDenied title="Admin access required">This area is only for administrators.</PermissionDenied>
      )}
    </>
  );
}
