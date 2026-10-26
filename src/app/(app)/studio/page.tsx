import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, NotConfigured, PermissionDenied } from "@/components/states/States";
import { evaluateAccess, getViewer } from "@/lib/auth/viewer";
import { ReplyForm } from "@/components/forms/ApplicationForm";
import { createUserClient } from "@/lib/supabase/server";
import { myArtist, myReleases } from "@/lib/studio/queries";

export const metadata: Metadata = { title: "Artist studio" };
export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return <><h1>Artist studio</h1><NotConfigured what="The artist studio" /></>;
  if (viewer.status === "anonymous")
    return <><h1>Artist studio</h1><PermissionDenied title="Sign in to use the studio">The studio is for signed-in artists. <Link href="/login?next=/studio">Sign in</Link> or <Link href="/signup?next=/studio">create an account</Link>.</PermissionDenied></>;

  const db = (await createUserClient())!;
  const access = evaluateAccess(viewer, ["artist", "admin"]);
  const artist = access.ok ? await myArtist(db, viewer.userId) : null;

  if (!artist) {
    const { data: app } = await db.from("artist_applications").select("id,status,artist_name,decision_reason,created_at").eq("user_id", viewer.userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: thread } = app?.status === "info_requested" || app?.status === "under_review" || app?.status === "pending"
      ? await db.from("application_messages").select("from_staff,body,created_at").eq("application_id", app.id).order("created_at")
      : { data: [] as { from_staff: boolean; body: string; created_at: string }[] };
    return (
      <>
        <h1>Artist studio</h1>
        {app?.status === "pending" || app?.status === "under_review" ? (
          <EmptyState title={app.status === "pending" ? "Application received" : "Application under review"}>We are reviewing your application for “{app.artist_name}”. You will be able to create releases once it is approved.</EmptyState>
        ) : app?.status === "info_requested" ? (
          <>
            <EmptyState title="The review team needs more information" action={<Link className="btn" href="/studio/apply">Edit and resubmit</Link>}>Application for “{app.artist_name}”.</EmptyState>
            {thread?.length ? <ul className="panel-list" aria-label="Messages">{thread.map((m, i) => <li key={i}><strong>{m.from_staff ? "Review team" : "You"}:</strong> {m.body}</li>)}</ul> : null}
            <ReplyForm id={app.id} />
          </>
        ) : app?.status === "draft" ? (
          <EmptyState title="You have a draft application" action={<Link className="btn" href="/studio/apply">Continue your application</Link>}>Draft for “{app.artist_name}”. Nothing has been sent yet.</EmptyState>
        ) : (
          <EmptyState title={app?.status === "rejected" ? "Your last application was not approved" : "Become an artist on Emerg Music"} action={<Link className="btn" href="/studio/apply">{app ? "Apply again" : "Apply to publish music"}</Link>}>
            {app?.status === "rejected" && app.decision_reason ? `Reason: ${app.decision_reason}` : "Tell us who you are and confirm you only upload music you have the right to share."}
          </EmptyState>
        )}
      </>
    );
  }

  const releases = await myReleases(db, artist.id);
  return (
    <>
      <h1>Artist studio</h1>
      <p className="muted">Signed in as <strong>{artist.name}</strong>{artist.status !== "approved" ? ` (${artist.status})` : ""}.</p>
      {artist.status !== "approved" ? (
        <PermissionDenied title="Your artist account is not active">New releases are paused. Contact support if you think this is a mistake.</PermissionDenied>
      ) : (
        <p><Link className="btn" href="/studio/releases/new">New release</Link></p>
      )}
      {releases.length === 0 ? (
        <EmptyState title="No releases yet">Create a draft release, add tracks, declare your rights and submit it for review.</EmptyState>
      ) : (
        <ul className="panel-list">
          {releases.map((r) => (
            <li key={r.id}>
              <Link href={`/studio/releases/${r.id}`}><strong>{r.title}</strong></Link>
              <span className={`status-chip status-${r.status}`}>{r.type} · {r.status.replace("_", " ")}</span>
              {r.removal_reason && (r.status === "removed" || r.status === "draft") ? <span className="muted">Note from review: {r.removal_reason}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
