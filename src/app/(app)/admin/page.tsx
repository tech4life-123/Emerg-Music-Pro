import type { Metadata } from "next";
import Link from "next/link";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const db = (await createUserClient())!;
  const count = async (table: string, col: string, val: string) =>
    (await db.from(table).select("id", { count: "exact", head: true }).eq(col, val)).count ?? 0;
  const [apps, review, reports] = await Promise.all([
    count("artist_applications", "status", "pending"), count("releases", "status", "in_review"), count("copyright_reports", "status", "received"),
  ]);
  const items: [string, number, string][] = [["Applications waiting", apps, "/staff/applications"], ["Releases in review", review, "/admin/reviews"], ["New copyright reports", reports, "/admin/reports"]];
  return (
    <ul className="panel-list">
      {items.map(([label, n, href]) => <li key={href}><Link href={href}><strong>{n}</strong> {label}</Link></li>)}
    </ul>
  );
}
