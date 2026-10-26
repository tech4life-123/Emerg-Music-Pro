import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms/AuthForm";
import { NotConfigured } from "@/components/states/States";
import { getViewer } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/forms";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "");
  const viewer = await getViewer();
  if (viewer.status === "signed_in") redirect(next || "/onboarding");
  return (
    <>
      <h1>Create your account</h1>
      {viewer.status === "unconfigured" ? <NotConfigured what="Accounts" /> : <AuthForm mode="signup" next={next || undefined} />}
    </>
  );
}
