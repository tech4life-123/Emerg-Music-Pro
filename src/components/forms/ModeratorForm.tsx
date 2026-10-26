"use client";

import { useActionState } from "react";
import { setModeratorAction } from "@/lib/admin/actions";
import { IDLE } from "@/lib/forms";
import { FormMessage, SelectField, TextField } from "./Field";

export function ModeratorForm() {
  const [state, action, pending] = useActionState(setModeratorAction, IDLE);
  return (
    <form action={action} className="form card" noValidate>
      <TextField id="username" label="Username" maxLength={30} required state={state} hint="The person must already have an account." />
      <SelectField id="role" label="Role" defaultValue="moderator" state={state}>
        <option value="moderator">Moderator</option><option value="listener">Listener (remove moderator)</option>
      </SelectField>
      <FormMessage state={state} />
      <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
