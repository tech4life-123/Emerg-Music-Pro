"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction, resetPasswordAction } from "@/lib/auth/actions";
import { IDLE } from "@/lib/forms";
import { FormMessage, TextField } from "./Field";
import { Turnstile } from "./Turnstile";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, IDLE);
  return (
    <form action={action} className="form card" noValidate>
      <TextField id="email" label="Email" type="email" autoComplete="email" required state={state} />
      <Turnstile resetKey={state} />
      <FormMessage state={state} />
      <button className="btn" type="submit" disabled={pending}>{pending ? "Please wait…" : "Send reset link"}</button>
      <p className="muted"><Link href="/login">Back to sign in</Link></p>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPasswordAction, IDLE);
  return (
    <form action={action} className="form card" noValidate>
      <TextField id="password" label="New password" type="password" autoComplete="new-password" required state={state} hint="At least 8 characters." />
      <TextField id="confirm" label="Repeat new password" type="password" autoComplete="new-password" required state={state} />
      <FormMessage state={state} />
      <button className="btn" type="submit" disabled={pending}>{pending ? "Please wait…" : "Change password"}</button>
    </form>
  );
}
