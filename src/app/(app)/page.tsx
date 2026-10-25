import Link from "next/link";
import { Outcome, ReleaseGrid } from "@/components/catalog/Catalog";
import { EmptyState } from "@/components/states/States";
import { getCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const catalog = await getCatalog();
  const [releases, genres] = catalog ? await Promise.all([catalog.newReleases(24), catalog.genres()]) : [null, null];
  return (
    <>
      <p className="eyebrow">Emerg Music</p>
      <h1>Music from Liberia, with permission.</h1>
      <p className="muted" style={{ maxWidth: "60ch" }}>
        Every track on Emerg Music is published only after its rights are documented and reviewed.
      </p>

      <section className="section" aria-labelledby="new-releases">
        <h2 id="new-releases">New releases</h2>
        <Outcome catalog={catalog} result={releases}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="No music is published yet">
                Releases appear here after an artist submits them with rights documentation and an admin approves them.
              </EmptyState>
            ) : (
              <ReleaseGrid releases={list} />
            )
          }
        </Outcome>
      </section>

      {genres?.status === "ok" && genres.data.length > 0 ? (
        <section className="section" aria-labelledby="genres">
          <h2 id="genres">Browse by genre</h2>
          <ul className="chips">
            {genres.data.map((g) => (
              <li key={g.slug}>
                <Link className="chip chip-link" href={`/genres/${g.slug}`}>
                  {g.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section" aria-labelledby="sections-to-come">
        <h2 id="sections-to-come">Coming in later phases</h2>
        <p className="muted">
          Charts, trending, sharing and listening history are not built yet, so they are not shown. Likes, follows and private playlists are in your <Link href="/library">Library</Link>. See the{" "}
          <Link href="/onboarding">welcome screen</Link> for what Emerg Music is about.
        </p>
      </section>
    </>
  );
}
