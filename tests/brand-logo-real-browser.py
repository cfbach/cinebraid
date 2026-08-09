#!/usr/bin/env python3
"""The shipped mini logo, measured by a real Chromium.

tests/brand-logo-asset.js reads the rules. This reads the layout, because a rule
that looks right and a box that computes right are different claims - the defect
being guarded here was CSS that read perfectly well and produced a 256px image in
a 250px sidebar.

Three things a browser can answer and a source file cannot:
  * the PNG actually decodes (naturalWidth > 0 rather than a broken-image icon),
  * the laid-out box preserves the source aspect ratio, at every viewport Q1 uses,
  * the mark fits inside the chrome that contains it.

No project data is touched: the server runs against a disposable config and
projects root, and every route is a plain GET.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL = "Brand mini logo real-browser audit"
sync_playwright = require_browser(LABEL)

SOURCE_WIDTH, SOURCE_HEIGHT = 80, 103
SOURCE_RATIO = SOURCE_WIDTH / SOURCE_HEIGHT
# Sub-pixel layout plus the browser's own rounding of an auto width. 23.296875/30
# is 0.776563 against a source 0.776699 - a thousandth, not a distortion.
RATIO_TOLERANCE = 0.01
VIEWPORTS = [(1920, 1080), (1440, 900), (1280, 720)]

# Where the mark appears, and the element whose box must contain it.
PLACES = [
    ("/#/production", ".brand-logo", "#rail", "workspace rail"),
    ("/bible.html", ".bible-brand img", ".bible-sidebar", "Project Bible sidebar"),
    ("/login.html", ".login-brand img", ".login-box", "passcode screen"),
]


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-logo-"))
projects_root = sandbox / "projects"
projects_root.mkdir()
shutil.copytree(ROOT / "projects" / "cinebraid-sample", projects_root / "logo-sample",
                ignore=shutil.ignore_patterns("backups", "*.bak", "generation-jobs.json", "agent-index.json"))
config_path = sandbox / "config.json"
config_path.write_text(json.dumps({
    "activeProject": "logo-sample",
    "assistant": {"provider": "none", "visionProvider": "none"},
    "generation": {"fal": {"enabled": False}},
}, indent=2), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

checked = 0
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
        page = browser.new_page(viewport={"width": VIEWPORTS[0][0], "height": VIEWPORTS[0][1]})
        failures = []
        page.on("pageerror", lambda error: failures.append(f"uncaught: {error}"))

        # The asset is served at all, before any layout question is asked.
        response = page.request.get(f"{base}/cinebraid-logo-xs.png")
        assert response.status == 200, f"the mini logo is not served: HTTP {response.status}"
        assert len(response.body()) > 1000, "the served mini logo is implausibly small"

        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            for route, selector, container, place in PLACES:
                page.goto(base + route, wait_until="domcontentloaded")
                page.wait_for_timeout(700)
                logo = page.locator(selector).first
                assert logo.count(), f"{place} at {width}px has no logo matching {selector}"

                measured = logo.evaluate("""node => {
                  const box = node.getBoundingClientRect();
                  return {src: node.getAttribute('src'), natural: [node.naturalWidth, node.naturalHeight],
                          width: box.width, height: box.height, fit: getComputedStyle(node).objectFit};
                }""")

                # A broken image still has a box; only naturalWidth proves it decoded.
                assert measured["natural"] == [SOURCE_WIDTH, SOURCE_HEIGHT], (
                    f"{place} at {width}px did not decode the mini logo: natural size {measured['natural']}")
                assert measured["src"].endswith("cinebraid-logo-xs.png"), (
                    f"{place} at {width}px renders {measured['src']} rather than the mini logo")
                assert measured["fit"] == "contain", (
                    f"{place} at {width}px computes object-fit:{measured['fit']}, which can distort the mark")

                assert measured["height"] > 8, f"{place} at {width}px rendered the logo {measured['height']}px tall"
                ratio = measured["width"] / measured["height"]
                assert abs(ratio - SOURCE_RATIO) < RATIO_TOLERANCE, (
                    f"{place} at {width}px rendered the mini logo at {measured['width']:.2f}x{measured['height']:.2f} "
                    f"(ratio {ratio:.4f}); the source is {SOURCE_RATIO:.4f}")

                # The 256px-in-a-250px-sidebar failure, stated directly.
                fits = page.locator(container).first.evaluate(
                    """(node, child) => {
                         const outer = node.getBoundingClientRect();
                         const inner = document.querySelector(child).getBoundingClientRect();
                         return inner.width <= outer.width + 1 && inner.height <= outer.height + 1;
                       }""", selector)
                assert fits, f"{place} at {width}px renders the logo larger than the {container} that contains it"
                checked += 1

        # Nothing anywhere still asks for the superseded mark as an image.
        for route, _selector, _container, place in PLACES:
            page.goto(base + route, wait_until="domcontentloaded")
            page.wait_for_timeout(400)
            stale = page.evaluate("""() => [...document.images]
                .map(img => img.getAttribute('src') || '')
                .filter(src => src.includes('cinebraid-mark.svg'))""")
            assert not stale, f"{place} still loads the superseded mark as an image: {stale}"

        assert not failures, f"the branded pages raised uncaught errors: {failures}"
        browser.close()

    print(f"Brand mini logo real-browser audit passed: the 80x103 mini logo decoded, kept its aspect ratio within "
          f"{RATIO_TOLERANCE} and stayed inside its container across {checked} place/viewport combinations "
          f"({len(PLACES)} locations x {len(VIEWPORTS)} viewports), and no page still loads the superseded mark.")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
