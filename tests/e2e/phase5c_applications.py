"""
Browser run of Milestone C2 (artist application workflow + staff review) against the LOCAL stack.
Run:  python3 tests/e2e/phase5c_applications.py <base_url>
Needs: other@preview.test set to role 'moderator', listener@preview.test as a plain listener (the local-stack seeds both users).
"""
import sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1]
PW = "preview-password-1"
results = []
def text(page): return page.locator("body").inner_text()
def check(name, ok, extra=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{extra}]" if extra and not ok else ""))
SKIP_SPLASH = "try{sessionStorage.setItem('emerg-splash-seen','1')}catch(e){}"
def ctx(b):
    c = b.new_context(); c.add_init_script(SKIP_SPLASH); return c
def login(page, email):
    page.goto(f"{BASE}/login"); page.fill("#email", email); page.fill("#password", PW); page.click("button[type=submit]")
    page.wait_for_url(lambda u: "/login" not in u, timeout=15000)

uname = f"band_{int(time.time()) % 100000}"
email = f"{uname}@preview.test"
artist_name = f"Band {uname}"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args=["--no-sandbox"])

    # ---- applicant signs up and applies ----
    a = ctx(b).new_page()
    a.goto(f"{BASE}/signup")
    a.fill("#name", "Applicant"); a.fill("#username", uname); a.fill("#email", email); a.fill("#password", PW); a.check("input[name=terms]")
    a.click("button[type=submit]"); a.wait_for_url(lambda u: "/signup" not in u, timeout=15000)
    a.goto(f"{BASE}/studio"); a.wait_for_selector("text=Become an artist")
    check("new listener sees the invitation to apply", "Apply to publish music" in text(a))
    a.goto(f"{BASE}/studio/apply"); a.wait_for_selector("#artist_name")
    a.fill("#artist_name", artist_name); a.check("#accept")
    a.click("button[value=submit]"); a.wait_for_selector("[role=alert]:has-text('Fill in artist type')", timeout=15000)
    check("submitting an incomplete application is refused with a clear message", True)
    a.fill("#artist_name", artist_name); a.fill("#hometown", "Monrovia"); a.check("#accept"); a.click("button[value=save]"); a.wait_for_selector("[role=status]:has-text('Draft saved')")
    check("draft saves", True)
    a.goto(f"{BASE}/studio"); a.wait_for_selector("text=You have a draft application")
    check("studio shows the draft", True)
    a.goto(f"{BASE}/studio/apply"); a.wait_for_selector("#artist_name")
    check("draft values come back", a.input_value("#hometown") == "Monrovia" and a.input_value("#artist_name") == artist_name)
    a.select_option("#artist_type", "band"); a.select_option("#country", "LR")
    a.select_option("#genre_id", index=1); a.fill("#contact_email", email)
    a.fill("#bio", "We are a Monrovia band making highlife and hip-hop."); a.check("#authority"); a.check("#accept")
    a.click("button[value=submit]"); a.wait_for_url(lambda u: "/apply" not in u, timeout=15000)
    a.wait_for_selector("text=Application received")
    check("complete application is submitted", "Application received" in text(a))
    a.goto(f"{BASE}/studio/apply"); a.wait_for_url(lambda u: "/apply" not in u, timeout=15000)
    check("a submitted application cannot be edited (redirected to status)", "/studio/apply" not in a.url)

    # ---- access control ----
    l = ctx(b).new_page(); login(l, "listener@preview.test")
    l.goto(f"{BASE}/staff/applications"); check("an ordinary listener gets a 404 on the staff screen", "could not be found" in text(l).lower() or "not found" in text(l).lower())

    # ---- moderator ----
    m = ctx(b).new_page(); login(m, "other@preview.test")
    check("moderator lands on application review", "/staff/applications" in m.url, m.url)
    m.wait_for_selector(f"h2:has-text('{artist_name}')")
    check("moderator sees the submitted application with details", "band" in text(m) and "Monrovia" in text(m) and email in text(m))
    m.goto(f"{BASE}/admin"); check("moderator cannot open Administration", "not found" in text(m).lower())
    m.goto(f"{BASE}/staff/applications"); m.wait_for_selector(f"h2:has-text('{artist_name}')")
    card = m.locator("li", has=m.locator(f"h2:has-text('{artist_name}')")).last
    card.locator("button:has-text('Start review')").click(); m.wait_for_selector("text=Under review", timeout=15000)
    m.reload(); m.wait_for_selector(f"h2:has-text('{artist_name}')")
    check("start review moves it to Under review", "under review" in text(m).lower())
    card = m.locator("li", has=m.locator(f"h2:has-text('{artist_name}')")).last
    card.locator("textarea").first.fill("Please add a link to your music."); card.locator("button:has-text('Request information')").click()
    m.wait_for_selector("text=Waiting for applicant", timeout=15000)
    check("moderator can request more information", True)

    # ---- applicant answers ----
    a.goto(f"{BASE}/studio"); a.wait_for_selector("text=needs more information")
    check("applicant sees the request and the message", "Please add a link to your music." in text(a))
    a.fill("textarea#body", "Here it is: https://example.test/music"); a.click("button:has-text('Send reply')"); a.wait_for_selector("[role=status]:has-text('Reply sent')")
    check("applicant can reply", True)
    a.goto(f"{BASE}/studio/apply"); a.wait_for_selector("#artist_name")
    a.fill("#links", "https://example.test/music"); a.click("button[value=submit]"); a.wait_for_url(lambda u: "/apply" not in u, timeout=15000)
    a.wait_for_selector("text=Application received")
    check("applicant edits and resubmits", True)

    # ---- approval ----
    m.goto(f"{BASE}/staff/applications"); m.wait_for_selector(f"h2:has-text('{artist_name}')")
    check("moderator sees the reply in the thread", "Here it is" in text(m))
    card = m.locator("li", has=m.locator(f"h2:has-text('{artist_name}')")).last
    card.locator("button:has-text('Approve')").click(); m.wait_for_selector(f"h2:has-text('{artist_name}')", state="detached", timeout=15000)
    check("moderator approves", True)
    a.goto(f"{BASE}/studio"); a.wait_for_selector("text=New release", timeout=15000)
    check("applicant is now an artist with a studio", "New release" in text(a) and artist_name in text(a))
    pub = ctx(b).new_page(); pub.goto(f"{BASE}/search?q={uname}")
    b.close()

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
