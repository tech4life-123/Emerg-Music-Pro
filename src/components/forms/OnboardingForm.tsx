"use client";

import { useActionState } from "react";
import { finishOnboardingAction, skipOnboardingAction } from "@/lib/profile/actions";
import { IDLE } from "@/lib/forms";
import { FormMessage } from "./Field";

export function OnboardingForm({ genres, artists }: { genres: { id: string; name: string }[]; artists: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(finishOnboardingAction, IDLE);
  return (
    <>
      <form action={action} className="form card" noValidate>
        <fieldset>
          <legend>Pick genres you like <span className="muted">(optional)</span></legend>
          {genres.length ? genres.map((g) => <label key={g.id} className="check"><input type="checkbox" name="genre" value={g.id} /> {g.name}</label>) : <p className="muted">No genres are available yet.</p>}
        </fieldset>
        <fieldset>
          <legend>Follow artists <span className="muted">(optional)</span></legend>
          {artists.length ? artists.map((a) => <label key={a.id} className="check"><input type="checkbox" name="follow" value={a.id} /> {a.name}</label>) : <p className="muted">No artists have been published yet. You can follow artists any time later.</p>}
        </fieldset>
        <FormMessage state={state} />
        <button className="btn" type="submit" disabled={pending}>{pending ? "Please wait…" : "Start listening"}</button>
      </form>
      <form action={skipOnboardingAction}><button className="btn btn-ghost" type="submit">Skip for now</button></form>
    </>
  );
}
