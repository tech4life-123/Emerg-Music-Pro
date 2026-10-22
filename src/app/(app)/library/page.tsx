import type { Metadata } from "next";
import { EmptyState, NotConfigured } from "@/components/states/States";
import { getViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Library" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const viewer = await getViewer();
  return (
    <>
      <h1>Library</h1>
      {viewer.status === "unconfigured" ? (
        <NotConfigured />
      ) : viewer.status === "anonymous" ? (
        <EmptyState title="Sign-in is not available yet">
          Accounts, likes, follows and playlists arrive in a later phase. Nothing is saved for you in this build.
        </EmptyState>
      ) : (
        <EmptyState title="Nothing here yet">This area is not built yet. You are signed in, and your data is private to you.</EmptyState>
      )}
    </>
  );
}
