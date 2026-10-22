import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, ErrorState, LoadingState, NotConfigured, PermissionDenied } from "@/components/states/States";

/** Visual check of every state component. Not available in production builds. */
export default function StatesPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AppShell>
      <h1>State components (dev only)</h1>
      <div style={{ display: "grid", gap: "1.5rem" }}>
        <LoadingState label="Loading example" />
        <EmptyState title="Empty">Nothing to show yet.</EmptyState>
        <ErrorState>Example error message.</ErrorState>
        <PermissionDenied />
        <NotConfigured />
      </div>
    </AppShell>
  );
}
