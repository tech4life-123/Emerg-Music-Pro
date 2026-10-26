import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms/AuthForm";
import { NotConfigured } from "@/components/states/States";
import { getViewer, landingFor } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/forms";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; link?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next, "");
  const viewer = await getViewer();
  if (viewer.status === "signed_in") redirect(next || landingFor(viewer.roles));
  return (
    <>
      <h1>Sign in</h1>
      {sp.reset ? <p className="form-ok" role="status">Password changed. Sign in with the new one.</p> : null}
      {sp.link ? <p className="form-error" role="alert">That link is invalid or has expired. Request a new one.</p> : null}
      {viewer.status === "unconfigured" ? <NotConfigured what="Accounts" /> : <AuthForm mode="signin" next={next || undefined} />}
    </>
  );
}
