#!/usr/bin/env python3
"""Batch 2 Slice 5b — Shot Intent UX and adaptive execution, in a real Chromium.

WHY A BROWSER IS NEEDED. tests/shot-intent-ux.js proves the derivations, the narrowing
matrix and the rendered markup in Node. Seven claims cannot be proven there, and they are
the seven a filmmaker would actually notice:

  1  a route-less legacy shot opens exactly as it always has, and the new control
     truthfully says nothing has been decided
  2  choosing an intent from the real <select> writes the canonical token, and the
     project on disk carries it after the debounced save
  3  the Frames stage visibly adapts: declaring an intent that needs no frame folds the
     frame workflow, and declaring one that does brings it straight back — and the line
     that explains the fold is laid out so a filmmaker can actually read it (3b)
  4  Simple <-> Advanced still works, and the two controls do not touch each other
  5  frame data survives folding and re-exposure — read out of the live DOM, not out of
     a function's return value
  6  no generation method becomes selectable because an intent was declared; the
     rendered picker's enabled set only ever shrinks
  7  a declared intent survives a full page reload and comes back onto the screen

IT CARRIES ITS OWN NEGATIVE CONTROLS, because an adaptation assertion that cannot fail is
worth nothing:

  N1 forces the folded frame workflow open while the intent says it should be folded, and
     requires the adaptation assertion to catch it
  N2 enables a route-narrowed option in the rendered picker and requires the
     no-widening assertion to catch it

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched. The POST to /api/generation/fal/jobs —
the only route that spends money — is intercepted and aborted before it reaches the
server, let alone a provider, and any off-site request fails the suite. FAL_KEY is a
string that is not a credential, purely so the client-side "is fal configured" gate opens
far enough to draw a generation dialog.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Batch 2 Slice 5b Shot Intent UX"
sync_playwright = require_browser(LABEL)

FRAMES_SHOT = "SAMPLE-01"      # a route-less legacy shot: one frame, no motion unit
MOTION_SHOT = "SAMPLE-03"      # given a t2v motion unit below, so its picker is reachable
PAID_ROUTE = "/api/generation/fal/jobs"
COMPILE_ROUTE = "/api/prompt/compile"
# Everything under /api/generation/ — the plan, the options and the job. A refused target
# must reach none of them, not merely stop short of the one that bills.
GENERATION_ROUTE = "/api/generation/"
generation_calls = []
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")
ROUTES = ["t2v", "i2v", "flf", "r2v", "hybrid"]

page_errors, console_errors, offsite, paid_calls = [], [], [], []
# Every prompt COMPILE, recorded the same way the paid route is. "Build prompt did not
# proceed" is a claim about a request that was never made, so the request has to be
# counted rather than inferred from the screen.
compile_calls = []
findings = []


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-slice5b-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_file = projects_root / "dogfood-sample" / "project.json"

# A TEXT-TO-VIDEO MOTION UNIT ON ONE SHOT, and nothing else about the fixture is touched.
#
# The shipped Motion panel is locked behind an approved still for every route except t2v —
# that is Shot Execution T0's own gate and this slice deliberately does not weaken it — so
# a fresh sample shot has no reachable video-target picker at all. Giving ONE shot the one
# route that legitimately needs no frame is what makes the rendered picker readable
# without approving anything, and section 6 is about the picker rather than the gate.
project = json.loads(project_file.read_text(encoding="utf-8"))
motion_shot = next(row for row in project["shots"] if row["id"] == MOTION_SHOT)
motion_shot["clips"] = [{
    "id": "slice5b-unit-a", "label": "A", "suffix": "a", "title": "Primary motion",
    "kind": "t2v", "dur": 5, "note": "", "motionPrompt": "The bay lights flicker once.",
    "fromFrame": "", "toFrame": "", "generationPackages": [],
}]
# Every shot starts route-less, which is section 1's precondition and is asserted there.
for row in project["shots"]:
    row.pop("deliveryRoute", None)
project_file.write_text(json.dumps(project, indent=2), encoding="utf-8")

config = json.loads(config_path.read_text(encoding="utf-8"))
config.setdefault("generation", {}).setdefault("fal", {}).update({
    "enabled": True, "blockingOutputs": 2, "blockingQuality": "low", "blockingResolution": "1k",
    "frameOutputs": 2, "frameQuality": "high", "frameResolution": "1k",
})
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "FAL_KEY": "slice5b-browser-qa-placeholder-not-a-credential"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# WHAT THE SHOT INTENT SURFACE SAYS, read off the rendered document and nothing else.
INTENT_STATE = """
() => {
  const control = document.querySelector('.shot-intent-control');
  if (!control) return { present: false };
  const select = control.querySelector('select');
  const options = [...control.querySelectorAll('option')].map((node) => ({
    value: node.value, label: node.textContent, selected: node.selected, disabled: node.disabled,
  }));
  const shot = (location.hash.split('?')[0].split('/')[2] || '');
  return {
    present: true,
    open: control.open,
    shotId: control.dataset.shotId,
    route: control.dataset.shotIntent,
    reading: control.dataset.shotIntentReading,
    framesRequired: control.dataset.framesRequired,
    summary: (control.querySelector('summary span') || {}).textContent || '',
    selectValue: select ? select.value : null,
    selected: options.filter((row) => row.selected).map((row) => row.value),
    options: options.map((row) => row.value),
    labels: options.map((row) => row.label),
    disabledSelected: options.filter((row) => row.selected).every((row) => row.disabled),
    /* THE RECORD ITSELF, from the page's own project document. `P` is a top-level `let`
       in public/app.js and therefore NOT a property of window, so it is read here in the
       page's own scope where the binding is visible. */
    stored: (() => {
      const row = (P.shots || []).find((item) => item.id === shot);
      if (!row) return 'NO-SHOT';
      return Object.prototype.hasOwnProperty.call(row, 'deliveryRoute') ? row.deliveryRoute : null;
    })(),
  };
}
"""

# WHAT THE FRAMES STAGE LOOKS LIKE. Every count here is of nodes that really exist in the
# document, so "the data survived" is a statement about what is rendered.
FRAMES_STATE = """
() => {
  const workspace = document.querySelector('#main .shot-frames-workspace');
  const workflow = document.querySelector('#main .guided-frame-workflow');
  return {
    workspace: !!workspace,
    relevance: workspace ? workspace.dataset.framesRelevance : null,
    framesRequired: workspace ? workspace.dataset.framesRequired : null,
    statement: document.querySelectorAll('#main .shot-frames-not-required').length,
    workflowPresent: !!workflow,
    workflowOpen: workflow ? workflow.open : null,
    /* Present in the DOM whether the disclosure is open or closed — a <details> that is
       closed still contains its children, which is the whole difference between folding
       a stage and deleting one. */
    frameRail: document.querySelectorAll('#main .guided-frame-rail').length,
    frameRailButtons: document.querySelectorAll('#main .guided-frame-rail button').length,
    addFrame: document.querySelectorAll('#main .guided-add-frame').length,
    frameCards: document.querySelectorAll('#main .guided-frame-card, #main .guided-frame-workflow-body > *').length,
    automation: document.querySelectorAll('#main .shot-stage-automation').length,
  };
}
"""

# THE FOLDED-FRAMES BANNER'S GEOMETRY. Node can prove the sentence is in the markup; only
# a real layout can prove a filmmaker can read it. `flex:0 0 auto` resolves flex-basis from
# the width property, and the generic .ghost-btn is `width:100%`, so the button claimed the
# whole row and — being unshrinkable — left the sentence 0px wide and 36 lines tall at a
# 1600px viewport. Measured, not inferred: getBoundingClientRect and the resolved
# line-height, which is the only way a collapsed text column is visible to a test at all.
FOLDED_BANNER_GEOMETRY = """
() => {
  const row = document.querySelector('#main .shot-frames-not-required');
  if (!row) return null;
  const button = row.querySelector('button');
  const copy = row.querySelector('div');
  const small = copy && copy.querySelector('small');
  const width = (node) => Math.round(node.getBoundingClientRect().width);
  return {
    row: width(row),
    button: width(button),
    copy: width(copy),
    small: small ? width(small) : 0,
    /* The rendered wrap count. One word per line is what the defect looked like. */
    smallLines: small
      ? Math.round(small.getBoundingClientRect().height / parseFloat(getComputedStyle(small).lineHeight))
      : 0,
    column: getComputedStyle(row).flexDirection === 'column',
  };
}
"""

# THE RENDERED VIDEO-TARGET PICKER: which options exist, and which a filmmaker could
# actually choose. `disabled` is read off the live option, not off the markup string.
PICKER_STATE = """
() => {
  const select = document.querySelector('#main .guided-video-target-control select');
  if (!select) return { present: false };
  const options = [...select.querySelectorAll('option')];
  return {
    present: true,
    intentRoute: select.dataset.intentRoute || '',
    all: options.map((node) => node.value),
    enabled: options.filter((node) => !node.disabled).map((node) => node.value),
    disabledSuffixes: options.filter((node) => node.disabled).map((node) => node.textContent),
    note: (document.querySelector('#main .guided-video-target-control small') || {}).textContent || '',
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
        context = browser.new_context(viewport={"width": 1600, "height": 1000})

        def guard(route):
            """No request leaves this machine, and the paid route is never reached."""
            request = route.request
            url = request.url
            if PAID_ROUTE in url and request.method == "POST":
                paid_calls.append(f"{request.method} {url}")
                return route.abort("failed")
            if COMPILE_ROUTE in url and request.method == "POST":
                compile_calls.append(f"{request.method} {url}")
                return route.continue_()
            if GENERATION_ROUTE in url:
                generation_calls.append(f"{request.method} {url}")
                return route.continue_()
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{request.method} {url}")
            return route.abort("failed")

        # Installed on the CONTEXT, before a page exists, so no navigation can begin
        # before the interceptor is in force.
        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

        def open_shot(shot_id):
            page.goto(f"{base}/#/shot/{shot_id}", wait_until="domcontentloaded")
            page.wait_for_selector("#main .shot-shell", timeout=20000)
            page.wait_for_selector(".shot-intent-control", timeout=20000)

        def select_stage(label):
            page.locator(".cb-stage-strip .focused-task-button", has_text=label).first.click()
            page.wait_for_timeout(400)

        def expand_all():
            """The video-target picker lives three disclosures deep inside the Motion
            workspace, which is the shipped design: it is an advanced control and it opens
            on demand. Section 6 is about WHICH OPTIONS ARE SELECTABLE, not about how many
            clicks reach them, so the disclosures are opened wholesale — the same thing
            tests/generation-simple-advanced-real-browser.py does to reach its dialog."""
            page.evaluate("() => document.querySelectorAll('#main details').forEach((node) => { node.open = true; })")
            page.wait_for_timeout(250)

        def open_intent():
            control = page.locator(".shot-intent-control").first
            if not control.evaluate("node => node.open"):
                control.locator("summary").click()
                page.wait_for_timeout(200)
            page.wait_for_selector(".shot-intent-control select", timeout=10000)

        def set_intent(value, wait_for=None):
            """Chosen the way a filmmaker chooses it: through the rendered <select>."""
            open_intent()
            page.locator(".shot-intent-control select").first.select_option(value)
            # The writer re-renders the whole route, so the control is a NEW node.
            page.wait_for_timeout(500)
            page.wait_for_selector(".shot-intent-control", timeout=10000)
            if wait_for: page.wait_for_selector(wait_for, timeout=10000)

        def saved_route(shot_id, expected, timeout=8.0):
            """WHAT THE PROJECT ON DISK SAYS. dirty() debounces for 500ms and then saves,
            so this polls the file the server actually wrote rather than sleeping once."""
            deadline_at = time.time() + timeout
            last = "NOT-READ"
            while time.time() < deadline_at:
                try:
                    row = next(r for r in json.loads(project_file.read_text(encoding="utf-8"))["shots"] if r["id"] == shot_id)
                except Exception:
                    time.sleep(.15); continue
                last = row.get("deliveryRoute", None) if "deliveryRoute" in row else "ABSENT"
                if last == expected: return last
                time.sleep(.15)
            return last

        # ============================================ 1 · A ROUTE-LESS LEGACY SHOT
        open_shot(FRAMES_SHOT)
        assert not page_errors, f"1. the shot workspace raised uncaught errors: {page_errors}"
        state = page.evaluate(INTENT_STATE)
        assert state["present"], "1. every shot must carry a Shot Intent control"
        assert state["shotId"] == FRAMES_SHOT, f"1. the control must belong to the shot: {state['shotId']!r}"
        assert state["stored"] is None, f"1. a legacy shot must carry no declared route, got {state['stored']!r}"
        assert state["reading"] == "absent", f"1. and must read as undeclared, got {state['reading']!r}"
        assert state["route"] == "", "1. and must show no route"
        assert state["selected"] == [""], f"1. only the undeclared option may be selected, got {state['selected']}"
        assert state["open"] is False, "1. the control must open COLLAPSED — one line, not another panel"
        assert state["summary"] == "Not decided yet", f"1. the collapsed line must say so, got {state['summary']!r}"
        assert state["options"] == [""] + ROUTES, f"1. the five routes plus the undeclared state, got {state['options']}"
        assert all(label and label not in ROUTES for label in state["labels"]), \
            f"1. every option must be labelled in filmmaker language, got {state['labels']}"
        findings.append(f"1. {FRAMES_SHOT} opens route-less: the control is collapsed, reads 'Not decided yet', "
                        f"offers {len(ROUTES)} routes plus the undeclared state, and the record carries no key")

        select_stage("Frames")
        page.wait_for_selector("#main .shot-frames-workspace", timeout=10000)
        legacy_frames = page.evaluate(FRAMES_STATE)
        assert legacy_frames["relevance"] == "undeclared", \
            f"1. an undeclared shot's Frames stage must say so, got {legacy_frames['relevance']!r}"
        assert legacy_frames["workflowOpen"] is True, "1. and must open exactly as the shipped build opens it"
        assert legacy_frames["statement"] == 0, "1. with no not-required statement"
        assert legacy_frames["frameRail"] >= 1, "1. and the frame workflow really is rendered"
        findings.append(f"1. its Frames stage is unchanged: relevance 'undeclared', workflow open, "
                        f"{legacy_frames['frameRailButtons']} frame-rail controls rendered")

        # ================================== 2 · DECLARING EACH ROUTE, AND PERSISTENCE
        for route in ROUTES:
            set_intent(route)
            live = page.evaluate(INTENT_STATE)
            assert live["stored"] == route, f"2. {route}: the page's own record must carry it, got {live['stored']!r}"
            assert live["reading"] == "declared", f"2. {route}: the surface must report a declared reading"
            assert live["route"] == route, f"2. {route}: the surface must show the stored truth"
            assert live["selected"] == [route], f"2. {route}: exactly that option may be selected, got {live['selected']}"
            assert live["summary"] not in ("", "Not decided yet"), \
                f"2. {route}: the collapsed line must state the intent, got {live['summary']!r}"
            on_disk = saved_route(FRAMES_SHOT, route)
            assert on_disk == route, f"2. {route}: the project on disk must carry it after the save, got {on_disk!r}"
        findings.append(f"2. all {len(ROUTES)} routes declared through the rendered <select>, each reflected back on "
                        "the surface and each written to the project file by the shipped save")

        # ============================================== 3 · VISIBLE STAGE ADAPTATION
        set_intent("t2v")
        page.wait_for_selector("#main .shot-frames-not-required", timeout=10000)
        folded = page.evaluate(FRAMES_STATE)
        assert folded["relevance"] == "not-required", f"3. t2v must mark the stage not-required, got {folded['relevance']!r}"
        assert folded["framesRequired"] == "0", "3. and say so on the element"
        assert folded["workflowOpen"] is False, "3. the frame workflow must fold"
        assert folded["statement"] == 1, "3. and the fold must explain itself in one visible line"
        assert page.locator("#main .shot-frames-not-required button", has_text="Change shot intent").count() == 1, \
            "3. and offer the way back to the control that caused it"
        # 3b · AND THE STATEMENT MUST BE READABLE. A banner whose sentence renders one word
        # per line states nothing. The button is allowed to sit beside the text (row) or
        # above it (the <=760px column); it is never allowed to BE the row.
        wide = page.evaluate(FOLDED_BANNER_GEOMETRY)
        assert wide and not wide["column"], "3b. precondition: 1600px must still lay the banner out as a row"
        assert wide["button"] < wide["row"] * 0.5, (
            f"3b. the button must not consume the row it explains itself in "
            f"({wide['button']}px of {wide['row']}px)")
        assert wide["copy"] > wide["row"] * 0.5, (
            f"3b. the sentence must get most of the row, got {wide['copy']}px of {wide['row']}px")
        assert wide["smallLines"] <= 4, (
            f"3b. the sentence must not collapse into a column of single words, "
            f"got {wide['smallLines']} rendered lines")

        # AND THE NARROW LAYOUT IS NOT COLLATERAL. Below 760px the banner is a column and
        # the button is meant to fill it. Widening the text above must not take that away.
        page.set_viewport_size({"width": 700, "height": 1000})
        page.wait_for_timeout(350)
        narrow = page.evaluate(FOLDED_BANNER_GEOMETRY)
        assert narrow and narrow["column"], "3b. precondition: 700px must still lay the banner out as a column"
        assert narrow["button"] > narrow["row"] * 0.9, (
            f"3b. the column layout must still give the button the full row "
            f"({narrow['button']}px of {narrow['row']}px)")
        assert narrow["smallLines"] <= 4, (
            f"3b. and the sentence must stay readable there too, got {narrow['smallLines']} rendered lines")
        page.set_viewport_size({"width": 1600, "height": 1000})
        page.wait_for_timeout(350)
        # N3 · AND 3b CAN FAIL. The defect was one declaration — the generic .ghost-btn
        # `width:100%` reaching a `flex:0 0 auto` button — so the negative control is that
        # declaration, put back through a stylesheet the page really applies. If 3b's
        # comparison could not see it, 3b would be proving nothing about the fix.
        page.add_style_tag(content=".shot-frames-not-required button{width:100%}")
        page.wait_for_timeout(350)
        regressed = page.evaluate(FOLDED_BANNER_GEOMETRY)
        assert regressed["button"] >= regressed["row"] * 0.5, \
            "N3: the control must actually reproduce the defect it is testing for"
        caught = not (regressed["button"] < regressed["row"] * 0.5
                      and regressed["copy"] > regressed["row"] * 0.5
                      and regressed["smallLines"] <= 4)
        assert caught, "N3: 3b would not have noticed the button eating the row it explains itself in"
        findings.append(f"N3. negative control: restoring the single `width:100%` declaration puts the button "
                        f"back to {regressed['button']}px of the {regressed['row']}px row and the sentence to "
                        f"{regressed['smallLines']} lines, and 3b's own comparison catches it")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#main .shot-frames-not-required", timeout=20000)
        page.wait_for_timeout(400)

        findings.append(f"3b. the folded-frames statement is readable: at 1600px the button takes "
                        f"{wide['button']}px of the {wide['row']}px row and the sentence renders in "
                        f"{wide['smallLines']} lines; at 700px the column layout still gives the button "
                        f"the full {narrow['button']}px row")
        # AND THE WAY BACK REALLY WORKS. The control is collapsed by default and lives
        # above the stage, so a folded stage that only NAMED it would be a dead end with
        # a label on it. Clicked, not asserted from source.
        page.evaluate("() => { const node = document.querySelector('.shot-intent-control'); if (node) node.open = false; }")
        page.wait_for_timeout(200)
        page.locator("#main .shot-frames-not-required button", has_text="Change shot intent").first.click()
        page.wait_for_timeout(600)
        assert page.evaluate("() => document.querySelector('.shot-intent-control').open") is True, \
            "3. the way back must actually open the Shot Intent control"
        assert page.locator(".shot-intent-control select").first.is_visible(), \
            "3. and leave the filmmaker looking at the control they have to change"

        set_intent("i2v")
        page.wait_for_timeout(400)
        reopened = page.evaluate(FRAMES_STATE)
        assert reopened["relevance"] == "required", f"3. i2v must need the frames again, got {reopened['relevance']!r}"
        assert reopened["workflowOpen"] is True, "3. and the workflow must come straight back open"
        assert reopened["statement"] == 0, "3. with the not-required line gone"

        # AND r2v KEEPS FRAMES, which is the disagreement this slice resolved: the probes
        # ask r2v only for a reference, but the shipped Motion panel still opens it from
        # an approved still, so folding Frames would be a dead end.
        set_intent("r2v")
        page.wait_for_timeout(400)
        reference_route = page.evaluate(FRAMES_STATE)
        assert reference_route["relevance"] == "required", \
            "3. r2v must keep the Frames workflow: the shipped motion workspace still opens it from an approved frame"
        findings.append("3. the Frames stage adapts visibly: t2v folds it with a stated reason and a way back, "
                        "i2v reopens it, and r2v keeps it because the shipped motion gate still asks for a frame")

        # N1 · THE ADAPTATION ASSERTION CAN FAIL. Force the folded workflow open and
        # require section 3's own check to catch it.
        set_intent("t2v")
        page.wait_for_selector("#main .shot-frames-not-required", timeout=10000)
        page.evaluate("() => { document.querySelector('#main .guided-frame-workflow').open = true; }")
        forced = page.evaluate(FRAMES_STATE)
        assert forced["workflowOpen"] is True, "N1: the control must actually change what the assertion reads"
        caught = forced["workflowOpen"] is not False
        assert caught, "N1: the adaptation assertion would not have noticed a workflow that refused to fold"
        findings.append("N1. negative control: a folded workflow forced open is caught by the same assertion "
                        "section 3 relies on")

        # N1 PUTS BACK WHAT IT DISTURBED, and the reason is the product behaving correctly.
        # Setting `open` fires a real toggle event, which rememberWorkspaceSection stores —
        # exactly as it would for a filmmaker's click, because it is indistinguishable from
        # one. Left there, section 5 would be reading this control's own interference and
        # calling it the product. The toggle is queued as a task, so the stored value is
        # cleared on the next turn rather than in the same evaluate.
        page.evaluate("() => { const node = document.querySelector('#main .guided-frame-workflow'); if (node) node.open = false; }")
        page.wait_for_timeout(300)
        page.evaluate("""() => {
            for (const key of Object.keys(localStorage))
                if (key.includes(':frames-workflow')) localStorage.removeItem(key);
        }""")

        # ============================ 5 · FRAME DATA SURVIVES FOLDING AND RE-EXPOSURE
        # Read from the live document in all three states. A closed <details> still holds
        # its children, so these counts are what the filmmaker still has.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#main .shot-frames-workspace", timeout=20000)
        while_folded = page.evaluate(FRAMES_STATE)
        assert while_folded["workflowOpen"] is False, "5. precondition: the shot is still folded after the reload"
        page.evaluate("() => { document.querySelector('#main .guided-frame-workflow').open = true; }")
        page.wait_for_timeout(200)
        unfolded_by_hand = page.evaluate(FRAMES_STATE)
        set_intent("flf")
        page.wait_for_timeout(400)
        after_change = page.evaluate(FRAMES_STATE)
        for label, snapshot in (("folded", while_folded), ("opened by hand", unfolded_by_hand), ("intent changed", after_change)):
            assert snapshot["frameRail"] == legacy_frames["frameRail"], \
                f"5. {label}: the frame rail must still be rendered ({snapshot['frameRail']} vs {legacy_frames['frameRail']})"
            assert snapshot["frameRailButtons"] == legacy_frames["frameRailButtons"], \
                f"5. {label}: every frame must still be reachable ({snapshot['frameRailButtons']} vs {legacy_frames['frameRailButtons']})"
            assert snapshot["addFrame"] == legacy_frames["addFrame"], f"5. {label}: adding a frame must stay possible"
        disk = json.loads(project_file.read_text(encoding="utf-8"))
        disk_shot = next(row for row in disk["shots"] if row["id"] == FRAMES_SHOT)
        assert len(disk_shot.get("keyframes", [])) >= 1, "5. and the frames must still be on the record"
        findings.append(f"5. frame data survives: {legacy_frames['frameRailButtons']} frame-rail controls and the "
                        "add-frame control are present folded, hand-opened and after the intent changed again; "
                        f"{len(disk_shot.get('keyframes', []))} keyframes still on the saved record")

        # ==================================== 7 · PERSISTED INTENT SURVIVES A RELOAD
        set_intent("hybrid")
        assert saved_route(FRAMES_SHOT, "hybrid") == "hybrid", "7. hybrid must reach the project file"
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".shot-intent-control", timeout=20000)
        reloaded = page.evaluate(INTENT_STATE)
        assert reloaded["stored"] == "hybrid", f"7. the reloaded page must carry it, got {reloaded['stored']!r}"
        assert reloaded["reading"] == "declared" and reloaded["route"] == "hybrid", \
            "7. and the surface must show it, not the undeclared state"
        assert reloaded["selected"] == ["hybrid"], "7. hybrid must not collapse into 'Not decided yet' across a reload"
        assert reloaded["framesRequired"] == "1", \
            "7. and a hybrid shot still needs the Frames workflow, because one of its methods begins from a frame"

        # WITHDRAWAL, and the key really goes. Read off the saved file rather than the page.
        set_intent("")
        assert saved_route(FRAMES_SHOT, "ABSENT") == "ABSENT", \
            "7. withdrawing an intent must remove the key from the saved project, not store an empty one"
        withdrawn = page.evaluate(INTENT_STATE)
        assert withdrawn["reading"] == "absent" and withdrawn["summary"] == "Not decided yet", \
            "7. and the surface must return to the undeclared state"
        findings.append("7. hybrid persisted to disk, survived a full reload as hybrid rather than collapsing into "
                        "the undeclared state, and withdrawing it removed the key from the saved project")

        # ============================== 6 · NO METHOD IS EXPOSED BY A DECLARED INTENT
        open_shot(MOTION_SHOT)
        select_stage("Motion")
        expand_all()
        page.wait_for_selector("#main .guided-video-target-control select", timeout=15000)
        assert page.locator("#main .guided-video-target-control select").first.is_visible(), \
            "6. the picker must really be on screen once its disclosures are open"
        baseline_picker = page.evaluate(PICKER_STATE)
        assert baseline_picker["present"], "6. the video-target picker must be reachable to be measured"
        assert baseline_picker["intentRoute"] == "", "6. precondition: this shot has declared no intent yet"
        assert len(baseline_picker["enabled"]) >= 2, \
            f"6. more than one target must be selectable with no intent, got {baseline_picker['enabled']}"
        narrowed_counts = {}
        for route in ROUTES:
            set_intent(route)
            expand_all()
            page.wait_for_selector("#main .guided-video-target-control select", timeout=15000)
            picker = page.evaluate(PICKER_STATE)
            assert picker["intentRoute"] == route, f"6. {route}: the picker must know the declared intent"
            assert picker["all"] == baseline_picker["all"], \
                f"6. {route}: narrowing must hide no target — the catalogue stays visible"
            for value in picker["enabled"]:
                assert value in baseline_picker["enabled"], \
                    f"6. {route}: {value} became selectable because an intent was declared — a route may only remove"
            narrowed_counts[route] = len(picker["enabled"])
            if route != "hybrid":
                assert len(picker["enabled"]) < len(baseline_picker["enabled"]), \
                    f"6. {route}: declaring a single-method intent must actually reduce the selectable set"
                assert any("not how this shot is made" in text for text in picker["disabledSuffixes"]), \
                    f"6. {route}: a target removed by the intent must say why"
        findings.append(f"6. the rendered picker never grows: {len(baseline_picker['enabled'])} selectable with no "
                        f"intent, narrowed to {narrowed_counts} — every enabled option a subset of the baseline")

        # N2 · THE NO-WIDENING ASSERTION CAN FAIL. Re-enable an option the intent removed
        # and require section 6's own check to catch it.
        set_intent("flf")
        expand_all()
        page.wait_for_selector("#main .guided-video-target-control select", timeout=15000)
        widened = page.evaluate("""() => {
            const select = document.querySelector('#main .guided-video-target-control select');
            const victim = [...select.querySelectorAll('option')].find((node) => node.disabled);
            if (!victim) return { widened: false };
            victim.disabled = false;
            return { widened: true, value: victim.value };
        }""")
        assert widened["widened"], "N2: the control needs a route-disabled option to re-enable"
        after_widening = page.evaluate(PICKER_STATE)
        assert widened["value"] in after_widening["enabled"], "N2: the control must actually change what is read"
        caught = any(value not in baseline_picker["enabled"] for value in after_widening["enabled"]) \
            or len(after_widening["enabled"]) > narrowed_counts["flf"]
        assert caught, "N2: the no-widening assertion would not have noticed a re-enabled option"
        findings.append(f"N2. negative control: re-enabling {widened['value']} is caught by the same comparison "
                        "section 6 relies on")

        # ================== 4 · SIMPLE <-> ADVANCED STILL WORKS, AND IS A SEPARATE THING
        # Driven on MOTION_SHOT because that is the sample shot whose blocking workspace
        # actually offers a compiled GENERATE — the same shot
        # tests/generation-simple-advanced-real-browser.py drives for the same dialog.
        open_shot(MOTION_SHOT)
        set_intent("i2v")
        before_dialog = page.evaluate(INTENT_STATE)
        select_stage("Look & blocking")
        page.evaluate("() => { try { localStorage.removeItem('cinebraid-generation-view'); } catch {} }")
        page.evaluate("() => document.querySelectorAll('#main details').forEach((node) => { node.open = true; })")
        page.wait_for_timeout(300)
        generate = page.get_by_role("button", name="GENERATE", exact=True)
        assert generate.count() == 1, f"4. expected one blocking-frame GENERATE button, found {generate.count()}"
        generate.first.click()
        page.wait_for_selector(".gen-view", timeout=20000)
        page.wait_for_timeout(300)
        view_mode = lambda: page.evaluate(
            "() => { const el = document.querySelector('.gen-view'); return el ? el.dataset.genView : null; }")
        assert view_mode() == "simple", f"4. the dialog must still open on Simple, got {view_mode()!r}"
        page.locator('.gen-view-tab[data-gen-view-mode="advanced"]').first.click()
        page.wait_for_timeout(300)
        assert view_mode() == "advanced", "4. Advanced must still disclose"
        # THE TWO CONTROLS DO NOT TOUCH EACH OTHER.
        assert page.evaluate("""() => {
            const shot = (location.hash.split('?')[0].split('/')[2] || '');
            const row = (P.shots || []).find((item) => item.id === shot);
            return row ? row.deliveryRoute : 'NO-SHOT';
        }""") == "i2v", "4. switching to Advanced must not change the shot's declared intent"
        page.locator('.gen-view-tab[data-gen-view-mode="simple"]').first.click()
        page.wait_for_timeout(300)
        assert view_mode() == "simple", "4. and Simple must come back"
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        # And the intent control draws no generation configuration of its own.
        open_intent()
        intent_controls = page.evaluate("""() => {
            const control = document.querySelector('.shot-intent-control');
            return {
                selects: control.querySelectorAll('select').length,
                inputs: control.querySelectorAll('input, textarea').length,
                genView: control.querySelectorAll('.gen-view, .gen-view-tab').length,
            };
        }""")
        assert intent_controls["selects"] == 1 and intent_controls["inputs"] == 0, \
            f"4. Shot Intent is ONE decision, not a settings panel: {intent_controls}"
        assert intent_controls["genView"] == 0, "4. and it must not reproduce Slice 4's Simple/Advanced switch"
        after_dialog = page.evaluate(INTENT_STATE)
        assert after_dialog["route"] == before_dialog["route"] == "i2v", \
            "4. the intent must be exactly what it was before the generation dialog was opened"
        findings.append("4. Simple opens, Advanced discloses and Simple returns with the declared intent untouched; "
                        "the intent control itself is one select and no generation configuration")

        # ============ 8 · STORED IS NOT EXECUTABLE — the reproduced blocker, end to end
        #
        # The exact case review reproduced: a shot storing minimax-h3/t2v and declaring
        # flf. The stored target must stay selected and changeable, and must not be able
        # to build or spend. Everything below is read off the live document and off the
        # requests the page really made.
        H3_T2V = "minimax-h3/t2v"
        # IS A GENERATION DIALOG ACTUALLY OPEN. closeModal() hides the host and leaves the
        # markup inside it — that is the shipped behaviour — so counting
        # `.h3-generation-modal` across the whole document finds a dialog somebody closed
        # two sections ago. The product's own answer is whether `#modal` is hidden.
        OPEN_DIALOGS = """
        () => {
          const host = document.getElementById('modal');
          if (!host || host.classList.contains('hidden')) return 0;
          return host.querySelectorAll('.h3-generation-modal').length;
        }
        """
        open_shot(MOTION_SHOT)
        set_intent("")
        select_stage("Motion")
        expand_all()
        page.wait_for_selector("#main .guided-video-target-control select", timeout=15000)

        # Chosen the way a filmmaker chooses it, with nothing declared so it is selectable.
        page.locator("#main .guided-video-target-control select").first.select_option(H3_T2V)
        page.wait_for_timeout(600)
        expand_all()
        page.locator("#main textarea.guided-motion-editor").first.fill("The bay lights flicker once as he turns.")
        page.locator("#main textarea.guided-motion-editor").first.blur()
        page.wait_for_timeout(600)
        expand_all()

        MOTION_STATE = """
        () => {
          const select = document.querySelector('#main .guided-video-target-control select');
          const build = [...document.querySelectorAll('#main button.assemble-btn')]
            .find((node) => /Build prompt/i.test(node.textContent));
          const shot = (location.hash.split('?')[0].split('/')[2] || '');
          const row = (P.shots || []).find((item) => item.id === shot);
          const creation = row ? ensureShotCreation(row) : null;
          const unit = row ? guidedActiveMotionUnit(row) : null;
          return {
            selected: select ? select.value : null,
            selectedLabel: select && select.selectedOptions[0] ? select.selectedOptions[0].textContent : '',
            selectedDisabled: select && select.selectedOptions[0] ? select.selectedOptions[0].disabled : null,
            intentRoute: row ? (row.deliveryRoute === undefined ? null : row.deliveryRoute) : 'NO-SHOT',
            /* Where the product really keeps the choice: the active motion unit first,
               the shot's creation record as the fallback. */
            stored: (unit && unit.motionProfileId) || (creation && creation.motionProfileId) || '',
            buildDisabled: build ? build.disabled : null,
            buildDescribedBy: build ? build.getAttribute('aria-describedby') : null,
            refusalLines: document.querySelectorAll('#main [data-video-profile-intent-blocked]').length,
            paidButtons: document.querySelectorAll('#main .h3-generate-btn').length,
            paidBlocked: document.querySelectorAll('#main [data-h3-intent-blocked]').length,
            builds: creation ? (creation.motionPromptBuilds || []).length : -1,
            executable: row && typeof guidedMotionProfileExecutable === 'function'
              ? guidedMotionProfileExecutable(row, guidedVideoProfiles().find((p) => p.id === (unit && unit.motionProfileId) || '') || null)
              : null,
          };
        }
        """

        chosen = page.evaluate(MOTION_STATE)
        assert chosen["selected"] == H3_T2V, f"8. precondition: the t2v target must be selected, got {chosen['selected']!r}"
        assert chosen["stored"] == H3_T2V, f"8. precondition: and stored on the record, got {chosen['stored']!r}"
        assert chosen["intentRoute"] is None, "8. precondition: nothing is declared yet"
        assert chosen["buildDisabled"] is False, "8. precondition: with nothing declared, Build prompt is available"

        # It really builds while nothing is declared — the accepted baseline, and what
        # makes every refusal below a change rather than a product that never worked.
        before_compiles = len(compile_calls)
        page.locator("#main button.assemble-btn", has_text="Build prompt").first.click()
        page.wait_for_timeout(3000)
        expand_all()
        compatible = page.evaluate(MOTION_STATE)
        assert len(compile_calls) > before_compiles, \
            "8. precondition: an undeclared shot must really compile, or the refusals below prove nothing"
        assert compatible["builds"] >= 1, "8. precondition: and the compiled package must exist"
        assert compatible["paidButtons"] == 1, \
            f"8. precondition: the paid GENERATE H3 VIDEO button must be drawn, got {compatible['paidButtons']}"
        findings.append(f"8. baseline: {H3_T2V} stored with nothing declared compiles a package and draws the paid "
                        "GENERATE H3 VIDEO button — the state review reproduced")

        # ---- declare flf: the stored target becomes non-executable --------------------
        set_intent("flf")
        expand_all()
        excluded = page.evaluate(MOTION_STATE)
        assert excluded["intentRoute"] == "flf", "8. the intent must be declared"
        assert excluded["stored"] == H3_T2V, \
            f"8. the stored target must NOT be erased or rewritten, got {excluded['stored']!r}"
        assert excluded["selected"] == H3_T2V, "8. and must still be the selected option, so it can be seen and changed"
        assert "not how this shot is made" in excluded["selectedLabel"], \
            f"8. and must be labelled truthfully, got {excluded['selectedLabel']!r}"
        assert excluded["executable"] is False, "8. but it must not be executable"
        assert excluded["refusalLines"] == 1, "8. the refusal must be stated once, through the picker's own convention"
        assert excluded["buildDisabled"] is True, "8. Build prompt must be disabled"
        assert excluded["buildDescribedBy"], "8. and must point at the visible reason rather than a tooltip"
        assert excluded["paidButtons"] == 0, "8. the paid button must be gone"
        assert excluded["paidBlocked"] == 1, "8. and the reason must stand where it was"

        # ---- BYPASS ATTACKS. The screen is not the gate. -----------------------------
        # Cleared first, because an earlier section's dialog is still in `#modal` — the
        # shell replaces `#main` on navigation and leaves the modal host alone — and a
        # "no dialog opened" assertion that started from one would be meaningless.
        page.evaluate("""() => {
            if (typeof closeModal === 'function') closeModal();
            window._falH3MotionRequest = null;
        }""")
        page.wait_for_timeout(200)
        assert page.evaluate(OPEN_DIALOGS) == 0, \
            "8. precondition: no generation dialog may be open before the bypass attacks"
        attack_compiles, attack_generation, attack_paid = len(compile_calls), len(generation_calls), len(paid_calls)
        builds_before_attack = excluded["builds"]

        # 1 · direct programmatic invocation of the prompt builder
        page.evaluate("async () => { await buildGuidedMotionPrompt('%s', false); }" % MOTION_SHOT)
        page.wait_for_timeout(1500)
        # 2 · the picker DOM re-enabled by hand, then the builder called again
        page.evaluate("""() => {
            const select = document.querySelector('#main .guided-video-target-control select');
            if (select) for (const option of select.querySelectorAll('option')) option.disabled = false;
            const build = [...document.querySelectorAll('#main button.assemble-btn')]
              .find((node) => /Build prompt/i.test(node.textContent));
            if (build) build.disabled = false;
        }""")
        page.wait_for_timeout(200)
        page.locator("#main button.assemble-btn", has_text="Build prompt").first.click()
        page.wait_for_timeout(1500)
        # 3 · the paid dialog, opened programmatically on the stale package
        page.evaluate("""async (shot) => {
            const row = (P.shots || []).find((item) => item.id === shot);
            const builds = ensureShotCreation(row).motionPromptBuilds || [];
            const last = builds[builds.length - 1];
            try { await openFalH3MotionModal(shot, last ? last.id : ''); } catch (error) {}
        }""", MOTION_SHOT)
        page.wait_for_timeout(1500)
        # THE SHARPEST SIGNAL THERE IS: the H3 preflight sets `_falH3MotionRequest` as it
        # opens, and nothing else does. Checked HERE, before attack 4 supplies one of its
        # own, so it can only be the dialog's.
        assert page.evaluate("() => !window._falH3MotionRequest"), \
            "8. the paid dialog must not have built a submittable request"
        assert page.evaluate(OPEN_DIALOGS) == 0, \
            "8. and must not have opened"
        # 4 · the paid submit, hand-built the way an open dialog would leave it
        page.evaluate("""async (shot) => {
            window._falH3Submitting = false;
            window._falH3MotionRequest = { shotId: shot, buildId: 'x', profileId: 'minimax-h3/t2v',
              profileMode: 't2v', prompt: 'A compiled t2v prompt.', compiledPrompt: 'A compiled t2v prompt.',
              durationSeconds: 5, clientRequestId: 'bypass', aspectRatio: '16:9', aspectOk: true };
            try { await startFalH3MotionGeneration(); } catch (error) {}
        }""", MOTION_SHOT)
        page.wait_for_timeout(1500)

        after_attack = page.evaluate(MOTION_STATE)
        assert len(compile_calls) == attack_compiles, \
            f"8. a bypassed screen must still compile nothing: {compile_calls[attack_compiles:]}"
        assert len(generation_calls) == attack_generation, \
            f"8. and must reach no generation endpoint: {generation_calls[attack_generation:]}"
        assert len(paid_calls) == attack_paid, f"8. and must spend nothing: {paid_calls[attack_paid:]}"
        assert after_attack["builds"] == builds_before_attack, "8. and must create no new package"
        assert after_attack["stored"] == H3_T2V, "8. and every attack must leave the stored target exactly as it was"

        # 5 · a reload, so nothing depends on the state of a rendered page
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#main .shot-shell", timeout=20000)
        select_stage("Motion")
        expand_all()
        reloaded = page.evaluate(MOTION_STATE)
        assert reloaded["stored"] == H3_T2V and reloaded["intentRoute"] == "flf", \
            "8. the reloaded page must carry both the stored target and the intent"
        assert reloaded["executable"] is False, "8. and the refusal must survive the reload"
        assert reloaded["paidButtons"] == 0, "8. with no paid button restored by it"
        findings.append("8. blocked: the stored target is preserved, selected and labelled, and refuses to build or "
                        "spend through a direct call, a re-enabled picker, a forced click, a programmatic paid "
                        "dialog, a hand-built submit and a full reload — 0 compiles, 0 generation calls, 0 paid")

        # ---- and back again: the SAME preserved selection becomes usable -------------
        set_intent("t2v")
        expand_all()
        restored = page.evaluate(MOTION_STATE)
        assert restored["stored"] == H3_T2V, "8. the preserved target must be the one that comes back"
        assert restored["executable"] is True, "8. and a compatible intent must make it executable again"
        assert restored["refusalLines"] == 0, "8. with the refusal gone"
        assert restored["buildDisabled"] is False, "8. and Build prompt available again"
        assert restored["paidButtons"] == 1, "8. and the paid button restored from the package that was already there"
        restored_compiles = len(compile_calls)
        page.locator("#main button.assemble-btn", has_text="Build prompt").first.click()
        page.wait_for_timeout(3000)
        assert len(compile_calls) > restored_compiles, \
            "8. and the same stored target must really compile again once the intent matches"
        findings.append("8. restored: changing the intent back to t2v makes the SAME preserved target executable "
                        "again — the picker, the build control, the paid button and a real compile all return")

        assert not page_errors, f"the page raised uncaught errors: {page_errors}"
        assert not console_errors, f"the page logged console errors: {console_errors}"
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)

assert not offsite, f"requests left the machine: {offsite}"
assert not paid_calls, f"a paid route was called: {paid_calls}"

print("\n".join(findings))
print(f"project data isolated: config {config_path}, projects {projects_root} — data/ untouched")
print(f"prompt compiles: {len(compile_calls)} (all local) · generation endpoint calls: {len(generation_calls)}")
print("provider calls: 0 · paid execution: 0 · off-site requests: 0")
print("Batch 2 Slice 5b shot intent UX real-browser audit passed")
