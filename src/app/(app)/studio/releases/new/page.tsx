import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewReleaseForm } from "@/components/forms/StudioForms";
import { evaluateAccess, getViewer } from "@/lib/auth/viewer";
import { createUserClient } from "@/lib/supabase/server";
import { genreOptions } from "@/lib/studio/queries";

export const metadata: Metadata = { title: "New release" };
export const dynamic = "force-dynamic";

export default async function NewReleasePage() {
  const viewer = await getViewer();
  if (viewer.status === "anonymous") redirect("/login?next=/studio/releases/new");
  if (!evaluateAccess(viewer, ["artist"]).ok) redirect("/studio");
  const db = (await createUserClient())!;
  return (
    <>
      <h1>New release</h1>
      <NewReleaseForm genres={await genreOptions(db)} />
    </>
  );
}
