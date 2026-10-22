"use client";

import { useActionState } from "react";
import { reportCopyrightAction } from "@/lib/report-actions";
import { IDLE } from "@/lib/forms";
import { Field, FormMessage, TextArea, TextField } from "./Field";

export function ReportForm({ releaseId, trackId }: { releaseId: string; trackId?: string }) {
  const [state, action, pending] = useActionState(reportCopyrightAction, IDLE);
  if (state.status === "success") return <p className="form-ok" role="status">{state.message}</p>;
  return (
    <form action={action} className="form card" noValidate>
      <input type="hidden" name="release_id" value={releaseId} />
      {trackId ? <input type="hidden" name="track_id" value={trackId} /> : null}
      <TextField id="reporter_name" label="Your name" autoComplete="name" required state={state} />
      <TextField id="reporter_email" label="Your email" type="email" autoComplete="email" required state={state} hint="We use this only to follow up on your report." />
      <TextArea id="description" label="What is the problem?" required minLength={10} maxLength={4000} state={state} hint="Say what work is affected and why you believe it is used without permission." />
      <Field id="confirm" label="" error={state.status === "error" && state.field === "confirm" ? state.message : undefined}>
        <div className="check-row"><input id="confirm" name="confirm" type="checkbox" /><label htmlFor="confirm">I confirm that what I have written is accurate to the best of my knowledge.</label></div>
      </Field>
      <FormMessage state={state} />
      <button className="btn" disabled={pending}>{pending ? "Sending…" : "Send report"}</button>
    </form>
  );
}
