"""
Browser run of Milestone C3 (artist profile editor, public page, admin verify, moderator assignment) against the LOCAL stack.
Run:  python3 tests/e2e/phase5c_profile.py <base_url>
Real image upload to Storage is NOT covered here (the local stack has no Storage service); it needs a live check.
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
def ctx(b):
    c = b.new_context(); c.add_init_script("try{sessionStorage.setItem('emerg-splash-seen','1')}catch(e){}"); return c
def login(page, email):
    page.goto(f"{BASE}/login"); page.fill("#email", email); page.fill("#password", PW); page.click("button[type=submit]")
    page.wait_for_url(lambda u: "/login" not in u, timeout=15000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args=["--no-sandbox"])

    # ---- start from a known state: not verified ----
    ad = ctx(b).new_page(); login(ad, "admin@preview.test"); ad.goto(f"{BASE}/admin/artists"); ad.wait_for_selector("text=Artists")
    if ad.locator("button:has-text('Remove verification')").count():
        ad.locator("button:has-text('Remove verification')").first.click(); ad.wait_for_selector("button:has-text('Verify artist')", timeout=15000)

    # ---- artist edits the profile ----
    a = ctx(b).new_page(); login(a, "artist@preview.test")
    a.goto(f"{BASE}/studio"); a.wait_for_selector("text=New release")
    check("studio links to the artist profile editor", a.locator("a:has-text('Artist profile')").count() == 1)
    a.goto(f"{BASE}/studio/profile"); a.wait_for_selector("#bio")
    slug = a.locator("a:has-text('View your public page')").get_attribute("href")
    check("editor shows picture, header and profile forms", "Artist picture" in text(a) and "Header image" in text(a) and "Public profile" in text(a))
    a.fill("#bio", "short"); a.click("button:has-text('Save profile')"); a.wait_for_selector("[role=alert]:has-text('at least 20')")
    check("a too-short bio is refused", True)
    a.fill("#bio", "Highlife and hip-hop from Monrovia.\nThanks for listening.")
    a.select_option("#artist_type", "band"); a.select_option("#country", "LR"); a.fill("#hometown", "Paynesville")
    a.fill("#links", "javascript:alert(1)"); a.fill("#contact_email", "booking@preview.test")
    a.click("button:has-text('Save profile')"); a.wait_for_selector("[role=alert]:has-text('http')")
    check("a javascript: link is refused", True)
    a.fill("#bio", "Highlife and hip-hop from Monrovia.\nThanks for listening.")
    a.select_option("#artist_type", "band"); a.select_option("#country", "LR")  # the form resets after a failed action
    a.fill("#links", "https://example.test/music\nhttps://example.test/shows"); a.fill("#hometown", "Paynesville"); a.fill("#contact_email", "booking@preview.test")
    opts = a.locator("#featured_release_id option").all_inner_texts()
    check("the featured-release choice lists published releases", len(opts) >= 2, str(opts))
    a.select_option("#featured_release_id", index=1)
    a.click("button:has-text('Save profile')"); a.wait_for_selector("[role=status]:has-text('Profile saved')", timeout=15000)
    check("profile saves", True)
    a.reload(); a.wait_for_selector("#bio")
    check("saved values come back, including the private contact email", a.input_value("#hometown") == "Paynesville" and a.input_value("#contact_email") == "booking@preview.test" and "example.test/shows" in a.input_value("#links"))

    # ---- public page ----
    pub = ctx(b).new_page(); pub.goto(f"{BASE}{slug}"); pub.wait_for_selector("text=Thanks for listening")
    t = text(pub)
    check("public page shows type, place, bio and links", "band" in t.lower() and "Paynesville, Liberia" in t and "Thanks for listening" in t and pub.locator("a[href='https://example.test/music']").count() == 1)
    check("external links open safely", "noopener" in (pub.locator("a[href='https://example.test/music']").get_attribute("rel") or ""))
    check("the contact email is not on the public page", "booking@preview.test" not in t)
    check("the featured release is shown first", "Featured" in t)
    check("not verified yet", pub.locator("h1 .chip:has-text('Verified')").count() == 0)

    # ---- someone else cannot reach the editor ----
    o = ctx(b).new_page(); login(o, "listener@preview.test"); o.goto(f"{BASE}/studio/profile")
    check("a non-artist gets a 404 on the editor", "not found" in text(o).lower() or "could not be found" in text(o).lower())

    # ---- admin verifies; moderators ----
    ad.goto(f"{BASE}/admin/artists"); ad.wait_for_selector("text=Verify artist")
    ad.locator("li", has=ad.locator(f"a[href='{slug}']")).first.locator("button:has-text('Verify artist')").click()
    ad.wait_for_selector("text=Remove verification", timeout=15000)
    pub.reload(); pub.wait_for_selector("text=Thanks for listening")
    check("admin verifies and the public badge appears", pub.locator("h1 .chip:has-text('Verified')").count() == 1)

    uname = f"mod_{int(time.time()) % 100000}"
    m = ctx(b).new_page(); m.goto(f"{BASE}/signup")
    m.fill("#name", "Future Moderator"); m.fill("#username", uname); m.fill("#email", f"{uname}@preview.test"); m.fill("#password", PW); m.check("input[name=terms]")
    m.click("button[type=submit]"); m.wait_for_url(lambda u: "/signup" not in u, timeout=15000)
    ad.goto(f"{BASE}/admin/people"); ad.wait_for_selector("#username")
    ad.fill("#username", uname); ad.select_option("#role", "moderator"); ad.click("button:has-text('Save')")
    ad.wait_for_selector("[role=status]:has-text('is now a moderator')", timeout=15000)
    check("admin makes someone a moderator", True)
    m.goto(f"{BASE}/staff/applications"); m.wait_for_selector("text=Application review", timeout=15000)
    check("the new moderator can open the staff screen", "not found" not in text(m).lower())
    ad.fill("#username", "artist_does_not_exist"); ad.click("button:has-text('Save')"); ad.wait_for_selector("[role=alert]:has-text('No one has that username')")
    check("an unknown username is refused", True)
    ad.goto(f"{BASE}/admin/people"); ad.wait_for_selector("#username")
    ad.fill("#username", uname); ad.select_option("#role", "listener"); ad.click("button:has-text('Save')"); ad.wait_for_selector("[role=status]:has-text('is now a listener')", timeout=15000)
    m.goto(f"{BASE}/staff/applications")
    check("removing the role closes the staff screen again", "not found" in text(m).lower() or "could not be found" in text(m).lower())

    # ---- moderator cannot verify (admin only) ----
    mo = ctx(b).new_page(); login(mo, "other@preview.test")
    mo.goto(f"{BASE}/admin/artists"); check("non-admins cannot open the artist admin screen", "not found" in text(mo).lower() or "could not be found" in text(mo).lower())
    b.close()

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
