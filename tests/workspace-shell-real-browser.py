#!/usr/bin/env python3
"""O2 — the persistent creator workspace shell, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. Everything declarative about O2 is proven in Node by
tests/workspace-shell.js: the region declaration, route eligibility, the overflow rules
in the stylesheet, the fact that nothing persists. Four claims cannot be proven there,
and they are the four O3 will actually depend on:

  * NODE IDENTITY. "The rail is the same node after a stage change" is a statement about
    object identity in a live document. tests/render-harness.js's FakeElement neither
    parses HTML nor tracks node identity, so it cannot answer it even in principle.
  * REAL SCROLL CONTAINMENT. Whether tall content scrolls inside a slot or lengthens the
    page is decided by layout, not by the presence of an overflow declaration.
  * HORIZONTAL OVERFLOW. scrollWidth > innerWidth is a rendered fact.
  * COEXISTENCE. That the Activity drawer still opens over the shell, and that a
    non-creator surface sheds it, are both live behaviours.

WHAT THIS SUITE ESTABLISHES, and nothing more:

  1.  The shell loads, is present on a creator surface, and both slots ship collapsed.
  2.  All five declared stages still render in the centre.
  3.  The shell root, the Main region and BOTH slot nodes are the SAME NODES after every
      stage change and after a normal re-render.
  4.  Test-only content mounted in the rail survives every stage change and a re-render.
  5.  Test-only content mounted in the dock survives the same, and unmounting returns the
      slot to its collapsed empty state.
  6.  Very tall fixture content scrolls INSIDE each slot instead of growing the page.
  7.  No horizontal overflow at desktop, laptop, tablet and mobile widths.
  8.  The existing Activity drawer still opens, covers the shell, and closes.
  9.  A non-creator surface (Settings) does not receive the shell.
  10. The dock never overlaps the navigation, at every width where both are visible.

IT CARRIES ITS OWN NEGATIVE CONTROLS. An identity check that cannot fail is worth
nothing, so N1 reconstructs the slots per stage the way a stage-owned rail would and
requires the identity assertion to catch it; N2 removes the dock's height bound and
requires the page-growth assertion to catch it; N3 removes the centre's min-width:0
floor and requires the horizontal-overflow assertion to catch it. Each restores the page
afterwards.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched; the route guard aborts the paid route and
anything off-loopback. NO CONTENT IS SHIPPED: every node mounted below is built in the
test and removed before the suite ends.
"""

import json, os, pathlib, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Creator workspace shell real-browser audit"
sync_playwright = require_browser(LABEL)

SHOT = "SAMPLE-01"
SLUG = "dogfood-sample"
PAID_ROUTE = "/api/generation/fal/jobs"

page_errors, offsite, paid_calls = [], [], []
findings = []

# Widths the shell must degrade through. The 1180 boundary is where the rail yields so a
# usable centre keeps the room; 900 is where the navigation stops being a column at all.
VIEWPORTS = [
    ("large desktop", 1920, 1080),
    ("laptop", 1440, 900),
    ("small laptop", 1180, 800),
    ("tablet", 900, 1024),
    ("narrow tablet", 760, 1024),
    ("mobile", 390, 844),
]


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-workspace-shell-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Mounted by the suite, never by the product. Kept as a constant so the teardown check can
# prove the page was left exactly as the shipped build renders it.
FIXTURE_ID = "cb-o2-test-fixture"

# The fixture is APPENDED BESIDE the shipped consumer's mounted node, not mounted over
# it with CineBraidShell.mountSlot.
#
# mountSlot replaces the slot body's children, which would evict the O3 Assistant or
# Terminal; those consumers notice their node has left the document and remount
# themselves on the next activity tick, 3.5s later, silently deleting the fixture
# mid-suite. Racing a shipped consumer for a slot is not a property worth testing and it
# is a flake worth not having.
#
# Appending into the slot body keeps the slot genuinely occupied by the real consumer
# while still giving these sections the CONTENT VOLUME they need to measure containment,
# and the consumer's reconciler only ever patches inside its own node, so the fixture is
# left alone. measure() is called for the same reason O3 calls it: a content change the
# ResizeObserver has not been given a frame to notice yet.
MOUNT_FIXTURE = """
({slot, lines}) => {
  const body = window.__CINEBRAID_SHELL.slotBody(slot);
  if (!body) return false;
  body.querySelectorAll(':scope > [data-o2-fixture]').forEach((node) => node.remove());
  const node = document.createElement('div');
  node.dataset.o2Fixture = slot;
  node.className = 'cb-o2-test-fixture';
  node.innerHTML = Array.from({length: lines}, (_, i) =>
    `<p style="margin:0;padding:9px">${slot} fixture line ${i}</p>`).join('');
  body.appendChild(node);
  window.__CINEBRAID_SHELL.measure();
  return true;
}
"""

CLEAR_FIXTURE = """
(slot) => {
  const body = window.__CINEBRAID_SHELL.slotBody(slot);
  if (!body) return false;
  body.querySelectorAll(':scope > [data-o2-fixture]').forEach((node) => node.remove());
  window.__CINEBRAID_SHELL.measure();
  return true;
}
"""

# Identity is taken by stamping each node once and reading the stamp back. A node that was
# rebuilt loses its stamp, which is a stronger claim than comparing ids or counts.
STAMP = """
() => {
  const targets = {
    root: document.getElementById('workspace'),
    region: document.getElementById('cb-shell-main'),
    centre: document.getElementById('main'),
    rail: document.getElementById('cb-shell-rail'),
    dock: document.getElementById('cb-shell-dock'),
    railBody: document.querySelector('#cb-shell-rail > .cb-shell-slot-body'),
    dockBody: document.querySelector('#cb-shell-dock > .cb-shell-slot-body'),
  };
  const out = {};
  for (const [name, node] of Object.entries(targets)) {
    if (!node) { out[name] = 'MISSING'; continue; }
    if (!node.__o2Stamp) node.__o2Stamp = `${name}:${Math.random().toString(36).slice(2)}`;
    out[name] = node.__o2Stamp;
  }
  return out;
}
"""

READ_STAMP = """
() => {
  const targets = {
    root: document.getElementById('workspace'),
    region: document.getElementById('cb-shell-main'),
    centre: document.getElementById('main'),
    rail: document.getElementById('cb-shell-rail'),
    dock: document.getElementById('cb-shell-dock'),
    railBody: document.querySelector('#cb-shell-rail > .cb-shell-slot-body'),
    dockBody: document.querySelector('#cb-shell-dock > .cb-shell-slot-body'),
  };
  const out = {};
  for (const [name, node] of Object.entries(targets)) out[name] = node ? (node.__o2Stamp || 'REBUILT') : 'MISSING';
  return out;
}
"""

GEOMETRY = """
() => {
  const doc = document.documentElement;
  const nav = document.getElementById('rail');
  const dock = document.getElementById('cb-shell-dock');
  const rail = document.getElementById('cb-shell-rail');
  const main = document.getElementById('main');
  const dockBody = dock && dock.querySelector('.cb-shell-slot-body');
  const navBox = nav && nav.getBoundingClientRect();
  const dockBox = dock && dock.getBoundingClientRect();
  const dockShown = dock && getComputedStyle(dock).display !== 'none';
  const railShown = rail && getComputedStyle(rail).display !== 'none';
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: doc.scrollWidth,
    scrollHeight: doc.scrollHeight,
    horizontalOverflow: doc.scrollWidth > window.innerWidth,
    shellPresent: document.getElementById('workspace').dataset.creatorShell === '1',
    blockedReason: document.getElementById('workspace').dataset.creatorShellBlocked || '',
    railShown: !!railShown,
    dockShown: !!dockShown,
    railWidth: railShown ? Math.round(rail.getBoundingClientRect().width) : 0,
    railScrollsInternally: railShown ? rail.scrollHeight > rail.clientHeight + 2 : null,
    railClientHeight: railShown ? rail.clientHeight : 0,
    dockHeight: dockShown ? Math.round(dockBox.height) : 0,
    dockScrollsInternally: dockShown ? dockBody.scrollHeight > dockBody.clientHeight + 2 : null,
    dockLeft: dockShown ? Math.round(dockBox.left) : null,
    navRight: (nav && getComputedStyle(nav).position !== 'fixed') ? Math.round(navBox.right) : null,
    navIsOverlay: nav ? getComputedStyle(nav).position === 'fixed' : null,
    mainWidth: Math.round(main.getBoundingClientRect().width),
    reserve: getComputedStyle(document.getElementById('app')).getPropertyValue('--cb-dock-reserve').trim(),
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
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        def guard(route):
            """No request leaves this machine, and the paid route is never called."""
            url = route.request.url
            if PAID_ROUTE in url and route.request.method == "POST":
                paid_calls.append(f"{route.request.method} {url}")
                return route.abort("failed")
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if url.startswith("https://fonts."):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)
        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector(".bounded-shot-taskbar", timeout=20000)
        page.wait_for_timeout(400)
        assert not page_errors, f"the shot workspace raised uncaught errors: {page_errors}"

        # ---- 1. the shell loads, is present, and ships collapsed ----------------------
        initial = page.evaluate("""() => {
            const rail = document.getElementById('cb-shell-rail');
            const dock = document.getElementById('cb-shell-dock');
            return {
              declaration: typeof window.creatorShellState === 'function',
              contract: typeof window.CineBraidShell === 'object' && typeof window.CineBraidShell.mountSlot === 'function',
              present: window.CineBraidShell.isShellPresent(),
              roots: document.querySelectorAll('[data-creator-shell]').length,
              regions: document.querySelectorAll('#cb-shell-main').length,
              rails: document.querySelectorAll('#cb-shell-rail').length,
              docks: document.querySelectorAll('#cb-shell-dock').length,
              centres: document.querySelectorAll('#main').length,
              railDisplay: getComputedStyle(rail).display,
              dockDisplay: getComputedStyle(dock).display,
              railOccupied: window.CineBraidShell.slotHasContent('rail'),
              dockOccupied: window.CineBraidShell.slotHasContent('dock'),
              centreInsideRegion: document.getElementById('main').parentElement.id,
              railInsideRegion: rail.parentElement.id,
              dockOutsideRegion: dock.parentElement.id,
            };
        }""")
        assert initial["declaration"], "1. the shell declaration did not load in the browser"
        assert initial["contract"], "1. the shell contract is not exposed in the browser"
        assert initial["present"], "1. the shot workspace is a creator surface and must receive the shell"
        for key, label in [("roots", "shell root"), ("regions", "Main region"), ("rails", "rail slot"),
                           ("docks", "dock slot"), ("centres", "centre")]:
            assert initial[key] == 1, f"1. found {initial[key]} of the {label}; exactly one must exist"
        assert initial["centreInsideRegion"] == "cb-shell-main", "1. the centre must sit inside the Main region"
        assert initial["railInsideRegion"] == "cb-shell-main", "1. the rail must sit inside the Main region"
        assert initial["dockOutsideRegion"] == "workspace", \
            f"1. the dock must be a sibling of the Main region, found inside #{initial['dockOutsideRegion']}"

        # BOTH SLOTS ARE NOW OCCUPIED, and that is the point of O3 rather than a
        # regression here. This suite asserted "O2 ships both slots empty" because O2
        # deliberately shipped no content; O3 mounts the Assistant and the Activity
        # Terminal, so the claim is superseded. What survives — and is O2's real property
        # — is that EMPTY MEANS ABSENT, so it is proven directly instead of by accident:
        # clear a slot, read the computed display back, then let the consumer repaint.
        assert initial["railOccupied"] and initial["dockOccupied"], \
            "1. the shipped build must mount a consumer in each slot; if both are empty the O3 surfaces did not load"
        assert initial["railDisplay"] != "none" and initial["dockDisplay"] != "none", \
            f"1. an occupied slot on a creator surface must paint, got rail={initial['railDisplay']} dock={initial['dockDisplay']}"
        emptied = page.evaluate("""() => {
            window.CineBraidShell.clearSlot('rail');
            window.CineBraidShell.clearSlot('dock');
            const rail = document.getElementById('cb-shell-rail');
            const dock = document.getElementById('cb-shell-dock');
            return {
              railDisplay: getComputedStyle(rail).display, dockDisplay: getComputedStyle(dock).display,
              railAttr: rail.hasAttribute('data-occupied'), dockAttr: dock.hasAttribute('data-occupied'),
              reserve: getComputedStyle(document.getElementById('app')).getPropertyValue('--cb-dock-reserve').trim(),
            };
        }""")
        assert emptied["railDisplay"] == "none" and emptied["dockDisplay"] == "none", \
            f"1. an emptied slot must paint nothing, got rail={emptied['railDisplay']} dock={emptied['dockDisplay']}"
        assert not emptied["railAttr"] and not emptied["dockAttr"], "1. occupancy state survived clearSlot"
        assert emptied["reserve"] in ("", "0px"), f"1. an empty dock must reserve nothing, got '{emptied['reserve']}'"
        page.evaluate("() => window.CineBraidCreatorSurfaces.paint()")
        page.wait_for_timeout(300)
        assert page.evaluate("() => window.CineBraidShell.slotHasContent('rail') && window.CineBraidShell.slotHasContent('dock')"), \
            "1. the consumer must remount after its slots were cleared"
        findings.append("1. one shell root, one Main region, one centre, one rail, one dock; both slots occupied by the "
                        "shipped consumers, and clearing either collapses it to nothing and releases its reservation")

        # ---- 2. the five declared stages still render ---------------------------------
        stages = page.evaluate("() => (window.SHOT_STAGE_IDS || []).slice()")
        assert len(stages) == 5, f"2. expected the five declared stages, got {stages}"

        def select_stage(stage_id):
            """Request a stage, then wait for THAT STAGE to be the one on screen.

            selectBoundedTask writes the focused task synchronously and then calls
            route(), which is ASYNCHRONOUS — page.evaluate returns while the previous
            stage's body is still in #main. The fixed 220ms sleep this replaces was
            waiting for time rather than for the stage; the identical contract was proven
            defective on a slower CI runner in
            tests/creator-surfaces-real-browser.py, whose 8b control shows the focused
            task already changed while the rendered body had not.

            `.guided-work-stack[data-bounded-task]` is the marker the assertion below
            reads, so waiting on it is waiting for exactly the fact under test."""
            page.evaluate("id => selectBoundedTask('shot-task', %s, id)" % json.dumps(SHOT), stage_id)
            page.wait_for_function(
                """(want) => document.querySelector('.guided-work-stack')?.dataset.boundedTask === want""",
                arg=stage_id, timeout=30000)

        for stage_id in stages:
            select_stage(stage_id)
            body = page.evaluate("() => document.querySelector('.guided-work-stack')?.dataset.boundedTask || ''")
            assert body == stage_id, f"2. selecting {stage_id} rendered the {body} body"
        findings.append(f"2. all five declared stages still render in the centre ({' -> '.join(stages)})")

        # ---- 3-5. identity and content survival across every stage change -------------
        page.evaluate(MOUNT_FIXTURE, {"slot": "rail", "lines": 60})
        page.evaluate(MOUNT_FIXTURE, {"slot": "dock", "lines": 60})
        page.wait_for_timeout(250)
        before = page.evaluate(STAMP)
        assert "MISSING" not in before.values(), f"3. a shell node was missing before the stage sweep: {before}"

        for stage_id in stages:
            select_stage(stage_id)
            after = page.evaluate(READ_STAMP)
            for name, stamp in before.items():
                assert after[name] == stamp, \
                    f"3. switching to '{stage_id}' replaced the shell's {name} node " \
                    f"({after[name]} != {stamp}). A stage change must not rebuild the shell — that is the whole point of O2."
            held = page.evaluate("""() => ({
                rail: !!document.querySelector('#cb-shell-rail [data-o2-fixture="rail"]'),
                dock: !!document.querySelector('#cb-shell-dock [data-o2-fixture="dock"]'),
                railOccupied: window.CineBraidShell.slotHasContent('rail'),
                dockOccupied: window.CineBraidShell.slotHasContent('dock'),
            })""")
            assert held["rail"], f"4. rail content did not survive the change to '{stage_id}'"
            assert held["dock"], f"5. dock content did not survive the change to '{stage_id}'"
            assert held["railOccupied"] and held["dockOccupied"], \
                f"3. occupancy was lost on the change to '{stage_id}'"

        # A full re-render is a stronger disturbance than a stage change: it is the path
        # that replaces the whole of #main.
        page.evaluate("() => route()")
        page.wait_for_timeout(400)
        after_render = page.evaluate(READ_STAMP)
        for name, stamp in before.items():
            assert after_render[name] == stamp, \
                f"3. a full re-render replaced the shell's {name} node ({after_render[name]} != {stamp})"
        assert page.evaluate("() => !!document.querySelector('#cb-shell-rail [data-o2-fixture=\"rail\"]')"), \
            "4. rail content did not survive a full re-render"
        assert page.evaluate("() => !!document.querySelector('#cb-shell-dock [data-o2-fixture=\"dock\"]')"), \
            "5. dock content did not survive a full re-render"
        findings.append(f"3. shell root, Main region, centre and both slot nodes kept identity across all {len(stages)} stage changes and a full re-render")
        findings.append("4-5. test-only rail and dock content stayed mounted throughout")

        # ---- 6. tall content scrolls inside its slot instead of growing the page ------
        # THE PROPERTY, stated precisely: page height must be INVARIANT TO SLOT CONTENT
        # VOLUME. Comparing "slots empty" against "slots full" would not prove it, because
        # mounting the rail legitimately narrows the centre column and a narrower column
        # reflows the workspace taller — a real effect that has nothing to do with
        # containment. So both measurements below are taken with both slots mounted and
        # the same geometry, and only the AMOUNT of content differs. Both fixtures are
        # already taller than the dock's bound, so the reservation is identical in both.
        page.set_viewport_size({"width": 1600, "height": 1000})
        page.wait_for_timeout(300)

        page.evaluate(MOUNT_FIXTURE, {"slot": "rail", "lines": 60})
        page.evaluate(MOUNT_FIXTURE, {"slot": "dock", "lines": 60})
        page.wait_for_timeout(350)
        modest = page.evaluate(GEOMETRY)
        assert modest["railShown"] and modest["dockShown"], \
            "6. both slots must be visible at 1600px once content is mounted"
        assert modest["railScrollsInternally"], "6. the rail must scroll internally, not lengthen the page"
        assert modest["dockScrollsInternally"], "6. the dock must scroll internally, not lengthen the page"
        assert modest["dockHeight"] <= round(modest["innerHeight"] * 0.38) + 2, \
            f"6. the dock grew to {modest['dockHeight']}px, past its 38vh bound"
        assert modest["railClientHeight"] <= modest["innerHeight"], \
            f"6. the rail grew to {modest['railClientHeight']}px, past the viewport"

        page.evaluate(MOUNT_FIXTURE, {"slot": "rail", "lines": 600})
        page.evaluate(MOUNT_FIXTURE, {"slot": "dock", "lines": 600})
        page.wait_for_timeout(350)
        flooded = page.evaluate(GEOMETRY)
        assert flooded["dockHeight"] == modest["dockHeight"], \
            f"6. ten times the dock content changed the dock's height from {modest['dockHeight']}px to " \
            f"{flooded['dockHeight']}px — the bound is following the content instead of capping it"
        growth = flooded["scrollHeight"] - modest["scrollHeight"]
        assert abs(growth) <= 4, \
            f"6. multiplying both slots' content by ten changed the page height by {growth}px. " \
            f"Slot content is escaping into page length, which is exactly what a future Assistant " \
            f"conversation and an unbounded Terminal log would do."
        assert flooded["railScrollsInternally"] and flooded["dockScrollsInternally"], \
            "6. the slots stopped scrolling internally under load"
        findings.append(f"6. multiplying both slots' content 10x (60 -> 600 paragraphs) changed page height by "
                        f"{growth}px and dock height by 0px; both scroll internally")

        # THE RESERVATION TRACKS THE DOCK, at both content volumes. A fixed dock cannot
        # push anything, so the only thing standing between the filmmaker and a hidden
        # row of controls is this number agreeing with the rendered height — under-reserve
        # and the bottom of the workspace is covered, over-reserve and there is a dead
        # band. That an EMPTY slot collapses and releases the reservation entirely is
        # section 1's check; this is the same invariant while the dock is in use.
        page.evaluate(CLEAR_FIXTURE, "dock")
        page.wait_for_timeout(350)
        released = page.evaluate(GEOMETRY)
        assert released["dockShown"], \
            "6. the dock still holds the shipped Terminal, so removing the fixture must not collapse it"
        assert released["dockHeight"] < flooded["dockHeight"], \
            f"6. removing 600 paragraphs did not shrink the dock ({flooded['dockHeight']}px -> {released['dockHeight']}px)"
        for label, geo in [("under load", flooded), ("after the fixture was removed", released)]:
            reserve = int((geo["reserve"] or "0px").replace("px", "") or 0)
            assert abs(reserve - geo["dockHeight"]) <= 2, \
                f"6. {label} the dock renders {geo['dockHeight']}px and reserves {reserve}px — " \
                f"the dock is either hiding the bottom of the centre or padding it with dead space"
        findings.append(f"6. the reservation tracked the dock at both volumes "
                        f"({flooded['dockHeight']}px under load, {released['dockHeight']}px after)")

        # ---- 7 & 10. no horizontal overflow, and the dock never covers navigation -----
        width_notes = []
        for name, width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(320)
            geo = page.evaluate(GEOMETRY)
            assert not geo["horizontalOverflow"], \
                f"7. {name} ({width}px) has horizontal page overflow: scrollWidth {geo['scrollWidth']} > {geo['innerWidth']}"
            if geo["dockShown"] and geo["navRight"] is not None:
                assert geo["dockLeft"] >= geo["navRight"], \
                    f"10. at {name} ({width}px) the dock starts at {geo['dockLeft']} but the navigation " \
                    f"ends at {geo['navRight']} — the dock is covering the navigation"
            if geo["railShown"]:
                assert geo["mainWidth"] >= 420, \
                    f"7. at {name} ({width}px) the rail squeezed the centre to {geo['mainWidth']}px"
            width_notes.append(f"{name} {width}px: rail={'on' if geo['railShown'] else 'off'} "
                               f"dock={geo['dockHeight']}px centre={geo['mainWidth']}px")
        assert any("rail=on" in row for row in width_notes), \
            "7. the rail was never shown at any tested width, so its layout claims are vacuous"
        assert any("rail=off" in row for row in width_notes), \
            "7. the rail never yielded at any tested width, so the responsive branch is untested"
        findings.append("7 & 10. no horizontal overflow at any tested width; dock never overlaps navigation — " + "; ".join(width_notes))

        # ---- NEGATIVE CONTROLS --------------------------------------------------------
        # N1: rebuild the slots the way a stage-owned rail would, and require the identity
        # assertion above to notice. Without this, section 3 could be passing because the
        # page never changes rather than because the shell is stable.
        page.set_viewport_size({"width": 1600, "height": 1000})
        page.wait_for_timeout(250)
        control_before = page.evaluate(STAMP)
        page.evaluate("""() => {
            const region = document.getElementById('cb-shell-main');
            const old = document.getElementById('cb-shell-rail');
            const rebuilt = document.createElement('aside');
            rebuilt.id = 'cb-shell-rail';
            rebuilt.className = 'cb-shell-slot';
            rebuilt.innerHTML = '<div class="cb-shell-slot-body"></div>';
            region.replaceChild(rebuilt, old);
        }""")
        control_after = page.evaluate(READ_STAMP)
        assert control_after["rail"] == "REBUILT", \
            "N1: reconstructing the rail did not lose its stamp, so the identity check in section 3 " \
            "cannot distinguish a persistent slot from a rebuilt one and proves nothing."
        assert control_after["region"] == control_before["region"], \
            "N1: the control was supposed to rebuild only the rail"
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".bounded-shot-taskbar", timeout=20000)
        page.wait_for_timeout(400)
        findings.append("N1. reconstructing the rail per stage is detected by the identity check")

        # N2: unbind the dock's height and require the page-growth arithmetic to notice.
        page.evaluate(MOUNT_FIXTURE, {"slot": "dock", "lines": 600})
        page.wait_for_timeout(300)
        bounded_height = page.evaluate("() => document.documentElement.scrollHeight")
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.id = 'cb-o2-control-unbound';
            style.textContent = '#cb-shell-dock{position:static!important;max-height:none!important}'
              + '#cb-shell-dock>.cb-shell-slot-body{overflow-y:visible!important;min-height:auto!important}';
            document.head.appendChild(style);
        }""")
        page.wait_for_timeout(320)
        unbounded_height = page.evaluate("() => document.documentElement.scrollHeight")
        assert unbounded_height > bounded_height + 500, \
            f"N2: removing the dock's bound and its fixed positioning changed the page height by only " \
            f"{unbounded_height - bounded_height}px, so section 6's page-growth arithmetic would not " \
            f"have caught an unbounded dock and is not testing containment."
        page.evaluate("() => document.getElementById('cb-o2-control-unbound')?.remove()")
        findings.append(f"N2. an unbounded dock grows the page by {unbounded_height - bounded_height}px and is caught")

        # N3: remove the centre's min-width:0 floor with a wide child present, and require
        # the horizontal-overflow assertion to notice.
        page.evaluate("""() => {
            const wide = document.createElement('div');
            wide.id = 'cb-o2-control-wide';
            wide.style.cssText = 'width:3000px;height:8px';
            document.getElementById('main').appendChild(wide);
        }""")
        page.wait_for_timeout(250)
        guarded = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
        assert not guarded, \
            "N3: a 3000px child already overflows the page with the min-width:0 floor in place, so the " \
            "floor is not doing anything and section 7 is not testing it."
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.id = 'cb-o2-control-nofloor';
            style.textContent = '.cb-shell-main{grid-template-columns:1fr!important}#main{min-width:auto!important}';
            document.head.appendChild(style);
        }""")
        page.wait_for_timeout(320)
        unguarded = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
        assert unguarded, \
            "N3: removing the centre's min-width:0 floor did not produce horizontal page overflow, so " \
            "section 7 would not have caught its loss."
        page.evaluate("""() => {
            document.getElementById('cb-o2-control-nofloor')?.remove();
            document.getElementById('cb-o2-control-wide')?.remove();
        }""")
        findings.append("N3. removing the centre's min-width:0 floor produces horizontal overflow and is caught")

        # ---- 8. the existing Activity drawer still works over the shell ---------------
        page.wait_for_timeout(200)
        drawer = page.evaluate("""() => {
            openGlobalAutomationActivity();
            const el = document.getElementById('automation-activity-drawer');
            const dock = document.getElementById('cb-shell-dock');
            return {
              open: el.classList.contains('open'),
              hidden: el.getAttribute('aria-hidden'),
              modal: el.getAttribute('aria-modal'),
              closeButton: !!document.querySelector('#automation-activity-drawer .cancel'),
              drawerLayer: Number(getComputedStyle(el).zIndex),
              dockLayer: Number(getComputedStyle(dock).zIndex),
              bodyLocked: document.body.classList.contains('automation-activity-open'),
            };
        }""")
        assert drawer["open"] and drawer["hidden"] == "false", "8. the Activity drawer did not open over the shell"
        assert drawer["modal"] == "true", "8. the Activity drawer lost its modal semantics"
        assert drawer["closeButton"], "8. the Activity drawer rendered no close control"
        assert drawer["drawerLayer"] > drawer["dockLayer"], \
            f"8. the drawer ({drawer['drawerLayer']}) must paint above the dock ({drawer['dockLayer']}) — " \
            "the drawer is a temporary overlay and the dock is a persistent surface, not the reverse"
        assert drawer["bodyLocked"], "8. the drawer's scroll lock was lost"
        closed = page.evaluate("""() => {
            document.querySelector('#automation-activity-drawer .cancel').click();
            const el = document.getElementById('automation-activity-drawer');
            return { open: el.classList.contains('open'), hidden: el.getAttribute('aria-hidden'),
                     bodyLocked: document.body.classList.contains('automation-activity-open') };
        }""")
        assert not closed["open"] and closed["hidden"] == "true" and not closed["bodyLocked"], \
            "8. the Activity drawer did not close cleanly"
        findings.append(f"8. Activity drawer still opens modally above the dock (z {drawer['drawerLayer']} > {drawer['dockLayer']}), and closes")

        # ---- 9. a non-creator surface does not receive the shell ----------------------
        page.goto(f"{base}/#/settings", wait_until="domcontentloaded")
        page.wait_for_timeout(700)
        settings = page.evaluate(GEOMETRY)
        assert not settings["shellPresent"], "9. Settings must not receive the creator workspace shell"
        assert settings["blockedReason"] == "excluded-view", \
            f"9. Settings should be refused as an excluded view, got '{settings['blockedReason']}'"
        assert not settings["railShown"] and not settings["dockShown"], \
            "9. neither slot may paint on a non-creator surface, even holding retained content"
        assert settings["reserve"] in ("", "0px"), \
            f"9. Settings must reserve no dock space, got '{settings['reserve']}'"
        assert not settings["horizontalOverflow"], "9. Settings gained horizontal overflow"

        # Returning to a creator surface restores it, and does not accumulate a second one.
        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector(".bounded-shot-taskbar", timeout=20000)
        page.wait_for_timeout(400)
        restored = page.evaluate("""() => ({
            present: window.CineBraidShell.isShellPresent(),
            roots: document.querySelectorAll('[data-creator-shell]').length,
            rails: document.querySelectorAll('#cb-shell-rail').length,
            docks: document.querySelectorAll('#cb-shell-dock').length,
        })""")
        assert restored["present"], "9. returning to the shot workspace must restore the shell"
        assert restored["roots"] == 1 and restored["rails"] == 1 and restored["docks"] == 1, \
            f"9. navigating accumulated shell regions: {restored}"
        findings.append("9. Settings sheds the shell (excluded-view) and reserves nothing; returning restores exactly one shell")

        # ---- 11. mounted content is RETAINED across a route change, not destroyed -----
        # The dock fixture mounted for control N2 was never cleared, and the trip through
        # Settings and back is a hash change rather than a document load. It is therefore
        # still mounted here, which is the behaviour O3 depends on: visiting Settings must
        # not throw away an Assistant conversation and hand back a fresh one. Retention and
        # visibility are separate — section 9 already proved it stayed INVISIBLE there.
        retained = page.evaluate("""() => ({
            dockOccupied: window.CineBraidShell.slotHasContent('dock'),
            dockFixtures: document.querySelectorAll('#cb-shell-dock [data-o2-fixture]').length,
            dockShown: getComputedStyle(document.getElementById('cb-shell-dock')).display !== 'none',
        })""")
        assert retained["dockOccupied"] and retained["dockFixtures"] == 1, \
            "11. dock content was destroyed by the trip through Settings; a future Assistant conversation " \
            "would not survive a visit to a non-creator surface"
        assert retained["dockShown"], "11. returning to a creator surface must paint the retained content again"
        findings.append("11. content mounted before a route change is retained through Settings and repainted on return")

        # ---- teardown: the page is left exactly as the shipped build renders it -------
        # The fixture is removed with the same helper that added it, and the shipped
        # consumers are then required to be the only occupants — which is what the page
        # looked like before this suite touched it.
        page.evaluate(CLEAR_FIXTURE, "rail")
        page.evaluate(CLEAR_FIXTURE, "dock")
        page.evaluate("() => window.CineBraidCreatorSurfaces.paint()")
        page.wait_for_timeout(350)
        final = page.evaluate("""() => ({
            fixtures: document.querySelectorAll('[data-o2-fixture]').length,
            controls: document.querySelectorAll('#cb-o2-control-unbound,#cb-o2-control-nofloor,#cb-o2-control-wide').length,
            railOccupied: window.CineBraidShell.slotHasContent('rail'),
            dockOccupied: window.CineBraidShell.slotHasContent('dock'),
            railChildren: [...document.querySelectorAll('#cb-shell-rail > .cb-shell-slot-body > *')].map((n) => n.id),
            dockChildren: [...document.querySelectorAll('#cb-shell-dock > .cb-shell-slot-body > *')].map((n) => n.id),
        })""")
        assert final["fixtures"] == 0 and final["controls"] == 0, \
            f"teardown: test-only nodes survived: {final}"
        assert final["railOccupied"] and final["dockOccupied"], \
            "teardown: the shipped build mounts a consumer in each slot"
        assert final["railChildren"] == ["cb-assistant-mount"] and final["dockChildren"] == ["cb-terminal-mount"], \
            f"teardown: each slot must hold exactly its one shipped consumer, got {final['railChildren']} / {final['dockChildren']}"
        findings.append("teardown. no test-only content or control styles remain; each slot holds exactly its one "
                        "shipped consumer")

        assert not page_errors, f"the page raised uncaught errors: {page_errors}"
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()

assert not offsite, f"requests left the machine: {offsite}"
assert not paid_calls, f"a paid route was called: {paid_calls}"

print("\n".join(findings))
print(f"project data isolated: config {config_path}, projects {projects_root} — data/ untouched")
print("no offsite request and no paid route: 0 blocked, 0 attempted")
print("creator workspace shell real-browser audit passed")
