export type RangeResult = { kind: "none" } | { kind: "unsatisfiable" } | { kind: "range"; start: number; end: number };

/** Parse a single `Range: bytes=...` header against an object of `size` bytes (RFC 9110). */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { kind: "none" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: "unsatisfiable" }; // malformed or multi-range: refuse rather than guess
  const [, rawStart = "", rawEnd = ""] = m;
  if (rawStart === "" && rawEnd === "") return { kind: "unsatisfiable" };
  if (size <= 0) return { kind: "unsatisfiable" };

  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd); // last N bytes
    if (suffix === 0) return { kind: "unsatisfiable" };
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "range", start, end };
}
