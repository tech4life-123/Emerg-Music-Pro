import type { ReactNode } from "react";
import { AlertIcon, LockIcon, MusicIcon, PlugIcon } from "@/components/icons";

function Panel({ tone, icon, title, children, role }: { tone?: string; icon: ReactNode; title: string; children?: ReactNode; role?: "status" | "alert" }) {
  return (
    <section className={`state ${tone ?? ""}`} role={role} aria-live={role === "alert" ? "assertive" : undefined}>
      <div className="state-icon">{icon}</div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Nothing here yet. Says WHY it is empty and, where one exists, what the real next step is. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Panel tone="state-empty" icon={<MusicIcon />} title={title}>
      {children ? <p>{children}</p> : null}
      {action}
    </Panel>
  );
}

/** A recoverable failure. Only pass `onRetry` when retrying can actually help (e.g. from an error boundary). */
export function ErrorState({ title = "Something went wrong", children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <Panel tone="state-error" icon={<AlertIcon />} title={title} role="alert">
      <p>{children ?? "We could not load this right now. Nothing was changed."}</p>
      {onRetry ? (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </Panel>
  );
}

/** The viewer is signed in (or not) but is not allowed here. Never reveals what exists behind the wall. */
export function PermissionDenied({ title = "You don't have access to this page", children }: { title?: string; children?: ReactNode }) {
  return (
    <Panel tone="state-denied" icon={<LockIcon />} title={title}>
      <p>{children ?? "Your account does not have the role this area needs."}</p>
    </Panel>
  );
}

/** The backend is not connected in this environment. Honest about it instead of showing fake data. */
export function NotConfigured({ what = "Accounts and the catalog" }: { what?: string }) {
  return (
    <Panel tone="state-empty" icon={<PlugIcon />} title="Backend not connected">
      <p>
        {what} need a Supabase project, and none is configured for this environment. See the README for the two environment variables to set.
      </p>
    </Panel>
  );
}

/** Skeleton placeholder. `label` is announced to screen readers. */
export function LoadingState({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label}…</span>
      <div className="grid" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 160 }} />
        ))}
      </div>
    </div>
  );
}
