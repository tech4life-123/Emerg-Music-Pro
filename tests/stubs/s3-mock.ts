import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Minimal in-process S3-compatible server (path-style) for TESTING the R2 driver's wire behaviour through the real
 * AWS SDK: PUT / GET (+Range) / HEAD / DELETE and multipart upload. It does NOT verify signatures and it is NOT
 * Cloudflare R2: a passing test proves our driver speaks S3 correctly, not that a real bucket is configured safely.
 */
export interface S3Mock {
  endpoint: string;
  objects: Map<string, Buffer>; // "bucket/key" -> bytes
  multipartAborted: number;
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

/** aws-chunked bodies carry "<hex>;chunk-signature=...\r\n<data>\r\n" framing; strip it when present. */
function decodeAwsChunked(buf: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 0;
  while (i < buf.length) {
    const eol = buf.indexOf("\r\n", i);
    if (eol < 0) break;
    const size = parseInt(buf.subarray(i, eol).toString().split(";")[0]!, 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buf.subarray(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  return Buffer.concat(out);
}

export async function startS3Mock(): Promise<S3Mock> {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, { target: string; parts: Map<number, Buffer> }>();
  const state = { multipartAborted: 0 };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const target = decodeURIComponent(url.pathname.slice(1));
    const send = (status: number, xml = "", headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/xml", "Content-Length": Buffer.byteLength(xml), ...headers });
      res.end(req.method === "HEAD" ? undefined : xml);
    };
    const notFound = () => send(404, `<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>`);
    try {
      if (req.method === "POST" && url.searchParams.has("uploads")) {
        const id = randomUUID();
        uploads.set(id, { target, parts: new Map() });
        return send(200, `<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
      }
      if (req.method === "PUT" && url.searchParams.has("partNumber")) {
        const up = uploads.get(url.searchParams.get("uploadId")!);
        if (!up) return notFound();
        const raw = await body(req);
        const data = req.headers["content-encoding"] === "aws-chunked" || String(req.headers["x-amz-content-sha256"]).startsWith("STREAMING") ? decodeAwsChunked(raw) : raw;
        up.parts.set(Number(url.searchParams.get("partNumber")), data);
        return send(200, "", { ETag: `"p${url.searchParams.get("partNumber")}"` });
      }
      if (req.method === "POST" && url.searchParams.has("uploadId")) {
        const id = url.searchParams.get("uploadId")!;
        const up = uploads.get(id);
        await body(req);
        if (!up) return notFound();
        objects.set(up.target, Buffer.concat([...up.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d)));
        uploads.delete(id);
        return send(200, `<?xml version="1.0"?><CompleteMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>`);
      }
      if (req.method === "DELETE" && url.searchParams.has("uploadId")) {
        if (uploads.delete(url.searchParams.get("uploadId")!)) state.multipartAborted++;
        return send(204);
      }
      if (req.method === "PUT") {
        const raw = await body(req);
        const data = req.headers["content-encoding"] === "aws-chunked" || String(req.headers["x-amz-content-sha256"]).startsWith("STREAMING") ? decodeAwsChunked(raw) : raw;
        objects.set(target, data);
        return send(200, "", { ETag: '"single"' });
      }
      if (req.method === "DELETE") {
        objects.delete(target);
        return send(204);
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const obj = objects.get(target);
        if (!obj) return notFound();
        const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ""));
        if (m && req.method === "GET") {
          const start = Number(m[1]);
          const end = Math.min(Number(m[2]), obj.length - 1);
          const slice = obj.subarray(start, end + 1);
          res.writeHead(206, { "Content-Length": slice.length, "Content-Range": `bytes ${start}-${end}/${obj.length}`, "Content-Type": "application/octet-stream" });
          return void res.end(slice);
        }
        res.writeHead(200, { "Content-Length": obj.length, "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes" });
        return void res.end(req.method === "HEAD" ? undefined : obj);
      }
      send(405);
    } catch {
      send(500);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    get multipartAborted() {
      return state.multipartAborted;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
