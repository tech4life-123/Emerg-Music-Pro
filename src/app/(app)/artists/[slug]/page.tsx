import { Cover, Outcome, ReleaseGrid } from "@/components/catalog/Catalog";
import { EmptyState } from "@/components/states/States";
import { getCatalog } from "@/lib/catalog";

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const catalog = await getCatalog();
  const result = catalog ? await catalog.artist(slug) : null;
  return (
    <Outcome catalog={catalog} result={result} notFoundTitle="Artist not found">
      {({ artist, releases }) => (
        <>
          <div className="hero-row">
            <Cover id={artist.id} size="hero" />
            <div>
              <p className="eyebrow">Artist</p>
              <h1>{artist.name}</h1>
              {artist.bio ? <p className="muted" style={{ maxWidth: "60ch" }}>{artist.bio}</p> : null}
            </div>
          </div>
          <section className="section" aria-labelledby="releases">
            <h2 id="releases">Releases</h2>
            {releases.length === 0 ? <EmptyState title="No published releases yet">Nothing from this artist has been published.</EmptyState> : <ReleaseGrid releases={releases} />}
          </section>
        </>
      )}
    </Outcome>
  );
}
