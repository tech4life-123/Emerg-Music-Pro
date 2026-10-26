import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtistImageUploader } from "@/components/forms/ArtistImageUploader";
import { ArtistProfileForm } from "@/components/forms/ArtistProfileForm";
import { NotConfigured, PermissionDenied } from "@/components/states/States";
import { artistImageSrc } from "@/lib/artist-image";
import { getViewer } from "@/lib/auth/viewer";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Artist profile" };
export const dynamic = "force-dynamic";

export default async function StudioProfilePage() {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return <><h1>Artist profile</h1><NotConfigured what="The artist studio" /></>;
  if (viewer.status === "anonymous") return <><h1>Artist profile</h1><PermissionDenied title="Sign in first">Sign in to edit your artist profile. <Link href="/login?next=/studio/profile">Sign in</Link></PermissionDenied></>;
  const db = (await createUserClient())!;
  const { data: a } = await db.from("artists").select("id,name,slug,bio,artist_type,country,hometown,links,image_url,header_url,featured_release_id,verified_at").eq("owner_id", viewer.userId).eq("status", "approved").maybeSingle();
  if (!a) notFound();
  const [{ data: rels }, { data: priv }] = await Promise.all([
    db.from("releases").select("id,title").eq("artist_id", a.id).eq("status", "published").order("published_at", { ascending: false }),
    db.from("artist_private").select("contact_email").eq("artist_id", a.id).maybeSingle(),
  ]);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return (
    <>
      <p><Link href="/studio">← Studio</Link></p>
      <h1>Artist profile</h1>
      <p className="muted">This is how listeners see you. <Link href={`/artists/${a.slug}`}>View your public page</Link>{a.verified_at ? " · Verified artist" : ""}</p>
      <ArtistImageUploader kind="avatar" artistId={a.id} src={artistImageSrc(a.image_url)} supabaseUrl={url} anonKey={key} />
      <ArtistImageUploader kind="header" artistId={a.id} src={artistImageSrc(a.header_url)} supabaseUrl={url} anonKey={key} />
      <ArtistProfileForm
        releases={(rels ?? []) as { id: string; title: string }[]}
        p={{ bio: a.bio ?? "", artist_type: a.artist_type ?? "", country: a.country ?? "", hometown: a.hometown ?? "", links: a.links ?? [], contact_email: priv?.contact_email ?? "", featured_release_id: a.featured_release_id ?? "" }}
      />
    </>
  );
}
