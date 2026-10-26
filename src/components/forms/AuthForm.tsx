"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { signInAction, signUpAction } from "@/lib/auth/actions";
import { IDLE } from "@/lib/forms";
import { FormMessage, TextField } from "./Field";

export function AuthForm({ mode, next }: { mode: "signin" | "signup"; next?: string }) {
  const [state, action, pending] = useActionState(mode === "signin" ? signInAction : signUpAction, IDLE);
  const other = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <form
      className="form card"
      noValidate
      // Submitted by hand so a failed attempt keeps what the person typed (React resets uncontrolled fields after a form action).
      onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); startTransition(() => action(data)); }}
    >
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {mode === "signup" ? <TextField id="name" label="Display name" autoComplete="name" required state={state} /> : null}
      {mode === "signup" ? <TextField id="username" label="Username" autoComplete="username" required state={state} minLength={3} maxLength={24} pattern="[a-z0-9_]{3,24}" hint="3 to 24 characters: lowercase letters, numbers, underscore." /> : null}
      <TextField id="email" label="Email" type="email" autoComplete="email" required state={state} />
      <TextField
        id="password" label="Password" type="password" required state={state}
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        hint={mode === "signup" ? "At least 8 characters." : undefined}
      />
      {mode === "signup" ? (
        <div className="field">
          <label className="check"><input type="checkbox" name="terms" required /> I accept the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</label>
          {state.status === "error" && state.field === "terms" ? <p className="field-error" role="alert">{state.message}</p> : null}
        </div>
      ) : null}
      <FormMessage state={state} />
      <button className="btn" type="submit" disabled={pending}>{pending ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
      <p className="muted">
        {mode === "signin" ? <><Link href="/forgot-password">Forgot password?</Link> · New here? <Link href={`/signup${other}`}>Create an account</Link></> : <>Already have an account? <Link href={`/login${other}`}>Sign in</Link></>}
      </p>
    </form>
  );
}
