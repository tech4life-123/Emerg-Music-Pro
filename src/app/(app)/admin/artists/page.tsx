import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/ActionForm";
import { EmptyState, ErrorState } from "@/components/states/States";
import { setArtistVerifiedAction } from "@/lib/admin/actions";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Artists" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const db = (await createUserClient())!;
  const { data, error } = await db.from("artists").select("id,name,slug,verified_at").eq("status", "approved").order("name");
  if (error) return <ErrorState />;
  if (!data?.length) return <EmptyState title="No artists yet">Approved artists appear here.</EmptyState>;
  return (
    <>
      <h1>Artists</h1>
      <p className="muted">A verified badge tells listeners that we have checked the artist is who they say they are.</p>
      <ul className="panel-list">
        {data.map((a) => (
          <li key={a.id}>
            <Link href={`/artists/${a.slug}`}><strong>{a.name}</strong></Link> {a.verified_at ? <span className="chip">Verified</span> : null}
            <ActionForm action={setArtistVerifiedAction} hidden={{ id: a.id }} choiceName="mode"
              choices={[a.verified_at ? { value: "unverify", label: "Remove verification" } : { value: "verify", label: "Verify artist" }]} />
          </li>
        ))}
      </ul>
    </>
  );
}
