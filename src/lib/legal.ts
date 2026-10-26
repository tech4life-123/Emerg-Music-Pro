/** Bump when the Terms or Privacy text changes materially; sign-up stores the version the person accepted. */
export const TERMS_VERSION = "2026-10-draft-1";

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

/** Short list for the optional country field (ISO 3166-1 alpha-2). West Africa first; "Other" is allowed by leaving it blank. */
export const COUNTRIES: [string, string][] = [
  ["LR", "Liberia"], ["SL", "Sierra Leone"], ["GN", "Guinea"], ["CI", "Côte d'Ivoire"], ["GH", "Ghana"], ["NG", "Nigeria"],
  ["SN", "Senegal"], ["GM", "Gambia"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["DE", "Germany"],
  ["FR", "France"], ["ZA", "South Africa"], ["KE", "Kenya"],
];

export const GENRES = ["Afrobeats", "Hip-hop", "Gospel", "Highlife", "R&B", "Reggae", "Traditional", "Dancehall", "Pop", "Jazz"];
