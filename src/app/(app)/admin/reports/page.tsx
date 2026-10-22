import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/ActionForm";
import { EmptyState, ErrorState } from "@/components/states/States";
import { resolveReportAction } from "@/lib/admin/actions";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Copyright reports" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const db = (await createUserClient())!;
  const { data, error } = await db.from("copyright_reports").select("id,release_id,track_id,reporter_name,reporter_email,description,status,resolution_note,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) return <ErrorState />;
  if (!data?.length) return <EmptyState title="No copyright reports">Reports sent through the public form appear here.</EmptyState>;
  return (
    <ul className="panel-list">
      {data.map((r) => (
        <li key={r.id}>
          <span className={`status-chip status-${r.status}`}>{r.status.replace("_", " ")}</span>
          <p>{r.description}</p>
          <p className="muted">From {r.reporter_name} ({r.reporter_email}) on {new Date(r.created_at).toLocaleDateString()}{r.release_id ? <> · <Link href={`/admin/releases/${r.release_id}`}>Open release</Link></> : null}</p>
          {r.resolution_note ? <p className="muted">Resolution: {r.resolution_note}</p> : null}
          {r.status === "received" || r.status === "under_review" ? (
            <ActionForm action={resolveReportAction} hidden={{ id: r.id }} choiceName="status" reasonLabel="Note (recorded with the decision)" reasonRequired
              choices={[...(r.status === "received" ? [{ value: "under_review", label: "Mark under review" }] : []), { value: "upheld", label: "Uphold", danger: true }, { value: "dismissed", label: "Dismiss" }]} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
