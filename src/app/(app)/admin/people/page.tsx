import type { Metadata } from "next";
import { ModeratorForm } from "@/components/forms/ModeratorForm";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Moderators" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const db = (await createUserClient())!;
  const { data } = await db.from("profiles").select("username,display_name").eq("role", "moderator").order("username");
  return (
    <>
      <h1>Moderators</h1>
      <p className="muted">Moderators can review artist applications. They cannot open Administration, publish releases or see audit logs.</p>
      <ModeratorForm />
      <h2>Current moderators</h2>
      {data?.length ? <ul className="panel-list">{data.map((m) => <li key={m.username ?? m.display_name}><strong>{m.display_name}</strong> <span className="muted">@{m.username}</span></li>)}</ul> : <p className="muted">No moderators yet.</p>}
    </>
  );
}
