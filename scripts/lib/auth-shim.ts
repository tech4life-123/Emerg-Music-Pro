/**
 * TEST-ONLY stand-in for Supabase Auth (GoTrue) so the sign-in, Studio and Admin flows can be exercised in a browser against the
 * local stack. It is NOT an auth server: passwords are held in memory, tokens are signed with the local PostgREST secret, and it
 * only implements the handful of endpoints supabase-js calls. Never deploy it. Real sign-in is Supabase Auth.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("base64url");

export function createAuthShim(opts: { secret: string; pool: Pool }) {
  const passwords = new Map<string, { id: string; password: string }>(); // email -> credentials

  const accessToken = (id: string, email: string) => {
    const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "authenticated", aud: "authenticated", sub: id, email, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    return `${h}.${sign(opts.secret, h)}`;
  };
  const refreshToken = (id: string) => `${id}.${sign(opts.secret, `refresh:${id}`)}`;
  const userObj = (id: string, email: string) => ({ id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
  const session = (id: string, email: string) => ({
    access_token: accessToken(id, email), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refreshToken(id), user: userObj(id, email),
  });
  const read = (req: IncomingMessage) => new Promise<Record<string, unknown>>((resolve) => {
    let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });
  const send = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(body === undefined ? undefined : JSON.stringify(body)); };
  const verify = (token: string): { sub: string; email: string } | null => {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const expected = Buffer.from(sign(opts.secret, `${h}.${p}`)), got = Buffer.from(s);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    const c = JSON.parse(Buffer.from(p, "base64url").toString()) as { sub: string; email: string; exp: number };
    return c.exp * 1000 > Date.now() ? c : null;
  };

  return {
    /** Register an account that already exists in auth.users (seeded users). */
    register(email: string, id: string, password: string) { passwords.set(email, { id, password }); },

    async handle(req: IncomingMessage, res: ServerResponse) {
      const url = new URL(req.url ?? "/", "http://x");
      const route = url.pathname.replace(/^\/auth\/v1/, "");
      if (route === "/token" && req.method === "POST") {
        const body = await read(req);
        if (url.searchParams.get("grant_type") === "refresh_token") {
          const [id, sig] = String(body.refresh_token ?? "").split(".");
          if (!id || sig !== sign(opts.secret, `refresh:${id}`)) return send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
          const row = await opts.pool.query("select email from auth.users where id = $1", [id]);
          return row.rowCount ? send(res, 200, session(id, row.rows[0].email)) : send(res, 400, { error: "invalid_grant" });
        }
        const email = String(body.email ?? "").toLowerCase();
        const acct = passwords.get(email);
        if (!acct || acct.password !== body.password) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        return send(res, 200, session(acct.id, email));
      }
      if (route === "/signup" && req.method === "POST") {
        const body = await read(req);
        const email = String(body.email ?? "").toLowerCase(), password = String(body.password ?? "");
        if (!email || password.length < 8) return send(res, 422, { msg: "invalid" });
        if (passwords.has(email)) return send(res, 422, { msg: "User already registered" });
        const meta = (body.data as object | undefined) ?? {};
        const r = await opts.pool.query("insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id", [email, JSON.stringify(meta)]);
        const id = r.rows[0].id as string;
        passwords.set(email, { id, password });
        return send(res, 200, session(id, email));
      }
      if (route === "/user" && (req.method === "GET" || req.method === "PUT")) {
        const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
        if (!claims) return send(res, 401, { msg: "invalid JWT" });
        if (req.method === "PUT") {
          const body = await read(req);
          const acct = passwords.get(claims.email);
          if (typeof body.password === "string" && acct && body.password.length >= 8) acct.password = body.password;
        }
        const row = await opts.pool.query("select email_confirmed_at from auth.users where id = $1", [claims.sub]);
        return send(res, 200, { ...userObj(claims.sub, claims.email), email_confirmed_at: row.rows[0]?.email_confirmed_at ?? null });
      }
      // Recovery / resend: GoTrue answers 200 and sends mail; here nothing is sent (the shim has no mailbox).
      if ((route === "/recover" || route === "/resend") && req.method === "POST") { await read(req); return send(res, 200, {}); }
      if (route === "/logout") return send(res, 204, undefined);
      return send(res, 404, { msg: "not implemented in the local auth shim" });
    },
  };
}
