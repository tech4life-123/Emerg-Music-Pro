import type { Metadata } from "next";
import { TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Use" };

export default function Page() {
  return (
    <>
      <h1>Terms of Use</h1>
      <p className="form-error" role="note"><strong>Draft.</strong> Version {TERMS_VERSION}. This text is a starting point and is pending review by a qualified adviser. It is not final legal advice.</p>
      <h2>Using Emerg Music</h2>
      <p>Emerg Music streams music that artists and rights holders have authorized. You may listen for personal, non-commercial use. Do not copy, rip or redistribute audio, and do not try to bypass playback protections.</p>
      <h2>Your account</h2>
      <p>Keep your password private. You are responsible for activity on your account. Usernames must not impersonate others or be offensive. We may suspend accounts that break these terms.</p>
      <h2>Artists</h2>
      <p>Artists may upload only music they own or are licensed to distribute, and must declare their rights. Uploads are reviewed before publication and may be removed after a valid rights complaint.</p>
      <h2>Payments</h2>
      <p>During the pilot there are no subscriptions, ads, payouts or royalties. Play counts shown to artists are not earnings.</p>
      <h2>Changes and contact</h2>
      <p>We may update these terms; the version you accepted is recorded with your account. Use the <a href="/report">copyright report form</a> to raise a rights concern.</p>
    </>
  );
}
