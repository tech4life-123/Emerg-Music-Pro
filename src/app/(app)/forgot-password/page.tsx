import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/forms/RecoveryForms";

export const metadata: Metadata = { title: "Forgot password" };

export default function Page() {
  return (
    <>
      <h1>Forgot your password?</h1>
      <p className="muted">Enter your email and we will send a link to choose a new one.</p>
      <ForgotPasswordForm />
    </>
  );
}
