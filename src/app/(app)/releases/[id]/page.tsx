import Link from "next/link";
import { Cover, Outcome, TrackList } from "@/components/catalog/Catalog";
import { EmptyState } from "@/components/states/States";
import { getCatalog } from "@/lib/catalog";
import { formatReleaseType } from "@/lib/catalog/query";

export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const catalog = await getCatalog();
  const result = catalog ? await catalog.release(id) : null;
  return (
    <Outcome catalog={catalog} result={result} notFoundTitle="Release not found">
      {({ release, tracks }) => (
        <>
          <div className="hero-row">
            <Cover id={release.id} size="hero" />
            <div>
              <p className="eyebrow">{formatReleaseType(release.type)}</p>
              <h1>{release.title}</h1>
              <p>
                <Link href={`/artists/${release.artist.slug}`}>{release.artist.name}</Link>
                {release.genre ? <> · <Link href={`/genres/${release.genre.slug}`}>{release.genre.name}</Link></> : null}
              </p>
            </div>
          </div>
          <section className="section" aria-labelledby="tracks">
            <h2 id="tracks">Tracks</h2>
            {tracks.length === 0 ? <EmptyState title="No tracks listed">This release has no tracks yet.</EmptyState> : <TrackList tracks={tracks} context={{ artist: release.artist.name, release: release.title }} />}
          </section>
          <p className="muted"><Link href={`/report?release=${release.id}`}>Report a copyright problem</Link></p>
        </>
      )}
    </Outcome>
  );
}
