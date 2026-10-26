"use client";

import { useActionState } from "react";
import { saveArtistProfileAction } from "@/lib/studio/profile";
import { IDLE } from "@/lib/forms";
import { COUNTRIES } from "@/lib/legal";
import { FormMessage, SelectField, TextArea, TextField } from "./Field";

export type ArtistProfile = { bio: string; artist_type: string; country: string; hometown: string; links: string[]; contact_email: string; featured_release_id: string };

export function ArtistProfileForm({ p, releases }: { p: ArtistProfile; releases: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(saveArtistProfileAction, IDLE);
  return (
    <form action={action} className="form card" noValidate>
      <h2>Public profile</h2>
      <TextArea id="bio" label="About you" hint="At least 20 characters. Shown on your artist page." maxLength={2000} required defaultValue={p.bio} state={state} />
      <SelectField id="artist_type" label="Type" defaultValue={p.artist_type} state={state}>
        <option value="">Choose…</option><option value="solo">Solo artist</option><option value="band">Band</option><option value="group">Group</option><option value="producer">Producer</option><option value="label">Label</option>
      </SelectField>
      <SelectField id="country" label="Country" defaultValue={p.country} state={state}>
        <option value="">Choose…</option>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
      </SelectField>
      <TextField id="hometown" label="Hometown or city" maxLength={80} defaultValue={p.hometown} state={state} />
      <TextArea id="links" label="Links" hint="One per line, up to 5. Must start with http:// or https://" rows={3} defaultValue={p.links.join("\n")} state={state} />
      <SelectField id="featured_release_id" label="Featured release" hint="Shown first on your artist page. Only published releases can be featured." defaultValue={p.featured_release_id} state={state}>
        <option value="">None</option>{releases.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
      </SelectField>
      <TextField id="contact_email" label="Contact email" type="email" maxLength={254} defaultValue={p.contact_email} state={state} hint="Only the Emerg Music team sees this. It is never shown publicly." />
      <FormMessage state={state} />
      <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save profile"}</button>
    </form>
  );
}
