"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";
import { ARTIST_IMAGE_SIZES, type ArtistImageKind } from "@/lib/artist-image";
import { AVATAR_MAX_INPUT_BYTES } from "@/lib/avatar";
import { cropToWebp } from "@/lib/image-crop";
import { removeArtistImageAction, setArtistImageAction } from "@/lib/studio/profile";

const OK = ["image/jpeg", "image/png", "image/webp"];
const COPY = {
  avatar: { title: "Artist picture", noun: "picture", hint: "Cropped to a square on your device before upload." },
  header: { title: "Header image", noun: "header", hint: "Wide banner (3:1). Cropped on your device before upload." },
} as const;

export function ArtistImageUploader({ kind, artistId, src, supabaseUrl, anonKey }: { kind: ArtistImageKind; artistId: string; src: string | null; supabaseUrl: string; anonKey: string }) {
  const [current, setCurrent] = useState(src);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = COPY[kind], size = ARTIST_IMAGE_SIZES[kind];

  async function onPick(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    if (!OK.includes(file.type)) return setMsg({ ok: false, text: "Choose a JPEG, PNG or WebP picture." });
    if (file.size > AVATAR_MAX_INPUT_BYTES) return setMsg({ ok: false, text: "That picture is too large (8 MB maximum)." });
    setBusy(true);
    try {
      const blob = await cropToWebp(file, size.w, size.h, kind === "header" ? 0.8 : 0.85);
      const name = `${artistId}/${kind}-${crypto.randomUUID()}.webp`;
      const sb = createBrowserClient(supabaseUrl, anonKey);
      const up = await sb.storage.from("artists").upload(name, blob, { contentType: "image/webp", upsert: false });
      if (up.error) throw new Error("upload");
      const res = await setArtistImageAction(kind, `artists/${name}`);
      if (res.status !== "success") throw new Error("save");
      setCurrent(URL.createObjectURL(blob));
      setMsg({ ok: true, text: `Your ${copy.noun} is updated.` });
    } catch {
      setMsg({ ok: false, text: `We could not update your ${copy.noun}. Try a different picture.` });
    } finally { setBusy(false); }
  }

  async function onRemove() {
    setBusy(true);
    const res = await removeArtistImageAction(kind);
    setBusy(false);
    if (res.status === "success") { setCurrent(null); setMsg({ ok: true, text: "Removed." }); }
    else setMsg({ ok: false, text: "Could not remove it." });
  }

  return (
    <div className="form card">
      <h2>{copy.title}</h2>
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current} alt={`Your ${copy.noun}`} style={kind === "avatar" ? { width: 96, height: 96, borderRadius: "50%", objectFit: "cover" } : { width: "100%", maxWidth: 480, aspectRatio: "3 / 1", objectFit: "cover", borderRadius: 8 }} />
      ) : <p className="muted">None yet.</p>}
      <label className="btn btn-ghost" style={{ width: "fit-content" }}>
        {busy ? "Working…" : current ? `Change ${copy.noun}` : `Upload ${copy.noun}`}
        <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} data-kind={kind} onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {current ? <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void onRemove()}>Remove {copy.noun}</button> : null}
      <p className="field-hint">{copy.hint}</p>
      {msg ? <p className={msg.ok ? "form-ok" : "form-error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p> : null}
    </div>
  );
}
