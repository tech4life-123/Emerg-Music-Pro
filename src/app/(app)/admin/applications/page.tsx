import { redirect } from "next/navigation";

/** Application review now lives under /staff so moderators can reach it without seeing the rest of Administration. */
export default function Page() {
  redirect("/staff/applications");
}
