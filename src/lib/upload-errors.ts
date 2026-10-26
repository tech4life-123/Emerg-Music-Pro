/** Plain-language reasons for a failed picture upload, so a failure says what went wrong instead of "try a different picture". */
export class UploadStage extends Error {
  constructor(public stage: "encode" | "upload" | "save", message: string) { super(message); }
}

export function uploadFailureText(e: unknown, noun: string): string {
  const stage = e instanceof UploadStage ? e.stage : "encode";
  const detail = e instanceof Error ? e.message : "";
  if (stage === "upload") {
    if (/row-level security|jwt|not authorized|unauthorized|403|401|expired/i.test(detail)) return "Your sign-in looks expired. Sign out, sign in again, then retry.";
    if (/size|too large|413|exceed/i.test(detail)) return `That ${noun} is too large after processing. Try a smaller picture.`;
    if (/mime|type|not supported|415/i.test(detail)) return "That picture type is not accepted. Use JPEG, PNG or WebP.";
    return `The upload was refused (${detail.slice(0, 120) || "no reason given"}).`;
  }
  if (stage === "save") return detail && detail.length < 140 ? detail : `The ${noun} uploaded but could not be saved. Try again.`;
  return "Your browser could not prepare that picture. Try a JPEG or PNG.";
}
