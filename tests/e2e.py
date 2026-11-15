"""Browser test of the help widget with Playwright (Python, Chromium) in demo mode.

Starts the server without an API key, embeds the widget via the demo pages, and checks:
open/close by mouse and keyboard, questions with sources, typos, unknown questions,
handoff to a person (error and success), history across page changes, full screen on phones,
isolation from foreign CSS, contrast, console errors. Screenshots → screenshots/.
Usage: python tests/e2e.py
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)
failures, passes = [], []


def check(cond, msg):
    (passes if cond else failures).append(msg)
    print(("  OK   " if cond else "  FAIL ") + msg)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


CONTRAST_IN_SHADOW = r"""
() => {
  const root = document.getElementById('farnhaus-chat').shadowRoot;
  const lum = (c) => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126*r + .7152*g + .0722*b; };
  const parse = (s) => s.match(/[\d.]+/g).map(Number);
  const bgOf = (el) => { while (el && el.nodeType === 1) { const c = parse(getComputedStyle(el).backgroundColor); if (c.length < 4 || c[3] > .5) return c.slice(0, 3); el = el.parentElement || el.getRootNode().host; } return [255,255,255]; };
  const bad = [];
  for (const el of root.querySelectorAll('*')) {
    if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest('.sr')) continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const st = getComputedStyle(el); if (st.visibility === 'hidden') continue;
    const fg = parse(st.color).slice(0, 3), bg = bgOf(el); const a = lum(fg), b = lum(bg);
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    if (ratio < 4.5) bad.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 25)}" ${ratio.toFixed(2)}`);
  }
  return bad;
}
"""


def main():
    tmp = Path(tempfile.mkdtemp(prefix="widget-e2e-"))
    port = free_port()
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    env.update({"PORT": str(port), "CHAT_MODE": "demo"})
    # Redirect data to a temp folder via a tiny starter script so the project's data/ stays clean
    starter = tmp / "start.mjs"
    starter.write_text(
        "import { pathToFileURL } from 'node:url';\n"
        f"const {{ createServer }} = await import(pathToFileURL({json.dumps(str(ROOT / 'server' / 'index.js'))}).href);\n"
        f"createServer({{ dataDir: {json.dumps(str(tmp / 'data'))} }}).listen({port});\n",
        encoding="utf8",
    )
    server = subprocess.Popen([shutil.which("node"), str(starter)], cwd=ROOT, env=env)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(base + "/api/config", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        run(base, tmp)
    finally:
        server.terminate()
        server.wait()
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{len(passes)} checks passed, {len(failures)} failed")
    if failures:
        print("\n".join("- " + f for f in failures))
        sys.exit(1)


def run(base, tmp):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="en-US")
        page = ctx.new_page()
        console = []
        page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console.append(str(e)))

        page.goto(base + "/demo/")
        launcher = page.locator("#farnhaus-chat .launcher")
        launcher.wait_for()
        check(launcher.get_attribute("aria-expanded") == "false", "Launcher visible, chat closed")
        page.screenshot(path=str(SHOTS / "demo-shop-desktop.png"))
        js_len = len(urllib.request.urlopen(base + "/widget.js").read())
        print(f"  INFO widget.js: {js_len/1024:.1f} KB uncompressed, no dependencies")

        # Open
        launcher.click()
        panel = page.locator("#farnhaus-chat .panel")
        check(panel.is_visible(), "Chat opens on click")
        check(launcher.get_attribute("aria-expanded") == "true", "aria-expanded=true")
        check(page.evaluate("document.getElementById('farnhaus-chat').shadowRoot.activeElement?.id") == "fh-input", "Focus moves to the input")
        page.wait_for_selector("#farnhaus-chat .chip")
        check(page.locator("#farnhaus-chat .chip").count() == 3, "Suggestions from the config")
        check("Farnhaus Help" in page.inner_text("#farnhaus-chat #fh-title"), "Assistant name from the FAQ file")

        # Question via suggestion
        page.locator("#farnhaus-chat .chip").first.click()
        page.wait_for_selector("#farnhaus-chat .msg.bot .sources")
        bot = page.locator("#farnhaus-chat .msg.bot").last
        check("€5.90" in bot.inner_text(), "Answer contains the shipping cost")
        check(bot.locator(".sources a").get_attribute("href").startswith("https://www.farnhaus.example/help/shipping"), "Source links to the FAQ page")

        # Typed question with a typo
        page.locator("#farnhaus-chat #fh-input").fill("how long does delivry take")
        page.keyboard.press("Enter")
        page.wait_for_function("document.getElementById('farnhaus-chat').shadowRoot.querySelectorAll('.msg.bot').length >= 3")
        last = page.locator("#farnhaus-chat .msg.bot").last
        check("Monday through Wednesday" in last.inner_text(), "Typo 'delivry' → delivery time")

        page.locator("#farnhaus-chat #fh-input").fill("Is a Monstera safe for my cat?")
        page.keyboard.press("Enter")
        page.wait_for_function("document.getElementById('farnhaus-chat').shadowRoot.querySelectorAll('.msg.bot').length >= 4")
        check("toxic to cats and dogs" in page.locator("#farnhaus-chat .msg.bot").last.inner_text(), "Pet question answered")
        page.screenshot(path=str(SHOTS / "chat-answers-desktop.png"))

        # Unknown question → points to a person
        page.locator("#farnhaus-chat #fh-input").fill("What will the weather be like tomorrow?")
        page.keyboard.press("Enter")
        page.wait_for_function("document.getElementById('farnhaus-chat').shadowRoot.querySelectorAll('.msg.bot').length >= 5")
        last = page.locator("#farnhaus-chat .msg.bot").last
        check("team" in last.inner_text(), "Unknown question: honest reply")
        check(last.locator("button", has_text="Talk to a person").count() == 1, "Unknown question: handoff button")
        bad = page.evaluate(CONTRAST_IN_SHADOW)
        check(not bad, f"Widget contrast ≥ 4.5:1 {bad[:3]}")

        # Handoff: error case
        last.locator("button", has_text="Talk to a person").click()
        page.wait_for_selector("#farnhaus-chat .hf form")
        check(page.input_value("#farnhaus-chat #hf-msg") == "What will the weather be like tomorrow?", "Message prefilled with the last question")
        page.click("#farnhaus-chat .hf .primary")
        page.wait_for_selector("#farnhaus-chat [data-err='name']:not(:empty)")
        check(page.locator("#farnhaus-chat .hf [aria-invalid=true]").count() >= 2, "Handoff: errors marked on the fields")
        check(page.evaluate("document.getElementById('farnhaus-chat').shadowRoot.activeElement?.id") == "hf-name", "Focus on the first invalid field")
        page.screenshot(path=str(SHOTS / "handoff-error-desktop.png"))

        # Handoff: success
        page.fill("#farnhaus-chat #hf-name", "Jane Sample")
        page.fill("#farnhaus-chat #hf-email", "jane@example.org")
        page.fill("#farnhaus-chat #hf-msg", "My Monstera has had yellow leaves since it arrived. What should I do?")
        page.check("#farnhaus-chat input[name=consent]")
        page.click("#farnhaus-chat .hf .primary")
        page.wait_for_selector("#farnhaus-chat .done")
        ticket = page.inner_text("#farnhaus-chat .ticket")
        check(ticket.startswith("FH-") and len(ticket) == 9, f"Handoff confirmed with ticket {ticket}")
        page.screenshot(path=str(SHOTS / "handoff-success-desktop.png"))
        stored = [json.loads(l) for l in (tmp / "data" / "handoffs.jsonl").read_text(encoding="utf8").splitlines()]
        check(stored[-1]["ticket"] == ticket and len(stored[-1]["transcript"]) >= 6, "Ticket stored with chat history")
        page.click("#farnhaus-chat .done .primary")
        check(page.locator("#farnhaus-chat .log").is_visible(), "Back to chat")

        # Keyboard: Escape closes, focus returns to the launcher
        page.locator("#farnhaus-chat #fh-input").focus()
        page.keyboard.press("Escape")
        check(panel.is_hidden(), "Escape closes the chat")
        check(page.evaluate("document.getElementById('farnhaus-chat').shadowRoot.activeElement?.className") == "launcher", "Focus back on the launcher")
        page.keyboard.press("Enter")
        check(panel.is_visible(), "Enter on the launcher reopens it")

        # History survives a page change
        n_before = page.locator("#farnhaus-chat .msg").count()
        page.goto(base + "/demo/foreign-site.html")
        page.wait_for_selector("#farnhaus-chat .msg")
        check(page.locator("#farnhaus-chat .msg").count() == n_before, "History and open state survive the page change")

        # Foreign CSS doesn't leak in
        styles = page.evaluate("""() => { const r = document.getElementById('farnhaus-chat').shadowRoot;
            const inp = r.querySelector('#fh-input'); const b = r.querySelector('.msg.bot'); const l = r.querySelector('.launcher');
            const s = (e) => getComputedStyle(e);
            return { font: s(b).fontSize, family: s(b).fontFamily, ls: s(b).letterSpacing, bg: s(b).backgroundColor, inpBorder: s(inp).borderStyle,
                     launcherBg: s(l).backgroundColor, left: s(l).left } }""")
        check(styles["font"] == "15px" and "Courier" not in styles["family"], f"Font unaffected by page CSS ({styles['font']}, {styles['family'][:20]})")
        check(styles["ls"] in ("normal", "0px"), f"Letter spacing unaffected ({styles['ls']})")
        check(styles["inpBorder"] == "solid", "Borders unaffected")
        check(styles["launcherBg"] == "rgb(122, 62, 157)", "data-color sets the brand color")
        check(styles["left"] == "20px", "data-position=left places it on the left")
        page.screenshot(path=str(SHOTS / "foreign-site-desktop.png"))

        check(not console, f"No console errors {console[:3]}")
        ctx.close()

        # Phone: full screen
        m = browser.new_context(viewport={"width": 390, "height": 844}, locale="en-US", has_touch=True, is_mobile=True)
        mp = m.new_page()
        merr = []
        mp.on("console", lambda msg: merr.append(msg.text) if msg.type == "error" else None)
        mp.goto(base + "/demo/")
        mp.screenshot(path=str(SHOTS / "demo-shop-phone.png"))
        mp.locator("#farnhaus-chat .launcher").tap()
        mp.wait_for_selector("#farnhaus-chat .chip")
        mp.wait_for_timeout(400)  # wait for the open animation
        box = mp.locator("#farnhaus-chat .panel").bounding_box()
        check(box["width"] == 390 and box["height"] >= 840, f"Phone: chat is full screen ({box['width']}×{box['height']})")
        check(mp.locator("#farnhaus-chat .close").is_visible(), "Phone: close button reachable")
        mp.locator("#farnhaus-chat .chip").nth(1).tap()
        mp.wait_for_selector("#farnhaus-chat .msg.bot .sources")
        over = mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(over <= 0, "Phone: no horizontal scrolling")
        mp.screenshot(path=str(SHOTS / "chat-phone.png"))
        mp.locator("#farnhaus-chat .handoff-link").tap()
        mp.wait_for_selector("#farnhaus-chat .hf form")
        mp.screenshot(path=str(SHOTS / "handoff-phone.png"))
        check(not merr, "Phone: no console errors")
        m.close()

        # Tablet
        t = browser.new_context(viewport={"width": 768, "height": 1024}, locale="en-US")
        tp = t.new_page()
        tp.goto(base + "/demo/")
        tp.locator("#farnhaus-chat .launcher").click()
        tp.wait_for_selector("#farnhaus-chat .chip")
        tp.screenshot(path=str(SHOTS / "chat-tablet.png"))
        t.close()
        browser.close()


if __name__ == "__main__":
    main()
