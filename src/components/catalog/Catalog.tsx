import Link from "next/link";
import type { ReactNode } from "react";
import { LikeButton } from "@/components/library/Controls";
import { PlayButton } from "@/components/player/PlayButton";
import type { PlayerTrack } from "@/components/player/PlayerProvider";
import { EmptyState, ErrorState, NotConfigured } from "@/components/states/States";
import { formatDuration, formatReleaseType, placeholderHues } from "@/lib/catalog/query";
import type { ReleaseSummary, Result, TrackItem } from "@/lib/catalog/types";

/** Decorative placeholder artwork (no real cover art exists yet). */
export function Cover({ id, size = "card" }: { id: string; size?: "card" | "hero" }) {
  const [a, b] = placeholderHues(id);
  return <div className={`cover cover-${size}`} aria-hidden="true" style={{ background: `linear-gradient(145deg, hsl(${a} 62% 38%), hsl(${b} 55% 22%))` }} />;
}

export function ReleaseGrid({ releases }: { releases: ReleaseSummary[] }) {
  return (
    <ul className="grid release-grid" role="list">
      {releases.map((r) => (
        <li key={r.id}>
          <Link href={`/releases/${r.id}`} className="card release-card">
            <Cover id={r.id} />
            <span className="chip">{formatReleaseType(r.type)}</span>
            <h3>{r.title}</h3>
            <p className="muted">{r.artist.name}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** `liked` is passed only for a signed-in viewer (the set of their liked track ids); signed-out viewers see no like buttons. */
export function TrackList({ tracks, context, liked }: { tracks: TrackItem[]; context?: { artist: string; release: string }; liked?: Set<string> }) {
  const asPlayer = (t: TrackItem): PlayerTrack => ({ id: t.id, title: t.title, artist: context?.artist ?? "", release: context?.release ?? "" });
  const queue = context ? tracks.filter((t) => t.audioReady).map(asPlayer) : [];
  return (
    <ol className="tracklist">
      {tracks.map((t) => (
        <li key={t.id}>
          <span className="tracklist-n">
            {context && t.audioReady ? <PlayButton track={asPlayer(t)} queue={queue} /> : (t.trackNumber ?? "–")}
          </span>
          <span className="tracklist-main">
            <Link href={`/tracks/${t.id}`} className="tracklist-title">
              {t.title}
            </Link>
            {t.explicit ? <span className="chip" title="Explicit lyrics">E</span> : null}
          </span>
          <span className="muted tracklist-d">{formatDuration(t.durationMs)}{liked ? <LikeButton trackId={t.id} title={t.title} liked={liked.has(t.id)} /> : null}</span>
          {t.audioReady ? null : <span className="muted tracklist-note">Audio not available yet</span>}
        </li>
      ))}
    </ol>
  );
}

/** Maps every non-ok catalog outcome to its state, so each page handles unconfigured / error / not found the same way. */
export function Outcome<T>({ catalog, result, children, notFoundTitle = "Not found" }: {
  catalog: unknown;
  result: Result<T> | null;
  children: (data: T) => ReactNode;
  notFoundTitle?: string;
}) {
  if (!catalog || !result) return <NotConfigured />;
  if (result.status === "error") return <ErrorState>This could not be loaded right now. Nothing was changed. Please refresh in a moment.</ErrorState>;
  if (result.status === "not_found") {
    return (
      <EmptyState title={notFoundTitle} action={<Link className="btn" href="/">Back to Home</Link>}>
        It does not exist, is not published, or is not available to you.
      </EmptyState>
    );
  }
  return <>{children(result.data)}</>;
}

export function SampleBanner() {
  return (
    <div className="sample-banner" role="note">
      <strong>Sample data.</strong> This preview shows fictional placeholder content, not the real catalog.
    </div>
  );
}
