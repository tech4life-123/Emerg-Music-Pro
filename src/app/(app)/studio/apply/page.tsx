import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplicationForm, EMPTY_DRAFT, type AppDraft } from "@/components/forms/ApplicationForm";
import { NotConfigured } from "@/components/states/States";
import { getViewer } from "@/lib/auth/viewer";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Apply as an artist" };
export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return <><h1>Apply as an artist</h1><NotConfigured what="Applications" /></>;
  if (viewer.status === "anonymous") redirect("/login?next=/studio/apply");
  if (viewer.roles.includes("artist") || viewer.roles.includes("admin")) redirect("/studio");
  const db = (await createUserClient())!;
  const [{ data: app }, { data: genres }] = await Promise.all([
    db.from("artist_applications").select("*").eq("user_id", viewer.userId).in("status", ["draft", "info_requested", "pending", "under_review"]).maybeSingle(),
    db.from("genres").select("id,name").order("sort").order("name"),
  ]);
  if (app && (app.status === "pending" || app.status === "under_review")) redirect("/studio");
  const draft: AppDraft = app
    ? {
        artist_name: app.artist_name, bio: app.bio ?? "", links: app.links ?? [], artist_type: app.artist_type ?? "", country: app.country ?? "",
        hometown: app.hometown ?? "", contact_email: app.contact_email ?? "", genre_id: app.genre_id ?? "", secondary: app.secondary_genre_ids ?? [], authority: Boolean(app.authority_confirmed),
      }
    : EMPTY_DRAFT;
  return (
    <>
      <h1>Apply as an artist</h1>
      {viewer.emailVerified === false ? <p className="form-error" role="note">Verify your email address on the Account page before you can save or submit an application.</p> : null}
      <p className="muted">Our review team checks every application. You can save a draft and finish later. You cannot publish until you are approved.</p>
      <ApplicationForm draft={draft} genres={genres ?? []} />
    </>
  );
}
