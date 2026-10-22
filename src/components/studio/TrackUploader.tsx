"use client";

import { useEffect, useState } from "react";

type Phase = { kind: "idle" } | { kind: "uploading"; pct: number } | { kind: "processing"; label: string } | { kind: "ready" } | { kind: "failed"; message: string };

const ACCEPT = ".wav,.flac,.mp3,.m4a,.aac,audio/*";
const MIME: Record<string, string> = { wav: "audio/wav", flac: "audio/flac", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac" };
const ERR: Record<string, string> = {
  invalid_type: "That file type is not supported. Use WAV, FLAC, MP3, M4A or AAC.",
  too_large: "That file is too large.", forbidden: "You cannot upload to this track.", rate_limited: "Too many uploads. Wait a minute.",
  unauthenticated: "Please sign in again.",
};

/** Upload goes through the app's authorized, short-lived upload URL; processing progress is polled from the user's own session. */
export function TrackUploader({ trackId, initial, editable }: { trackId: string; initial: "pending" | "processing" | "ready" | "failed"; editable: boolean }) {
  const [phase, setPhase] = useState<Phase>(initial === "ready" ? { kind: "ready" } : initial === "failed" ? { kind: "failed", message: "Processing failed. Upload the file again." } : initial === "processing" ? { kind: "processing", label: "Processing…" } : { kind: "idle" });
  const processing = phase.kind === "processing";

  // While a job is queued or running, ask the server (as this user) every few seconds until it settles.
  useEffect(() => {
    if (!processing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/studio/tracks/${trackId}/status`, { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { processing: string; job: { status: string; error_message: string | null } | null };
          if (cancelled) return;
          if (d.processing === "ready") return setPhase({ kind: "ready" });
          if (d.processing === "failed" || d.job?.status === "failed") return setPhase({ kind: "failed", message: d.job?.error_message ?? "Processing failed. Upload the file again." });
          setPhase({ kind: "processing", label: d.job?.status === "running" ? "Processing audio…" : "Waiting in the queue…" });
        }
      } catch { /* transient: try again */ }
      if (!cancelled) timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [processing, trackId]);

  async function onFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const type = file.type && file.type !== "application/octet-stream" ? file.type : MIME[ext] ?? "";
    setPhase({ kind: "uploading", pct: 0 });
    const auth = await fetch("/api/upload/authorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trackId, contentType: type, sizeBytes: file.size }) });
    const a = (await auth.json().catch(() => ({}))) as { uploadUrl?: string; error?: string; contentType?: string };
    if (!auth.ok || !a.uploadUrl) return setPhase({ kind: "failed", message: ERR[a.error ?? ""] ?? "Could not start the upload." });
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", a.uploadUrl);
    xhr.setRequestHeader("content-type", a.contentType ?? type);
    xhr.upload.onprogress = (e) => e.lengthComputable && setPhase({ kind: "uploading", pct: Math.round((e.loaded / e.total) * 100) });
    xhr.onerror = () => setPhase({ kind: "failed", message: "The upload was interrupted. Try again." });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return setPhase({ kind: "processing", label: "Waiting in the queue…" });
      let code = ""; try { code = JSON.parse(xhr.responseText).error; } catch { /* ignore */ }
      setPhase({ kind: "failed", message: ERR[code] ?? "The upload failed. Try again." });
    };
    xhr.send(file);
  }

  return (
    <div className="uploader">
      {phase.kind === "uploading" ? (
        <div role="status"><p>Uploading… {phase.pct}%</p><div className="progress" aria-hidden="true"><span style={{ width: `${phase.pct}%` }} /></div></div>
      ) : phase.kind === "processing" ? (
        <p role="status">{phase.label}</p>
      ) : phase.kind === "ready" ? (
        <p role="status" className="status-published">Audio is processed and ready.</p>
      ) : phase.kind === "failed" ? (
        <p role="alert" className="form-error">{phase.message}</p>
      ) : (
        <p className="muted">No audio uploaded yet.</p>
      )}
      {editable && phase.kind !== "uploading" && phase.kind !== "processing" ? (
        <label className="btn btn-ghost btn-sm">
          {phase.kind === "ready" ? "Replace audio" : "Choose audio file"}
          <input type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onFile(f); }} />
        </label>
      ) : null}
    </div>
  );
}
