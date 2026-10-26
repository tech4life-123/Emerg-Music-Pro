import type { Metadata } from "next";
import { TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Page() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="form-error" role="note"><strong>Draft.</strong> Version {TERMS_VERSION}. Pending review by a qualified adviser. It describes what the pilot actually does today.</p>
      <h2>What we store</h2>
      <p>Your email, display name, username, optional country, bio and genre choices, your library (likes, follows, playlists) and listening events. Profiles are private unless you make yours public.</p>
      <h2>Who sees it</h2>
      <p>Artists see aggregate numbers only (plays and listener counts, with small counts hidden), never who you are. Administrators may look at raw listening events only for fraud, security or support work, and those accesses are logged.</p>
      <h2>How long</h2>
      <p>Raw listening events are kept for 90 days, then reduced to daily totals. You can ask for your account to be deleted from Account settings; during the pilot an administrator processes these requests by hand.</p>
      <h2>Service providers</h2>
      <p>Account data is held in Supabase; the site is served by Vercel; audio files are held in Cloudflare R2. We do not sell personal data and show no ads.</p>
    </>
  );
}
