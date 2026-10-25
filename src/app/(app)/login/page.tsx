import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms/AuthForm";
import { NotConfigured } from "@/components/states/States";
import { getViewer, landingFor } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/forms";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "");
  const viewer = await getViewer();
  if (viewer.status === "signed_in") redirect(next || landingFor(viewer.roles));
  return (
    <>
      <h1>Sign in</h1>
      {viewer.status === "unconfigured" ? <NotConfigured what="Accounts" /> : <AuthForm mode="signin" next={next || undefined} />}
    </>
  );
}
