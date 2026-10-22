import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/admin/ActionForm";
import { moderateReleaseAction, reviewRightsAction, trackTakedownAction } from "@/lib/admin/actions";
import { releaseWorkspace } from "@/lib/studio/queries";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review release" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const db = (await createUserClient())!;
  const ws = await releaseWorkspace(db, id);
  if (!ws) notFound();
  const { release, tracks, rights, declared } = ws;
  const { data: artist } = await db.from("artists").select("name,status").eq("id", release.artist_id).maybeSingle();
  const approved = rights.some((r) => r.review_status === "approved");
  return (
    <>
      <p><Link href="/admin/reviews">← Review queue</Link></p>
      <h2>{release.title}</h2>
      <p className={`status-chip status-${release.status}`}>{release.type} · {release.status.replace("_", " ")} · by {artist?.name ?? "unknown"}{artist?.status && artist.status !== "approved" ? ` (${artist.status})` : ""}</p>
      {release.removal_reason ? <p className="muted">Last note: {release.removal_reason}</p> : null}

      <section className="card form form-wide">
        <h3>Rights</h3>
        <p className={declared ? "status-published" : "form-error"}>{declared ? "Declaration accepted." : "No declaration."}</p>
        {rights.length === 0 ? <p className="form-error">No rights record. The release cannot be published.</p> : (
          <ul className="panel-list">
            {rights.map((r) => (
              <li key={r.id}>
                <strong>{r.rights_holder_name}</strong> · {r.basis.replace("_", " ")} · {r.territories.join(", ")} · {r.term_start}{r.term_end ? ` → ${r.term_end}` : " → open"}
                <span className={`status-chip status-${r.review_status}`}>{r.review_status.replace("_", " ")}</span>
                {r.review_note ? <span className="muted">Note: {r.review_note}</span> : null}
                {r.review_status === "pending" ? (
                  <ActionForm action={reviewRightsAction} hidden={{ id: r.id }} choiceName="status" reasonLabel="Note (required unless approving)"
                    choices={[{ value: "approved", label: "Approve" }, { value: "changes_requested", label: "Request changes" }, { value: "rejected", label: "Reject", danger: true }]} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card form form-wide">
        <h3>Tracks</h3>
        <ul className="panel-list">
          {tracks.map((t) => (
            <li key={t.id}>
              <strong>{t.track_number}. {t.title}</strong> <span className="muted">audio: {t.processing_status}</span>
              {t.removed_at ? <span className="form-error">Taken down: {t.removal_reason}</span> : null}
              <ActionForm action={trackTakedownAction} hidden={{ id: t.id, mode: t.removed_at ? "restore" : "takedown" }} choiceName="x" reasonLabel={t.removed_at ? "Note for the audit log" : "Reason (the artist will see it)"} reasonRequired
                choices={[{ value: "go", label: t.removed_at ? "Restore track" : "Take down track", danger: !t.removed_at }]} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card form form-wide">
        <h3>Release decision</h3>
        {release.status === "in_review" && !approved ? <p className="muted">Publishing needs an approved rights record.</p> : null}
        <ActionForm action={moderateReleaseAction} hidden={{ id: release.id }} choiceName="status" reasonLabel="Reason (required to send back or remove)"
          choices={[
            ...(release.status !== "published" ? [{ value: "published", label: "Publish" }] : []),
            ...(release.status === "in_review" || release.status === "published" ? [{ value: "draft", label: "Send back to artist" }] : []),
            ...(release.status !== "removed" ? [{ value: "removed", label: "Remove release", danger: true }] : []),
          ]} />
      </section>
    </>
  );
}
