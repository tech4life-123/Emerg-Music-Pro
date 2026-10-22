"use client";

import { useActionState, useRef, useEffect } from "react";
import { addRightsRecordAction, addTrackAction, applyAsArtistAction, createReleaseAction } from "@/lib/studio/actions";
import { IDLE } from "@/lib/forms";
import { Field, FormMessage, SelectField, TextArea, TextField } from "./Field";
import { APPLICATION_STATEMENT } from "@/lib/studio/rights-statement";

export function ApplyForm() {
  const [state, action, pending] = useActionState(applyAsArtistAction, IDLE);
  return (
    <form action={action} className="form card" noValidate>
      <TextField id="artist_name" label="Artist or band name" required maxLength={80} state={state} />
      <TextArea id="bio" label="About you" hint="A few sentences. Shown on your artist page once approved." maxLength={2000} state={state} />
      <TextArea id="links" label="Links (optional)" hint="Where we can hear your work: one per line, up to 5." rows={3} state={state} />
      <Field id="accept" label="" error={state.status === "error" && state.field === "accept" ? state.message : undefined}>
        <div className="check-row"><input id="accept" name="accept" type="checkbox" /><label htmlFor="accept">{APPLICATION_STATEMENT}</label></div>
      </Field>
      <FormMessage state={state} />
      <button className="btn" disabled={pending}>{pending ? "Sending…" : "Send application"}</button>
    </form>
  );
}

export function NewReleaseForm({ genres }: { genres: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createReleaseAction, IDLE);
  return (
    <form action={action} className="form card" noValidate>
      <TextField id="title" label="Release title" required maxLength={120} state={state} />
      <SelectField id="type" label="Type" defaultValue="single" state={state}>
        <option value="single">Single</option><option value="ep">EP</option><option value="album">Album</option>
      </SelectField>
      <SelectField id="genre_id" label="Genre" defaultValue="" required state={state}>
        <option value="" disabled>Choose a genre</option>
        {genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </SelectField>
      <TextField id="language" label="Language code" defaultValue="en" maxLength={10} hint="For example en, fr, kpe." state={state} />
      <FormMessage state={state} />
      <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create draft release"}</button>
    </form>
  );
}

export function AddTrackForm({ releaseId }: { releaseId: string }) {
  const [state, action, pending] = useActionState(addTrackAction, IDLE);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.status === "success") ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="form" noValidate>
      <input type="hidden" name="release_id" value={releaseId} />
      <TextField id="title" label="Track title" required maxLength={120} state={state} />
      <div className="check-row"><input id="explicit" name="explicit" type="checkbox" /><label htmlFor="explicit">Explicit lyrics</label></div>
      <FormMessage state={state} />
      <button className="btn btn-ghost" disabled={pending}>{pending ? "Adding…" : "Add track"}</button>
    </form>
  );
}

export function RightsRecordForm({ releaseId }: { releaseId: string }) {
  const [state, action, pending] = useActionState(addRightsRecordAction, IDLE);
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="release_id" value={releaseId} />
      <SelectField id="basis" label="How do you hold the rights?" defaultValue="owner" state={state}>
        <option value="owner">I own them</option>
        <option value="licensed">I have a licence</option>
        <option value="authorized_distributor">I am an authorised distributor</option>
      </SelectField>
      <TextField id="rights_holder_name" label="Rights holder (person or company)" required maxLength={200} state={state} />
      <TextField id="territories" label="Territories" required defaultValue="LR" hint="Two-letter country codes separated by commas, or WW for worldwide." state={state} />
      <TextField id="term_start" label="Rights start date" type="date" required state={state} />
      <TextField id="term_end" label="Rights end date (optional)" type="date" hint="Leave empty if the rights have no end date." state={state} />
      <FormMessage state={state} />
      <button className="btn btn-ghost" disabled={pending}>{pending ? "Saving…" : "Save rights record"}</button>
    </form>
  );
}
