"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, signUpAction } from "@/lib/auth/actions";
import { IDLE } from "@/lib/forms";
import { FormMessage, TextField } from "./Field";

export function AuthForm({ mode, next }: { mode: "signin" | "signup"; next?: string }) {
  const [state, action, pending] = useActionState(mode === "signin" ? signInAction : signUpAction, IDLE);
  const other = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <form action={action} className="form card" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {mode === "signup" ? <TextField id="name" label="Your name" autoComplete="name" required state={state} /> : null}
      <TextField id="email" label="Email" type="email" autoComplete="email" required state={state} />
      <TextField
        id="password" label="Password" type="password" required state={state}
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        hint={mode === "signup" ? "At least 8 characters." : undefined}
      />
      <FormMessage state={state} />
      <button className="btn" type="submit" disabled={pending}>{pending ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
      <p className="muted">
        {mode === "signin" ? <>New here? <Link href={`/signup${other}`}>Create an account</Link></> : <>Already have an account? <Link href={`/login${other}`}>Sign in</Link></>}
      </p>
    </form>
  );
}
