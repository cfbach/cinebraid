#!/usr/bin/env python3
"""Capture the Q1 review screens from a real browser, and smoke-test the viewports.

    npm run qa:capture                      writes to ../QA-Reviews/Q1-browser-qa
    python scripts/qa-capture-screens.py <out-dir>

This is evidence for a human, not a test: it never asserts, it records. Layout
problems are collected into a findings table and printed at the end, so a reviewer
sees the same list whether or not they open the images. The assertions that must
fail a build live in tests/private-preview-layout-real-browser.py and
tests/c2b-generation-real-browser.py.

Everything runs against a disposable sandbox built by scripts/qa-sandbox.js, so no
real project or config is read or written. No request leaves the loopback host and
the paid generation route is blocked outright: the blocking dialog is opened and
photographed, never submitted.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium  # noqa: E402

LABEL = "Q1 QA capture"
sync_playwright = require_browser(LABEL)

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT.parent / "QA-Reviews" / "Q1-browser-qa")
SHOT = "SAMPLE-03"
VIEWPORTS = [(1920, 1080), (1440, 900), (1280, 720)]
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")

shots = []       # (filename, what it shows)
findings = []    # (severity, where, what)
console_errors = []


def note(filename, description):
    shots.append((filename, description))


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def layout_findings(page, where, width):
    """Objective layout problems only: overflow, clipping, and offscreen actions."""
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    if overflow > 2:
        findings.append(("layout", f"{where} @ {width}px", f"page overflows horizontally by {overflow}px"))
    # HORIZONTAL only. A control below the fold is a page that scrolls, which is not a
    # defect; a control past the right edge cannot be reached at all. Closed modals and
    # anything aria-hidden are excluded - they are parked offscreen by design, and
    # reporting them buries the real findings in noise.
    offscreen = page.evaluate("""() => [...document.querySelectorAll('button, a, select, input, textarea')]
        .filter(node => {
          if (node.closest('[aria-hidden="true"], .hidden, [hidden]')) return false;
          if (typeof node.checkVisibility === 'function'
              && !node.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
          const box = node.getBoundingClientRect();
          if (box.width < 1 || box.height < 1) return false;
          return box.right > innerWidth + 2 || box.left < -2;
        })
        .map(node => (node.id || node.className || node.tagName) + ' :: ' + (node.innerText || '').trim().slice(0, 40))
        .slice(0, 6)""")
    for row in offscreen:
        findings.append(("reachability", f"{where} @ {width}px", f"control outside the viewport: {row}"))
    clipped = page.evaluate("""() => [...document.querySelectorAll('#main *')]
        .filter(node => {
          const style = getComputedStyle(node);
          if (!node.children.length || style.overflow !== 'hidden') return false;
          return node.scrollWidth > node.clientWidth + 4 || node.scrollHeight > node.clientHeight + 4;
        })
        .map(node => (node.className || node.tagName) + '')
        .filter(name => !/scroll|pager|marquee|thumb|media|preview/i.test(name))
        .slice(0, 5)""")
    for row in clipped:
        findings.append(("clipping", f"{where} @ {width}px", f"content clipped by overflow:hidden in {row}"))


def modal_findings(page, where, width):
    box = page.evaluate("""() => {
      const modal = document.querySelector('.h3-generation-modal');
      if (!modal) return null;
      const rect = modal.getBoundingClientRect();
      const submit = document.getElementById('fal-frame-submit');
      const submitRect = submit ? submit.getBoundingClientRect() : null;
      return {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
              width: rect.width, height: rect.height, viewportW: innerWidth, viewportH: innerHeight,
              submit: submitRect ? {top: submitRect.top, bottom: submitRect.bottom, right: submitRect.right} : null};
    }""")
    if not box:
        findings.append(("layout", f"{where} @ {width}px", "the generation dialog did not render"))
        return
    if box["width"] > box["viewportW"] + 2 or box["left"] < -2 or box["right"] > box["viewportW"] + 2:
        findings.append(("layout", f"{where} @ {width}px", f"dialog is wider than the viewport ({box['width']:.0f}px)"))
    if box["height"] > box["viewportH"] + 2:
        findings.append(("layout", f"{where} @ {width}px",
                         f"dialog is taller than the viewport ({box['height']:.0f} > {box['viewportH']})"))
    if box["submit"] and (box["submit"]["bottom"] > box["viewportH"] + 2 or box["submit"]["top"] < -2):
        findings.append(("reachability", f"{where} @ {width}px",
                         "the GENERATE button sits outside the viewport"))


# ---------------------------------------------------------------- the sandbox

work = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-qa-capture-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(work / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = work / "env" / "config.json"
projects_root = work / "env" / "projects"
config = json.loads(config_path.read_text(encoding="utf-8"))
config["generation"] = {"fal": {"enabled": True, "blockingOutputs": 2, "blockingQuality": "low"}}
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

OUT.mkdir(parents=True, exist_ok=True)
port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "FAL_KEY": "q1-browser-qa-placeholder-not-a-credential"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), .25): break
        except OSError: time.sleep(.1)
    else:
        raise RuntimeError("CineBraid server did not start")
    base = f"http://127.0.0.1:{port}"

    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"uncaught: {e}"))

        def guard(route):
            url = route.request.url
            if "/api/generation/fal/jobs" in url and route.request.method == "POST":
                findings.append(("safety", "capture run", "a paid generation POST was attempted and blocked"))
                return route.abort("failed")
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            findings.append(("safety", "capture run", f"blocked an off-machine request to {url}"))
            return route.abort("failed")

        page.route("**/*", guard)

        def open_route(hash_value, settle=1200):
            page.goto(f"{base}/#{hash_value}", wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=15000)
            page.wait_for_timeout(settle)

        def open_blocking_dialog():
            open_route(f"/shot/{SHOT}")
            page.locator(".focused-task-button", has_text="Look & blocking").first.click()
            page.wait_for_timeout(500)
            page.evaluate("() => document.querySelectorAll('#main details').forEach(node => { node.open = true; })")
            page.wait_for_timeout(250)
            page.get_by_role("button", name="GENERATE", exact=True).first.click()
            page.wait_for_selector(".gen-option", timeout=20000)
            page.wait_for_timeout(600)

        # ---- 1..7 the review set, at the primary desktop size ------------
        open_route("/production")
        page.screenshot(path=str(OUT / "01-production-workspace.png"), full_page=False)
        note("01-production-workspace.png", "Production overview — the screen CineBraid opens on, showing project readiness.")

        open_route(f"/shot/{SHOT}")
        page.screenshot(path=str(OUT / "02-shot-workspace.png"), full_page=False)
        note("02-shot-workspace.png", f"Shot workspace for {SHOT}: the five task stages and their status.")

        open_blocking_dialog()
        page.screenshot(path=str(OUT / "03-blocking-frame-dialog.png"), full_page=False)
        note("03-blocking-frame-dialog.png",
             "Create blocking frame — the compiled dialog: task, references, options, prompt and output settings.")

        options = page.locator("#fal-frame-options")
        options.screenshot(path=str(OUT / "04-blocking-model-options.png"))
        note("04-blocking-model-options.png",
             "The capability-aware option list. One row is usable; every other row is disabled and says why.")

        page.evaluate("() => { const d = document.querySelector('.gen-options-advanced'); if (d) d.open = true; }")
        page.wait_for_timeout(300)
        page.locator(".gen-options-advanced").screenshot(path=str(OUT / "05-advanced-model-detail.png"))
        note("05-advanced-model-detail.png",
             "Technical detail: every model/provider combination with its id, surface, catalogue status and adapter.")

        settings_panel = page.locator(".h3-generation-settings")
        settings_panel.screenshot(path=str(OUT / "06-output-settings.png"))
        note("06-output-settings.png", "Size, quality and number-of-options controls, each a compiler input.")
        page.locator(".h3-generation-head .cancel").click()
        page.wait_for_timeout(300)

        open_route(f"/shot/{SHOT}")
        frames = page.locator(".focused-task-button", has_text="Frames")
        if frames.count():
            frames.first.click()
            page.wait_for_timeout(700)
            page.screenshot(path=str(OUT / "07-frames-continuity-area.png"), full_page=False)
            note("07-frames-continuity-area.png",
                 "Frames stage — where approval happens and where continuity checking is offered.")

        open_route("/settings", settle=1600)
        page.screenshot(path=str(OUT / "08-settings-providers.png"), full_page=True)
        note("08-settings-providers.png",
             "Settings: assistant provider, fal generation and the account state that drives model availability.")

        # H3 / Animate shot, read from the same resolver the UI uses.
        animate = page.evaluate("""async () => {
          const response = await fetch('/api/generation/options', {method:'POST',
            headers:{'Content-Type':'application/json'}, body: JSON.stringify({task:'animate-shot', references:[]})});
          return response.json();
        }""")
        (OUT / "09-animate-shot-options.json").write_text(json.dumps({
            "task": "animate-shot",
            "resolved": len(animate.get("options") or []),
            "shownNormally": len(animate.get("normal") or []),
            "actionable": [option["optionId"] for option in animate.get("options") or [] if option.get("actionable")],
            "rows": [{"model": option["modelName"], "surface": option.get("surfaceId") or "none",
                      "availability": option["availability"], "actionable": option["actionable"],
                      "reason": (option.get("reasons") or [{}])[0].get("message", "")}
                     for option in animate.get("options") or []],
        }, indent=2), encoding="utf-8")
        note("09-animate-shot-options.json",
             "Animate shot, as the resolver answers it: which video models exist and which one can actually run.")

        # ---- viewport smoke ---------------------------------------------
        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            for label, hash_value in [("Production", "/production"), ("Shot workspace", f"/shot/{SHOT}"),
                                      ("References", "/library/approved"), ("Settings", "/settings")]:
                open_route(hash_value, settle=900)
                layout_findings(page, label, width)
            open_blocking_dialog()
            modal_findings(page, "Create blocking frame", width)
            layout_findings(page, "Create blocking frame", width)
            page.screenshot(path=str(OUT / f"10-blocking-dialog-{width}x{height}.png"), full_page=False)
            note(f"10-blocking-dialog-{width}x{height}.png",
                 f"Create blocking frame at {width}x{height} — dialog fit and reachability of GENERATE.")
            page.locator(".h3-generation-head .cancel").click()
            page.wait_for_timeout(200)

        browser.close()

    # ---- the index ------------------------------------------------------
    lines = [
        "# Q1 pre-dogfood browser QA — screenshot index",
        "",
        f"Captured from a real Chromium against a disposable sandbox. No paid request was sent and no real",
        f"project or configuration was read or written.",
        "",
        "## Screens",
        "",
    ]
    lines += [f"- **{name}** — {description}" for name, description in shots]
    lines += ["", "## Viewport smoke", "",
              "Checked at " + ", ".join(f"{w}x{h}" for w, h in VIEWPORTS) +
              " for horizontal overflow, controls outside the viewport, clipped content, and dialog fit.", ""]
    if findings:
        lines += ["### Findings", ""]
        lines += [f"- `{severity}` **{where}** — {what}" for severity, where, what in findings]
    else:
        lines += ["No layout, reachability or clipping problems were found at any checked viewport.", ""]
    lines += ["", "## Console", ""]
    lines += ([f"- {row}" for row in console_errors] if console_errors
              else ["No console errors or uncaught exceptions were emitted during the capture run.", ""])
    (OUT / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Q1 QA capture wrote {len(shots)} artefacts to {OUT}")
    print(f"  layout/reachability findings : {len(findings)}")
    for severity, where, what in findings:
        print(f"    [{severity}] {where}: {what}")
    print(f"  console errors               : {len(console_errors)}")
    for row in console_errors:
        print(f"    {row}")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(work, ignore_errors=True)
