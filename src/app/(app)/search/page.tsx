import type { Metadata } from "next";
import Link from "next/link";
import { Outcome, ReleaseGrid } from "@/components/catalog/Catalog";
import { EmptyState } from "@/components/states/States";
import { getCatalog } from "@/lib/catalog";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, normalizeQuery } from "@/lib/catalog/query";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = normalizeQuery(raw);
  const catalog = await getCatalog();
  const result = catalog && q ? await catalog.search(q) : null;

  return (
    <>
      <h1>Search</h1>
      <form className="search-form" action="/search" method="get" role="search">
        <label className="visually-hidden" htmlFor="q">Search artists, releases and tracks</label>
        <input id="q" name="q" type="search" defaultValue={q ?? raw ?? ""} maxLength={MAX_QUERY_LENGTH} placeholder="Artists, releases, tracks" autoComplete="off" />
        <button className="btn" type="submit">Search</button>
      </form>

      {raw !== undefined && !q ? (
        <EmptyState title="Type a little more">Enter at least {MIN_QUERY_LENGTH} characters.</EmptyState>
      ) : !q ? (
        <p className="muted">Search published artists, releases and tracks.</p>
      ) : (
        <Outcome catalog={catalog} result={result}>
          {(hit) =>
            hit.artists.length + hit.releases.length + hit.tracks.length === 0 ? (
              <EmptyState title={`No results for “${q}”`}>Check the spelling or try a shorter word. Only published music is searchable.</EmptyState>
            ) : (
              <>
                {hit.artists.length > 0 ? (
                  <section className="section" aria-labelledby="r-artists">
                    <h2 id="r-artists">Artists</h2>
                    <ul className="result-list">
                      {hit.artists.map((a) => (
                        <li key={a.id}><Link href={`/artists/${a.slug}`}>{a.name}</Link></li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {hit.releases.length > 0 ? (
                  <section className="section" aria-labelledby="r-releases">
                    <h2 id="r-releases">Releases</h2>
                    <ReleaseGrid releases={hit.releases} />
                  </section>
                ) : null}
                {hit.tracks.length > 0 ? (
                  <section className="section" aria-labelledby="r-tracks">
                    <h2 id="r-tracks">Tracks</h2>
                    <ul className="result-list">
                      {hit.tracks.map((t) => (
                        <li key={t.id}>
                          <Link href={`/tracks/${t.id}`}>
                            {t.title} <span className="muted">· {t.release.artist.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            )
          }
        </Outcome>
      )}
    </>
  );
}
