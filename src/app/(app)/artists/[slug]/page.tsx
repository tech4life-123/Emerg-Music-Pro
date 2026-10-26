import { Cover, Outcome, ReleaseGrid } from "@/components/catalog/Catalog";
import { EmptyState } from "@/components/states/States";
import Link from "next/link";
import { FollowButton } from "@/components/library/Controls";
import { getCatalog } from "@/lib/catalog";
import { followerCount, isFollowing } from "@/lib/library/data";
import { libraryViewer } from "@/lib/library/session";
import { artistImageSrc, safeLinks } from "@/lib/artist-image";
import { COUNTRIES } from "@/lib/legal";

const TYPE_LABEL: Record<string, string> = { solo: "Solo artist", band: "Band", group: "Group", producer: "Producer", label: "Label" };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const catalog = await getCatalog();
  const result = catalog ? await catalog.artist(slug) : null;
  const lv = await libraryViewer();
  const artistId = result?.status === "ok" ? result.data.artist.id : null;
  const following = lv && artistId ? await isFollowing(lv.db, lv.userId, artistId) : false;
  const followers = lv && artistId ? await followerCount(lv.db, artistId) : null;
  return (
    <Outcome catalog={catalog} result={result} notFoundTitle="Artist not found">
      {({ artist, releases }) => {
        const avatar = artistImageSrc(artist.imagePath), header = artistImageSrc(artist.headerPath);
        const place = [artist.hometown, COUNTRIES.find(([c]) => c === artist.country)?.[1]].filter(Boolean).join(", ");
        const links = safeLinks(artist.links);
        const featured = releases.find((r) => r.id === artist.featuredReleaseId);
        const rest = featured ? releases.filter((r) => r.id !== featured.id) : releases;
        return (
        <>
          {header ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={header} alt="" style={{ width: "100%", aspectRatio: "3 / 1", objectFit: "cover", borderRadius: 12, marginBottom: 16 }} />
          ) : null}
          <div className="hero-row">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt={`${artist.name}`} width={160} height={160} style={{ borderRadius: "50%", objectFit: "cover" }} />
            ) : <Cover id={artist.id} size="hero" />}
            <div>
              <p className="eyebrow">{(artist.artistType && TYPE_LABEL[artist.artistType]) || "Artist"}</p>
              <h1>{artist.name}{artist.verified ? <span className="chip" title="Verified by Emerg Music" style={{ marginLeft: 8, fontSize: "0.5em", verticalAlign: "middle" }}>Verified</span> : null}</h1>
              {place ? <p className="muted">{place}</p> : null}
              {artist.bio ? <p className="muted" style={{ maxWidth: "60ch", whiteSpace: "pre-line" }}>{artist.bio}</p> : null}
              {links.length ? (
                <ul aria-label="Links" role="list" style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: 0, listStyle: "none" }}>
                  {links.map((l) => <li key={l}><a href={l} target="_blank" rel="noopener noreferrer nofollow ugc">{host(l)}</a></li>)}
                </ul>
              ) : null}
              {lv ? (
                <>
                  <FollowButton artistId={artist.id} name={artist.name} following={following} />
                  {followers !== null ? <p className="muted">{followers} {followers === 1 ? "follower" : "followers"}</p> : null}
                </>
              ) : (
                <p className="muted"><Link href={`/login?next=/artists/${artist.slug}`}>Sign in</Link> to follow this artist.</p>
              )}
            </div>
          </div>
          {featured ? (
            <section className="section" aria-labelledby="featured">
              <h2 id="featured">Featured</h2>
              <ReleaseGrid releases={[featured]} />
            </section>
          ) : null}
          <section className="section" aria-labelledby="releases">
            <h2 id="releases">{featured ? "More releases" : "Releases"}</h2>
            {releases.length === 0 ? <EmptyState title="No published releases yet">Nothing from this artist has been published.</EmptyState> : rest.length === 0 ? <p className="muted">That is everything for now.</p> : <ReleaseGrid releases={rest} />}
          </section>
        </>
        );
      }}
    </Outcome>
  );
}
