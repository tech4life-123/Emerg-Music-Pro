import Link from "next/link";
import { EmptyState, ErrorState, NotConfigured } from "@/components/states/States";
import { listPublishedReleases } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const catalog = await listPublishedReleases();
  return (
    <>
      <p className="eyebrow">Emerg Music</p>
      <h1>Music from Liberia, with permission.</h1>
      <p className="muted" style={{ maxWidth: "60ch" }}>
        Every track on Emerg Music is published only after its rights are documented and reviewed.
      </p>

      <section className="section" aria-labelledby="new-releases">
        <h2 id="new-releases">New releases</h2>
        {catalog.status === "unconfigured" ? (
          <NotConfigured />
        ) : catalog.status === "error" ? (
          <ErrorState>The catalog could not be loaded. Nothing was changed. Please refresh in a moment.</ErrorState>
        ) : catalog.releases.length === 0 ? (
          <EmptyState title="No music is published yet">
            Releases appear here after an artist submits them with rights documentation and an admin approves them. This is
            an early foundation build and the launch catalog is still being assembled with the artists&rsquo; permission.
          </EmptyState>
        ) : (
          <div className="grid">
            {catalog.releases.map((r) => (
              <article key={r.id} className="card">
                <span className="chip">{r.type}</span>
                <h3 style={{ marginTop: "0.75rem" }}>{r.title}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {r.artistName}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="sections-to-come">
        <h2 id="sections-to-come">Coming in later phases</h2>
        <p className="muted">
          Trending, playlists, artist pages and the player are not built yet, so they are not shown. See the{" "}
          <Link href="/onboarding">welcome screen</Link> for what Emerg Music is about.
        </p>
      </section>
    </>
  );
}
