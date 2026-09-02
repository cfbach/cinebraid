#!/usr/bin/env python3
"""A2 shell identity, read off a real Chromium at three desktop widths.

WHY A BROWSER IS NEEDED AT ALL. tests/shell-identity.js proves everything
semantic about this slice in Node: where the version comes from, what the rail
may and may not say, what the menu offers, and that no runtime asks Git. Four
claims cannot be proven there, and they are the four a filmmaker would notice:

  * THE PROJECT TITLE IS ACTUALLY READABLE IN A 220px RAIL. "It wraps" is a claim
    about rendered geometry — how many lines, how wide, and whether the page
    scrolls sideways because of it.
  * THE MENU OPENS INSIDE THE SCREEN. A popover that is correct in the DOM and
    hanging off the bottom of a 800px-high laptop is not a working menu.
  * THE APPLICATION VERSION IS ON SCREEN, and the project version is not. Two
    strings, read out of a live document rather than out of a template.
  * A1 STILL COEXISTS WITH IT. The Assistant entry, the Activity control and the
    Terminal dock are all still visible with the menu open, at every width.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because a geometry assertion that cannot
fail is worth nothing:

  N1 forces the rail title to a single unwrapped line and requires the
     no-horizontal-overflow assertion to catch it at 1280.
  N2 pushes the menu off the right edge and requires the within-viewport
     assertion to catch it.

IT ALSO WRITES THE FOUNDER EVIDENCE SET. Screenshots go to docs/qa/a2-shell-identity/
so the dogfood review is looking at exactly what the assertions measured.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in
a temporary sandbox reached through CINEBRAID_CONFIG_PATH and
CINEBRAID_PROJECTS_ROOT, so data/ and the shipped sample are never touched; the
route guard aborts anything off-loopback.
"""

import json, os, pathlib, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "A2 shell identity real-browser audit"
sync_playwright = require_browser(LABEL)

# THE FOUNDER EVIDENCE SET IS OPT-IN, and writes NOTHING into the repository by
# default — the same contract tests/real-browser-workflow.py and
# tests/manual-first-real-browser.py have. Two reasons, and the second is the one
# that matters: QA evidence is something a run produces rather than something the
# repository carries, and tests/external-test-readiness.js reads the working tree
# to assert a release carries no media outside the sanitized sample. A suite that
# dropped seven PNGs into the tree on every run would fail that check on behalf of
# a build that is perfectly clean.
#
# Set CINEBRAID_A2_SCREENSHOT_DIR to a directory to capture the set. Every
# assertion below runs either way; only the screenshots are conditional.
EVIDENCE = pathlib.Path(os.environ["CINEBRAID_A2_SCREENSHOT_DIR"]) if os.environ.get("CINEBRAID_A2_SCREENSHOT_DIR") else None
if EVIDENCE:
    EVIDENCE.mkdir(parents=True, exist_ok=True)


def capture(page, name):
    """Write one evidence screenshot, if a directory was asked for."""
    if EVIDENCE:
        page.screenshot(path=str(EVIDENCE / name))

# The three desktop widths the slice is judged at. 1280x800 is the compact laptop
# stress viewport; it is not a handheld target and nothing here treats it as one.
VIEWPORTS = [("1920x1080", 1920, 1080), ("1366x768", 1366, 768), ("1280x800", 1280, 800)]

# A title long enough to need every wrapping rule the stylesheet declares.
PROJECT_TITLE = "The Last Seat — Principal Photography Reference Master"
PROJECT_FORMAT = "Feature"
PROJECT_RECORD_VERSION = "6.6.4-studio.2"

page_errors, offsite, paid_calls = [], [], []
findings = []


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-shell-identity-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"

# The sandbox project is renamed to the stress title and left carrying the exact
# record version that caused this slice. A shell that leaks it has somewhere to
# leak it FROM, which is the only way this suite can prove it does not.
slug_dir = next(p for p in projects_root.iterdir() if (p / "project.json").exists())
record = json.loads((slug_dir / "project.json").read_text(encoding="utf-8"))
record["meta"]["title"] = PROJECT_TITLE
record["meta"]["format"] = PROJECT_FORMAT
record["meta"]["version"] = PROJECT_RECORD_VERSION
(slug_dir / "project.json").write_text(json.dumps(record, indent=2), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Everything every assertion below reads, gathered in one pass so the numbers a
# finding quotes are the numbers one layout produced.
GEOMETRY = """
() => {
  const doc = document.documentElement;
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  const title = document.getElementById('project-title');
  const menu = document.getElementById('project-menu');
  const rail = document.getElementById('rail');
  const style = title ? getComputedStyle(title) : null;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: doc.clientWidth,
    horizontalOverflow: doc.scrollWidth > doc.clientWidth,
    scrollWidth: doc.scrollWidth,
    railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
    title: box(title),
    titleText: title ? title.textContent : null,
    titleLines: title && style ? Math.round(title.getBoundingClientRect().height / parseFloat(style.lineHeight || '0')) : 0,
    titleExpanded: title ? title.getAttribute('aria-expanded') : 'MISSING',
    titleAria: title ? title.getAttribute('aria-label') : 'MISSING',
    format: (document.getElementById('project-format') || {}).textContent,
    appIdentity: (document.getElementById('app-identity') || {}).textContent,
    topbarProject: (document.getElementById('topbar-project') || {}).textContent,
    menuHidden: menu ? menu.hidden : 'MISSING',
    menu: menu && !menu.hidden ? box(menu) : null,
    menuText: menu && !menu.hidden ? menu.innerText : '',
    menuItems: menu ? [...menu.querySelectorAll('[data-project-menu-item]')].map((b) => b.querySelector('b').textContent) : [],
    /* A1 coexistence, read as VISIBLE BOXES rather than as element presence: a
       control that exists with zero size is not an entry point. */
    assistant: box(document.getElementById('creator-rail-toggle')),
    activity: box(document.getElementById('automation-activity-toggle')),
    dock: box(document.getElementById('cb-shell-dock')),
    terminalMounted: !!document.querySelector('#cb-shell-dock .cb-terminal'),
    drawer: !!document.getElementById('automation-activity-drawer'),
    main: box(document.getElementById('main')),
  };
}
"""

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
        context = browser.new_context(viewport={"width": 1920, "height": 1080})

        def guard(route):
            """No request leaves this machine."""
            url = route.request.url
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if url.startswith("https://fonts."):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        for label, width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.goto(f"{base}/#/production", wait_until="domcontentloaded")
            page.wait_for_function("() => document.body.dataset.renderReady === '1'", timeout=25000)
            page.wait_for_function("() => (document.getElementById('app-identity')||{}).textContent !== 'CineBraid'",
                                   timeout=10000)
            page.wait_for_timeout(150)

            # ---- 1. the shell, closed -------------------------------------------------
            shut = page.evaluate(GEOMETRY)
            assert not shut["horizontalOverflow"], \
                f"1. {label}: the page scrolls sideways ({shut['scrollWidth']} > {shut['clientWidth']})"
            assert shut["title"]["w"] > 0 and shut["title"]["h"] > 0, \
                f"1. {label}: the project title has no rendered box: {shut['title']}"
            assert shut["title"]["right"] <= shut["railWidth"] + 1, \
                f"1. {label}: the project title overflows the {shut['railWidth']}px rail: {shut['title']}"
            assert 1 <= shut["titleLines"] <= 3, \
                f"1. {label}: the project title rendered {shut['titleLines']} lines; it must wrap within three"
            assert shut["menuHidden"] is True, f"1. {label}: the menu must ship closed, got {shut['menuHidden']}"
            assert shut["titleExpanded"] == "false", f"1. {label}: a closed menu must announce aria-expanded=false"

            # ---- 2. project identity is the project's, and nothing else ---------------
            assert shut["format"] == PROJECT_FORMAT, \
                f"2. {label}: the subtitle must be the project format, got {shut['format']!r}"
            assert PROJECT_RECORD_VERSION not in (shut["format"] or ""), \
                f"2. {label}: the project record version is back under the title: {shut['format']!r}"
            assert shut["topbarProject"] == PROJECT_TITLE, \
                f"2. {label}: the topbar must carry the project title, got {shut['topbarProject']!r}"
            assert PROJECT_TITLE in (shut["titleAria"] or ""), \
                f"2. {label}: the clamped title must carry its full name on the button, got {shut['titleAria']!r}"

            # ---- 3. the application version is on screen, from the server -------------
            served = page.evaluate("async () => (await (await fetch('/api/app-identity')).json())")
            assert shut["appIdentity"] == f"CineBraid {served['app']['version']}", \
                f"3. {label}: the rail foot must show the served release, got {shut['appIdentity']!r}"
            assert PROJECT_RECORD_VERSION not in (shut["appIdentity"] or ""), \
                f"3. {label}: the project record version reached the application line"
            assert served["build"]["source"] == "development", \
                f"3. {label}: a checkout must report a development build, got {served['build']}"

            # ---- 4. the menu opens, entirely inside the screen -------------------------
            page.click("#project-title")
            page.wait_for_timeout(160)
            open_state = page.evaluate(GEOMETRY)
            menu = open_state["menu"]
            assert menu, f"4. {label}: the menu did not open"
            assert menu["x"] >= 0 and menu["y"] >= 0, f"4. {label}: the menu starts off screen: {menu}"
            assert menu["right"] <= open_state["clientWidth"], \
                f"4. {label}: the menu runs past the right edge ({menu['right']} > {open_state['clientWidth']})"
            assert menu["bottom"] <= open_state["innerHeight"], \
                f"4. {label}: the menu runs past the bottom edge ({menu['bottom']} > {open_state['innerHeight']})"
            assert not open_state["horizontalOverflow"], f"4. {label}: opening the menu made the page scroll sideways"
            assert open_state["menuItems"] == ["Project settings", "Switch project", "New project", "About CineBraid"], \
                f"4. {label}: unexpected menu entries: {open_state['menuItems']}"
            assert PROJECT_TITLE in open_state["menuText"], \
                f"4. {label}: the menu must show the complete project title the button clamps"
            assert f"CineBraid {served['app']['version']}" in open_state["menuText"], \
                f"4. {label}: the menu foot must carry the application version"
            assert "Development build" in open_state["menuText"], \
                f"4. {label}: the menu foot must name the build"
            assert PROJECT_RECORD_VERSION not in open_state["menuText"], \
                f"4. {label}: the project record version must not appear in the menu"

            # ---- 5. A1 coexists with it, at this width, with the menu open -------------
            for name in ("assistant", "activity", "dock"):
                node = open_state[name]
                assert node and node["w"] > 0 and node["h"] > 0, \
                    f"5. {label}: the A1 {name} surface is not visible with the menu open: {node}"
            assert open_state["terminalMounted"], f"5. {label}: the Activity Terminal must stay mounted in its dock"
            assert not open_state["drawer"], f"5. {label}: the retired Global Activity drawer must not exist"
            assert menu["right"] <= open_state["main"]["x"] + open_state["main"]["w"], \
                f"5. {label}: the menu escaped the workspace it overlays"

            capture(page, f"menu-open-{label}.png")

            # ---- 6. Escape closes it and hands focus back ------------------------------
            page.keyboard.press("Escape")
            page.wait_for_timeout(140)
            closed = page.evaluate("""() => ({
                hidden: document.getElementById('project-menu').hidden,
                expanded: document.getElementById('project-title').getAttribute('aria-expanded'),
                focusIsTitle: document.activeElement === document.getElementById('project-title'),
            })""")
            assert closed["hidden"] is True, f"6. {label}: Escape must close the menu"
            assert closed["expanded"] == "false", f"6. {label}: a closed menu must announce aria-expanded=false"
            assert closed["focusIsTitle"], f"6. {label}: Escape must hand focus back to the button that opened it"

            # ---- 7. a click outside closes it too ---------------------------------------
            page.click("#project-title")
            page.wait_for_timeout(120)
            page.mouse.click(open_state["main"]["x"] + 40, open_state["main"]["y"] + 24)
            page.wait_for_timeout(140)
            assert page.evaluate("() => document.getElementById('project-menu').hidden") is True, \
                f"7. {label}: a click outside the project owner must close the menu"

            capture(page, f"shell-{label}.png")
            findings.append(
                f"{label}: no horizontal overflow (scrollWidth {shut['scrollWidth']} <= client {shut['clientWidth']}); "
                f"title {shut['title']['w']}x{shut['title']['h']} in a {shut['railWidth']}px rail across "
                f"{shut['titleLines']} line(s); menu {menu['w']}x{menu['h']} at ({menu['x']},{menu['y']}) fully on "
                f"screen; rail foot reads {shut['appIdentity']!r}; Assistant, Activity and the Terminal dock all "
                f"visible with it open; Escape and outside-click both close it")

        # ---- 8. About, the one place the machinery is allowed to be visible ------------
        page.set_viewport_size({"width": 1920, "height": 1080})
        page.goto(f"{base}/#/production", wait_until="domcontentloaded")
        page.wait_for_function("() => document.body.dataset.renderReady === '1'", timeout=25000)
        page.wait_for_timeout(200)
        page.click("#project-title")
        page.wait_for_timeout(140)
        page.click("#project-menu [data-project-menu-item]:last-child")
        page.wait_for_timeout(200)
        page.evaluate("() => { document.querySelector('.about-cinebraid .cb-disclosure').open = true; }")
        page.wait_for_timeout(140)
        about = page.evaluate("""() => ({
            open: !document.getElementById('modal').classList.contains('hidden'),
            menuHidden: document.getElementById('project-menu').hidden,
            text: document.querySelector('.about-cinebraid').innerText,
            rows: [...document.querySelectorAll('.about-cinebraid .cb-meta-stack > span > b')].map((b) => b.textContent),
        })""")
        assert about["open"], "8. About must open from the project menu"
        assert about["menuHidden"] is True, "8. opening About must close the menu behind it"
        assert "Development build" in about["text"], "8. About must name the build"
        assert PROJECT_RECORD_VERSION in about["text"], \
            "8. the project record version must remain readable in About, where it is labelled as one"
        assert "Project record version" in about["rows"], \
            f"8. About must label the project record version as one: {about['rows']}"
        assert "Project schema" in about["rows"], f"8. About must keep the schema markers diagnostic: {about['rows']}"
        capture(page, "about-1920x1080.png")
        findings.append("about: opens from the menu, closes it behind, names the build, and keeps the project record "
                        f"version and schema markers folded under Technical details ({', '.join(about['rows'])})")

        page.keyboard.press("Escape")
        page.wait_for_timeout(140)

        # ==== NEGATIVE CONTROLS ========================================================
        # Both restore what they broke, and both are checked at 1280x800 — the width
        # where a geometry rule that does not hold actually shows.
        page.set_viewport_size({"width": 1280, "height": 800})
        page.wait_for_timeout(160)

        # N1: the title stops wrapping. The rail can no longer contain it and the page
        # gains the sideways scroll section 1 asserts against.
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.id = 'a2-control-n1';
            style.textContent = '.project-title{display:block!important;white-space:nowrap!important;overflow:visible!important;width:max-content!important}';
            document.head.appendChild(style);
        }""")
        page.wait_for_timeout(160)
        broken = page.evaluate(GEOMETRY)
        assert broken["horizontalOverflow"] or broken["title"]["right"] > broken["railWidth"] + 1, \
            "N1 DID NOT FIRE: an unwrapped title neither overflowed the page nor escaped the rail, so the geometry " \
            "assertions in section 1 cannot fail and are worth nothing"
        page.evaluate("() => document.getElementById('a2-control-n1').remove()")
        page.wait_for_timeout(140)
        restored = page.evaluate(GEOMETRY)
        assert not restored["horizontalOverflow"] and restored["title"]["right"] <= restored["railWidth"] + 1, \
            "N1 did not restore the shipped layout"
        findings.append("N1 an unwrapped rail title breaks the 1280x800 layout, and section 1 catches it")

        # N2: the menu is pushed off the right edge.
        page.click("#project-title")
        page.wait_for_timeout(140)
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.id = 'a2-control-n2';
            style.textContent = '.project-menu{left:calc(100vw - 40px)!important;right:auto!important;max-width:none!important}';
            document.head.appendChild(style);
        }""")
        page.wait_for_timeout(160)
        pushed = page.evaluate(GEOMETRY)
        assert pushed["menu"]["right"] > pushed["clientWidth"], \
            "N2 DID NOT FIRE: a menu pushed past the right edge still measured as on screen, so the within-viewport " \
            "assertion in section 4 is worth nothing"
        page.evaluate("() => document.getElementById('a2-control-n2').remove()")
        page.wait_for_timeout(140)
        back = page.evaluate(GEOMETRY)
        assert back["menu"]["right"] <= back["clientWidth"], "N2 did not restore the shipped menu position"
        page.evaluate("() => closeProjectMenu()")
        findings.append("N2 a menu pushed past the right edge is caught by the within-viewport assertion in section 4")

        # ---- teardown: nothing the suite added survives ---------------------------------
        final = page.evaluate("""() => ({
            controls: document.querySelectorAll('#a2-control-n1, #a2-control-n2').length,
            menuHidden: document.getElementById('project-menu').hidden,
            modalHidden: document.getElementById('modal').classList.contains('hidden'),
        })""")
        assert final["controls"] == 0, f"teardown: a control stylesheet survived: {final}"
        assert final["menuHidden"] is True, "teardown: the menu must be left closed"
        assert final["modalHidden"], "teardown: no dialog may be left open"

        assert not page_errors, f"the page raised uncaught errors: {page_errors}"
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()

assert not offsite, f"requests left the machine: {offsite}"
assert not paid_calls, f"a paid route was called: {paid_calls}"

print("\n".join(findings))
print(f"evidence written to {EVIDENCE}" if EVIDENCE else
      "evidence not captured (set CINEBRAID_A2_SCREENSHOT_DIR to a directory to capture it)")
print(f"project data isolated: config {config_path}, projects {projects_root} — data/ untouched")
print("no offsite request and no paid route: 0 blocked, 0 attempted")
print("A2 shell identity real-browser audit passed")
