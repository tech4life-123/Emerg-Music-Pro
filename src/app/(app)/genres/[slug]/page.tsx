import { Outcome, ReleaseGrid } from "@/components/catalog/Catalog";
import { EmptyState } from "@/components/states/States";
import { getCatalog } from "@/lib/catalog";

export default async function GenrePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const catalog = await getCatalog();
  const result = catalog ? await catalog.genre(slug) : null;
  return (
    <Outcome catalog={catalog} result={result} notFoundTitle="Genre not found">
      {({ genre, releases }) => (
        <>
          <p className="eyebrow">Genre</p>
          <h1>{genre.name}</h1>
          {releases.length === 0 ? <EmptyState title="Nothing published in this genre yet">Check back as artists publish.</EmptyState> : <ReleaseGrid releases={releases} />}
        </>
      )}
    </Outcome>
  );
}
