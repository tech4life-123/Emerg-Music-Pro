"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";
import { AVATAR_MAX_INPUT_BYTES, AVATAR_SIZE } from "@/lib/avatar";
import { removeAvatarAction, setAvatarAction } from "@/lib/profile/actions";
import { UploadStage, uploadFailureText } from "@/lib/upload-errors";

const OK = ["image/jpeg", "image/png", "image/webp"];

/** Centre-crops to a square and re-encodes as 512x512 WebP: this strips metadata and guarantees an image, whatever was picked. */
async function cropToWebp(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
  if (!blob || blob.type !== "image/webp") throw new Error("encode");
  return blob;
}

export function AvatarUploader({ userId, src, supabaseUrl, anonKey }: { userId: string; src: string | null; supabaseUrl: string; anonKey: string }) {
  const [current, setCurrent] = useState(src);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    if (!OK.includes(file.type)) return setMsg({ ok: false, text: "Choose a JPEG, PNG or WebP picture." });
    if (file.size > AVATAR_MAX_INPUT_BYTES) return setMsg({ ok: false, text: "That picture is too large (8 MB maximum)." });
    setBusy(true);
    try {
      const blob = await cropToWebp(file).catch((e) => { throw new UploadStage("encode", String(e)); });
      const key = `${userId}/${crypto.randomUUID()}.webp`;
      const sb = createBrowserClient(supabaseUrl, anonKey);
      const up = await sb.storage.from("avatars").upload(key, blob, { contentType: "image/webp", upsert: false });
      if (up.error) throw new UploadStage("upload", up.error.message);
      const res = await setAvatarAction(`avatars/${key}`);
      if (res.status !== "success") throw new UploadStage("save", res.status === "error" ? res.message : "");
      setCurrent(URL.createObjectURL(blob));
      setMsg({ ok: true, text: "Photo updated." });
    } catch (e) {
      console.error("avatar_upload_failed", e);
      setMsg({ ok: false, text: uploadFailureText(e, "photo") });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    const res = await removeAvatarAction();
    setBusy(false);
    if (res.status === "success") { setCurrent(null); setMsg({ ok: true, text: "Photo removed." }); }
    else setMsg({ ok: false, text: res.status === "error" ? res.message : "Could not remove the photo." });
  }

  return (
    <div className="form card">
      <h2>Profile photo</h2>
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current} alt="Your profile photo" width={96} height={96} style={{ borderRadius: "50%", objectFit: "cover" }} />
      ) : <p className="muted">No photo yet.</p>}
      <label className="btn btn-ghost" style={{ width: "fit-content" }}>
        {busy ? "Working…" : current ? "Change photo" : "Upload photo"}
        <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {current ? <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void onRemove()}>Remove photo</button> : null}
      <p className="field-hint">The picture is cropped to a square and shrunk on your device before upload.</p>
      {msg ? <p className={msg.ok ? "form-ok" : "form-error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p> : null}
    </div>
  );
}
