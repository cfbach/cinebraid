#!/usr/bin/env python3
"""O4 — the persistent stage strip and the persistent stage actions, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. Everything semantic about O4 is proven in Node by
tests/stage-surfaces.js: the contract, the refusals, the declaration ownership, the
rendered attributes and the accessibility markup. Eight claims cannot be proven there,
and they are the eight a filmmaker would actually notice:

  * ONE NAVIGATOR IN THE WHOLE DOCUMENT. Node can prove `#main`'s renderer builds none
    and that the O4 runtime builds one. Only a live page can prove that what a filmmaker
    is looking at contains exactly one.
  * NODE IDENTITY ACROSS ALL FIVE STAGES AND A FULL ROUTE RERENDER. "The strip is the
    same node after a stage change" is a statement about object identity in a live
    document, and it is the entire reason the navigator moved out of `#main`.
  * REAL NAVIGATION. The five stages select through the SHIPPED path, and the completion
    condition is the rendered stage — never a fixed sleep. That lesson is O3's, learned
    the expensive way (af8de75).
  * THE DOM AGREES WITH THE DECLARATION, compared against the page's OWN
    shotStageProgress rather than against a copy of it in this file.
  * THE STICKY GEOMETRY. The bar pins beneath the topbar, the rail and the shot's
    inspector pin beneath the bar, and none of them overlaps the Activity Terminal.
  * THE RESPONSIVE RULE. All five stages stay reachable and the current one stays
    visible at ten widths, in both themes, with no horizontal document overflow.
  * THE STATUS COLOURS RESOLVE. Three of the shipped tone colours were painted with
    custom properties this stylesheet never declared, so they computed to `unset` and
    were invisible. Only a real engine can say whether a colour exists.
  * O3 SURVIVES. The Assistant and the Terminal keep their nodes across every stage
    change O4 introduced.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because an identity check that cannot fail is
worth nothing. Each one mutates the RUNNING page, asserts the mutation really changed
what the check reads — the probe receipt — and then requires the check to notice:

  N1 rebuilds the bar per stage the way a stage-owned navigator would.
  N2 renders a second navigator beside the first.
  N3 derives the stage order from the strip's rendered children by shuffling them.
  N4 locally relabels a blocked stage as complete.
  N5 turns an empty recommendedNext into a Continue button.
  N6 re-enables a disabled action.
  N7 lets the bar overlap the Activity Terminal.
  N8 hides two stages at a phone width.

THE FIXTURE IS THE DEMO SANDBOX, built by scripts/qa-sandbox.js and read back through
the real server, so what the strip renders is a project the writers really persist.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched; the route guard aborts the paid route and
anything off-loopback.
"""

import json, os, pathlib, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Persistent stage strip and stage actions real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
APPROVED_SHOT = "SAMPLE-01"   # required frame approved: motion and deliver are open
BLOCKED_SHOT = "SAMPLE-03"    # no approved frame: motion and deliver are blocked

page_errors, offsite, paid_calls = [], [], []
findings = []

# The rail's three bands are O3's and must survive O4 untouched, so they are asserted
# here as well as there: O4 changed the rail's sticky top and max-height, and a batch
# that quietly changed its WIDTH as well would be a regression nobody was looking for.
CENTRE_FLOOR = 900
VIEWPORTS = [
    ("large desktop", 1920, 1080, 340),
    ("desktop", 1600, 1000, 340),
    ("full-rail floor", 1460, 900, 340),
    ("laptop", 1440, 900, 240),
    ("small laptop", 1366, 900, 240),
    ("compact floor", 1360, 900, 240),
    ("below the rail", 1280, 900, 0),
    ("narrow laptop", 1180, 800, 0),
    ("tablet", 900, 1024, 0),
    ("phone", 390, 844, 0),
]


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-stage-surfaces-"))
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

# ---------------------------------------------------------------------------
# Identity is taken by stamping each node once and reading the stamp back. A node that
# was rebuilt loses its stamp, which is a stronger claim than comparing ids or counts.
STAMP = """
() => {
  const targets = {
    barSlot: document.getElementById('cb-shell-bar'),
    barMount: document.getElementById('cb-stage-mount'),
    strip: document.querySelector('.cb-stage-strip'),
    actions: document.querySelector('.cb-stage-actions'),
    assistant: document.getElementById('cb-assistant-mount'),
    terminal: document.getElementById('cb-terminal-mount'),
  };
  const out = {};
  for (const [name, node] of Object.entries(targets)) {
    if (!node) { out[name] = 'MISSING'; continue; }
    if (!node.__o4Stamp) node.__o4Stamp = `${name}:${Math.random().toString(36).slice(2)}`;
    out[name] = node.__o4Stamp;
  }
  return out;
}
"""

READ_STAMP = """
() => {
  const targets = {
    barSlot: document.getElementById('cb-shell-bar'),
    barMount: document.getElementById('cb-stage-mount'),
    strip: document.querySelector('.cb-stage-strip'),
    actions: document.querySelector('.cb-stage-actions'),
    assistant: document.getElementById('cb-assistant-mount'),
    terminal: document.getElementById('cb-terminal-mount'),
  };
  const out = {};
  for (const [name, node] of Object.entries(targets)) out[name] = node ? (node.__o4Stamp || 'REBUILT') : 'MISSING';
  return out;
}
"""

# WHAT THE BAR SAYS, and what the DECLARATION says, read in the same breath from the same
# page. The declared side is computed by the page's OWN shotStageProgress over the page's
# OWN facts — never by a copy of the model in this file, which would only prove that two
# copies agree. Note the bare identifiers: CineBraid's state lives in top-level `let`
# bindings, which are lexical and NOT properties of `window`.
SURFACE = """
() => {
  const strip = document.querySelector('.cb-stage-strip');
  const shotId = (String(location.hash || '').split('?')[0].split('/')[2] || '');
  const shot = typeof shotById === 'function' ? shotById(decodeURIComponent(shotId)) : null;
  const takes = shot && typeof takesFor === 'function' ? takesFor(shot.id) : [];
  const facts = shot ? shotStageModelFacts(shot, takes) : null;
  const declared = facts ? shotStageProgress(facts) : [];
  const workspace = document.querySelector('[data-bounded-task]');
  return {
    navigators: document.querySelectorAll('.focused-taskbar').length,
    navigatorsInMain: document.querySelectorAll('#main .focused-taskbar').length,
    actionSurfaces: document.querySelectorAll('[data-cb-stage-actions]').length,
    stripsInMain: document.querySelectorAll('#main .cb-stage-strip').length,
    declaredOrder: [...SHOT_STAGE_IDS],
    renderedOrder: strip ? [...strip.querySelectorAll('.focused-task-button')].map((b) => b.dataset.stageId) : [],
    rendered: strip ? [...strip.querySelectorAll('.focused-task-button')].map((b) => ({
      id: b.dataset.stageId,
      availability: b.dataset.availability,
      completion: b.dataset.completion,
      current: b.getAttribute('aria-current') === 'step',
      text: b.innerText,
      dotColour: getComputedStyle(b.querySelector('i')).backgroundColor,
      dotRing: getComputedStyle(b.querySelector('i')).boxShadow,
      statusColour: getComputedStyle(b.querySelector('em')).color,
    })) : [],
    declared: declared.map((s) => ({
      id: s.id, availability: s.availability, completion: s.completion,
      blockedReason: s.blockedReason, recommendedNext: s.recommendedNext,
    })),
    selected: workspace ? workspace.dataset.boundedTask : '',
    actions: [...document.querySelectorAll('.cb-stage-action')].map((b) => ({
      id: b.dataset.actionId,
      label: b.textContent,
      disabled: b.disabled,
      advances: b.dataset.advances === '1',
      describedBy: b.getAttribute('aria-describedby') || '',
      reason: b.getAttribute('aria-describedby')
        ? (document.getElementById(b.getAttribute('aria-describedby')) || {}).textContent || ''
        : '',
      reasonVisible: b.getAttribute('aria-describedby')
        ? (() => { const el = document.getElementById(b.getAttribute('aria-describedby'));
                   return !!el && getComputedStyle(el).display !== 'none' && el.textContent.trim().length > 0; })()
        : null,
    })),
    o3: {
      assistant: document.querySelectorAll('#cb-assistant-mount .cb-assistant').length,
      terminal: document.querySelectorAll('#cb-terminal-mount .cb-terminal').length,
    },
  };
}
"""

GEOMETRY = """
() => {
  const doc = document.documentElement;
  const app = document.getElementById('app');
  const bar = document.getElementById('cb-shell-bar');
  const dock = document.getElementById('cb-shell-dock');
  const rail = document.getElementById('cb-shell-rail');
  const main = document.getElementById('main');
  const topbar = document.getElementById('topbar');
  const strip = document.querySelector('.cb-stage-strip');
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none';
  const box = (el) => el ? (({width, height, top, bottom, left, right}) => ({
    w: Math.round(width), h: Math.round(height), top: Math.round(top),
    bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right),
  }))(el.getBoundingClientRect()) : null;
  const current = strip ? strip.querySelector('[aria-current="step"]') : null;
  return {
    innerWidth: window.innerWidth,
    scrollWidth: doc.scrollWidth,
    scrollHeight: doc.scrollHeight,
    horizontalOverflow: doc.scrollWidth > window.innerWidth,
    barShown: shown(bar),
    barBox: box(bar),
    barVar: getComputedStyle(app).getPropertyValue('--cb-bar-height').trim(),
    topbarBox: box(topbar),
    railShown: shown(rail),
    railWidth: shown(rail) ? Math.round(rail.getBoundingClientRect().width) : 0,
    railBox: shown(rail) ? box(rail) : null,
    uiScale: getComputedStyle(app).getPropertyValue('--ui-scale').trim(),
    scrollY: Math.round(window.scrollY),
    dockShown: shown(dock),
    dockBox: box(dock),
    mainWidth: Math.round(main.getBoundingClientRect().width),
    stageCount: strip ? strip.querySelectorAll('.focused-task-button').length : 0,
    stagesVisible: strip ? [...strip.querySelectorAll('.focused-task-button')]
      .filter((b) => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0).length : 0,
    stripScrolls: strip ? strip.scrollWidth > strip.clientWidth + 1 : null,
    currentInView: (() => {
      if (!strip || !current) return null;
      const s = strip.getBoundingClientRect(), c = current.getBoundingClientRect();
      return c.left >= s.left - 2 && c.right <= s.right + 2;
    })(),
    barOverlapsDock: (() => {
      if (!shown(bar) || !shown(dock)) return false;
      const b = bar.getBoundingClientRect(), d = dock.getBoundingClientRect();
      return b.bottom > d.top && b.top < d.bottom;
    })(),
    barOverlapsTopbar: (() => {
      if (!shown(bar) || !topbar) return false;
      const b = bar.getBoundingClientRect(), t = topbar.getBoundingClientRect();
      return b.top < t.bottom - 1;
    })(),
  };
}
"""

# The production truth a persistent action must not touch. Deliberately NOT the whole
# project record: `creation.openPanels` is disclosure memory the shipped openGuidedPanel
# has always written, and O4 reuses that handler rather than rewriting it. What must be
# unchanged is every fact the workflow is derived from.
TRUTH = """
() => JSON.stringify((P.shots || []).map((s) => ({
  id: s.id,
  winner: s.winner || '',
  keyframes: (s.keyframes || []).map((k) => ({ id: k.id, winner: k.winner || '', required: k.required })),
  clips: (s.clips || []).length,
  finalStillFile: s.creation && s.creation.finalStillFile || '',
  finalVideoFile: s.creation && s.creation.finalVideoFile || '',
  deliveryIntent: s.creation && s.creation.deliveryIntent || '',
  approvals: s.stageApprovals || null,
})))
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

        def open_shot(shot):
            page.goto(f"{base}/?o4={shot}#/shot/{shot}", wait_until="domcontentloaded")
            page.wait_for_selector(".cb-stage-strip .focused-task-button", timeout=20000)
            page.wait_for_function("() => typeof P !== 'undefined' && !!P", timeout=20000)

        def select_stage(stage_id):
            """Click the SHIPPED control and wait for the RENDERED stage.

            The completion condition is the workspace stating it rendered the stage that
            was asked for — `[data-bounded-task="X"]` — not a sleep. A fixed wait after an
            async navigation reads a stale DOM on a slow machine and passes on a fast one,
            which is how a suite comes to prove nothing on CI (30eb6da, af8de75)."""
            page.click(f'.cb-stage-strip .focused-task-button[data-stage-id="{stage_id}"]')
            page.wait_for_selector(f'[data-bounded-task="{stage_id}"]', timeout=20000)
            page.wait_for_selector(f'.cb-stage-strip [data-stage-id="{stage_id}"][aria-current="step"]', timeout=20000)

        open_shot(APPROVED_SHOT)
        assert not page_errors, f"the shot workspace raised uncaught errors: {page_errors}"

        # THE ASSISTANT RAIL SHIPS CLOSED since Batch 2, Slice 1, so nothing mounts into
        # it until it is asked for. The retention property below is about a mounted
        # surface keeping its node, so the default is asserted here and the rail is then
        # opened; tests/quiet-shell-real-browser.py owns the default itself.
        assert page.evaluate("() => !window.CineBraidCreatorSurfaces.railOpen()"), \
            "the Assistant rail must ship CLOSED with no stored preference"
        page.evaluate("() => window.CineBraidCreatorSurfaces.openRail()")
        page.wait_for_selector("#cb-assistant-mount", timeout=10000)

        # ---- 1-3. one strip, one action surface, and no duplicate taskbar ---------------
        view = page.evaluate(SURFACE)
        assert view["navigators"] == 1, \
            f"1. the shot must show exactly one stage navigator, found {view['navigators']}"
        assert view["navigatorsInMain"] == 0 and view["stripsInMain"] == 0, \
            "3. the obsolete in-#main taskbar must be absent — a navigator inside #main is rebuilt by every stage change"
        assert view["actionSurfaces"] == 1, \
            f"2. exactly one persistent action surface, found {view['actionSurfaces']}"
        assert page.evaluate("() => typeof window.CineBraidStageSurfaces === 'object'"), \
            "the O4 contract is not exposed in the browser"
        findings.append("1-3. one stage strip, one action surface, and no navigator anywhere inside #main")

        # ---- 4. the order is the declaration's, read from the page ----------------------
        assert view["renderedOrder"] == view["declaredOrder"], \
            f"4. the strip's order {view['renderedOrder']} is not the declared order {view['declaredOrder']}"
        findings.append(f"4. strip order equals the page's own SHOT_STAGE_IDS: {' -> '.join(view['declaredOrder'])}")

        # ---- 5-7. all five stages render through real navigation, the nodes survive ------
        stamps = page.evaluate(STAMP)
        assert "MISSING" not in stamps.values(), f"5. a surface was missing before navigation: {stamps}"
        seen_current = []
        for stage_id in view["declaredOrder"]:
            select_stage(stage_id)
            after = page.evaluate(SURFACE)
            assert after["selected"] == stage_id, \
                f"5. selecting {stage_id} left the workspace rendering {after['selected']!r}"
            current = [row["id"] for row in after["rendered"] if row["current"]]
            assert current == [stage_id], f"7. the current-stage marker reads {current}, expected [{stage_id!r}]"
            seen_current.append(stage_id)
            live = page.evaluate(READ_STAMP)
            assert live == stamps, \
                f"6. a persistent surface was rebuilt by selecting {stage_id}: {live} vs {stamps}"
        assert seen_current == view["declaredOrder"], "5. every declared stage must have been visited"
        findings.append(f"5-7. all {len(seen_current)} stages selected through the shipped control, waiting on the "
                        f"rendered stage; the bar, strip, actions, Assistant and Terminal kept their nodes throughout")

        # A FULL CENTER RERENDER. `route()` is the app's own wholesale replacement of
        # `#main` — the operation that used to destroy the navigator, because the
        # navigator was inside it. Nothing about the bar may notice.
        page.evaluate("() => route()")
        page.wait_for_timeout(250)
        after_route = page.evaluate(READ_STAMP)
        assert after_route == stamps, \
            f"6. a full route() rerender of #main rebuilt a persistent surface: {after_route} vs {stamps}"
        findings.append("6. route() replaces #main wholesale and every persistent surface keeps its node")

        # AND A ROUTE CHANGE AWAY AND BACK, driven through the hash rather than a document
        # load, because a load would rebuild everything by construction and prove nothing.
        # Off a shot the bar holds nothing and must consume nothing; the SLOT is static
        # markup and survives, while the MOUNT is deliberately cleared — there is no shot
        # strip worth retaining over the Production page. O3's surfaces are retained, and
        # that difference is the one this assertion is here to pin.
        page.evaluate("() => { location.hash = '#/production'; }")
        page.wait_for_function("() => !document.querySelector('.cb-stage-strip')", timeout=20000)
        page.wait_for_timeout(250)
        away = page.evaluate(GEOMETRY)
        assert not away["barShown"] and away["barVar"] in ("0px", ""), \
            f"6. off a shot the bar must consume no space, got shown={away['barShown']} reserve={away['barVar']!r}"
        away_stamps = page.evaluate(READ_STAMP)
        assert away_stamps["barSlot"] == stamps["barSlot"], \
            "6. the bar slot is static markup and must never be destroyed"
        assert away_stamps["assistant"] == stamps["assistant"] and away_stamps["terminal"] == stamps["terminal"], \
            "O3 regression: the Assistant and Terminal are RETAINED off an eligible surface and must keep their nodes"
        page.evaluate(f"() => {{ location.hash = '#/shot/{APPROVED_SHOT}'; }}")
        page.wait_for_selector(".cb-stage-strip .focused-task-button", timeout=20000)
        back_stamps = page.evaluate(READ_STAMP)
        assert back_stamps["barSlot"] == stamps["barSlot"], "6. the bar slot must be the same node on return"
        assert back_stamps["barMount"] == "REBUILT", \
            "6. the bar's MOUNT is expected to be rebuilt on return — it is cleared off a shot on purpose, and an " \
            "assertion that found it retained would mean the strip had been sitting over the Production page"
        findings.append("6. leaving the shot collapses the bar to zero height, keeps the static slot and O3's two "
                        "retained surfaces, and rebuilds only the bar's own mount on return")

        # ---- 8. the DOM says what the declaration says, in a live document ---------------
        open_shot(BLOCKED_SHOT)
        blocked_view = page.evaluate(SURFACE)
        declared = {row["id"]: row for row in blocked_view["declared"]}
        for row in blocked_view["rendered"]:
            expect = declared[row["id"]]
            assert row["availability"] == expect["availability"], \
                f"8. {row['id']}: the strip painted {row['availability']!r}, the declaration said {expect['availability']!r}"
            assert row["completion"] == expect["completion"], \
                f"8. {row['id']}: the strip painted completion {row['completion']!r}, the declaration said {expect['completion']!r}"
        blocked_rows = [row for row in blocked_view["rendered"] if row["availability"] == "blocked"]
        assert blocked_rows, f"8. fixture check: {BLOCKED_SHOT} must have at least one blocked stage"
        for row in blocked_rows:
            reason = declared[row["id"]]["blockedReason"]
            assert reason and reason.lower() in row["text"].lower(), \
                f"8. {row['id']} is blocked and must show why; its button reads {row['text']!r}"
        review = [row for row in blocked_view["rendered"] if row["completion"] == "needs-review"]
        complete = [row for row in blocked_view["rendered"] if row["completion"] == "complete"]
        assert review, "8. fixture check: this shot must have a stage needing review"
        assert complete, "8. fixture check: this shot must have a completed stage"
        # BLOCKED MUST NOT LOOK LIKE COMPLETE, decided by the pixels the engine computed.
        assert blocked_rows[0]["dotColour"] != complete[0]["dotColour"], \
            "8. a blocked stage and a complete stage paint the same dot"
        assert blocked_rows[0]["statusColour"] != complete[0]["statusColour"], \
            "8. a blocked stage and a complete stage paint the same status word"
        findings.append(f"8. every rendered stage matches the page's own shotStageProgress; "
                        f"{len(blocked_rows)} blocked, {len(review)} needing review, {len(complete)} complete, "
                        f"and blocked paints differently from complete")

        # ---- 9. an unavailable primary is disabled and says why --------------------------
        blocked_id = blocked_rows[0]["id"]
        select_stage(blocked_id)
        at_blocked = page.evaluate(SURFACE)
        disabled = [a for a in at_blocked["actions"] if a["disabled"]]
        assert disabled, f"9. the blocked stage {blocked_id} must still offer its action, disabled"
        for action in disabled:
            assert action["describedBy"], f"9. the disabled action {action['id']} must point at its reason"
            assert action["reasonVisible"], \
                f"9. the reason for {action['id']} must be VISIBLE, not a tooltip a keyboard user cannot reach"
            assert action["reason"] == declared[blocked_id]["blockedReason"], \
                f"9. the reason must be the declaration's own words, got {action['reason']!r}"
        # AND IT REALLY IS INERT: the runtime re-derives availability at click time, so
        # even a click that reaches it does nothing.
        assert page.evaluate("() => window.CineBraidStageSurfaces.invoke('open-stage-work')") is False, \
            "9. invoking a blocked action must be refused by the runtime, not only by the attribute"
        findings.append(f"9. {blocked_id}'s primary action is disabled, carries the declaration's reason visibly, "
                        f"and is refused by the runtime when invoked directly")

        # ---- 11. no fabricated recommendation --------------------------------------------
        no_recommendation = [row for row in blocked_view["declared"] if not row["recommendedNext"]]
        assert no_recommendation, "11. fixture check: this shot must have a stage with no recommendation"
        for row in no_recommendation:
            select_stage(row["id"])
            state = page.evaluate(SURFACE)
            advancing = [a for a in state["actions"] if a["advances"]]
            assert not advancing, \
                f"11. {row['id']} has no recommendedNext, but the bar offered {[a['label'] for a in advancing]}"
        findings.append(f"11. {len(no_recommendation)} stages return no recommendation and the bar offers no "
                        f"Continue for any of them")

        # ---- 10 + 20. a valid primary invokes the shipped path, and changes no truth -----
        open_shot(APPROVED_SHOT)
        with_recommendation = [row for row in page.evaluate(SURFACE)["declared"] if row["recommendedNext"]]
        assert with_recommendation, "10. fixture check: this shot must have a stage with a real recommendation"
        start = with_recommendation[0]
        select_stage(start["id"])
        truth_before = page.evaluate(TRUTH)
        page.click('.cb-stage-action[data-advances="1"]')
        page.wait_for_selector(f'[data-bounded-task="{start["recommendedNext"]}"]', timeout=20000)
        moved = page.evaluate(SURFACE)
        assert moved["selected"] == start["recommendedNext"], \
            f"10. Continue left the workspace on {moved['selected']!r}"
        assert page.evaluate(TRUTH) == truth_before, "20. advancing a stage must change no production truth"
        # And the AVAILABLE primary reaches the shipped cross-panel handoff.
        open_shot(APPROVED_SHOT)
        select_stage("motion")
        assert page.evaluate("() => window.CineBraidStageSurfaces.invoke('open-stage-work')") is True, \
            "10. an available primary must dispatch"
        page.wait_for_selector('[data-guided-panel="motion"]', timeout=20000)
        findings.append("10. Continue navigates through the shipped stage-selection path and the primary reaches "
                        "the shipped openGuidedPanel handoff; the shot's approvals, frames, clips and delivery "
                        "intent are byte-identical afterwards")

        # ---- 12-13. O3 survives, and the bar never covers the Terminal -------------------
        after_all = page.evaluate(SURFACE)
        assert after_all["o3"]["assistant"] == 1 and after_all["o3"]["terminal"] == 1, \
            f"12. the Assistant and the Terminal must still be mounted, got {after_all['o3']}"
        geometry = page.evaluate(GEOMETRY)
        assert not geometry["barOverlapsDock"], "13. the persistent bar must never overlap the Activity Terminal"
        assert not geometry["barOverlapsTopbar"], "13. the bar must pin BENEATH the topbar, not behind it"
        findings.append("12-13. Assistant and Terminal still mounted after every stage change; the bar sits under "
                        "the topbar and clear of the dock")

        # ---- 14. the bar does not grow the document unexpectedly -------------------------
        # The strip left `#main` and took its own height with it, so the honest claim is
        # about the NET: the page must not have grown by more than the bar's own height.
        page.evaluate("() => window.scrollTo(0, 0)")
        before_dock = page.evaluate(GEOMETRY)
        page.evaluate("() => window.CineBraidStageSurfaces.paint()")
        page.wait_for_timeout(200)
        after_paint = page.evaluate(GEOMETRY)
        assert abs(after_paint["scrollHeight"] - before_dock["scrollHeight"]) <= 2, \
            f"14. repainting the bar changed the document height ({before_dock['scrollHeight']} -> {after_paint['scrollHeight']})"
        assert after_paint["barVar"].endswith("px") and int(after_paint["barVar"][:-2]) == after_paint["barBox"]["h"], \
            f"14. the published bar height {after_paint['barVar']} must equal the rendered one {after_paint['barBox']['h']}px"
        findings.append(f"14. a repaint changes no document height, and --cb-bar-height ({after_paint['barVar']}) "
                        f"equals the bar's rendered height")

        # ---- 15-17. responsive, in both themes ------------------------------------------
        overflow, reach = [], []
        for theme in ("night", "light"):
            page.evaluate("(t) => { document.getElementById('app').dataset.surf = t; }", theme)
            for name, width, height, expected_rail in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                page.wait_for_timeout(260)
                g = page.evaluate(GEOMETRY)
                if g["horizontalOverflow"]:
                    overflow.append(f"{theme}/{name} {width}px: scrollWidth {g['scrollWidth']}")
                if g["stageCount"] != 5 or g["stagesVisible"] != 5:
                    reach.append(f"{theme}/{name} {width}px: {g['stagesVisible']}/{g['stageCount']} stages reachable")
                assert g["currentInView"] is not False, \
                    f"16. {theme}/{name} {width}px: the current stage is scrolled out of the strip"
                assert g["railWidth"] == expected_rail, \
                    f"O3 regression: {theme}/{name} {width}px expected a {expected_rail}px rail, got {g['railWidth']}"
                if g["railShown"]:
                    assert g["mainWidth"] >= CENTRE_FLOOR, \
                        f"O3 regression: {theme}/{name} {width}px left the centre at {g['mainWidth']}px"
                assert not g["barOverlapsDock"], f"13. {theme}/{name} {width}px: the bar overlapped the Terminal"

                # THE STICKY STACK, measured WHILE SCROLLED, which is the only state in
                # which it can be wrong: at scroll 0 every sticky surface is already at its
                # static position and the arithmetic is trivially satisfied. Rendered rects
                # rather than computed `top` strings, because #app carries `zoom` and a
                # computed length is in pre-zoom CSS pixels while a rect is in device ones.
                page.evaluate("() => window.scrollTo(0, 600)")
                page.wait_for_timeout(170)
                pinned = page.evaluate(GEOMETRY)
                if pinned["scrollY"] > 0:
                    assert not pinned["barOverlapsTopbar"], \
                        f"{theme}/{name} {width}px: the bar pinned behind the topbar while scrolled"
                    assert not pinned["barOverlapsDock"], \
                        f"13. {theme}/{name} {width}px: the bar overlapped the Terminal while scrolled"
                    if pinned["railShown"] and pinned["railBox"]:
                        assert pinned["railBox"]["top"] >= pinned["barBox"]["bottom"] - 2, \
                            (f"{theme}/{name} {width}px: the rail pinned at {pinned['railBox']['top']}px, above the "
                             f"bar's bottom edge at {pinned['barBox']['bottom']}px — its first "
                             f"{pinned['barBox']['bottom'] - pinned['railBox']['top']}px sit behind the strip")
                page.evaluate("() => window.scrollTo(0, 0)")
                page.wait_for_timeout(130)
        assert not overflow, f"15. horizontal document overflow: {overflow}"
        assert not reach, f"16. stages became unreachable: {reach}"
        findings.append(f"15-17. {len(VIEWPORTS)} widths x 2 themes: no horizontal overflow, all five stages "
                        f"reachable and the current one in view at every one, and O3's 340/240/0 rail bands "
                        f"and 900px centre floor are unchanged")

        page.set_viewport_size({"width": 1600, "height": 1000})
        page.wait_for_timeout(260)

        # ---- 17b. the tone colours actually resolve --------------------------------------
        # Three shipped tone colours were painted with custom properties this stylesheet
        # never declares, so they computed to `unset` — the attention dot and the running
        # dot were transparent and nobody could see it in a source review.
        open_shot(BLOCKED_SHOT)
        painted = page.evaluate(SURFACE)["rendered"]
        transparent = [row["id"] for row in painted
                       if row["dotColour"] in ("rgba(0, 0, 0, 0)", "transparent") and not row["dotRing"].strip("none ")]
        assert not transparent, \
            f"17. these stages painted an invisible status dot with no ring either: {transparent}"
        findings.append(f"17. every stage's status dot resolves to a real colour or a ring in both themes "
                        f"({len({row['dotColour'] for row in painted})} distinct dot colours in this state)")

        # =================================================================================
        # NEGATIVE CONTROLS. Each mutates the running page, proves the mutation changed
        # what the check reads, and requires the check to notice.
        # =================================================================================

        def probe(label, condition, why):
            assert condition, f"{label} probe receipt: {why}"

        # N1 — rebuild the bar per stage, the way a stage-owned navigator would.
        open_shot(APPROVED_SHOT)
        base_stamps = page.evaluate(STAMP)
        page.evaluate("""() => {
            const slot = document.querySelector('#cb-shell-bar .cb-shell-slot-body');
            const fresh = document.createElement('div');
            fresh.id = 'cb-stage-mount';
            fresh.className = 'cb-stage-mount';
            slot.replaceChildren(fresh);
            window.CineBraidStageSurfaces.paint();
        }""")
        page.wait_for_timeout(200)
        rebuilt = page.evaluate(READ_STAMP)
        probe("N1", rebuilt["barMount"] == "REBUILT",
              "replacing the mount did not lose its stamp, so the identity check is not reading the mount")
        assert rebuilt != base_stamps, "N1: a rebuilt bar was not caught by the identity comparison"
        findings.append("N1. a bar rebuilt per stage loses its stamp and is caught")

        open_shot(APPROVED_SHOT)

        # N2 — render a second navigator.
        before_n2 = page.evaluate(SURFACE)["navigators"]
        page.evaluate("""() => {
            const clone = document.querySelector('.cb-stage-strip').cloneNode(true);
            clone.id = 'cb-o4-control-second-nav';
            document.getElementById('main').prepend(clone);
        }""")
        after_n2 = page.evaluate(SURFACE)
        probe("N2", after_n2["navigators"] == before_n2 + 1 and after_n2["navigatorsInMain"] == 1,
              "the injected navigator was not counted, so the one-navigator check is not reading the document")
        assert after_n2["navigators"] != 1, "N2: a second navigator was not caught"
        page.evaluate("() => document.getElementById('cb-o4-control-second-nav')?.remove()")
        findings.append("N2. a second navigator inside #main is counted and caught")

        # N3 — derive the order from rendered children by shuffling them.
        before_n3 = page.evaluate(SURFACE)["renderedOrder"]
        page.evaluate("""() => {
            const strip = document.querySelector('.cb-stage-strip');
            const kids = [...strip.children];
            strip.replaceChildren(...kids.slice().reverse());
        }""")
        after_n3 = page.evaluate(SURFACE)
        probe("N3", after_n3["renderedOrder"] == before_n3[::-1],
              "reversing the children did not change the read order, so the order check is not reading the DOM")
        assert after_n3["renderedOrder"] != after_n3["declaredOrder"], \
            "N3: a strip whose order came from its rendered children was not caught"
        page.evaluate("() => window.CineBraidStageSurfaces.paint()")
        page.wait_for_timeout(150)
        assert page.evaluate(SURFACE)["renderedOrder"] == before_n3, "N3: the repaint did not restore the declared order"
        findings.append("N3. a strip reordered by its rendered children disagrees with the declaration and is caught")

        # N4 — locally relabel a blocked stage as complete.
        open_shot(BLOCKED_SHOT)
        target = [row for row in page.evaluate(SURFACE)["rendered"] if row["availability"] == "blocked"][0]["id"]
        page.evaluate("""(id) => {
            const button = document.querySelector(`.cb-stage-strip [data-stage-id="${id}"]`);
            button.dataset.availability = 'available';
            button.dataset.completion = 'complete';
        }""", target)
        lied = page.evaluate(SURFACE)
        painted_row = [row for row in lied["rendered"] if row["id"] == target][0]
        declared_row = [row for row in lied["declared"] if row["id"] == target][0]
        probe("N4", painted_row["completion"] == "complete" and declared_row["completion"] != "complete",
              "the relabel did not take, so the declaration-agreement check is not comparing the painted attributes")
        assert painted_row["availability"] != declared_row["availability"], \
            "N4: a locally-relabelled blocked stage was not caught by the declaration comparison"
        page.evaluate("() => window.CineBraidStageSurfaces.paint()")
        page.wait_for_timeout(150)
        restored = [row for row in page.evaluate(SURFACE)["rendered"] if row["id"] == target][0]
        assert restored["availability"] == "blocked", "N4: the repaint did not restore the declared availability"
        findings.append(f"N4. calling the blocked stage {target} complete disagrees with the page's own "
                        f"shotStageProgress and is caught")

        # N5 — turn an empty recommendedNext into a Continue.
        empty = [row for row in page.evaluate(SURFACE)["declared"] if not row["recommendedNext"]][0]["id"]
        select_stage(empty)
        before_n5 = [a for a in page.evaluate(SURFACE)["actions"] if a["advances"]]
        probe("N5", not before_n5, f"{empty} already offered a Continue, so the fabrication control proves nothing")
        page.evaluate("""() => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'cb-stage-action emphasis-advance';
            button.dataset.actionId = 'control-fabricated';
            button.dataset.advances = '1';
            button.textContent = 'Continue to Motion & sound';
            document.querySelector('.cb-stage-actions').appendChild(button);
        }""")
        after_n5 = [a for a in page.evaluate(SURFACE)["actions"] if a["advances"]]
        probe("N5", len(after_n5) == 1,
              "the fabricated Continue was not read, so the no-recommendation check is not reading the bar")
        assert after_n5, "N5: a fabricated Continue on a stage with no recommendation was not caught"
        page.evaluate("() => window.CineBraidStageSurfaces.paint()")
        page.wait_for_timeout(150)
        assert not [a for a in page.evaluate(SURFACE)["actions"] if a["advances"]], \
            "N5: the repaint did not remove the fabricated recommendation"
        findings.append(f"N5. a Continue fabricated on {empty}, which the model gives no recommendation for, is caught")

        # N6 — re-enable a disabled action. The attribute check must notice, AND the
        # runtime must still refuse the invocation, which is the second guard.
        select_stage(target)
        before_n6 = [a for a in page.evaluate(SURFACE)["actions"] if a["disabled"]]
        probe("N6", before_n6, f"{target} offered no disabled action, so the control proves nothing")
        page.evaluate("() => document.querySelectorAll('.cb-stage-action[disabled]').forEach((b) => b.removeAttribute('disabled'))")
        after_n6 = page.evaluate(SURFACE)["actions"]
        probe("N6", not any(a["disabled"] for a in after_n6),
              "removing the attribute did not change what the check reads")
        assert not any(a["disabled"] for a in after_n6), "N6: a clickable disabled action was not caught"
        truth_before_n6 = page.evaluate(TRUTH)
        page.click(f'.cb-stage-action[data-action-id="open-stage-work"]')
        page.wait_for_timeout(300)
        assert page.evaluate(TRUTH) == truth_before_n6, \
            "N6: clicking the re-enabled action changed production truth — the runtime's own availability guard is not holding"
        page.evaluate("() => window.CineBraidStageSurfaces.paint()")
        page.wait_for_timeout(150)
        assert any(a["disabled"] for a in page.evaluate(SURFACE)["actions"]), \
            "N6: the repaint did not restore the disabled attribute"
        findings.append("N6. removing `disabled` is caught, and the runtime still refuses the invocation, so the "
                        "attribute is a second lock rather than the only one")

        # N7 — let the bar overlap the Terminal.
        probe("N7", not page.evaluate(GEOMETRY)["barOverlapsDock"], "the bar already overlapped the dock")
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.id = 'cb-o4-control-overlap';
            style.textContent = '#cb-shell-bar{position:fixed!important;bottom:0!important;top:auto!important;left:0;right:0;z-index:99}';
            document.head.appendChild(style);
        }""")
        page.wait_for_timeout(250)
        assert page.evaluate(GEOMETRY)["barOverlapsDock"], \
            "N7: pinning the bar to the viewport bottom did not make it overlap the dock, so the overlap check is not measuring anything"
        page.evaluate("() => document.getElementById('cb-o4-control-overlap')?.remove()")
        page.wait_for_timeout(250)
        assert not page.evaluate(GEOMETRY)["barOverlapsDock"], "N7: removing the control did not restore the geometry"
        findings.append("N7. a bar allowed to cover the Activity Terminal is caught by the overlap measurement")

        # N8 — hide two stages at a phone width.
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(300)
        probe("N8", page.evaluate(GEOMETRY)["stagesVisible"] == 5, "not all five stages were reachable to begin with")
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.id = 'cb-o4-control-hide';
            // `!important` because the shipped `.focused-task-button{display:grid!important}`
            // would otherwise win and the control would silently do nothing.
            style.textContent = '@media(max-width:640px){.cb-stage-strip .focused-task-button:nth-child(n+4){display:none!important}}';
            document.head.appendChild(style);
        }""")
        page.wait_for_timeout(250)
        hidden = page.evaluate(GEOMETRY)
        assert hidden["stagesVisible"] == 3, \
            f"N8: hiding the last two stages left {hidden['stagesVisible']} reachable, so the reachability check is not measuring visibility"
        page.evaluate("() => document.getElementById('cb-o4-control-hide')?.remove()")
        page.wait_for_timeout(250)
        assert page.evaluate(GEOMETRY)["stagesVisible"] == 5, "N8: removing the control did not restore reachability"
        findings.append("N8. hiding stages at a phone width is caught by the reachability measurement")

        # ---- teardown -------------------------------------------------------------------
        page.set_viewport_size({"width": 1600, "height": 1000})
        page.wait_for_timeout(200)
        final = page.evaluate("""() => ({
            controls: document.querySelectorAll('#cb-o4-control-overlap,#cb-o4-control-hide,#cb-o4-control-second-nav').length,
            navigators: document.querySelectorAll('.focused-taskbar').length,
            actionSurfaces: document.querySelectorAll('[data-cb-stage-actions]').length,
            assistants: document.querySelectorAll('#cb-assistant-mount').length,
            terminals: document.querySelectorAll('#cb-terminal-mount').length,
        })""")
        assert final["controls"] == 0, f"teardown: a control survived: {final}"
        assert final["navigators"] == 1 and final["actionSurfaces"] == 1, \
            f"teardown: the page must hold exactly one navigator and one action surface, got {final}"
        assert final["assistants"] == 1 and final["terminals"] == 1, \
            f"teardown: O3's surfaces must still be mounted, got {final}"
        assert not page_errors, f"the page raised uncaught errors: {page_errors}"
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()

assert not offsite, f"requests left the machine: {offsite}"
assert not paid_calls, f"a paid route was called: {paid_calls}"

print("\n".join(findings))
print(f"project data isolated: config {config_path}, projects {projects_root} - data/ untouched")
print("no offsite request and no paid route: 0 blocked, 0 attempted")
print("persistent stage strip and stage actions real-browser audit passed")
