"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CloseIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "@/components/icons";

export interface PlayerTrack {
  id: string;
  title: string;
  artist: string;
  release: string;
}
type Status = "idle" | "loading" | "playing" | "paused" | "error";

interface PlayerApi {
  current: PlayerTrack | null;
  status: Status;
  play: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void;
}
const Ctx = createContext<PlayerApi | null>(null);

export function usePlayer(): PlayerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return v;
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/**
 * One <audio> element for the whole app. It lives in the shell layout, so music keeps playing while the listener
 * navigates. The browser never sees a storage URL: it asks /api/playback/authorize (all rights, territory and
 * publication checks happen on the server) and gets back a short-lived same-origin stream URL.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const seq = useRef(0); // ignores answers from a load that has been superseded
  const retried = useRef(false);
  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const load = useCallback(async (track: PlayerTrack, resumeAt = 0) => {
    const el = audio.current;
    if (!el) return;
    const mine = ++seq.current;
    setStatus("loading");
    setMessage(null);
    try {
      const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      const res = await fetch("/api/playback/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id, lowBandwidth: conn?.saveData === true }),
      });
      if (mine !== seq.current) return;
      if (!res.ok) {
        setStatus("error");
        setMessage(res.status === 429 ? "Too many requests. Wait a moment and try again." : "This track is not available to play right now.");
        return;
      }
      const { streamUrl } = (await res.json()) as { streamUrl: string };
      if (mine !== seq.current) return;
      el.src = streamUrl;
      if (resumeAt > 0) el.currentTime = resumeAt;
      await el.play();
    } catch (err) {
      if (mine !== seq.current) return;
      // Autoplay blocked or interrupted: the track is loaded and the listener can press play.
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) {
        setStatus("paused");
        return;
      }
      setStatus("error");
      setMessage("Playback could not start. Check your connection and try again.");
    }
  }, []);

  const play = useCallback(
    (track: PlayerTrack, q?: PlayerTrack[]) => {
      retried.current = false;
      setQueue(q && q.length > 0 ? q : [track]);
      setCurrent(track);
      setPosition(0);
      setDuration(0);
      void load(track);
    },
    [load],
  );

  const step = useCallback(
    (delta: number) => {
      if (!current) return;
      const i = queue.findIndex((t) => t.id === current.id);
      const target = queue[i + delta];
      if (target) play(target, queue);
    },
    [current, queue, play],
  );

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el || !current) return;
    if (el.paused) {
      if (!el.src) void load(current, position);
      else el.play().catch(() => setStatus("paused"));
    } else el.pause();
  }, [current, load, position]);

  const close = useCallback(() => {
    seq.current++;
    const el = audio.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    setCurrent(null);
    setQueue([]);
    setStatus("idle");
    setMessage(null);
  }, []);

  // Media keys, lock screen and headset controls.
  useEffect(() => {
    if (!current || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: current.release });
    navigator.mediaSession.setActionHandler("play", () => audio.current?.play().catch(() => undefined));
    navigator.mediaSession.setActionHandler("pause", () => audio.current?.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
    return () => {
      for (const a of ["play", "pause", "nexttrack", "previoustrack"] as const) navigator.mediaSession.setActionHandler(a, null);
    };
  }, [current, step]);

  const api = useMemo<PlayerApi>(() => ({ current, status, play, toggle }), [current, status, play, toggle]);
  const hasNext = current ? queue.findIndex((t) => t.id === current.id) < queue.length - 1 : false;
  const hasPrev = current ? queue.findIndex((t) => t.id === current.id) > 0 : false;

  return (
    <Ctx.Provider value={api}>
      {children}
      <audio
        ref={audio}
        preload="none"
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onPlaying={() => setStatus("playing")}
        onPlay={() => setStatus((s) => (s === "loading" ? s : "playing"))}
        onPause={() => setStatus((s) => (s === "loading" || s === "idle" || s === "error" ? s : "paused"))}
        onWaiting={() => setStatus("loading")}
        onEnded={() => (hasNext ? step(1) : setStatus("paused"))}
        onError={() => {
          // The stream URL is short-lived; if it expired mid-song, ask for a new one once and resume where we were.
          const el = audio.current;
          if (!current || !el?.src || el.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
          if (!retried.current) {
            retried.current = true;
            void load(current, el.currentTime);
          } else {
            setStatus("error");
            setMessage("Playback stopped. Try again.");
          }
        }}
      />
      {current ? (
        <section className="player" aria-label="Player">
          <div className="player-info">
            <Link href={`/tracks/${current.id}`} className="player-title">
              {current.title}
            </Link>
            <span className="muted player-sub">
              {current.artist} · {current.release}
            </span>
          </div>
          <div className="player-controls">
            <button type="button" className="icon-btn" aria-label="Previous track" disabled={!hasPrev} onClick={() => step(-1)}>
              <PrevIcon />
            </button>
            <button type="button" className="icon-btn icon-btn-main" aria-label={status === "playing" || status === "loading" ? "Pause" : "Play"} onClick={toggle}>
              {status === "playing" || status === "loading" ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button type="button" className="icon-btn" aria-label="Next track" disabled={!hasNext} onClick={() => step(1)}>
              <NextIcon />
            </button>
          </div>
          <div className="player-seek">
            <span className="muted player-time">{fmt(position)}</span>
            <input
              type="range"
              aria-label="Seek"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              step={1}
              value={Math.min(Math.floor(position), Math.max(1, Math.floor(duration)))}
              disabled={duration === 0}
              aria-valuetext={`${fmt(position)} of ${fmt(duration)}`}
              onChange={(e) => {
                const el = audio.current;
                if (el) el.currentTime = Number(e.target.value);
              }}
            />
            <span className="muted player-time">{fmt(duration)}</span>
          </div>
          <button type="button" className="icon-btn" aria-label="Close player" onClick={close}>
            <CloseIcon />
          </button>
          <p className="player-status" role="status" aria-live="polite">
            {status === "loading" ? "Loading…" : (message ?? "")}
          </p>
        </section>
      ) : null}
    </Ctx.Provider>
  );
}
