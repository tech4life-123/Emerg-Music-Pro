import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, NotConfigured } from "@/components/states/States";
import { getViewer } from "@/lib/auth/viewer";
import { signOutAction } from "@/lib/auth/actions";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return <><h1>Account</h1><NotConfigured /></>;
  if (viewer.status === "anonymous")
    return (
      <>
        <h1>Account</h1>
        <EmptyState title="You are not signed in" action={<p className="row-actions"><Link className="btn" href="/login">Sign in</Link><Link className="btn btn-ghost" href="/signup">Create account</Link></p>}>
          Sign in to apply as an artist or manage your releases. Playlists, likes and follows arrive in a later phase.
        </EmptyState>
      </>
    );
  const db = (await createUserClient())!;
  const { data: profile } = await db.from("profiles").select("display_name,role").eq("id", viewer.userId).maybeSingle();
  return (
    <>
      <h1>Account</h1>
      <section className="card form">
        <p><strong>{profile?.display_name ?? "Your account"}</strong></p>
        <p className="muted">Role: {viewer.roles[0] ?? "listener"}</p>
        <p><Link href="/studio">Artist studio</Link></p>
        <form action={signOutAction}><button className="btn btn-ghost">Sign out</button></form>
      </section>
    </>
  );
}
