/**
 * Generates the development sample audio: a synthesized 440 Hz sine tone (2s).
 * It is created locally by FFmpeg's signal generator - it is NOT music and contains no third-party material.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(__dirname, "../fixtures/sample");
mkdirSync(out, { recursive: true });
const file = path.join(out, "sample-tone-440hz.wav");
execFileSync(
  process.env.FFMPEG_PATH ?? "ffmpeg",
  ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=16000", "-ac", "1", "-c:a", "pcm_s16le", file],
  { stdio: "inherit" },
);
console.log(`wrote ${file}`);
