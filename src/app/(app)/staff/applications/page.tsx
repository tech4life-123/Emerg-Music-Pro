import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/ActionForm";
import { EmptyState, ErrorState } from "@/components/states/States";
import { decideApplicationAction, requestInfoAction, startReviewAction } from "@/lib/admin/actions";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { pending: "Submitted", under_review: "Under review", info_requested: "Waiting for applicant" };

export default async function Page() {
  const db = (await createUserClient())!;
  const { data, error } = await db
    .from("artist_applications")
    .select("id,artist_name,bio,links,status,artist_type,country,hometown,contact_email,genre_id,submitted_at,created_at")
    .in("status", ["pending", "under_review", "info_requested"])
    .order("created_at");
  if (error) return <ErrorState />;
  if (!data?.length) return <EmptyState title="No applications waiting">New artist applications appear here once they are submitted.</EmptyState>;
  const ids = data.map((a) => a.id as string);
  const [{ data: msgs }, { data: genres }] = await Promise.all([
    db.from("application_messages").select("application_id,from_staff,body,created_at").in("application_id", ids).order("created_at"),
    db.from("genres").select("id,name"),
  ]);
  const genreName = new Map((genres ?? []).map((g) => [g.id as string, g.name as string]));
  return (
    <ul className="panel-list">
      {data.map((a) => {
        const thread = (msgs ?? []).filter((m) => m.application_id === a.id);
        return (
          <li key={a.id}>
            <h2>{a.artist_name} <span className={`status-chip status-${a.status}`}>{LABEL[a.status as string] ?? a.status}</span></h2>
            <p className="muted">
              {[a.artist_type, a.country, a.hometown, a.genre_id ? genreName.get(a.genre_id as string) : null].filter(Boolean).join(" · ") || "No details given"}
              {a.contact_email ? ` · ${a.contact_email}` : ""}
            </p>
            {a.bio ? <p>{a.bio}</p> : null}
            {a.links?.length ? <ul>{a.links.map((l: string) => <li key={l}>{l}</li>)}</ul> : null}
            <p className="muted">Applied {new Date(a.created_at).toLocaleDateString()}</p>
            {thread.length ? (
              <ul aria-label="Messages">
                {thread.map((m, i) => <li key={i}><strong>{m.from_staff ? "Staff" : "Applicant"}:</strong> {m.body}</li>)}
              </ul>
            ) : null}
            {a.status === "pending" ? <ActionForm action={startReviewAction} hidden={{ id: a.id }} choiceName="go" choices={[{ value: "start", label: "Start review" }]} /> : null}
            {a.status !== "info_requested" ? (
              <ActionForm action={requestInfoAction} hidden={{ id: a.id }} choiceName="go" reasonLabel="Ask the applicant for more information" reasonRequired
                choices={[{ value: "ask", label: "Request information" }]} />
            ) : null}
            <ActionForm action={decideApplicationAction} hidden={{ id: a.id }} choiceName="decision" reasonLabel="Reason (required to reject)"
              choices={[{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject", danger: true }]} />
          </li>
        );
      })}
    </ul>
  );
}
