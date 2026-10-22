import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplyForm } from "@/components/forms/StudioForms";
import { NotConfigured } from "@/components/states/States";
import { getViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Apply as an artist" };
export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return <><h1>Apply as an artist</h1><NotConfigured what="Applications" /></>;
  if (viewer.status === "anonymous") redirect("/login?next=/studio/apply");
  if (viewer.roles.includes("artist") || viewer.roles.includes("admin")) redirect("/studio");
  return (
    <>
      <h1>Apply as an artist</h1>
      <p className="muted">An administrator reviews every application. You will not be able to publish until it is approved.</p>
      <ApplyForm />
    </>
  );
}
