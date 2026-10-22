/**
 * Audio processing contract. Phase 1 ships a local FFmpeg implementation; a hosted worker
 * (e.g. a container on a paid/free-tier host) can implement the same interface later without
 * touching callers.
 */
export interface ProbeResult {
  codec: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
  bitrateKbps: number | null;
  sizeBytes: number;
}

export interface RenditionSpec {
  bitrateKbps: number; // e.g. 64 | 96 | 160 (data-saver friendly)
}

export class AudioValidationError extends Error {
  constructor(
    message: string,
    readonly code: "no_audio_stream" | "too_short" | "too_long" | "unreadable",
  ) {
    super(message);
    this.name = "AudioValidationError";
  }
}

export interface AudioWorker {
  /** Throws AudioValidationError for files that are not usable audio. */
  probe(inputPath: string): Promise<ProbeResult>;
  /** Produces an AAC (m4a) rendition with metadata stripped. */
  transcode(inputPath: string, outputPath: string, spec: RenditionSpec): Promise<void>;
  /** Normalised 0..1 peak per bucket, for a REAL waveform (no decorative fakes). */
  waveformPeaks(inputPath: string, buckets: number): Promise<number[]>;
}
