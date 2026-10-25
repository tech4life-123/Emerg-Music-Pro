import type { Metadata } from "next";
import Link from "next/link";
import { DeletePlaylistForm, RemoveUnavailable, RenamePlaylistForm } from "@/components/library/Controls";
import { LibraryTrackList } from "@/components/library/LibraryTrackList";
import { EmptyState, ErrorState, NotConfigured } from "@/components/states/States";
import { getViewer } from "@/lib/auth/viewer";
import { likedAmong, myPlaylist } from "@/lib/library/data";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Playlist", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return <NotConfigured />;
  const notFound = (
    <EmptyState title="Playlist not found" action={<Link className="btn" href="/library">Back to Library</Link>}>
      It does not exist or is not yours.
    </EmptyState>
  );
  if (viewer.status === "anonymous") return notFound;
  const db = await createUserClient();
  if (!db) return <NotConfigured />;
  const res = await myPlaylist(db, viewer.userId, id);
  if (res.status === "error") return <ErrorState>This playlist could not be loaded. Nothing was changed. Please refresh in a moment.</ErrorState>;
  if (res.status === "not_found") return notFound;
  const { name, tracks, unavailable } = res.data;
  const liked = await likedAmong(db, viewer.userId, tracks.map((t) => t.id));
  return (
    <>
      <p className="muted"><Link href="/library">← Library</Link></p>
      <h1>{name}</h1>
      <p className="muted">Private playlist · {tracks.length} {tracks.length === 1 ? "track" : "tracks"}</p>
      <RenamePlaylistForm id={res.data.id} name={name} />
      {unavailable > 0 ? <RemoveUnavailable playlistId={res.data.id} count={unavailable} /> : null}
      <section className="section" aria-labelledby="pl-tracks">
        <h2 id="pl-tracks">Tracks</h2>
        {tracks.length === 0 ? (
          <EmptyState title="This playlist is empty">Open any track and choose “Add to playlist”.</EmptyState>
        ) : (
          <LibraryTrackList tracks={tracks} liked={liked} playlistId={res.data.id} />
        )}
      </section>
      <section className="section" aria-labelledby="pl-manage">
        <h2 id="pl-manage">Manage</h2>
        <DeletePlaylistForm id={res.data.id} />
      </section>
    </>
  );
}
