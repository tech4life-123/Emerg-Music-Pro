import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/ActionForm";
import { EmptyState, ErrorState } from "@/components/states/States";
import { decideApplicationAction } from "@/lib/admin/actions";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const db = (await createUserClient())!;
  const { data, error } = await db.from("artist_applications").select("id,artist_name,bio,links,created_at").eq("status", "pending").order("created_at");
  if (error) return <ErrorState />;
  if (!data?.length) return <EmptyState title="No applications waiting">New artist applications appear here.</EmptyState>;
  return (
    <ul className="panel-list">
      {data.map((a) => (
        <li key={a.id}>
          <h2>{a.artist_name}</h2>
          {a.bio ? <p>{a.bio}</p> : null}
          {a.links?.length ? <ul>{a.links.map((l: string) => <li key={l}>{l}</li>)}</ul> : null}
          <p className="muted">Applied {new Date(a.created_at).toLocaleDateString()}</p>
          <ActionForm action={decideApplicationAction} hidden={{ id: a.id }} choiceName="decision" reasonLabel="Reason (required to reject)"
            choices={[{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject", danger: true }]} />
        </li>
      ))}
    </ul>
  );
}
