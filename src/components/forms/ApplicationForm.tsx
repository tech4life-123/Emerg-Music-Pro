"use client";

import { useActionState } from "react";
import { saveApplicationAction, replyToApplicationAction } from "@/lib/studio/application";
import { IDLE } from "@/lib/forms";
import { COUNTRIES } from "@/lib/legal";
import { APPLICATION_STATEMENT } from "@/lib/studio/rights-statement";
import { Field, FormMessage, SelectField, TextArea, TextField } from "./Field";

export type AppDraft = {
  artist_name: string; bio: string; links: string[]; artist_type: string; country: string; hometown: string; contact_email: string;
  genre_id: string; secondary: string[]; authority: boolean;
};
export const EMPTY_DRAFT: AppDraft = { artist_name: "", bio: "", links: [], artist_type: "", country: "", hometown: "", contact_email: "", genre_id: "", secondary: [], authority: false };

export function ApplicationForm({ draft, genres }: { draft: AppDraft; genres: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveApplicationAction, IDLE);
  return (
    <form action={action} className="form card" noValidate>
      <TextField id="artist_name" label="Artist or band name" required maxLength={80} defaultValue={draft.artist_name} state={state} />
      <SelectField id="artist_type" label="Type" defaultValue={draft.artist_type} state={state}>
        <option value="">Choose…</option><option value="solo">Solo artist</option><option value="band">Band</option><option value="group">Group</option><option value="producer">Producer</option><option value="label">Label</option>
      </SelectField>
      <SelectField id="country" label="Country" defaultValue={draft.country} state={state}>
        <option value="">Choose…</option>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
      </SelectField>
      <TextField id="hometown" label="Hometown or city" maxLength={80} defaultValue={draft.hometown} state={state} />
      <SelectField id="genre_id" label="Main genre" defaultValue={draft.genre_id} state={state}>
        <option value="">Choose…</option>{genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </SelectField>
      <fieldset>
        <legend>Other genres <span className="muted">(up to 3, optional)</span></legend>
        {genres.map((g) => <label key={g.id} className="check"><input type="checkbox" name="secondary" value={g.id} defaultChecked={draft.secondary.includes(g.id)} /> {g.name}</label>)}
      </fieldset>
      <TextField id="contact_email" label="Contact email" type="email" maxLength={254} defaultValue={draft.contact_email} state={state} hint="Only our review team sees this. It is never shown publicly." />
      <TextArea id="bio" label="About you" hint="At least 20 characters. Shown on your artist page once approved." maxLength={2000} defaultValue={draft.bio} state={state} />
      <TextArea id="links" label="Links (optional)" hint="Where we can hear your work: one per line, up to 5." rows={3} defaultValue={draft.links.join("\n")} state={state} />
      <Field id="authority" label="" error={state.status === "error" && state.field === "authority" ? state.message : undefined}>
        <div className="check-row"><input id="authority" name="authority" type="checkbox" defaultChecked={draft.authority} /><label htmlFor="authority">I am the artist, or I am authorised to represent them.</label></div>
      </Field>
      <Field id="accept" label="" error={state.status === "error" && state.field === "accept" ? state.message : undefined}>
        <div className="check-row"><input id="accept" name="accept" type="checkbox" defaultChecked={draft.artist_name.length > 0} /><label htmlFor="accept">{APPLICATION_STATEMENT}</label></div>
      </Field>
      <FormMessage state={state} />
      <div className="row-actions">
        <button className="btn btn-ghost" name="intent" value="save" disabled={pending}>{pending ? "Working…" : "Save draft"}</button>
        <button className="btn" name="intent" value="submit" disabled={pending}>Submit for review</button>
      </div>
    </form>
  );
}

export function ReplyForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(replyToApplicationAction, IDLE);
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="id" value={id} />
      <TextArea id="body" label="Reply to the review team" maxLength={2000} required state={state} />
      <FormMessage state={state} />
      <button className="btn btn-ghost" disabled={pending}>{pending ? "Sending…" : "Send reply"}</button>
    </form>
  );
}
