import Link from "next/link";
import { PlayButton } from "@/components/player/PlayButton";
import type { PlayerTrack } from "@/components/player/PlayerProvider";
import { formatDuration } from "@/lib/catalog/query";
import type { LibraryTrack } from "@/lib/library/data";
import { LikeButton, RemoveFromPlaylist } from "./Controls";

const asPlayer = (t: LibraryTrack): PlayerTrack => ({ id: t.id, title: t.title, artist: t.artist.name, release: t.release.title });

/** A playable list of the viewer's own saved tracks. The player queue is the playable tracks of this list, in order. */
export function LibraryTrackList({ tracks, liked, playlistId }: { tracks: LibraryTrack[]; liked: Set<string>; playlistId?: string }) {
  const queue = tracks.filter((t) => t.audioReady).map(asPlayer);
  return (
    <ol className="lib-tracks">
      {tracks.map((t) => (
        <li key={t.id}>
          <span>{t.audioReady ? <PlayButton track={asPlayer(t)} queue={queue} /> : <span className="muted">–</span>}</span>
          <span>
            <Link href={`/tracks/${t.id}`} className="tracklist-title">{t.title}</Link>
            {t.explicit ? <span className="chip" title="Explicit lyrics">E</span> : null}
            <br />
            <span className="muted"><Link href={`/artists/${t.artist.slug}`}>{t.artist.name}</Link> · {t.release.title} · {formatDuration(t.durationMs)}{t.audioReady ? "" : " · Audio not available yet"}</span>
          </span>
          <span className="lib-actions">
            <LikeButton trackId={t.id} title={t.title} liked={liked.has(t.id)} />
            {playlistId ? <RemoveFromPlaylist playlistId={playlistId} trackId={t.id} title={t.title} /> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
