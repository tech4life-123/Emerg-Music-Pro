import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { AudioValidationError, type AudioWorker, type ProbeResult, type RenditionSpec } from "./types";

const run = promisify(execFile);

export interface LocalFfmpegOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  timeoutMs?: number;
}

/**
 * Local FFmpeg worker ($0). Uses execFile with an ARGUMENT ARRAY (never a shell string), so file names
 * cannot inject commands. Input/output paths must be absolute.
 */
export class LocalFfmpegWorker implements AudioWorker {
  private readonly ffmpeg: string;
  private readonly ffprobe: string;
  private readonly minDurationMs: number;
  private readonly maxDurationMs: number;
  private readonly timeoutMs: number;

  constructor(opts: LocalFfmpegOptions = {}) {
    this.ffmpeg = opts.ffmpegPath ?? "ffmpeg";
    this.ffprobe = opts.ffprobePath ?? (opts.ffmpegPath ? path.join(path.dirname(opts.ffmpegPath), "ffprobe") : "ffprobe");
    this.minDurationMs = opts.minDurationMs ?? 1_000;
    this.maxDurationMs = opts.maxDurationMs ?? 20 * 60_000;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  private static assertAbsolute(p: string): void {
    if (!path.isAbsolute(p) || p.includes("\0")) throw new Error("worker paths must be absolute");
  }

  async probe(inputPath: string): Promise<ProbeResult> {
    LocalFfmpegWorker.assertAbsolute(inputPath);
    let stdout: string;
    try {
      ({ stdout } = await run(
        this.ffprobe,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--", inputPath],
        { timeout: this.timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      ));
    } catch {
      throw new AudioValidationError("The file could not be read as audio.", "unreadable");
    }
    const info = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; bit_rate?: string }>;
      format?: { duration?: string; size?: string; bit_rate?: string };
    };
    const audio = info.streams?.find((s) => s.codec_type === "audio");
    if (!audio) throw new AudioValidationError("No audio stream found in the file.", "no_audio_stream");

    const durationMs = Math.round(Number(info.format?.duration ?? 0) * 1000);
    if (!Number.isFinite(durationMs) || durationMs < this.minDurationMs) {
      throw new AudioValidationError("The audio is too short.", "too_short");
    }
    if (durationMs > this.maxDurationMs) throw new AudioValidationError("The audio is too long.", "too_long");

    const br = Number(audio.bit_rate ?? info.format?.bit_rate ?? NaN);
    return {
      codec: audio.codec_name ?? "unknown",
      durationMs,
      sampleRate: Number(audio.sample_rate ?? 0),
      channels: audio.channels ?? 0,
      bitrateKbps: Number.isFinite(br) && br > 0 ? Math.round(br / 1000) : null,
      sizeBytes: Number(info.format?.size ?? 0),
    };
  }

  async transcode(inputPath: string, outputPath: string, spec: RenditionSpec): Promise<void> {
    LocalFfmpegWorker.assertAbsolute(inputPath);
    LocalFfmpegWorker.assertAbsolute(outputPath);
    if (!Number.isInteger(spec.bitrateKbps) || spec.bitrateKbps < 32 || spec.bitrateKbps > 320) {
      throw new Error("bitrateKbps must be an integer between 32 and 320");
    }
    await run(
      this.ffmpeg,
      ["-y", "-v", "error", "-i", inputPath, "-vn", "-map_metadata", "-1", "-c:a", "aac", "-b:a", `${spec.bitrateKbps}k`, "-movflags", "+faststart", outputPath],
      { timeout: this.timeoutMs },
    );
  }

  async waveformPeaks(inputPath: string, buckets: number): Promise<number[]> {
    LocalFfmpegWorker.assertAbsolute(inputPath);
    if (!Number.isInteger(buckets) || buckets < 8 || buckets > 2000) throw new Error("buckets must be 8..2000");
    const { stdout } = await run(
      this.ffmpeg,
      ["-v", "error", "-i", inputPath, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
      { timeout: this.timeoutMs, maxBuffer: 128 * 1024 * 1024, encoding: "buffer" },
    );
    const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
    const per = Math.max(1, Math.floor(samples.length / buckets));
    const peaks: number[] = [];
    for (let b = 0; b < buckets; b++) {
      let max = 0;
      const from = b * per;
      const to = b === buckets - 1 ? samples.length : from + per;
      for (let i = from; i < to; i++) max = Math.max(max, Math.abs(samples[i] ?? 0));
      peaks.push(Math.round((max / 32768) * 100) / 100);
    }
    return peaks;
  }
}
