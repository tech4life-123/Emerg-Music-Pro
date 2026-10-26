"use client";

import { useActionState } from "react";
import { changePasswordAction, resendVerificationAction } from "@/lib/auth/actions";
import { cancelDeletionAction, requestDeletionAction, updateProfileAction } from "@/lib/profile/actions";
import { IDLE } from "@/lib/forms";
import { COUNTRIES } from "@/lib/legal";
import { FormMessage, SelectField, TextArea, TextField } from "./Field";

type P = { display_name: string; username: string | null; bio: string | null; country: string | null; profile_public: boolean };

export function ProfileForm({ p }: { p: P }) {
  const [state, action, pending] = useActionState(updateProfileAction, IDLE);
  return (
    <form action={action} className="form card" noValidate>
      <h2>Profile</h2>
      <TextField id="display_name" label="Display name" defaultValue={p.display_name} required maxLength={80} state={state} />
      <TextField id="username" label="Username" defaultValue={p.username ?? ""} maxLength={24} state={state} hint="3 to 24 characters: lowercase letters, numbers, underscore." />
      <TextArea id="bio" label="About you" defaultValue={p.bio ?? ""} maxLength={500} state={state} />
      <SelectField id="country" label="Country" defaultValue={p.country ?? ""} state={state}>
        <option value="">Prefer not to say</option>
        {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
      </SelectField>
      <label className="check"><input type="checkbox" name="profile_public" defaultChecked={p.profile_public} /> Make my profile public (name, username, bio only)</label>
      <FormMessage state={state} />
      <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, IDLE);
  return (
    <form action={action} className="form card" noValidate>
      <h2>Change password</h2>
      <TextField id="current" label="Current password" type="password" autoComplete="current-password" required state={state} />
      <TextField id="password" label="New password" type="password" autoComplete="new-password" required state={state} hint="At least 8 characters." />
      <TextField id="confirm" label="Repeat new password" type="password" autoComplete="new-password" required state={state} />
      <FormMessage state={state} />
      <button className="btn" type="submit" disabled={pending}>{pending ? "Please wait…" : "Change password"}</button>
    </form>
  );
}

export function VerifyEmail({ verified }: { verified: boolean }) {
  const [state, action, pending] = useActionState(async () => resendVerificationAction(), IDLE);
  if (verified) return <p className="form-ok">Email verified.</p>;
  return (
    <form action={action} className="form">
      <p className="form-error">Your email is not verified yet. You need it verified before applying as an artist.</p>
      <FormMessage state={state} />
      <button className="btn btn-ghost" type="submit" disabled={pending}>{pending ? "Sending…" : "Resend verification email"}</button>
    </form>
  );
}

export function DeletionForm({ pending: hasPending }: { pending: boolean }) {
  const [state, action, busy] = useActionState(async () => (hasPending ? cancelDeletionAction() : requestDeletionAction()), IDLE);
  return (
    <form action={action} className="form card">
      <h2>Delete my account</h2>
      <p className="muted">{hasPending ? "A deletion request is waiting for an administrator. You can cancel it." : "Ask for your account and its data to be deleted. An administrator processes requests by hand during the pilot."}</p>
      <FormMessage state={state} />
      <button className="btn btn-ghost" type="submit" disabled={busy}>{hasPending ? "Cancel deletion request" : "Request account deletion"}</button>
    </form>
  );
}
