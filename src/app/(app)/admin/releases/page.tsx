import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/states/States";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Releases" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const db = (await createUserClient())!;
  const { data, error } = await db.from("releases").select("id,title,type,status,artists(name)").in("status", ["published", "removed", "in_review"]).order("updated_at", { ascending: false }).limit(100);
  if (error) return <ErrorState />;
  if (!data?.length) return <EmptyState title="No releases yet">Published and removed releases are listed here.</EmptyState>;
  return (
    <ul className="panel-list">
      {data.map((r) => {
        const a = Array.isArray(r.artists) ? r.artists[0] : r.artists;
        return <li key={r.id}><Link href={`/admin/releases/${r.id}`}><strong>{r.title}</strong></Link> <span className={`status-chip status-${r.status}`}>{r.status.replace("_", " ")}</span> <span className="muted">{r.type} by {a?.name ?? "unknown"}</span></li>;
      })}
    </ul>
  );
}
