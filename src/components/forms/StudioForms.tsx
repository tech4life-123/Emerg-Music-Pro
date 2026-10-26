"use client";

import { useActionState, useRef, useEffect } from "react";
import { addRightsRecordAction, addTrackAction, createReleaseAction } from "@/lib/studio/actions";
import { IDLE } from "@/lib/forms";
import { FormMessage, SelectField, TextField } from "./Field";

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
