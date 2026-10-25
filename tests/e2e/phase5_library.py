"""
Browser run of Phase 5 Milestone 2 (Library, likes, follows, private playlists) against the LOCAL stack.
Run:  python3 tests/e2e/phase5_library.py <base_url>
Seeded accounts: listener@preview.test, other@preview.test (password preview-password-1).
"""
import re, sys
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
def login(page, email, nxt="/library"):
    page.goto(f"{BASE}/login?next={nxt}")
    page.fill("#email", email); page.fill("#password", PW); page.click("button[type=submit]")
    page.wait_for_url(lambda u: "/login" not in u)  # (a pattern ending in the next path would match the login URL itself)
    if nxt == "/library": page.wait_for_selector("#following", timeout=15000)  # the page streams; wait for real content, not the loading shell

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args=["--no-sandbox"])

    # ---- signed out ----
    a = ctx(b).new_page()
    a.goto(f"{BASE}/"); rel_href = a.locator("a[href^='/releases/']").first.get_attribute("href")
    a.goto(f"{BASE}{rel_href}")
    check("anon: release page has no like buttons and invites sign-in", a.locator("button[aria-label^='Add']").count() == 0 and "to like tracks" in a.content())
    track_href = a.locator("a[href^='/tracks/']").first.get_attribute("href")
    a.goto(f"{BASE}{track_href}"); check("anon: track page invites sign-in, no like button", a.locator("button[aria-pressed]").count() == 0 and "to like this track" in a.content())
    artist_href = a.locator("a[href^='/artists/']").first.get_attribute("href")
    a.goto(f"{BASE}{artist_href}"); check("anon: artist page invites sign-in, no follow button", a.locator("button[aria-label^='Follow']").count() == 0 and "to follow this artist" in a.content())
    a.goto(f"{BASE}/library"); check("anon: library asks to sign in and shows nothing private", "Sign in to build your library" in a.content())

    # ---- listener ----
    lc = ctx(b); l = lc.new_page(); login(l, "listener@preview.test")
    check("listener: empty library states", "You have no playlists yet." in l.content() and "No liked songs yet" in l.content() and "not following anyone yet" in l.content())

    l.fill("#new-playlist", "Road Trip"); l.click("button:has-text('Create playlist')")
    l.wait_for_url(re.compile(r".*/library/playlists/[0-9a-f-]{36}$")); pl_url = l.url
    check("listener: playlist created, private, empty", "Road Trip" in l.content() and "Private playlist" in l.content() and "This playlist is empty" in l.content())

    l.goto(f"{BASE}{track_href}")
    like = l.locator("button[aria-pressed]").first
    check("listener: like button present, not pressed", like.get_attribute("aria-pressed") == "false")
    like.click(); l.wait_for_selector("button[aria-pressed='true']")
    l.reload(); check("listener: like persists after reload", l.locator("button[aria-pressed='true']").count() >= 1)

    l.select_option("select[name=playlist_id]", label="Road Trip"); l.click("button:has-text('Add to playlist')")
    l.wait_for_selector("text=Added to playlist.")
    l.click("button:has-text('Add to playlist')"); l.wait_for_selector("text=Already in that playlist.")
    check("listener: add to playlist is idempotent", True)

    l.goto(pl_url); check("listener: playlist shows the track with a play button", l.locator(".lib-tracks li").count() == 1 and l.locator(".lib-tracks button[aria-label^='Play']").count() == 1)
    l.fill("#rename-playlist", "Road Trip 2"); l.click("button:has-text('Rename')"); l.wait_for_selector("text=Renamed.")
    l.reload(); check("listener: rename persisted", "Road Trip 2" in l.locator("h1:not(.splash-word)").inner_text())

    l.goto(f"{BASE}{artist_href}")
    l.locator("button[aria-label^='Follow']").click(); l.wait_for_selector("button[aria-label^='Unfollow']")
    check("listener: follow shows Following and 1 follower", "1 follower" in text(l))

    l.goto(f"{BASE}/library"); l.wait_for_selector("#following")
    check("library: shows liked track, playlist with 1 track, followed artist", l.locator(".lib-tracks li").count() == 1 and "1 track" in text(l) and l.locator("#following ~ ul a").count() == 1)

    # ---- another user cannot see any of it ----
    oc = ctx(b); o = oc.new_page(); login(o, "other@preview.test")
    check("other: library is empty (nothing leaks from listener)", "No liked songs yet" in text(o) and "You have no playlists yet." in text(o))
    o.goto(pl_url); check("other: listener's private playlist URL says not found", "Playlist not found" in o.content() and "Road Trip" not in o.content())
    o.goto(f"{BASE}{artist_href}"); o.wait_for_selector("button[aria-label^='Follow']"); check("other: follower count is aggregate only (1) and not following", "1 follower" in text(o) and o.locator("button[aria-label^='Follow']").count() == 1)

    # ---- undo ----
    l.goto(pl_url)
    l.locator("button[aria-label$='from this playlist']").click(); l.wait_for_selector("text=This playlist is empty")
    check("listener: remove track from playlist", True)
    l.click("button:has-text('Delete playlist')"); l.click("button:has-text('Yes, delete playlist')")
    l.wait_for_url(re.compile(r".*/library$")); l.wait_for_selector("text=You have no playlists yet.", timeout=5000)
    check("listener: delete playlist needs a second confirm and then removes it", "Road Trip" not in text(l))
    l.goto(f"{BASE}{track_href}"); l.locator("button[aria-pressed='true']").first.click(); l.wait_for_selector("button[aria-pressed='false']")
    l.goto(f"{BASE}{artist_href}"); l.locator("button[aria-label^='Unfollow']").click(); l.wait_for_selector("button[aria-label^='Follow']")
    l.goto(f"{BASE}/library"); l.wait_for_selector("#following"); check("listener: unlike and unfollow clear the library", "No liked songs yet" in l.content() and "not following anyone yet" in l.content())

    # ---- mobile layout, no horizontal scroll ----
    mc = b.new_context(viewport={"width": 375, "height": 800}); mc.add_init_script(SKIP_SPLASH); m = mc.new_page(); login(m, "listener@preview.test")
    check("mobile 375px: library has no horizontal scroll", m.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))

    b.close()

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
