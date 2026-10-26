import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { anon, createTestDb, createUser, genreId, makeAdmin, query, superuser, user, type TestDb } from "./helpers";

let db: TestDb;
let admin: string;
let mod: string;
let genre: string;
beforeAll(async () => {
  db = await createTestDb();
  admin = await makeAdmin(db.pool);
  genre = await genreId(db.pool);
  mod = await createUser(db.pool, "mod");
  await query(db.pool, user(admin), "select public.set_user_role($1, 'moderator')", [mod]);
});
afterAll(async () => db.drop());

const q = <T = Record<string, unknown>>(who: ReturnType<typeof user> | typeof anon | typeof superuser, sql: string, args: unknown[] = []) => query<T>(db.pool, who, sql, args);

async function draft(uid: string, name = `Band ${randomUUID().slice(0, 6)}`) {
  const r = await q<{ id: string }>(user(uid), `insert into public.artist_applications (user_id, artist_name, rights_statement_accepted, status) values ($1,$2,true,'draft') returning id`, [uid, name]);
  return r.rows[0]!.id;
}
async function complete(uid: string, id: string) {
  await q(user(uid), `update public.artist_applications set artist_type='solo', country='LR', genre_id=$2, contact_email='a@b.test', bio='A long enough bio for review.', authority_confirmed=true where id=$1`, [id, genre]);
}
const status = async (id: string) => (await q<{ status: string }>(superuser, "select status::text from public.artist_applications where id=$1", [id])).rows[0]!.status;

describe("roles", () => {
  it("only an admin can set listener/moderator, never admin or artist, never for an artist or admin", async () => {
    const p = await createUser(db.pool, "plain");
    await expect(q(user(p), "select public.set_user_role($1, 'moderator')", [p])).rejects.toThrow(/Admin only/);
    await expect(q(user(admin), "select public.set_user_role($1, 'admin')", [p])).rejects.toThrow(/listener or moderator/);
    await expect(q(user(admin), "select public.set_user_role($1, 'moderator')", [admin])).rejects.toThrow(/cannot be changed/);
    await expect(q(user(p), "update public.profiles set role='moderator' where id=$1", [p])).rejects.toThrow(/permission denied/);
  });
  it("moderator is staff but not admin", async () => {
    expect((await q<{ s: boolean; a: boolean }>(user(mod), "select private.is_staff() s, private.is_admin() a")).rows[0]).toEqual({ s: true, a: false });
  });
});

describe("application drafts", () => {
  it("an unverified email cannot create or submit", async () => {
    const u = await createUser(db.pool, "unv");
    await q(superuser, "update auth.users set email_confirmed_at = null where id=$1", [u]);
    await expect(draft(u)).rejects.toThrow(/row-level security/);
  });
  it("the owner edits a draft but cannot change status, and others cannot touch it", async () => {
    const u = await createUser(db.pool, "own"), o = await createUser(db.pool, "oth");
    const id = await draft(u);
    expect((await q(user(u), "update public.artist_applications set hometown='Monrovia' where id=$1", [id])).rowCount).toBe(1);
    await expect(q(user(u), "update public.artist_applications set status='approved' where id=$1", [id])).rejects.toThrow(/permission denied/);
    expect((await q(user(o), "update public.artist_applications set hometown='X' where id=$1", [id])).rowCount).toBe(0);
    expect((await q(user(o), "select 1 from public.artist_applications where id=$1", [id])).rowCount).toBe(0);
  });
  it("only one active application per person", async () => {
    const u = await createUser(db.pool, "dup");
    await draft(u);
    await expect(draft(u)).rejects.toThrow(/one_active_per_user/);
  });
});

describe("submit", () => {
  it("rejects incomplete, then accepts a complete application and locks editing", async () => {
    const u = await createUser(db.pool, "sub"); const id = await draft(u);
    await expect(q(user(u), "select public.submit_artist_application($1)", [id])).rejects.toThrow(/Fill in artist type/);
    await complete(u, id);
    await q(user(u), "select public.submit_artist_application($1)", [id]);
    expect(await status(id)).toBe("pending");
    expect((await q(user(u), "update public.artist_applications set hometown='Late' where id=$1", [id])).rowCount).toBe(0);
  });
  it("needs the authority confirmation and a bio", async () => {
    const u = await createUser(db.pool, "auth"); const id = await draft(u);
    await complete(u, id);
    await q(user(u), "update public.artist_applications set authority_confirmed=false where id=$1", [id]);
    await expect(q(user(u), "select public.submit_artist_application($1)", [id])).rejects.toThrow(/authorised/);
    await q(user(u), "update public.artist_applications set authority_confirmed=true, bio='short' where id=$1", [id]);
    await expect(q(user(u), "select public.submit_artist_application($1)", [id])).rejects.toThrow(/short bio/);
  });
  it("cannot submit someone else's application, or one whose name is already taken", async () => {
    const u = await createUser(db.pool, "mine"), o = await createUser(db.pool, "thief");
    const id = await draft(u, "Unique Name One"); await complete(u, id);
    await expect(q(user(o), "select public.submit_artist_application($1)", [id])).rejects.toThrow(/not found/);
    await q(user(u), "select public.submit_artist_application($1)", [id]);
    await q(user(mod), "select public.approve_artist_application($1)", [id]);
    const w = await createUser(db.pool, "same"); const id2 = await draft(w, "unique name one"); await complete(w, id2);
    await expect(q(user(w), "select public.submit_artist_application($1)", [id2])).rejects.toThrow(/already exists/);
  });
  it("an unverified email cannot submit even a finished draft", async () => {
    const u = await createUser(db.pool, "late"); const id = await draft(u); await complete(u, id);
    await q(superuser, "update auth.users set email_confirmed_at = null where id=$1", [u]);
    await expect(q(user(u), "select public.submit_artist_application($1)", [id])).rejects.toThrow(/Verify your email/);
  });
});

describe("staff review and messages", () => {
  it("moderator reviews, asks for info; applicant sees it, replies, edits and resubmits; strangers see nothing", async () => {
    const u = await createUser(db.pool, "flow"), s = await createUser(db.pool, "stranger");
    const id = await draft(u); await complete(u, id);
    await q(user(u), "select public.submit_artist_application($1)", [id]);
    await expect(q(user(u), "select public.start_application_review($1)", [id])).rejects.toThrow(/Staff only/);
    await q(user(mod), "select public.start_application_review($1)", [id]);
    expect(await status(id)).toBe("under_review");
    await expect(q(user(mod), "select public.request_application_info($1, '   ')", [id])).rejects.toThrow(/Write what you need/);
    await q(user(mod), "select public.request_application_info($1, 'Please add a link to your music')", [id]);
    expect(await status(id)).toBe("info_requested");
    expect((await q(user(u), "select body from public.application_messages where application_id=$1", [id])).rows).toEqual([{ body: "Please add a link to your music" }]);
    expect((await q(user(s), "select 1 from public.application_messages where application_id=$1", [id])).rowCount).toBe(0);
    await q(user(u), "insert into public.application_messages (application_id, author_id, from_staff, body) values ($1,$2,false,'Added')", [id, u]);
    await expect(q(user(u), "insert into public.application_messages (application_id, author_id, from_staff, body) values ($1,$2,true,'I am staff')", [id, u])).rejects.toThrow(/row-level security/);
    await expect(q(user(s), "insert into public.application_messages (application_id, author_id, from_staff, body) values ($1,$2,false,'hi')", [id, s])).rejects.toThrow(/row-level security/);
    await q(user(u), "update public.artist_applications set links = array['https://example.test/m'] where id=$1", [id]);
    await q(user(u), "select public.submit_artist_application($1)", [id]);
    expect(await status(id)).toBe("pending");
  });
  it("staff can read applications and messages; ordinary users cannot approve or reject", async () => {
    const u = await createUser(db.pool, "rd"); const id = await draft(u); await complete(u, id);
    expect((await q(user(mod), "select 1 from public.artist_applications where id=$1", [id])).rowCount).toBe(1);
    await expect(q(user(u), "select public.approve_artist_application($1)", [id])).rejects.toThrow(/Staff only/);
    await expect(q(user(u), "select public.reject_artist_application($1, 'x')", [id])).rejects.toThrow(/Staff only/);
  });
  it("a moderator rejection needs a reason; approval copies the profile fields and keeps the email private", async () => {
    const u = await createUser(db.pool, "dec"); const id = await draft(u, "Decision Artist"); await complete(u, id);
    await q(user(u), "select public.submit_artist_application($1)", [id]);
    await expect(q(user(mod), "select public.reject_artist_application($1, '')", [id])).rejects.toThrow(/reason/);
    const art = (await q<{ approve_artist_application: string }>(user(mod), "select public.approve_artist_application($1)", [id])).rows[0]!.approve_artist_application;
    const a = (await q<Record<string, unknown>>(anon, "select artist_type, country from public.artists where id=$1", [art])).rows[0];
    expect(a).toEqual({ artist_type: "solo", country: "LR" });
    expect((await q(anon, "select 1 from public.artist_private where artist_id=$1", [art]).catch(() => ({ rowCount: 0 }))).rowCount).toBe(0);
    expect((await q(user(u), "select contact_email from public.artist_private where artist_id=$1", [art])).rows).toEqual([{ contact_email: "a@b.test" }]);
    expect((await q(user(await createUser(db.pool, "nosy")), "select 1 from public.artist_private where artist_id=$1", [art])).rowCount).toBe(0);
    expect((await q(superuser, "select role::text r from public.profiles where id=$1", [u])).rows[0]!.r).toBe("artist");
  });
});

describe("artist profile", () => {
  let owner: string; let artist: string;
  beforeAll(async () => {
    owner = await createUser(db.pool, "prof");
    const id = await draft(owner, "Profile Artist"); await complete(owner, id);
    await q(user(owner), "select public.submit_artist_application($1)", [id]);
    artist = (await q<{ approve_artist_application: string }>(user(admin), "select public.approve_artist_application($1)", [id])).rows[0]!.approve_artist_application;
  });
  it("the owner edits profile fields but cannot self-verify; only an admin verifies", async () => {
    expect((await q(user(owner), "update public.artists set hometown='Paynesville', links=array['https://x.test'] where id=$1", [artist])).rowCount).toBe(1);
    await expect(q(user(owner), "update public.artists set verified_at=now() where id=$1", [artist])).rejects.toThrow(/permission denied/);
    await expect(q(user(owner), "select public.set_artist_verified($1, true)", [artist])).rejects.toThrow(/Admin only/);
    await expect(q(user(mod), "select public.set_artist_verified($1, true)", [artist])).rejects.toThrow(/Admin only/);
    await q(user(admin), "select public.set_artist_verified($1, true)", [artist]);
    expect((await q(anon, "select verified_at is not null v from public.artists where id=$1", [artist])).rows[0]).toEqual({ v: true });
  });
  it("someone else cannot edit it", async () => {
    const o = await createUser(db.pool, "intruder");
    expect((await q(user(o), "update public.artists set bio='hacked' where id=$1", [artist])).rowCount).toBe(0);
  });
  it("image paths must be inside the artist's own folder", async () => {
    await q(user(owner), "update public.artists set header_url=$2, image_url=$3 where id=$1", [artist, `artists/${artist}/h.webp`, `artists/${artist}/a.webp`]);
    await expect(q(user(owner), "update public.artists set header_url=$2 where id=$1", [artist, `artists/${randomUUID()}/h.webp`])).rejects.toThrow(/artists_header_own_folder/);
    await expect(q(user(owner), "update public.artists set image_url='https://tracker.test/x.png' where id=$1", [artist])).rejects.toThrow(/artists_image_own_folder/);
  });
  it("a featured release must be the artist's own published release", async () => {
    const rel = (await q<{ id: string }>(user(owner), "insert into public.releases (artist_id, title) values ($1,'Draft') returning id", [artist])).rows[0]!.id;
    await expect(q(user(owner), "update public.artists set featured_release_id=$2 where id=$1", [artist, rel])).rejects.toThrow(/published releases/);
    await expect(q(user(owner), "update public.artists set featured_release_id=$2 where id=$1", [artist, randomUUID()])).rejects.toThrow(/published releases/);
  });
});

describe("artists bucket", () => {
  let owner: string; let artist: string;
  beforeAll(async () => {
    owner = await createUser(db.pool, "img");
    const id = await draft(owner, "Image Artist"); await complete(owner, id);
    await q(user(owner), "select public.submit_artist_application($1)", [id]);
    artist = (await q<{ approve_artist_application: string }>(user(admin), "select public.approve_artist_application($1)", [id])).rows[0]!.approve_artist_application;
  });
  const put = (who: ReturnType<typeof user>, folder: string) => q(who, "insert into storage.objects (bucket_id, name) values ('artists', $1)", [`${folder}/${randomUUID()}.webp`]);
  it("is public, 1 MB, webp/jpeg/png only", async () => {
    const r = (await q<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(superuser, "select * from storage.buckets where id='artists'")).rows[0]!;
    expect(r.public).toBe(true); expect(Number(r.file_size_limit)).toBe(1048576);
    expect([...r.allowed_mime_types].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
  it("the owner writes into the artist folder; others, root and non-uuid folders are refused", async () => {
    expect((await put(user(owner), artist)).rowCount).toBe(1);
    const o = await createUser(db.pool, "other");
    await expect(put(user(o), artist)).rejects.toThrow(/row-level security/);
    await expect(put(user(owner), randomUUID())).rejects.toThrow(/row-level security/);
    await expect(put(user(owner), "not-a-uuid")).rejects.toThrow(/row-level security/);
    await expect(q(user(owner), "insert into storage.objects (bucket_id, name) values ('artists','root.webp')")).rejects.toThrow(/row-level security/);
    await expect(put(anon as never, artist)).rejects.toThrow(/permission denied|row-level security/);
  });
});
