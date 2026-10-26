"""
Browser run of Phase 5 Milestone B2 (sign-up fields, onboarding, profile/settings, public profile, recovery) against the LOCAL stack.
Run:  python3 tests/e2e/phase5b_accounts.py <base_url>      (fresh state: new usernames are generated per run)
The local auth shim sends no mail, so email-link steps (/auth/callback code exchange) are NOT covered here.
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

uname = f"tester_{int(time.time()) % 100000}"
email = f"{uname}@preview.test"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args=["--no-sandbox"])
    a = ctx(b).new_page()

    a.goto(f"{BASE}/terms"); check("terms page is marked draft", "pending review by a qualified adviser" in text(a))
    a.goto(f"{BASE}/privacy"); check("privacy page is marked draft", "Pending review by a qualified adviser" in text(a))

    # ---- sign-up validation ----
    a.goto(f"{BASE}/signup")
    a.fill("#name", "Test User"); a.fill("#email", email); a.fill("#password", PW)
    a.evaluate("document.querySelector('#username').removeAttribute('pattern')")
    a.fill("#username", "Bad Name!")
    a.evaluate("document.querySelector('input[name=terms]').removeAttribute('required')")
    a.click("button[type=submit]"); a.wait_for_selector("#username-err")
    check("sign-up rejects a malformed username", "lowercase letters" in text(a))
    a.check("input[name=terms]"); a.fill("#username", "admin")
    a.click("button[type=submit]"); a.wait_for_selector("#username-err:has-text('taken or not allowed')")
    check("sign-up rejects a reserved username", True)
    a.fill("#username", uname); a.uncheck("input[name=terms]")
    a.click("button[type=submit]"); a.wait_for_selector("[role=alert]:has-text('Accept the Terms')")
    check("sign-up requires terms acceptance", True)

    # ---- sign-up success -> onboarding ----
    a.check("input[name=terms]"); a.click("button[type=submit]")
    a.wait_for_url(lambda u: "/signup" not in u, timeout=15000)
    check("sign-up lands on onboarding", "/onboarding" in a.url, a.url)
    a.wait_for_selector("h1:not(.splash-word)")
    check("onboarding greets by display name", "Welcome, Test User" in text(a))
    a.click("button:has-text('Start listening')"); a.wait_for_url(lambda u: "/onboarding" not in u, timeout=15000)
    check("finishing onboarding goes to home", a.url.rstrip("/") == BASE.rstrip("/"), a.url)
    a.goto(f"{BASE}/onboarding"); a.wait_for_url(lambda u: "/onboarding" not in u, timeout=15000)
    check("onboarding is not shown again once completed", "/onboarding" not in a.url)

    # ---- account / profile ----
    a.goto(f"{BASE}/account"); a.wait_for_selector("#display_name")
    check("account shows username", f"@{uname}" in text(a))
    check("account shows verified email", "Email verified" in text(a))
    a.fill("#bio", "Hello from Monrovia"); a.select_option("#country", "LR"); a.check("input[name=profile_public]")
    a.click("button:has-text('Save profile')"); a.wait_for_selector("text=Profile saved")
    check("profile saves", True)
    other = ctx(b).new_page()
    other.goto(f"{BASE}/u/{uname}")
    check("public profile visible to anonymous when enabled", "Hello from Monrovia" in text(other) and f"@{uname}" in text(other))
    check("public profile hides email", email not in text(other))
    a.uncheck("input[name=profile_public]"); a.click("button:has-text('Save profile')"); a.wait_for_selector("text=Profile saved")
    gone = False
    for _ in range(10):  # the save is asynchronous; poll instead of trusting the earlier "Profile saved" text
        other.goto(f"{BASE}/u/{uname}")
        if "Hello from Monrovia" not in text(other): gone = True; break
        time.sleep(0.5)
    check("profile is a 404 again when made private", gone and "not found" in text(other).lower())

    # ---- change password ----
    a.fill("#current", "wrong-password-1"); a.fill("#password", "another-pass-22"); a.fill("#confirm", "another-pass-22")
    a.click("button:has-text('Change password')"); a.wait_for_selector("#current-err")
    check("change password requires the right current password", "incorrect" in text(a))
    a.fill("#current", PW); a.fill("#password", "another-pass-22"); a.fill("#confirm", "another-pass-22")
    a.click("button:has-text('Change password')"); a.wait_for_selector("[role=status]:has-text('Password changed')")
    check("change password succeeds", True)

    # ---- deletion request ----
    a.click("button:has-text('Request account deletion')"); a.wait_for_selector("text=Deletion requested")
    check("deletion request recorded", True)
    a.reload(); a.wait_for_selector("button:has-text('Cancel deletion request')")
    a.click("button:has-text('Cancel deletion request')"); a.wait_for_selector("text=Deletion request cancelled")
    check("deletion request can be cancelled", True)

    # ---- recovery is generic ----
    r = ctx(b).new_page()
    msgs = []
    for addr in (email, "nobody-here@preview.test"):
        r.goto(f"{BASE}/forgot-password"); r.fill("#email", addr); r.click("button[type=submit]"); r.wait_for_selector("[role=status]")
        msgs.append(r.locator("[role=status]").inner_text())
    check("recovery gives the same answer for known and unknown emails", msgs[0] == msgs[1] and "If that email" in msgs[0], str(msgs))
    r.goto(f"{BASE}/reset-password"); check("reset page without a recovery session offers a new link", "Request a new one" in text(r))

    # ---- sign out / sign in ----
    a.click("button:has-text('Sign out')"); a.wait_for_url(lambda u: "/account" not in u)
    a.goto(f"{BASE}/login"); a.fill("#email", email); a.fill("#password", PW); a.click("button[type=submit]")
    a.wait_for_selector("#email-err, .form-error", timeout=10000)
    check("old password stops working after change", "incorrect" in text(a))
    b.close()

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
