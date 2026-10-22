"use client";

import { PauseIcon, PlayIcon } from "@/components/icons";
import { usePlayer, type PlayerTrack } from "./PlayerProvider";

/** Rendered only for tracks whose audio is ready; the server still re-checks rights and territory on every play. */
export function PlayButton({ track, queue, label, variant = "icon" }: { track: PlayerTrack; queue?: PlayerTrack[]; label?: string; variant?: "icon" | "button" }) {
  const { current, status, play, toggle } = usePlayer();
  const isCurrent = current?.id === track.id;
  const active = isCurrent && (status === "playing" || status === "loading");
  const text = active ? `Pause ${track.title}` : `Play ${track.title}`;
  const onClick = () => (isCurrent ? toggle() : play(track, queue));
  if (variant === "button") {
    return (
      <button type="button" className="btn" onClick={onClick}>
        {active ? <PauseIcon width={20} height={20} /> : <PlayIcon width={20} height={20} />}
        {label ?? (active ? "Pause" : "Play")}
      </button>
    );
  }
  return (
    <button type="button" className="icon-btn" aria-label={text} onClick={onClick}>
      {active ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}
