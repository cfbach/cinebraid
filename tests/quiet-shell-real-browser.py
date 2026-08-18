#!/usr/bin/env python3
"""Batch 2, Slice 1 — QUIET THE SHELL, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. tests/quiet-shell.js proves everything semantic about
this slice in Node: the compact status agrees with the drawer row, the panels emit no
timeline, the panel defaults, the result target and its fallbacks, and the composition
order of the Frames workspace. Five claims cannot be proven there, and they are the five
a filmmaker would actually notice:

  * THE CENTRE REALLY GETS THE WIDTH BACK. "The rail is closed" is a claim about a CSS
    grid track resolving differently, which is arithmetic over rendered geometry.
  * OPENING THE RAIL RESTORES IT WITHOUT DESTROYING THE WORKSPACE, and the Assistant is
    genuinely reachable and usable afterwards — node identity in a live document.
  * ONE PERSISTENT GLOBAL INDICATOR, counted in a rendered page rather than in source.
  * THE TERMINAL PREFERENCE SURVIVES A RELOAD. localStorage across a real navigation.
  * A COMPLETED RUN'S HAND-OFF ACTUALLY LANDS ON THE STAGE THAT OWNS THE RESULT, by
    clicking the button the drawer really renders.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because a width assertion that cannot fail is
worth nothing:

  N1 forces the rail slot occupied while the preference says closed, and requires the
     reclaimed-width assertion to catch it.
  N2 puts a full LIVE AUTOMATION ACTIVITY node back into the task page, and requires the
     no-embedded-timeline assertion to catch it.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched; the route guard aborts the paid route and
anything off-loopback. The one run this suite reasons about is FULFILLED BY THE TEST on
the runs endpoint rather than written anywhere — the 3.5s activity poll would otherwise
replace it mid-assertion, which is the shape of the known check:browser-real flake.
"""

import json, os, pathlib, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Quiet the shell real-browser audit"
sync_playwright = require_browser(LABEL)

SHOT = "SAMPLE-01"
PAID_ROUTE = "/api/generation/fal/jobs"
RUNS_ROUTE = "**/api/automation/runs"

page_errors, offsite, paid_calls = [], [], []
findings = []


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-quiet-shell-"))
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

# Geometry, read once and used by every width assertion below. `railTrack` is the
# rendered width of the rail slot; `mainWidth` is what the filmmaker's work actually got.
GEOMETRY = """
() => {
  const doc = document.documentElement;
  const rail = document.getElementById('cb-shell-rail');
  const main = document.getElementById('main');
  const region = document.getElementById('cb-shell-main');
  const railShown = rail && getComputedStyle(rail).display !== 'none';
  return {
    innerWidth: window.innerWidth,
    horizontalOverflow: doc.scrollWidth > window.innerWidth,
    shellPresent: document.getElementById('workspace').dataset.creatorShell === '1',
    railOccupied: rail ? rail.hasAttribute('data-occupied') : null,
    railShown: !!railShown,
    railWidth: railShown ? Math.round(rail.getBoundingClientRect().width) : 0,
    mainWidth: main ? Math.round(main.getBoundingClientRect().width) : 0,
    regionWidth: region ? Math.round(region.getBoundingClientRect().width) : 0,
    railToggleExpanded: (document.getElementById('creator-rail-toggle') || {}).getAttribute
      ? document.getElementById('creator-rail-toggle').getAttribute('aria-expanded') : 'MISSING',
    railToggleHidden: document.getElementById('creator-rail-toggle')
      ? document.getElementById('creator-rail-toggle').hidden : 'MISSING',
    assistantMounted: !!document.querySelector('#cb-shell-rail .cb-assistant'),
    terminalMounted: !!document.querySelector('#cb-shell-dock .cb-terminal'),
    terminalCollapsed: (document.querySelector('.cb-terminal') || {}).dataset
      ? document.querySelector('.cb-terminal').dataset.collapsed : 'MISSING',
    embeddedTimelines: document.querySelectorAll('#main .automation-live-activity').length,
    compactStatuses: document.querySelectorAll('#main .automation-compact-status').length,
    globalIndicators: [
      document.getElementById('automation-activity-toggle') ? 'topbar-chip' : null,
      document.getElementById('automation-global-live-strip') ? 'floating-strip' : null,
    ].filter(Boolean),
    railPreference: (() => { try { return localStorage.getItem('cinebraid-creator-rail-open'); } catch { return 'THREW'; } })(),
    dockPreference: (() => { try { return localStorage.getItem('cinebraid-creator-terminal-collapsed'); } catch { return 'THREW'; } })(),
  };
}
"""

# A completed shot-chain stills run. Its scope is what makes it resolvable to the Frames
# stage through the declared stage model, and nothing else about it matters.
COMPLETED_RUN = {
    "id": "quiet-shell-done", "revision": 1, "type": "shot-chain", "targetId": SHOT,
    "scope": "stills", "label": "Frame automation", "status": "completed",
    "stage": "Frame A approved", "summary": "Approved",
    "createdAt": "2026-08-17T10:00:00Z", "updatedAt": "2026-08-17T10:05:00Z",
    "config": {}, "usage": {}, "current": {},
    "steps": {"frame:a:generate": {
        "key": "frame:a:generate", "kind": "generation", "status": "completed",
        "label": "Generate Frame A", "startedAt": "2026-08-17T10:00:00Z",
        "updatedAt": "2026-08-17T10:05:00Z", "completedAt": "2026-08-17T10:05:00Z",
        "activity": {"system": "FAL · GPT IMAGE 2", "state": "done"},
    }},
    "logs": [],
}

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
        # A fresh context is the whole point of sections 1 and 4: no stored preference.
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        served_runs = {"payload": None}

        def guard(route):
            """No request leaves this machine, and the paid route is never called."""
            url = route.request.url
            if PAID_ROUTE in url and route.request.method == "POST":
                paid_calls.append(f"{route.request.method} {url}")
                return route.abort("failed")
            if "/api/automation/runs" in url and served_runs["payload"] is not None:
                # THE POLL IS PINNED, not raced. refreshGlobalAutomationActivity replaces
                # AUTOMATION_RUNS wholesale every 3.5s while the drawer is open; a run
                # injected into the page would be gone before it could be clicked.
                return route.fulfill(status=200, content_type="application/json",
                                     body=json.dumps(served_runs["payload"]))
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

        # ---- 1. at 1920 the rail is closed and the centre has the width -----------------
        closed = page.evaluate(GEOMETRY)
        assert closed["shellPresent"], "the shot workspace must be a creator surface"
        assert closed["railPreference"] is None, \
            f"this section requires a fresh preference state, found rail preference {closed['railPreference']!r}"
        assert not closed["railOccupied"], \
            "with no stored preference the rail slot must be unoccupied — that is how the centre reclaims the width"
        assert not closed["railShown"], \
            f"an unoccupied rail must paint nothing, it rendered {closed['railWidth']}px"
        assert closed["railToggleExpanded"] == "false", \
            f"the topbar open control must reflect a closed rail, got {closed['railToggleExpanded']!r}"
        assert closed["railToggleHidden"] is False, \
            "the open control must be offered on a creator surface, or the rail cannot be reached"
        # The centre takes the whole region: the two-track grid collapsed to one.
        assert abs(closed["mainWidth"] - closed["regionWidth"]) <= 2, \
            (f"1. with the rail closed the centre must take the whole Main region, "
             f"got main {closed['mainWidth']}px inside region {closed['regionWidth']}px")
        assert not closed["horizontalOverflow"], "the page must not scroll horizontally at 1920"
        findings.append(f"1. at 1920px with no stored preference the rail is unmounted and #main takes the whole "
                        f"{closed['regionWidth']}px Main region ({closed['mainWidth']}px), no horizontal overflow")

        # ---- 2. opening the rail restores it, and does not destroy the workspace --------
        # Stamp the centre first: "did not destroy the workspace" is a claim about node
        # identity, which a width comparison cannot make.
        page.evaluate("() => { document.getElementById('main').__quietStamp = 'centre-1'; }")
        shot_title_before = page.evaluate("() => (document.querySelector('.shot-title-display') || {}).textContent || ''")

        page.click("#creator-rail-toggle")
        page.wait_for_selector("#cb-shell-rail[data-occupied]", timeout=10000)
        page.wait_for_timeout(250)
        opened = page.evaluate(GEOMETRY)

        assert opened["railOccupied"], "opening the rail must occupy the slot"
        assert opened["railWidth"] == 340, \
            f"2. the opened rail must restore the declared 340px track, got {opened['railWidth']}px"
        assert opened["railToggleExpanded"] == "true", "the open control must reflect an open rail"
        assert opened["railPreference"] == "1", \
            f"opening the rail must record the preference, got {opened['railPreference']!r}"
        reclaimed = closed["mainWidth"] - opened["mainWidth"]
        assert abs(reclaimed - 340) <= 8, \
            (f"2. opening the rail must cost the centre the rail's width; "
             f"centre went {closed['mainWidth']} -> {opened['mainWidth']} ({reclaimed}px)")
        assert not opened["horizontalOverflow"], "opening the rail must not make the page scroll horizontally"

        # The workspace survived, and the Assistant is really there and really usable.
        assert page.evaluate("() => document.getElementById('main').__quietStamp || 'REBUILT'") == "centre-1", \
            "2. opening the rail rebuilt the centre; the workspace must survive"
        assert page.evaluate("() => (document.querySelector('.shot-title-display') || {}).textContent || ''") == shot_title_before, \
            "2. opening the rail changed what the workspace was showing"
        assert opened["assistantMounted"], "2. the Assistant must be mounted once the rail is open"
        usable = page.evaluate("""() => {
            const rail = document.getElementById('cb-shell-rail');
            const box = rail.getBoundingClientRect();
            const controls = [...rail.querySelectorAll('button, a')];
            return {
              controls: controls.length,
              inside: controls.every((node) => {
                const r = node.getBoundingClientRect();
                return r.left >= box.left - 1 && r.right <= box.right + 1;
              }),
              activityReachable: controls.some((node) => /openGlobalAutomationActivity/.test(node.getAttribute('onclick') || '')),
            };
        }""")
        assert usable["controls"] > 0 and usable["inside"], \
            f"2. every Assistant control must render inside the rail, got {usable}"
        assert usable["activityReachable"], \
            "2. the Assistant must still reach the Activity drawer with the rail open"
        findings.append(f"2. opening the rail restores exactly 340px, costs the centre {reclaimed}px, keeps the centre "
                        f"node and its content, and mounts an Assistant whose {usable['controls']} controls are all "
                        f"inside the rail and still reach Activity")

        # ---- N1. the reclaimed-width assertion can fail --------------------------------
        n1 = page.evaluate("""() => {
            const before = Math.round(document.getElementById('main').getBoundingClientRect().width);
            window.CineBraidCreatorSurfaces.closeRail();
            const closedWidth = Math.round(document.getElementById('main').getBoundingClientRect().width);
            const rail = document.getElementById('cb-shell-rail');
            const body = rail.querySelector(':scope > .cb-shell-slot-body');
            const probe = document.createElement('div');
            probe.dataset.quietProbe = '1';
            probe.textContent = 'probe';
            body.appendChild(probe);
            rail.dataset.occupied = '1';
            const forcedWidth = Math.round(document.getElementById('main').getBoundingClientRect().width);
            probe.remove();
            delete rail.dataset.occupied;
            window.CineBraidCreatorSurfaces.paint();
            return { before, closedWidth, forcedWidth };
        }""")
        assert n1["forcedWidth"] < n1["closedWidth"] - 300, \
            (f"N1. an occupied rail must take the width back, so the section-1 assertion is capable of failing; "
             f"closed {n1['closedWidth']}px vs forced {n1['forcedWidth']}px")
        findings.append(f"N1. forcing the slot occupied while the preference says closed drops the centre "
                        f"{n1['closedWidth'] - n1['forcedWidth']}px — the width assertion can fail")

        # Leave the rail closed for the remaining sections; the preference is now "0".
        page.evaluate("() => window.CineBraidCreatorSurfaces.closeRail()")
        page.wait_for_timeout(200)

        # ---- 3. one persistent global activity indicator, drawer reachable --------------
        activity = page.evaluate(GEOMETRY)
        assert activity["globalIndicators"] == ["topbar-chip"], \
            f"3. there must be exactly one persistent global activity indicator, found {activity['globalIndicators']}"
        assert page.locator("#automation-global-live-strip").count() == 0, \
            "3. the retired floating activity strip must not exist in the document"

        served_runs["payload"] = {
            "projectSlug": page.evaluate("() => (typeof ACTIVE_PROJECT_SLUG !== 'undefined' && ACTIVE_PROJECT_SLUG) || ''"),
            "runs": [COMPLETED_RUN],
        }
        page.evaluate("() => refreshGlobalAutomationActivity(true)")
        page.wait_for_timeout(300)

        page.click("#automation-activity-toggle")
        page.wait_for_selector("#automation-activity-drawer.open", timeout=10000)
        page.wait_for_selector(f'#automation-activity-drawer [data-run-id="{COMPLETED_RUN["id"]}"]', timeout=10000)
        drawer = page.evaluate("""() => {
            const node = document.getElementById('automation-activity-drawer');
            return {
              open: node.classList.contains('open'),
              rows: node.querySelectorAll('[data-run-id]').length,
              sections: [...node.querySelectorAll('.automation-drawer-list h3, .automation-drawer-list header span')]
                .map((n) => n.textContent.trim()).filter(Boolean),
              text: node.innerText,
            };
        }""")
        assert drawer["open"] and drawer["rows"] >= 1, f"3. the Activity drawer must open and show the run, got {drawer}"
        findings.append(f"3. one persistent global indicator (the topbar chip); the drawer opens from it and shows "
                        f"{drawer['rows']} run row(s)")

        # ---- 4/5. the completed run hands off to the result -----------------------------
        handoff_button = page.locator(f'#automation-activity-drawer [data-run-id="{COMPLETED_RUN["id"]}"] button', has_text="OPEN RESULT")
        assert handoff_button.count() == 1, \
            ("5. a completed shot still run must offer OPEN RESULT rather than OPEN WORKSPACE; "
             f"drawer said: {drawer['text'][:300]}")
        # PUT THE WORKSPACE SOMEWHERE ELSE FIRST, AND REDRAW IT, so "it reached the
        # result" is a transition the DOM actually made rather than a stage it happened to
        # already be on. Writing the preference without redrawing is how the first version
        # of this check passed against a page that never moved.
        page.evaluate("""(shot) => {
            localStorage.setItem(`cinebraid-focused:${ACTIVE_PROJECT_SLUG}:shot-task:${shot}`, 'deliver');
            route();
        }""", SHOT)
        page.wait_for_selector('[data-selected-task="deliver"]', timeout=10000)
        assert page.locator("#main .guided-frame-workflow").count() == 0, \
            "5. the workspace must start on a stage that is NOT the result's, or the hand-off proves nothing"
        handoff_button.click()
        page.wait_for_selector("#automation-activity-drawer:not(.open)", timeout=10000)
        page.wait_for_function(
            """(shot) => {
                 const key = `cinebraid-focused:${ACTIVE_PROJECT_SLUG}:shot-task:${shot}`;
                 return localStorage.getItem(key) === 'frames';
               }""",
            arg=SHOT, timeout=10000)
        landed = page.evaluate("""(shot) => ({
            hash: location.hash,
            selected: localStorage.getItem(`cinebraid-focused:${ACTIVE_PROJECT_SLUG}:shot-task:${shot}`),
            declaredStage: (shotStageForPanel('still') || {}).id,
            target: v670RunResultTarget(v641RunById('quiet-shell-done')),
        })""", SHOT)
        assert landed["selected"] == "frames", \
            f"5. the hand-off must select the stage that owns the result, got {landed['selected']!r}"
        assert landed["selected"] == landed["declaredStage"], \
            "5. the stage it selected must be the declared stage model's own answer for the still panel"
        assert landed["hash"] == f"#/shot/{SHOT}", \
            f"5. the hash must remain the shipped workspace route, got {landed['hash']!r}"
        assert landed["target"]["resolved"] is True and landed["target"]["stage"] == "frames", \
            f"5. the resolved target must be panel/stage-qualified, got {landed['target']}"
        # THE DOM REALLY MOVED, not just the stored selection.
        page.wait_for_selector('[data-selected-task="frames"]', timeout=10000)
        page.wait_for_selector("#main .guided-frame-workflow", timeout=10000)
        findings.append(f"5. OPEN RESULT on a completed still run selected the declared Frames stage (from "
                        f"shotStageForPanel('still')) and rendered the frame workspace, on the unchanged "
                        f"{landed['hash']} route")

        # ---- 6. no working page embeds a timeline --------------------------------------
        page.wait_for_timeout(300)
        embeds = page.evaluate(GEOMETRY)
        assert embeds["embeddedTimelines"] == 0, \
            f"6. the task page must embed no LIVE AUTOMATION ACTIVITY timeline, found {embeds['embeddedTimelines']}"
        # NOT VACUOUS. A page showing no run at all embeds no timeline either, and would
        # pass the line above while proving nothing. The compact status is the evidence
        # that this page really is rendering a run.
        assert embeds["compactStatuses"] >= 1, \
            ("6. the task page rendered no compact run status, so the no-timeline assertion above "
             "proved nothing — the run must be visible on the page for this section to mean anything")
        panel_state = page.evaluate("""() => {
            const compact = [...document.querySelectorAll('#main .automation-compact-status')];
            return {
              compact: compact.length,
              controls: compact.flatMap((node) => [...node.querySelectorAll('button')].map((b) => b.getAttribute('onclick') || '')),
              text: compact.map((node) => node.innerText.replace(/\\s+/g, ' ').trim()),
            };
        }""")
        for handler in panel_state["controls"]:
            assert "openGlobalAutomationActivity" in handler, \
                f"6. the compact status may only offer the drawer, found handler: {handler}"
        findings.append(f"6. the task page embeds 0 timelines and shows {panel_state['compact']} compact run "
                        f"status block(s), whose only control opens the drawer: {panel_state['text'][:1]}")

        # ---- N2. the no-embedded-timeline assertion can fail ---------------------------
        n2 = page.evaluate("""() => {
            const host = document.getElementById('main');
            const probe = document.createElement('section');
            probe.className = 'automation-live-activity';
            probe.dataset.quietProbe = '1';
            probe.textContent = 'LIVE AUTOMATION ACTIVITY';
            host.appendChild(probe);
            const seen = document.querySelectorAll('#main .automation-live-activity').length;
            probe.remove();
            return { seen, after: document.querySelectorAll('#main .automation-live-activity').length };
        }""")
        assert n2["seen"] == 1 and n2["after"] == 0, \
            f"N2. the embedded-timeline check must be able to see one, got {n2}"
        findings.append("N2. an injected timeline node is seen by the section-6 check — it can fail")

        # ---- 7. the Terminal starts collapsed, expands, and the preference survives -----
        assert activity["terminalMounted"], "the Activity Terminal must be mounted"
        assert activity["dockPreference"] is None, \
            f"this section requires a fresh dock preference, found {activity['dockPreference']!r}"
        assert activity["terminalCollapsed"] == "1", \
            f"7. with no stored preference the Activity Terminal must start COLLAPSED, got {activity['terminalCollapsed']!r}"

        page.click('.cb-terminal button[aria-expanded="false"]')
        page.wait_for_selector('.cb-terminal[data-collapsed="0"]', timeout=10000)
        expanded = page.evaluate(GEOMETRY)
        assert expanded["terminalCollapsed"] == "0", "7. the Terminal must expand when asked"
        assert expanded["dockPreference"] == "0", \
            f"7. expanding must record the preference, got {expanded['dockPreference']!r}"
        assert page.locator(".cb-terminal .cb-terminal-rows").count() == 1, \
            "7. an expanded Terminal must actually show its rows"

        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".bounded-shot-taskbar", timeout=20000)
        page.wait_for_selector(".cb-terminal", timeout=10000)
        page.wait_for_timeout(300)
        reloaded = page.evaluate(GEOMETRY)
        assert reloaded["terminalCollapsed"] == "0", \
            f"7. an explicit expanded preference must survive a reload, got {reloaded['terminalCollapsed']!r}"
        # And the rail's explicit closed preference survived it too.
        assert reloaded["railPreference"] == "0" and not reloaded["railOccupied"], \
            f"7. the rail's explicit closed preference must survive a reload, got {reloaded['railPreference']!r}"
        findings.append("7. the Terminal starts collapsed on a fresh preference, expands on demand, and the explicit "
                        "expanded preference survives a reload; the rail's explicit closed preference survives it too")

        # ---- teardown: the page is left exactly as the shipped build renders it ---------
        final = page.evaluate("""() => ({
            probes: document.querySelectorAll('[data-quiet-probe]').length,
            strips: document.querySelectorAll('#automation-global-live-strip').length,
            timelines: document.querySelectorAll('#main .automation-live-activity').length,
            railChildren: [...document.querySelectorAll('#cb-shell-rail > .cb-shell-slot-body > *')].map((n) => n.id),
            dockChildren: [...document.querySelectorAll('#cb-shell-dock > .cb-shell-slot-body > *')].map((n) => n.id),
        })""")
        assert final["probes"] == 0, f"teardown: test-only nodes survived: {final}"
        assert final["strips"] == 0, "teardown: the retired strip must not exist"
        assert final["timelines"] == 0, "teardown: no embedded timeline may remain"
        assert final["railChildren"] == [], \
            f"teardown: a closed rail must hold nothing, got {final['railChildren']}"
        assert final["dockChildren"] == ["cb-terminal-mount"], \
            f"teardown: the dock must hold exactly its one shipped consumer, got {final['dockChildren']}"
        findings.append("teardown. no test-only content remains; the closed rail holds nothing and the dock holds "
                        "exactly its one shipped consumer")

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
print("quiet the shell real-browser audit passed")
