import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalFfmpegWorker } from "@/lib/worker/local-ffmpeg";
import { AudioValidationError } from "@/lib/worker/types";

const SAMPLE = path.resolve(__dirname, "../../fixtures/sample/sample-tone-440hz.wav");
let dir: string;
let SILENCE = "";
const worker = new LocalFfmpegWorker();

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "emerg-worker-"));
  SILENCE = path.join(dir, "silence.wav");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "2", SILENCE]);
});
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe("LocalFfmpegWorker (real FFmpeg on the synthesized sample)", () => {
  it("probes the sample tone", async () => {
    const p = await worker.probe(SAMPLE);
    expect(p).toMatchObject({ codec: "pcm_s16le", sampleRate: 16000, channels: 1 });
    expect(p.durationMs).toBeGreaterThan(1900);
    expect(p.durationMs).toBeLessThan(2100);
  });
  it("transcodes to AAC at the requested bitrate, with metadata stripped", async () => {
    const out = path.join(dir, "r96.m4a");
    await worker.transcode(SAMPLE, out, { bitrateKbps: 96 });
    expect((await stat(out)).size).toBeGreaterThan(1000);
    const p = await worker.probe(out);
    expect(p.codec).toBe("aac");
    const tags = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format_tags", "-of", "json", out]).toString();
    expect(JSON.parse(tags).format.tags?.title).toBeUndefined();
  });
  it("computes a real waveform: a constant tone gives a steady non-zero envelope", async () => {
    const peaks = await worker.waveformPeaks(SAMPLE, 20);
    expect(peaks).toHaveLength(20);
    // FFmpeg's sine source has amplitude 1/8 = 0.125, so the true peak is ~0.12 (not normalised).
    const inner = peaks.slice(1, -1);
    expect(Math.min(...inner)).toBeGreaterThanOrEqual(0.1);
    expect(Math.max(...inner)).toBeLessThanOrEqual(0.13);
    expect(Math.max(...inner) - Math.min(...inner)).toBeLessThanOrEqual(0.02); // flat envelope
    // and silence really is silence
    expect(await worker.waveformPeaks(SILENCE, 10)).toEqual(Array(10).fill(0));
  });
  it("rejects non-audio files and audio that is too short", async () => {
    const junk = path.join(dir, "junk.wav");
    await writeFile(junk, "this is not audio at all");
    await expect(worker.probe(junk)).rejects.toBeInstanceOf(AudioValidationError);

    const tiny = path.join(dir, "tiny.wav");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=duration=0.2", tiny]);
    await expect(worker.probe(tiny)).rejects.toMatchObject({ code: "too_short" });
  });
  it("refuses relative paths and out-of-range bitrates, and survives shell metacharacters in names", async () => {
    await expect(worker.probe("relative.wav")).rejects.toThrow(/absolute/);
    await expect(worker.transcode(SAMPLE, path.join(dir, "x.m4a"), { bitrateKbps: 9999 })).rejects.toThrow(/bitrateKbps/);
    const weird = path.join(dir, "a; touch pwned #.m4a");
    await worker.transcode(SAMPLE, weird, { bitrateKbps: 64 });
    await expect(stat(path.join(dir, "pwned"))).rejects.toThrow(); // no command was injected
  });
});
