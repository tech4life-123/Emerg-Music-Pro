import type { Metadata } from "next";
import Link from "next/link";
import { CreatePlaylistForm } from "@/components/library/Controls";
import { LibraryTrackList } from "@/components/library/LibraryTrackList";
import { EmptyState, ErrorState, NotConfigured } from "@/components/states/States";
import { getViewer } from "@/lib/auth/viewer";
import { followedArtists, likedTracks, myPlaylists } from "@/lib/library/data";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Library" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return (<><h1>Library</h1><NotConfigured /></>);
  if (viewer.status === "anonymous") {
    return (
      <>
        <h1>Library</h1>
        <EmptyState title="Sign in to build your library" action={<Link className="btn" href="/login?next=/library">Sign in</Link>}>
          Liked songs, followed artists and playlists are saved to your account and are private to you.
        </EmptyState>
      </>
    );
  }
  const db = await createUserClient();
  if (!db) return (<><h1>Library</h1><NotConfigured /></>);
  const [liked, playlists, following] = await Promise.all([likedTracks(db, viewer.userId), myPlaylists(db, viewer.userId), followedArtists(db, viewer.userId)]);
  const failed = liked.status === "error" || playlists.status === "error" || following.status === "error";
  return (
    <>
      <h1>Library</h1>
      <p className="muted">Everything here is private to you.</p>
      {failed ? <ErrorState>Part of your library could not be loaded. Nothing was changed. Please refresh in a moment.</ErrorState> : null}

      <section className="section" aria-labelledby="playlists">
        <h2 id="playlists">Playlists</h2>
        <CreatePlaylistForm />
        {playlists.status === "ok" && playlists.data.length === 0 ? <p className="muted">You have no playlists yet.</p> : null}
        {playlists.status === "ok" ? (
          <ul className="lib-list">
            {playlists.data.map((p) => (
              <li key={p.id}><Link href={`/library/playlists/${p.id}`}>{p.name}</Link> <span className="muted">· {p.trackCount} {p.trackCount === 1 ? "track" : "tracks"}</span></li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="section" aria-labelledby="liked">
        <h2 id="liked">Liked songs</h2>
        {liked.status === "ok" && liked.data.length === 0 ? (
          <EmptyState title="No liked songs yet">Tap the heart on any track to save it here.</EmptyState>
        ) : liked.status === "ok" ? (
          <LibraryTrackList tracks={liked.data} liked={new Set(liked.data.map((t) => t.id))} />
        ) : null}
      </section>

      <section className="section" aria-labelledby="following">
        <h2 id="following">Following</h2>
        {following.status === "ok" && following.data.length === 0 ? (
          <EmptyState title="You are not following anyone yet">Follow an artist from their page.</EmptyState>
        ) : following.status === "ok" ? (
          <ul className="lib-list">
            {following.data.map((a) => <li key={a.id}><Link href={`/artists/${a.slug}`}>{a.name}</Link></li>)}
          </ul>
        ) : null}
      </section>
    </>
  );
}
