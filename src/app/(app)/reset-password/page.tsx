import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/forms/RecoveryForms";
import { getViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const viewer = await getViewer();
  return (
    <>
      <h1>Choose a new password</h1>
      {viewer.status === "signed_in" ? <ResetPasswordForm /> : <p>This reset link is missing or has expired. <Link href="/forgot-password">Request a new one</Link>.</p>}
    </>
  );
}
