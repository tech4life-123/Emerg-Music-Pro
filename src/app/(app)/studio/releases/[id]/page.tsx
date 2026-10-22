import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AddTrackForm, RightsRecordForm } from "@/components/forms/StudioForms";
import { TrackUploader } from "@/components/studio/TrackUploader";
import { getViewer } from "@/lib/auth/viewer";
import { createUserClient } from "@/lib/supabase/server";
import { deleteTrackAction, declareRightsAction, submitReleaseAction } from "@/lib/studio/actions";
import { releaseWorkspace } from "@/lib/studio/queries";
import { RIGHTS_STATEMENT } from "@/lib/studio/rights-statement";
import { z } from "zod";

export const metadata: Metadata = { title: "Release" };
export const dynamic = "force-dynamic";

export default async function ReleasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submit_error?: string; submitted?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const viewer = await getViewer();
  if (viewer.status === "anonymous") redirect(`/login?next=/studio/releases/${id}`);
  if (viewer.status !== "signed_in") notFound();
  const db = (await createUserClient())!;
  const ws = await releaseWorkspace(db, id);
  if (!ws) notFound(); // RLS hides other people's drafts: indistinguishable from "does not exist"
  const { release, tracks, rights, declared } = ws;
  const live = tracks.filter((t) => !t.removed_at);
  const isDraft = release.status === "draft";
  const checks = [
    { ok: live.length > 0, label: "At least one track" },
    { ok: live.length > 0 && live.every((t) => t.processing_status === "ready"), label: "Every track has processed audio" },
    { ok: declared, label: "Rights declaration accepted" },
    { ok: rights.some((r) => r.review_status === "pending" || r.review_status === "approved"), label: "Rights record added" },
  ];
  const canSubmit = isDraft && checks.every((c) => c.ok);

  return (
    <>
      <p><Link href="/studio">← Studio</Link></p>
      <h1>{release.title}</h1>
      <p className={`status-chip status-${release.status}`}>{release.type} · {release.status.replace("_", " ")}</p>
      {sp.submitted ? <p className="form-ok" role="status">Submitted. An administrator will review it.</p> : null}
      {sp.submit_error ? <p className="form-error" role="alert">{sp.submit_error}</p> : null}
      {release.removal_reason ? <p className="form-error" role="status">Note from review: {release.removal_reason}</p> : null}
      {release.status === "in_review" ? <p className="muted">This release is waiting for review. You cannot edit it until a decision is made.</p> : null}

      <section className="card form form-wide" aria-labelledby="tracks-h">
        <h2 id="tracks-h">Tracks</h2>
        {tracks.length === 0 ? <p className="muted">No tracks yet.</p> : (
          <ul className="panel-list">
            {tracks.map((t) => (
              <li key={t.id}>
                <strong>{t.track_number}. {t.title}</strong>
                {t.removed_at ? <p className="form-error">Removed by Emerg Music{t.removal_reason ? `: ${t.removal_reason}` : ""}.</p> : (
                  <>
                    <TrackUploader trackId={t.id} initial={t.processing_status} editable={isDraft} />
                    {isDraft ? (
                      <form action={deleteTrackAction}><input type="hidden" name="track_id" value={t.id} /><input type="hidden" name="release_id" value={release.id} /><button className="btn btn-ghost btn-sm">Delete track</button></form>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {isDraft ? <AddTrackForm releaseId={release.id} /> : null}
      </section>

      <section className="card form form-wide" aria-labelledby="rights-h">
        <h2 id="rights-h">Rights</h2>
        {!declared && isDraft ? (
          <form action={declareRightsAction} className="form">
            <input type="hidden" name="release_id" value={release.id} />
            <div className="check-row"><input id="accept-rights" name="accept" type="checkbox" required /><label htmlFor="accept-rights">{RIGHTS_STATEMENT}</label></div>
            <button className="btn btn-ghost">Accept declaration</button>
          </form>
        ) : declared ? <p className="status-published">Declaration accepted.</p> : null}
        {rights.length ? (
          <ul className="panel-list">
            {rights.map((r) => (
              <li key={r.id}>
                <strong>{r.rights_holder_name}</strong> · {r.basis.replace("_", " ")} · {r.territories.join(", ")} · from {r.term_start}{r.term_end ? ` to ${r.term_end}` : ""}
                <span className={`status-chip status-${r.review_status}`}>{r.review_status.replace("_", " ")}</span>
                {r.review_note ? <span className="muted">Reviewer: {r.review_note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {(isDraft || release.status === "published") ? <RightsRecordForm releaseId={release.id} /> : null}
        <p className="muted">Playback only works in the territories and dates of an <em>approved</em> rights record.</p>
      </section>

      {isDraft ? (
        <section className="card form" aria-labelledby="submit-h">
          <h2 id="submit-h">Submit for review</h2>
          <ul className="checklist">{checks.map((c) => <li key={c.label} className={c.ok ? "done" : ""}>{c.label}</li>)}</ul>
          <form action={submitReleaseAction}>
            <input type="hidden" name="release_id" value={release.id} />
            <button className="btn" disabled={!canSubmit}>Submit for review</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
