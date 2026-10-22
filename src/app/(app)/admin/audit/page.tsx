import type { Metadata } from "next";
import { EmptyState, ErrorState } from "@/components/states/States";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const action = ((await searchParams).action ?? "").replace(/[^a-z_.:-]/gi, "").slice(0, 60);
  const db = (await createUserClient())!;
  let q = db.from("audit_log").select("id,actor_id,action,target_type,target_id,detail,created_at").order("id", { ascending: false }).limit(100);
  if (action) q = q.ilike("action", `%${action}%`);
  const { data, error } = await q;
  if (error) return <ErrorState />;
  return (
    <>
      <form className="search-form" role="search" aria-label="Filter audit log"><input name="action" defaultValue={action} placeholder="Filter by action, e.g. takedown" aria-label="Action filter" /></form>
      {!data?.length ? <EmptyState title="No entries">Nothing matches.</EmptyState> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.created_at).toLocaleString()}</td><td>{a.action}</td>
                  <td>{a.target_type} <code>{String(a.target_id).slice(0, 8)}</code></td>
                  <td><code>{a.detail ? JSON.stringify(a.detail).slice(0, 160) : ""}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
