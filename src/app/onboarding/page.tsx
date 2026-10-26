import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/forms/OnboardingForm";
import { getViewer } from "@/lib/auth/viewer";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const viewer = await getViewer();
  if (viewer.status !== "signed_in") redirect("/login?next=/onboarding");
  const db = (await createUserClient())!;
  const [{ data: profile }, { data: genres }, { data: artists }] = await Promise.all([
    db.from("profiles").select("display_name,onboarding_completed_at").eq("id", viewer.userId).maybeSingle(),
    db.from("genres").select("id,name").order("sort").order("name").limit(30),
    db.from("artists").select("id,name").eq("status", "approved").order("name").limit(12),
  ]);
  if (profile?.onboarding_completed_at) redirect("/");
  return (
    <main className="onboard">
      <Image src="/icons/icon-192.png" alt="Emerg Music" width={72} height={72} priority style={{ borderRadius: "50%" }} />
      <div>
        <h1>Welcome{profile?.display_name ? `, ${profile.display_name}` : ""}</h1>
        <p className="muted" style={{ maxWidth: "42ch", margin: "0 auto" }}>Liberian music, streamed with the artists&rsquo; permission. Tell us what you like, or skip and look around.</p>
      </div>
      <OnboardingForm genres={genres ?? []} artists={artists ?? []} />
    </main>
  );
}
