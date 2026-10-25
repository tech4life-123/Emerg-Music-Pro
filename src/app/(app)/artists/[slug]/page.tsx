import { Cover, Outcome, ReleaseGrid } from "@/components/catalog/Catalog";
import { EmptyState } from "@/components/states/States";
import Link from "next/link";
import { FollowButton } from "@/components/library/Controls";
import { getCatalog } from "@/lib/catalog";
import { followerCount, isFollowing } from "@/lib/library/data";
import { libraryViewer } from "@/lib/library/session";

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
      {({ artist, releases }) => (
        <>
          <div className="hero-row">
            <Cover id={artist.id} size="hero" />
            <div>
              <p className="eyebrow">Artist</p>
              <h1>{artist.name}</h1>
              {artist.bio ? <p className="muted" style={{ maxWidth: "60ch" }}>{artist.bio}</p> : null}
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
          <section className="section" aria-labelledby="releases">
            <h2 id="releases">Releases</h2>
            {releases.length === 0 ? <EmptyState title="No published releases yet">Nothing from this artist has been published.</EmptyState> : <ReleaseGrid releases={releases} />}
          </section>
        </>
      )}
    </Outcome>
  );
}
