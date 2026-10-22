import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "Welcome" };

export default function OnboardingPage() {
  return (
    <main className="onboard">
      <div className="collage" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <Image src="/icons/icon-192.png" alt="Emerg Music" width={72} height={72} priority style={{ borderRadius: "50%" }} />
      <div>
        <h1>Welcome to Emerg Music</h1>
        <p className="muted" style={{ maxWidth: "42ch", margin: "0 auto" }}>
          Liberian music, streamed with the artists&rsquo; permission. The artwork above is decorative placeholder colour, not real
          artists.
        </p>
      </div>
      <div className="dots" role="img" aria-label="Step 1 of 1">
        <i aria-current="step" />
      </div>
      <Link href="/" className="btn">
        Start
      </Link>
    </main>
  );
}
