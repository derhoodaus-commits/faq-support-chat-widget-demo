"""Browser test of the static GitHub Pages build (Playwright, Python, Chromium).

Builds the site into a temp folder, serves it like GitHub Pages under the sub-path
/faq-support-chat-widget-demo/ (static files only, 404.html for missing paths), and checks at 1440 px and 390 px:
page loads, demo notice, no console errors, no failed requests, no /api calls and no POSTs at all,
open/close by mouse and keyboard, answers with working source links, fallback with handoff,
handoff validation + "demo only, nothing was sent" confirmation, page links, foreign-site embed, 404 page.
Usage: python tests/e2e_pages.py   (screenshots go to a temp folder, or to $PAGES_SHOTS if set)
"""
import functools
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SUB = "faq-support-chat-widget-demo"
failures, passes = [], []


def check(cond, msg):
    (passes if cond else failures).append(msg)
    print(("  OK   " if cond else "  FAIL ") + msg)


class PagesHandler(http.server.SimpleHTTPRequestHandler):
    """Static files like GitHub Pages: fixed MIME types (the Windows registry can't interfere), 404.html for misses."""

    extensions_map = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", "": "application/octet-stream"}

    def send_error(self, code, message=None, explain=None):
        page = Path(self.directory) / SUB / "404.html"
        if code == 404 and page.exists():
            body = page.read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, *args):
        pass


def main():
    tmp = Path(tempfile.mkdtemp(prefix="widget-pages-"))
    shots = Path(os.environ.get("PAGES_SHOTS") or (tmp / "shots"))
    shots.mkdir(parents=True, exist_ok=True)
    site = tmp / "site"
    subprocess.run([shutil.which("node"), str(ROOT / "scripts" / "build-pages.js"), "--out", str(site / SUB)], cwd=ROOT, check=True)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(PagesHandler, directory=str(site)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://localhost:{httpd.server_address[1]}/{SUB}/"
    print(f"  INFO serving {base}")
    try:
        faq = json.loads((site / SUB / "faq.json").read_text(encoding="utf8"))
        answers = {e["id"]: e["answer"] for e in faq["entries"]}
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for name, opts in [
                ("desktop", {"viewport": {"width": 1440, "height": 900}}),
                ("phone", {"viewport": {"width": 390, "height": 844}, "has_touch": True, "is_mobile": True}),
            ]:
                print(f"\n[{name}]")
                run(browser, base, opts, name, answers, shots)
            browser.close()
    finally:
        httpd.shutdown()
        if not os.environ.get("PAGES_SHOTS"):
            shutil.rmtree(tmp, ignore_errors=True)
        else:
            shutil.rmtree(site, ignore_errors=True)
    print(f"\n{len(passes)} checks passed, {len(failures)} failed")
    if failures:
        print("\n".join("- " + f for f in failures))
        sys.exit(1)


SHADOW = "document.getElementById('farnhaus-chat').shadowRoot"


def bot_count(page):
    return page.evaluate(f"{SHADOW}.querySelectorAll('.msg.bot').length")


def ask(page, text):
    n = bot_count(page)
    page.locator("#farnhaus-chat #fh-input").fill(text)
    page.keyboard.press("Enter")
    page.wait_for_function(f"{SHADOW}.querySelectorAll('.msg.bot').length > {n}")
    return page.locator("#farnhaus-chat .msg.bot").last


def run(browser, base, opts, name, answers, shots):
    ctx = browser.new_context(locale="en-US", **opts)
    errors, failed, bad_status, api_calls, posts, foreign = [], [], [], [], [], []
    expected_404 = set()

    def wire(pg):
        pg.on("console", lambda m: errors.append(f"{pg.url}: {m.text}") if m.type == "error" and not any(u in m.text for u in ["404"]) else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))

    ctx.on("page", wire)
    ctx.on("requestfailed", lambda r: failed.append(f"{r.url} {r.failure}"))
    ctx.on("response", lambda r: bad_status.append(f"{r.status} {r.url}") if r.status >= 400 and r.url not in expected_404 else None)

    def on_request(r):
        if "/api/" in r.url:
            api_calls.append(r.url)
        if r.method != "GET":
            posts.append(f"{r.method} {r.url}")
        if not r.url.startswith(("http://localhost:", "data:")):
            foreign.append(r.url)

    ctx.on("request", on_request)
    page = ctx.new_page()
    mobile = name == "phone"
    tap = (lambda loc: loc.tap()) if mobile else (lambda loc: loc.click())

    resp = page.goto(base)
    check(resp.status == 200, f"Landing page loads under /{SUB}/ ({resp.status})")
    check("Farnhaus" in page.title(), "Title is the demo shop")
    bar = page.locator(".demo-bar")
    check(bar.is_visible() and "Demo project" in bar.inner_text() and "demo mode" in bar.inner_text() and "no messages are sent" in bar.inner_text(),
          "Visible notice: demo project, demo mode, nothing sent")
    page.locator("#embed").scroll_into_view_if_needed()
    check(page.locator("#embed pre").is_visible() and 'data-mode="static"' in page.locator("#embed pre").inner_text(), "Embed snippet section visible (static variant)")
    page.evaluate("window.scrollTo(0, 0)")
    over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(over <= 0, f"No horizontal scrolling on the landing page ({over}px)")
    page.screenshot(path=str(shots / f"pages-{name}-landing.png"), full_page=True)

    # Open / close with the mouse
    launcher = page.locator("#farnhaus-chat .launcher")
    panel = page.locator("#farnhaus-chat .panel")
    tap(launcher)
    check(panel.is_visible() and launcher.get_attribute("aria-expanded") == "true", "Opens by click/tap")
    page.wait_for_selector("#farnhaus-chat .chip")
    check(page.locator("#farnhaus-chat .chip").count() == 3, "Suggestions loaded from the static faq.json")
    check("Farnhaus Help" in page.inner_text("#farnhaus-chat #fh-title"), "Assistant name from the FAQ")
    mode = page.inner_text("#farnhaus-chat .mode")
    check("Demo mode" in mode and "nothing is sent" in mode, f"Mode line explains demo mode ({mode!r})")
    if mobile:
        page.wait_for_timeout(300)
        box = panel.bounding_box()
        check(box["width"] == 390 and box["height"] >= 840, f"Phone: chat is full screen ({box['width']}×{box['height']})")
    tap(page.locator("#farnhaus-chat .close"))
    check(panel.is_hidden() and launcher.get_attribute("aria-expanded") == "false", "Closes with the close button")

    # Keyboard: focus the launcher, Enter opens, Escape closes and returns focus
    launcher.focus()
    page.keyboard.press("Enter")
    check(panel.is_visible(), "Enter on the launcher opens it")
    check(page.evaluate(f"{SHADOW}.activeElement?.id") == "fh-input", "Focus moves to the input")
    page.keyboard.press("Escape")
    check(panel.is_hidden(), "Escape closes it")
    check(page.evaluate(f"{SHADOW}.activeElement?.className") == "launcher", "Focus returns to the launcher")
    page.keyboard.press("Space")
    check(panel.is_visible(), "Space on the launcher reopens it")

    # Typical questions → exact FAQ answer + source link to faq.html#id
    for q, eid in [("How much is shipping?", "shipping-cost"), ("how long does delivry take", "delivery-time"),
                   ("Is a Monstera safe for my cat?", None), ("Do you take PayPal?", "payment-methods"),
                   ("I'd like to send a plant back", "returns"), ("tiny black flies in the soil", None)]:
        bot = ask(page, q)
        text = bot.inner_text()
        link = bot.locator(".sources a")
        href = link.first.get_attribute("href") if link.count() else ""
        sid = href.rsplit("#", 1)[-1] if "#" in href else ""
        ok = link.count() == 1 and href.startswith(base + "faq.html#") and sid in answers and answers[sid] in text and (eid is None or sid == eid)
        check(ok, f"{q!r} → {sid or 'no source'}")

    # Source link opens the FAQ page at the right entry
    link = page.locator("#farnhaus-chat .msg.bot .sources a").first
    with ctx.expect_page() as pop:
        tap(link)
    faq_page = pop.value
    faq_page.wait_for_load_state()
    target = faq_page.url.rsplit("#", 1)[-1]
    check(faq_page.url.startswith(base + "faq.html#") and faq_page.locator(f"#{target}").is_visible()
          and faq_page.evaluate("document.querySelector(':target')?.id") == target, f"Source link opens faq.html at #{target}")
    faq_page.screenshot(path=str(shots / f"pages-{name}-faq.png"))
    faq_page.close()

    # Unknown question → honest fallback + handoff
    bot = ask(page, "What will the weather be like tomorrow?")
    check("team" in bot.inner_text() and bot.locator(".sources").count() == 0, "Unknown question: honest fallback, no source")
    handoff_btn = bot.locator("button", has_text="Talk to a person")
    check(handoff_btn.count() == 1, "Unknown question: offers 'Talk to a person'")
    bot = ask(page, "I want to talk to a human")
    check(bot.locator("button", has_text="Talk to a person").count() == 1, "'Talk to a human' → handoff button")
    page.screenshot(path=str(shots / f"pages-{name}-chat.png"))

    # Handoff: validation, then demo confirmation — nothing is sent
    tap(page.locator("#farnhaus-chat .msg.bot").last.locator("button", has_text="Talk to a person"))
    page.wait_for_selector("#farnhaus-chat .hf form")
    check("nothing is sent" in page.inner_text("#farnhaus-chat .hf .lead"), "Form says up front that nothing is sent")
    page.fill("#farnhaus-chat #hf-msg", "")
    tap(page.locator("#farnhaus-chat .hf .primary"))
    page.wait_for_selector("#farnhaus-chat [data-err='name']:not(:empty)")
    check(page.locator("#farnhaus-chat .hf [aria-invalid=true]").count() == 4, "Empty form: 4 fields marked invalid")
    check(page.evaluate(f"{SHADOW}.activeElement?.id") == "hf-name", "Focus on the first invalid field")
    page.fill("#farnhaus-chat #hf-name", "Jane Sample")
    page.fill("#farnhaus-chat #hf-email", "jane@example")
    page.fill("#farnhaus-chat #hf-msg", "My Monstera has yellow leaves.")
    page.check("#farnhaus-chat input[name=consent]")
    tap(page.locator("#farnhaus-chat .hf .primary"))
    check(page.inner_text("#farnhaus-chat [data-err='email']") != "" and page.locator("#farnhaus-chat .done").count() == 0, "Invalid email is rejected")
    page.screenshot(path=str(shots / f"pages-{name}-handoff-error.png"))
    page.fill("#farnhaus-chat #hf-email", "jane@example.org")
    tap(page.locator("#farnhaus-chat .hf .primary"))
    page.wait_for_selector("#farnhaus-chat .done")
    done = page.inner_text("#farnhaus-chat .done")
    check("Demo only" in done and "nothing was sent" in done, "Confirmation: demo only, nothing was sent")
    check(page.evaluate(f"{SHADOW}.activeElement?.className") == "done", "Focus on the confirmation")
    page.screenshot(path=str(shots / f"pages-{name}-handoff-done.png"))
    tap(page.locator("#farnhaus-chat .done .primary"))
    check(page.locator("#farnhaus-chat .log").is_visible(), "Back to chat")
    over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(over <= 0, "No horizontal scrolling with the chat open")
    page.keyboard.press("Escape")

    # Page links: foreign site (history survives), back to the shop, FAQ page
    n_msgs = page.locator("#farnhaus-chat .msg").count()
    page.locator("#embed a[href='foreign-site.html']").click()
    page.wait_for_url(base + "foreign-site.html")
    tap(page.locator("#farnhaus-chat .launcher"))
    page.wait_for_selector("#farnhaus-chat .msg")
    styles = page.evaluate(f"""() => {{ const r = {SHADOW}; const s = (e) => getComputedStyle(e);
        const b = r.querySelector('.msg.bot'), l = r.querySelector('.launcher');
        return {{ font: s(b).fontSize, family: s(b).fontFamily, bg: s(l).backgroundColor, left: s(l).left }} }}""")
    check(page.locator("#farnhaus-chat .msg").count() == n_msgs, "Foreign site: history carried over")
    check(styles["font"] == "15px" and "Courier" not in styles["family"], "Foreign site: page CSS doesn't leak into the widget")
    check(styles["bg"] == "rgb(122, 62, 157)" and (mobile or styles["left"] == "20px"), "Foreign site: data-color / data-position work")
    bot = ask(page, "Can I pay later on invoice?")
    check(answers["payment-methods"] in bot.inner_text(), "Foreign site: chat answers in static mode")
    page.screenshot(path=str(shots / f"pages-{name}-foreign.png"))
    page.keyboard.press("Escape")
    page.locator("a", has_text="Back to the demo shop").click()
    page.wait_for_url(base)
    check(page.locator(".demo-bar").is_visible(), "Foreign site: 'Back to the demo shop' works")
    page.locator("#embed a[href='faq.html']").click()
    page.wait_for_url(base + "faq.html")
    check(page.locator("article.q").count() == len(answers), f"FAQ page lists all {len(answers)} entries")
    page.locator("a", has_text="Back to the shop").click()
    page.wait_for_url(base)
    page.locator("a.logo").click()
    page.wait_for_url(base)
    check(True, "Logo link stays on the landing page")
    for a in page.locator("a[href^='#']").all():
        href = a.get_attribute("href")
        if len(href) > 1:
            check(page.locator(href).count() == 1, f"In-page link {href} has a target")

    # 404 at any depth, styled, links back under the sub-path
    missing = base + "no/such/page"
    expected_404.add(missing)
    r = page.goto(missing)
    check(r.status == 404 and "doesn't exist" in page.inner_text("h1"), "404.html is served for missing pages")
    page.screenshot(path=str(shots / f"pages-{name}-404.png"))
    page.locator("a.btn").click()
    page.wait_for_url(base)
    check(page.locator(".demo-bar").is_visible(), "404 page links back to the demo shop")

    check(not errors, f"No console errors {errors[:3]}")
    check(not failed, f"No failed requests {failed[:3]}")
    check(not bad_status, f"No HTTP errors {bad_status[:3]}")
    check(not api_calls, f"No /api calls {api_calls[:3]}")
    check(not posts, f"Nothing sent (no non-GET requests) {posts[:3]}")
    check(not foreign, f"No requests to other hosts {foreign[:3]}")
    ctx.close()


if __name__ == "__main__":
    main()
