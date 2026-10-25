import Link from "next/link";
import { Cover, Outcome } from "@/components/catalog/Catalog";
import { PlayButton } from "@/components/player/PlayButton";
import { AddToPlaylist, LikeButton } from "@/components/library/Controls";
import { getCatalog } from "@/lib/catalog";
import { likedAmong, myPlaylists } from "@/lib/library/data";
import { libraryViewer } from "@/lib/library/session";
import { formatDuration } from "@/lib/catalog/query";

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const catalog = await getCatalog();
  const result = catalog ? await catalog.track(id) : null;
  const lv = await libraryViewer();
  const trackId = result?.status === "ok" ? result.data.track.id : null;
  const liked = lv && trackId ? (await likedAmong(lv.db, lv.userId, [trackId])).has(trackId) : false;
  const pls = lv && trackId ? await myPlaylists(lv.db, lv.userId) : null;
  return (
    <Outcome catalog={catalog} result={result} notFoundTitle="Track not found">
      {({ track, release, credits }) => (
        <>
          <div className="hero-row">
            <Cover id={release.id} size="hero" />
            <div>
              <p className="eyebrow">Track</p>
              <h1>{track.title}</h1>
              <p>
                <Link href={`/artists/${release.artist.slug}`}>{release.artist.name}</Link> · <Link href={`/releases/${release.id}`}>{release.title}</Link>
              </p>
              <p className="muted">
                {formatDuration(track.durationMs)}
                {track.explicit ? " · Explicit" : ""}
                {track.genre ? <> · <Link href={`/genres/${track.genre.slug}`}>{track.genre.name}</Link></> : null}
              </p>
              {track.audioReady ? (
                <PlayButton track={{ id: track.id, title: track.title, artist: release.artist.name, release: release.title }} variant="button" />
              ) : (
                <p className="muted">Audio is not available yet.</p>
              )}
              {lv ? (
                <div style={{ marginTop: "0.75rem" }}>
                  <LikeButton trackId={track.id} title={track.title} liked={liked} />
                  {pls?.status === "ok" ? <AddToPlaylist trackId={track.id} playlists={pls.data.map((p) => ({ id: p.id, name: p.name }))} /> : null}
                </div>
              ) : (
                <p className="muted"><Link href={`/login?next=/tracks/${track.id}`}>Sign in</Link> to like this track or add it to a playlist.</p>
              )}
            </div>
          </div>
          {credits.length > 0 ? (
            <section className="section" aria-labelledby="credits">
              <h2 id="credits">Credits</h2>
              <ul className="credits">
                {credits.map((c, i) => (
                  <li key={i}>{c.name} <span className="muted">· {c.role}</span></li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </Outcome>
  );
}
