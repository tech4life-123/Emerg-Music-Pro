import type { Metadata } from "next";
import { EmptyState, NotConfigured, PermissionDenied } from "@/components/states/States";
import { evaluateAccess, getViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Artist studio" };
export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const access = evaluateAccess(await getViewer(), ["artist", "admin"]);
  return (
    <>
      <h1>Artist studio</h1>
      {access.ok ? (
        <EmptyState title="The studio is not built yet">
          You have artist access. The upload wizard, rights declarations and release status arrive in a later phase.
        </EmptyState>
      ) : access.reason === "unconfigured" ? (
        <NotConfigured what="The artist studio" />
      ) : access.reason === "anonymous" ? (
        <PermissionDenied title="Sign in to use the studio">The artist studio is for signed-in artists and their managers.</PermissionDenied>
      ) : (
        <PermissionDenied title="Artist access required">Your account is not linked to an artist profile yet.</PermissionDenied>
      )}
    </>
  );
}
