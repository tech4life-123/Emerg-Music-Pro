import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, NotConfigured } from "@/components/states/States";
import { getViewer } from "@/lib/auth/viewer";
import { signOutAction } from "@/lib/auth/actions";
import { DeletionForm, PasswordForm, ProfileForm, VerifyEmail } from "@/components/forms/ProfileForms";
import { AvatarUploader } from "@/components/forms/AvatarUploader";
import { avatarSrc } from "@/lib/avatar";
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
          Sign in to apply as an artist or manage your releases. 
        </EmptyState>
      </>
    );
  const db = (await createUserClient())!;
  const [{ data: p }, { data: del }] = await Promise.all([
    db.from("profiles").select("display_name,username,bio,country,profile_public,avatar_url").eq("id", viewer.userId).maybeSingle(),
    db.from("account_deletion_requests").select("id").eq("user_id", viewer.userId).eq("status", "pending").maybeSingle(),
  ]);
  return (
    <>
      <h1>Account</h1>
      <section className="card form">
        <p><strong>{p?.display_name ?? "Your account"}</strong>{p?.username ? <span className="muted"> @{p.username}</span> : null}</p>
        <p className="muted">Role: {viewer.roles[0] ?? "listener"}</p>
        <VerifyEmail verified={Boolean(viewer.emailVerified)} />
        {p?.username && p.profile_public ? <p><Link href={`/u/${p.username}`}>View my public profile</Link></p> : null}
        <p><Link href="/studio">Artist studio</Link></p>
        <form action={signOutAction}><button className="btn btn-ghost">Sign out</button></form>
      </section>
      <AvatarUploader userId={viewer.userId} src={avatarSrc(p?.avatar_url)} supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""} />
      <ProfileForm p={{ display_name: p?.display_name ?? "", username: p?.username ?? null, bio: p?.bio ?? null, country: p?.country ?? null, profile_public: Boolean(p?.profile_public) }} />
      <PasswordForm />
      <DeletionForm pending={Boolean(del)} />
    </>
  );
}
