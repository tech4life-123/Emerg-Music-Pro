import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { avatarSrc } from "@/lib/avatar";
import { createUserClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Profile" };

type Pub = { username: string; display_name: string; avatar_url: string | null; bio: string | null; joined_at: string; following_count: number };

export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const db = await createUserClient();
  if (!db || !/^[a-z0-9_]{3,24}$/.test(username)) notFound();
  const { data } = await db.rpc("get_public_profile", { p_username: username });
  const p = (Array.isArray(data) ? data[0] : data) as Pub | null;
  if (!p) notFound();
  return (
    <>
      {avatarSrc(p.avatar_url) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarSrc(p.avatar_url)!} alt="" width={96} height={96} style={{ borderRadius: "50%", objectFit: "cover" }} />
      ) : null}
      <h1>{p.display_name}</h1>
      <p className="muted">@{p.username} · joined {new Date(p.joined_at).toLocaleDateString("en", { year: "numeric", month: "long" })} · following {p.following_count}</p>
      {p.bio ? <p>{p.bio}</p> : null}
    </>
  );
}
