export interface ArtistSummary {
  id: string;
  slug: string;
  name: string;
}
export interface ReleaseSummary {
  id: string;
  title: string;
  type: string;
  publishedAt: string | null;
  artist: ArtistSummary;
}
export interface TrackItem {
  id: string;
  title: string;
  trackNumber: number | null;
  durationMs: number | null;
  explicit: boolean;
  /** Audio has been validated and transcoded (processing_status = ready). Whether it may be PLAYED is still decided per request by the playback gate (rights, territory, publication). */
  audioReady: boolean;
}
export interface Credit {
  name: string;
  role: string;
}
export interface Genre {
  slug: string;
  name: string;
}
export interface ArtistProfileInfo {
  bio: string | null;
  artistType: string | null;
  country: string | null;
  hometown: string | null;
  links: string[];
  verified: boolean;
  imagePath: string | null;
  headerPath: string | null;
  featuredReleaseId: string | null;
}
export interface ArtistPage {
  artist: ArtistSummary & ArtistProfileInfo;
  releases: ReleaseSummary[];
}
export interface ReleasePage {
  release: ReleaseSummary & { language: string | null; genre: Genre | null };
  tracks: TrackItem[];
}
export interface TrackPage {
  track: TrackItem & { genre: Genre | null };
  release: ReleaseSummary;
  credits: Credit[];
}
export interface GenrePage {
  genre: Genre;
  releases: ReleaseSummary[];
}
export interface SearchHit {
  artists: ArtistSummary[];
  releases: ReleaseSummary[];
  tracks: { id: string; title: string; release: ReleaseSummary }[];
}

/** Every catalog call returns one of these; pages must handle each (PRD: loading/empty/error/denied states). */
export type Result<T> = { status: "ok"; data: T } | { status: "not_found" } | { status: "error" };

export interface CatalogRepo {
  readonly source: "supabase" | "sample";
  newReleases(limit: number): Promise<Result<ReleaseSummary[]>>;
  genres(): Promise<Result<Genre[]>>;
  genre(slug: string): Promise<Result<GenrePage>>;
  artist(slug: string): Promise<Result<ArtistPage>>;
  release(id: string): Promise<Result<ReleasePage>>;
  track(id: string): Promise<Result<TrackPage>>;
  search(query: string): Promise<Result<SearchHit>>;
}
