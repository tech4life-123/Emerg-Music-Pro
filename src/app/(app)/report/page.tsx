import type { Metadata } from "next";
import { z } from "zod";
import { ReportForm } from "@/components/forms/ReportForm";
import { ErrorState, NotConfigured } from "@/components/states/States";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Report a copyright problem" };
export const dynamic = "force-dynamic";

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ release?: string; track?: string }> }) {
  const sp = await searchParams;
  const ok = z.string().uuid().safeParse(sp.release).success;
  const db = await createUserClient();
  if (!db) return <><h1>Report a copyright problem</h1><NotConfigured what="Reporting" /></>;
  let title = "";
  if (ok) {
    const { data } = await db.from("releases").select("title").eq("id", sp.release!).eq("status", "published").maybeSingle();
    title = data?.title ?? "";
  }
  return (
    <>
      <h1>Report a copyright problem</h1>
      {!ok || !title ? (
        <ErrorState title="Open this form from a release">Use the “Report” link on a release or track page so we know which work you mean.</ErrorState>
      ) : (
        <>
          <p>You are reporting: <strong>{title}</strong>. Reports are reviewed by an administrator; a report does not remove music by itself.</p>
          <ReportForm releaseId={sp.release!} trackId={z.string().uuid().safeParse(sp.track).success ? sp.track : undefined} />
        </>
      )}
    </>
  );
}
