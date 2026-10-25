"""
Browser run of the whole Phase 4 flow against the LOCAL stack (test-only auth shim, real pipeline, real RLS).
  artist: sign in -> new release -> add track -> upload audio -> worker processes -> declare rights + record -> submit
  admin : review -> approve rights -> publish -> anonymous can play (authorize 200) -> take down track (authorize 404) -> restore
  public: report form -> admin resolves -> audit log shows the actions
Run:  python3 tests/e2e/phase4_flow.py <base_url> <wav_path>
"""
import re, sys, json, time
from playwright.sync_api import sync_playwright, expect

BASE, WAV = sys.argv[1], sys.argv[2]
PW = "preview-password-1"
results = []
def check(name, ok, extra=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{extra}]" if extra and not ok else ""))

SKIP_SPLASH = "try{sessionStorage.setItem('emerg-splash-seen','1')}catch(e){}"
def ctx(b):
    c = b.new_context(); c.add_init_script(SKIP_SPLASH); return c

def login(page, email, password=PW, nxt="/studio"):
    page.goto(f"{BASE}/login?next={nxt}")
    page.fill("#email", email); page.fill("#password", password)
    page.click("button[type=submit]")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args=["--no-sandbox"])

    # ---------- access control before anything else ----------
    anon = ctx(b); pg = anon.new_page()
    pg.goto(f"{BASE}/admin"); check("anon: /admin is a plain 404 (does not advertise itself)", "Page not found" in pg.content() and "Administration" not in pg.content())
    pg.goto(f"{BASE}/studio"); check("anon: /studio asks to sign in", "Sign in to use the studio" in pg.content())
    pg.goto(f"{BASE}/login"); pg.fill("#email", "artist@preview.test"); pg.fill("#password", "wrong-password-1"); pg.click("button[type=submit]")
    pg.wait_for_selector("p.form-error"); check("bad password: generic error", "Email or password is incorrect." in pg.content())
    pg.goto(f"{BASE}/login?next=//evil.example"); pg.fill("#email", "artist@preview.test"); pg.fill("#password", PW); pg.click("button[type=submit]")
    pg.wait_for_url(re.compile(r".*/studio$")); check("open redirect ignored (lands on /studio)", pg.url.startswith(BASE))

    # ---------- artist ----------
    art = pg  # already signed in as the artist
    art.goto(f"{BASE}/studio"); check("artist: studio lists seeded release", "Placeholder Tones" in art.content())
    art.goto(f"{BASE}/admin"); check("artist: /admin is a plain 404", "Page not found" in art.content() and "Administration" not in art.content())
    art.goto(f"{BASE}/account"); check("artist: no admin link anywhere in the app", art.locator("a[href^='/admin']").count() == 0)
    art.goto(f"{BASE}/studio/releases/new")
    art.fill("#title", "E2E Single"); art.select_option("#genre_id", index=1); art.click("button:has-text('Create draft release')")
    art.wait_for_url(re.compile(r".*/studio/releases/[0-9a-f-]{36}$"))
    rel_url = art.url; rel_id = rel_url.rsplit("/", 1)[1]
    check("artist: draft release created", "E2E Single" in art.content())
    check("artist: submit disabled while incomplete", art.locator("button:has-text('Submit for review')").is_disabled())

    art.fill("#title", "E2E Track One"); art.click("button:has-text('Add track')")
    art.wait_for_selector("text=E2E Track One")
    art.locator("input[type=file]").set_input_files(WAV)
    art.wait_for_selector("text=Audio is processed and ready.", timeout=90000)
    check("artist: upload -> worker -> ready (polled)", True)

    art.check("#accept-rights"); art.click("button:has-text('Accept declaration')")
    art.wait_for_selector("text=Declaration accepted.")
    art.fill("#rights_holder_name", "E2E Artist"); art.fill("#territories", "WW"); art.fill("#term_start", "2020-01-01")
    art.click("button:has-text('Save rights record')"); art.wait_for_selector("text=Rights record saved")
    art.reload(); art.wait_for_selector("text=pending")
    art.fill("#territories", "xx!"); 
    check("artist: rights record visible as pending", "E2E Artist" in art.content())
    sub = art.locator("button:has-text('Submit for review')")
    check("artist: submit enabled when complete", sub.is_enabled())
    sub.click(); art.wait_for_selector("text=Submitted.")
    check("artist: status in review, no edit controls", "in review" in art.content() and art.locator("button:has-text('Add track')").count() == 0)

    # an artist cannot reach the admin decision surface even by URL
    art.goto(f"{BASE}/admin/releases/{rel_id}"); check("artist: admin release page is a 404", "Page not found" in art.content())

    # ---------- admin ----------
    adm = ctx(b); ap = adm.new_page()
    ap.goto(f"{BASE}/login"); ap.fill("#email", "admin@preview.test"); ap.fill("#password", PW); ap.click("button[type=submit]")
    ap.wait_for_url(re.compile(r"^[^?]*/admin$")); check("admin: signing in with no destination lands on /admin", True)
    ap.goto(f"{BASE}/"); check("admin: even the admin sees no admin link in the app", ap.locator("a[href^='/admin']").count() == 0)
    ap.goto(f"{BASE}/admin")
    ap.goto(f"{BASE}/admin/reviews"); check("admin: review queue shows the release", "E2E Single" in ap.content())
    ap.goto(f"{BASE}/admin/releases/{rel_id}")
    ap.locator("button:has-text('Publish')").click(); ap.wait_for_selector("p.form-error")
    msg = ap.locator("p.form-error").first.inner_text()
    check("admin: publish blocked until rights approved", "rights" in msg.lower() or "approved" in msg.lower(), msg)
    ap.locator("button:has-text('Request changes')").click(); ap.wait_for_selector("li:has-text('E2E Artist') p.form-error")
    msg = ap.locator("li:has-text('E2E Artist') p.form-error").first.inner_text()
    check("admin: changes require a note", "reason" in msg.lower(), msg)
    ap.locator("button:has-text('Approve')").first.click(); ap.wait_for_selector(".status-approved")
    ap.reload(); ap.locator("button:has-text('Publish')").click(); ap.wait_for_selector("text=Published.")
    check("admin: published", True)

    # ---------- public ----------
    pub = ctx(b); pp = pub.new_page()
    pp.goto(f"{BASE}/releases/{rel_id}"); check("public: release page visible", "E2E Single" in pp.content())
    track_id = re.search(r'/tracks/([0-9a-f-]{36})', pp.content()).group(1)
    r = pp.request.post(f"{BASE}/api/playback/authorize", data=json.dumps({"trackId": track_id}), headers={"content-type": "application/json", "origin": BASE})
    check("public: playback authorized after approval", r.status == 200, r.text())

    # ---------- takedown ----------
    ap.goto(f"{BASE}/admin/releases/{rel_id}")
    ap.locator("textarea").nth(-2).fill("") 
    ap.locator("li:has-text('E2E Track One') textarea").fill("Reported as infringing, taken down pending review.")
    ap.locator("button:has-text('Take down track')").click(); ap.wait_for_selector("text=Track taken down")
    r = pp.request.post(f"{BASE}/api/playback/authorize", data=json.dumps({"trackId": track_id}), headers={"content-type": "application/json", "origin": BASE})
    check("takedown: playback refused immediately", r.status in (403, 404), str(r.status))
    pp.goto(f"{BASE}/releases/{rel_id}"); check("takedown: track hidden from public release page", "E2E Track One" not in pp.content())
    art.goto(rel_url); check("takedown: artist sees the reason", "taken down pending review" in art.content())
    ap.goto(f"{BASE}/admin/releases/{rel_id}")
    ap.locator("li:has-text('E2E Track One') textarea").fill("Rights holder confirmed permission.")
    ap.locator("button:has-text('Restore track')").click(); ap.wait_for_selector("text=Track restored.")
    r = pp.request.post(f"{BASE}/api/playback/authorize", data=json.dumps({"trackId": track_id}), headers={"content-type": "application/json", "origin": BASE})
    check("restore: playback works again", r.status == 200, str(r.status))

    # ---------- public report -> admin ----------
    pp.goto(f"{BASE}/report?release={rel_id}&track={track_id}")
    pp.fill("#reporter_name", "Jane Reporter"); pp.fill("#reporter_email", "jane@example.test")
    pp.fill("#description", "This recording is my work and was uploaded without my permission.")
    pp.check("#confirm"); pp.click("button:has-text('Send report')"); pp.wait_for_selector("text=Thank you.")
    check("report: public submission accepted", True)
    pp.goto(f"{BASE}/report?release={rel_id}"); pp.click("button:has-text('Send report')"); pp.wait_for_selector(".field-error")
    check("report: empty form rejected", pp.locator(".field-error").count() > 0)
    ap.goto(f"{BASE}/admin/reports"); check("admin: report listed", "Jane Reporter" in ap.content())
    ap.locator("textarea").first.fill("Permission letter received; dismissed.")
    ap.locator("button:has-text('Dismiss')").first.click(); ap.wait_for_selector(".status-dismissed")
    ap.goto(f"{BASE}/admin/audit?action=takedown"); check("audit: takedown recorded", "takedown" in ap.content().lower() and "track" in ap.content())
    ap.goto(f"{BASE}/admin/audit"); check("audit: publish + report resolution recorded", ap.locator("tbody tr").count() >= 4)

    # ---------- sign out ----------
    art.goto(f"{BASE}/account"); art.click("button:has-text('Sign out')"); art.wait_for_url(f"{BASE}/")
    art.goto(f"{BASE}/studio"); check("sign out: studio requires sign-in again", "Sign in to use the studio" in art.content())
    # ---------- intro splash ----------
    fresh = b.new_context(); sp = fresh.new_page()
    sp.goto(f"{BASE}/"); check("splash: shown on first visit", sp.locator(".splash").count() == 1 and sp.locator(".splash").is_visible())
    check("splash: brand text present", "Emerg Music" in sp.locator(".splash").inner_text())
    sp.wait_for_selector(".splash", state="detached", timeout=8000); check("splash: leaves by itself after about 4 seconds", True)
    sp.reload(); check("splash: not replayed in the same session", sp.locator(".splash:visible").count() == 0)

    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
