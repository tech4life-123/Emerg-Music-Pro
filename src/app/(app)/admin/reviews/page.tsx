import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/states/States";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review queue" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const db = (await createUserClient())!;
  const { data, error } = await db.from("releases").select("id,title,type,created_at,artists(name)").eq("status", "in_review").order("created_at");
  if (error) return <ErrorState />;
  if (!data?.length) return <EmptyState title="Nothing to review">Releases submitted by artists appear here.</EmptyState>;
  return (
    <ul className="panel-list">
      {data.map((r) => {
        const a = Array.isArray(r.artists) ? r.artists[0] : r.artists;
        return <li key={r.id}><Link href={`/admin/releases/${r.id}`}><strong>{r.title}</strong></Link> <span className="muted">{r.type} by {a?.name ?? "unknown"}</span></li>;
      })}
    </ul>
  );
}
