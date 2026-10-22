import Link from "next/link";
import { Cover, Outcome } from "@/components/catalog/Catalog";
import { getCatalog } from "@/lib/catalog";
import { formatDuration } from "@/lib/catalog/query";

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const catalog = await getCatalog();
  const result = catalog ? await catalog.track(id) : null;
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
              {track.audioReady ? null : <p className="muted">Audio is not available yet.</p>}
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
