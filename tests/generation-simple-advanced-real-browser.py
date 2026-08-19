#!/usr/bin/env python3
"""Simple vs Advanced generation, and price truth, in a real Chromium.

Batch 2 Slice 4. The Node suites prove the derivations; this proves the SCREEN, because
a resolver that answers correctly and a dialog that draws something else is the same
defect with a longer path. Everything below is read off rendered controls and captured
request bodies rather than off the functions that produced them.

What it establishes, in the order the brief lists the attacks:

  A  Simple is what opens - on the compiled frame dialog, on the MiniMax H3 motion
     dialog, and on the full-shot automation planner
  B  Advanced discloses the expert controls, by mouse and by keyboard, and the price
     and route stay visible in BOTH views
  C  a capability change re-renders the block: changing the duration moves the quote,
     and the durations offered are the effective range rather than a fixed list

WHAT THE MOTION SECTIONS DO AND DO NOT COVER. Sections C, F and G drive the SHIPPED
motion renderer - renderFalH3GenerationView() and updateFalH3CostEstimate() - in the real
page, against a plan payload of the shape /api/generation/fal/h3/plan returns. They
exercise the real configured-rate read from the real served CONFIG, the real price
derivation, the real capability-driven duration control and the real DOM. They do NOT
exercise the H3 COMPILE step, because a compilable motion package needs an approved
reference fixture this suite deliberately does not build; that path is covered by
check:h3-execution, which drives openFalH3MotionModal() end to end. Saying so here rather
than letting a green tick imply more than it proves.
  D  neither shipped model documents CFG, steps or a seed - so no such control is drawn
     and no such key is in the captured paid-request body
  E  a size chosen under Advanced, abandoned by a return to Simple, does NOT reach the
     request - captured from the real submit, not inferred
  F  with a motion rate configured, the quote the dialog renders is the number
     generation-cost.js would record for the same request
  G  with the rate removed, the dialog says unavailable and the recorder says unknown -
     both, consistently, and neither says $0.00
  H  a local route reads "$0 provider charge", and no generation dialog says "Free"
  J  the two entity-state shortcuts — "GENERATE 3 MORE" and "IMPROVE + GENERATE 3" —
     cannot reach the paid endpoint on their own, and what they DO submit is gated
  K  a use-case guide's authored reasoning survives the real /api/generation/options
     response, over real HTTP, rather than being dropped on the wire
  L  candidate correction — the last paid image dialog that drew its own grid and
     posted its own body — presents the accepted preflight with a real cost, and
     what it submits is gated
  M  changing the candidate count moves the quote BEFORE dispatch, and the number
     on screen is the number in the body — with no rate configured, no count
     change invents one
  I  no provider was contacted, no paid route was called, nothing left this machine

NOTHING HERE IS PAID. The dialogs compile through /api/generation/fal/image/plan,
/api/generation/fal/h3/plan and /api/generation/options, all local computation. The
POST to /api/generation/fal/jobs - the only route that spends money - is INTERCEPTED
AND ABORTED by the page's own route guard, so its body is inspected and the request
never reaches the server, let alone a provider. Any off-site request fails the suite.
FAL_KEY is a string that is not a credential, purely so the client-side "is fal
configured" gate opens.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped sample are
never touched, and the directory is removed at the end.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL = "Batch 2 Slice 4 Simple/Advanced generation and price truth"
sync_playwright = require_browser(LABEL)

SHOT = "SAMPLE-03"
PAID_ROUTE = "/api/generation/fal/jobs"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")

MOTION_RATE = {"usdPerSecond": 0.26, "source": "operator note for this fixture", "asOf": "2026-08-15"}
EXPERT_KEYS = ("seed", "cfgScale", "guidanceScale", "steps", "referenceStrength", "referenceWeights")


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def node_recorded_estimate(config_file, seconds):
    """WHAT THE LEDGER WOULD RECORD for this request, from the product's own modules.

    Deliberately computed by invoking generation-cost.js rather than by reimplementing
    the arithmetic here: a suite that multiplied the rate itself would be a THIRD cost
    authority, and would agree with the browser for exactly as long as both happened to
    be right. It reads the same config file the running server was given."""
    script = (
        "const cfg=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));"
        "const {configuredMotionRate}=require('./public/shared-generation-rate');"
        "const {submissionAccounting}=require('./generation-cost');"
        "const a=submissionAccounting({purpose:'motion-h3',outputCount:1,"
        "  motionRate:configuredMotionRate(cfg),durationSeconds:Number(process.argv[2]),at:'fixture'});"
        "process.stdout.write(JSON.stringify({confidence:a.estimate.confidence,"
        "  amount:a.estimate.amount===undefined?null:a.estimate.amount,basis:a.basis}));"
    )
    out = subprocess.run(["node", "-e", script, str(config_file), str(seconds)],
                         cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-slice4-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"

# A CONTINUITY STATE WITH A COMPILED PROMPT, so the entity-state shortcuts have
# something real to press. PROP-PARCEL/state-open is the sample's own derived state; only
# the prompt build is added, because that is the one thing standing between the shipped
# fixture and a paid entity-state dispatch.
ENTITY_LIST, ENTITY_ID, ENTITY_STATE = "props", "PROP-PARCEL", "state-open"
ENTITY_BUILD = "slice4-state-build"
project_file = projects_root / "dogfood-sample" / "project.json"
project = json.loads(project_file.read_text(encoding="utf-8"))
parcel = next(row for row in project["props"] if row["id"] == ENTITY_ID)
open_state = next(row for row in parcel["continuityStates"] if row["id"] == ENTITY_STATE)
open_state["notes"] = open_state.get("notes") or "Torn flap, contents visible."
open_state.setdefault("assetPromptBuilds", []).append({
    "id": ENTITY_BUILD,
    "date": "2026-08-18T00:00:00.000Z",
    "stateId": ENTITY_STATE,
    "stateName": open_state.get("name") or "Open",
    "profileId": "gpt-image-2/edit",
    "profileName": "GPT Image 2 · Reference Edit",
    "prompt": "COMPILED OPEN-PARCEL STATE INSTRUCTION",
    "warnings": [], "confirmations": [],
})
project_file.write_text(json.dumps(project, indent=2), encoding="utf-8")


# A CORRECTION BUILD, so the candidate-correction dialog has something real to open on.
# The candidate RECORD is created on demand by candidateRecord(), so only the build has to
# exist. The first reference must be the editable base — the dispatch refuses otherwise,
# which is correction semantics this suite deliberately does not weaken.
CORRECTION_SHOT, CORRECTION_FRAME = "SAMPLE-01", "frame-a"
CORRECTION_CANDIDATE = "SAMPLE-01-ARRIVAL.png"
CORRECTION_BUILD = "slice4-correction-build"
CORRECTION_PACKAGE = "SAMPLE-01-A-CORRECTION-R01"
correction_url = f"/assets/shots/{CORRECTION_SHOT}/takes/{CORRECTION_CANDIDATE}"
project = json.loads(project_file.read_text(encoding="utf-8"))
project.setdefault("promptBuildsById", {})[CORRECTION_BUILD] = {
    "id": CORRECTION_BUILD,
    "date": "2026-08-18T00:00:00.000Z",
    "packageId": CORRECTION_PACKAGE,
    "parentPackageId": "SAMPLE-01-A-R01",
    "parentBuildId": "slice4-original-build",
    "kind": "candidate-correction",
    "revisionReason": "candidate-correction",
    "profileId": "gpt-image-2/edit",
    "profileName": "GPT Image 2 · Reference Edit",
    "sourceCandidate": CORRECTION_CANDIDATE,
    "prompt": "CORRECTION: restore the approved platform architecture behind the courier.",
    "correctionWarnings": [],
    "references": [
        {"key": "base", "label": "Candidate under correction", "role": "base",
         "url": correction_url, "instruction": "Editable base. Preserve everything not named."},
        {"key": "guide", "label": "Blocking guide", "role": "composition",
         "url": correction_url, "instruction": "Geometry only."},
    ],
}
project_file.write_text(json.dumps(project, indent=2), encoding="utf-8")


IMAGE_RATE = 0.06


def write_config(motion_rate, image_rate=IMAGE_RATE):
    config = json.loads(config_path.read_text(encoding="utf-8"))
    fal = config.setdefault("generation", {}).setdefault("fal", {})
    fal.update({"enabled": True, "frameOutputs": 2, "blockingOutputs": 2,
                "frameQuality": "high", "frameResolution": "1k",
                "blockingQuality": "low", "blockingResolution": "1k",
                "h3Resolution": "2K", "estimatedCostPerImage": image_rate})
    if motion_rate is None:
        fal.pop("motionRate", None)
    else:
        fal["motionRate"] = dict(motion_rate)
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")


write_config(MOTION_RATE)

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "FAL_KEY": "slice4-browser-qa-placeholder-not-a-credential"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

console_errors, page_errors, offsite, paid_calls, failed_requests = [], [], [], [], []
captured_submits = []
findings = []

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
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("requestfailed", lambda request: failed_requests.append(
            f"{request.method} {request.url} ({(request.failure or '')})"))
        not_found = []
        page.on("response", lambda r: not_found.append(f"{r.request.method} {r.url} -> {r.status}")
                if r.status >= 400 else None)

        def guard(route):
            """No request leaves this machine, and the paid route is captured and killed.

            The POST body is recorded BEFORE the abort, which is the whole point: it is
            the real gated payload the dialog built, and it never reaches the server."""
            request = route.request
            url = request.url
            if url.endswith(PAID_ROUTE) and request.method == "POST":
                try: captured_submits.append(json.loads(request.post_data or "{}"))
                except Exception: captured_submits.append({})
                paid_calls.append(f"{request.method} {url}")
                return route.abort("failed")
            if PAID_ROUTE in url and request.method == "POST":
                paid_calls.append(f"{request.method} {url}")
                return route.abort("failed")
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)

        def reset_view_preference():
            """The Simple/Advanced choice is remembered, deliberately — so a section that
            wants to observe the DEFAULT has to clear it first, or it would be reading the
            previous section's click."""
            page.evaluate("() => { try { localStorage.removeItem('cinebraid-generation-view'); } catch {} }")

        def view_mode():
            return page.evaluate(
                "() => { const el = document.querySelector('.gen-view'); return el ? el.dataset.genView : null; }")

        def open_advanced():
            page.locator('.gen-view-tab[data-gen-view-mode="advanced"]').first.click()
            page.wait_for_timeout(300)
            assert view_mode() == "advanced", "the Advanced disclosure did not open"

        def open_simple():
            page.locator('.gen-view-tab[data-gen-view-mode="simple"]').first.click()
            page.wait_for_timeout(300)
            assert view_mode() == "simple", "the Simple view did not come back"

        def open_frame_dialog():
            page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=15000)
            page.wait_for_timeout(1200)
            reset_view_preference()
            page.locator(".focused-task-button", has_text="Look & blocking").first.click()
            page.wait_for_timeout(500)
            page.evaluate("() => document.querySelectorAll('#main details').forEach(node => { node.open = true; })")
            page.wait_for_timeout(300)
            generate = page.get_by_role("button", name="GENERATE", exact=True)
            assert generate.count() == 1, f"expected one Create blocking frame button, found {generate.count()}"
            generate.first.click()
            page.wait_for_selector(".h3-generation-modal", timeout=20000)
            page.wait_for_selector(".gen-view", timeout=20000)
            page.wait_for_timeout(400)

        # ================================================== A · SIMPLE IS WHAT OPENS
        open_frame_dialog()
        assert not page_errors, f"A: the workspace raised uncaught errors: {page_errors}"
        assert not console_errors, f"A: console errors: {console_errors}; failed: {failed_requests}"
        assert view_mode() == "simple", f"A: the frame dialog opened on {view_mode()!r}"
        assert page.locator("#fal-frame-quality").count() == 1, "A: Simple must still carry the quality decision"
        assert page.locator("#fal-frame-size").count() == 0, "A: and must not carry the expert size control"
        findings.append("A: the compiled frame dialog opens on Simple, carrying quality and not size")

        # The price, the route and the model standing are on screen BEFORE any disclosure.
        always = page.locator(".gen-view-always").inner_text()
        for expected in ("Provider cost", "Where it runs", "Model"):
            assert expected in always, f"A: Simple must state {expected!r} before the paid button, got {always!r}"
        findings.append("A: model, route and provider cost are all stated on the Simple screen")

        # ============================================ B · ADVANCED DISCLOSES, AND KEEPS
        open_advanced()
        assert page.locator("#fal-frame-size").count() == 1, "B: Advanced must disclose the expert size control"
        always_advanced = page.locator(".gen-view-always").inner_text()
        assert "Provider cost" in always_advanced, "B: the cost must stay visible under Advanced too"
        findings.append("B: Advanced discloses the size control and the cost block stays visible in both views")

        # Keyboard: the tab takes focus and activates without a mouse.
        open_simple()
        page.locator('.gen-view-tab[data-gen-view-mode="advanced"]').first.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        assert view_mode() == "advanced", "B: the switch must be operable from the keyboard"
        focus_ring = page.evaluate(
            "() => { const el = document.querySelector('.gen-view-tab[aria-selected=\\\"true\\\"]');"
            " return el ? getComputedStyle(el).outlineStyle : null; }")
        assert focus_ring is not None, "B: the selected tab must be a real focusable element"
        findings.append("B: the disclosure is operable from the keyboard and exposes aria-selected")

        # ==================================== D · NO CFG, NO STEPS, NO SEED - ANYWHERE
        modal_html = page.locator(".h3-generation-modal").inner_html()
        for key in EXPERT_KEYS:
            assert f'id="fal-frame-{key.lower()}"' not in modal_html.lower(), \
                f"D: neither shipped model documents {key}, so no {key} control may be drawn"

        # NAMED IS NOT DRAWN, and the difference is the whole requirement. Advanced states
        # "settings this model does not have" and lists them BY NAME - that is the honest
        # form of the absence, and a word search would call it a violation. So the check is
        # for an actual FORM CONTROL: a labelled input or select the filmmaker could set.
        # A model without CFG must have no CFG control, disabled or otherwise; it may
        # perfectly well have a sentence saying it has none.
        control_labels = page.evaluate(
            "() => [...document.querySelectorAll('.gen-view-controls label')]"
            "  .filter(node => node.querySelector('input, select, textarea'))"
            "  .map(node => (node.querySelector('span')?.textContent || node.textContent || '').trim().toLowerCase())")
        for word in ("guidance", "cfg", "sampling steps", "seed", "reference strength"):
            assert not any(word in label for label in control_labels), \
                f"D: {word!r} was drawn as a settable control on a model that does not support it: {control_labels}"

        # And it IS named as absent, rather than leaving a gap the filmmaker reads as a
        # missing feature.
        unsupported = page.locator(".gen-view-unsupported").inner_text().lower()
        assert "does not have" in unsupported, \
            "D: Advanced must name the settings this model does not have instead of leaving a gap"
        for word in ("guidance (cfg)", "sampling steps", "seed", "reference strength"):
            assert word in unsupported, f"D: {word!r} must be named as unsupported rather than silently missing"
        findings.append(f"D: the only settable controls under Advanced are {control_labels}; CFG, steps, seed and "
                        f"reference strength are named as unsupported rather than drawn")

        # ============ E · AN ADVANCED SIZE, ABANDONED BY SIMPLE, DOES NOT REACH THE REQUEST
        sizes = page.evaluate("() => [...document.querySelectorAll('#fal-frame-size option')].map(o => o.value)")
        current = page.locator("#fal-frame-size").input_value()
        other = next((value for value in sizes if value != current), "")
        assert other, f"E: the fixture needs a second documented size to choose, got {sizes}"
        page.select_option("#fal-frame-size", other)
        page.wait_for_timeout(900)
        open_advanced() if view_mode() != "advanced" else None
        assert page.locator("#fal-frame-size").input_value() == other, "E: the Advanced choice did not take"

        open_simple()
        assert page.locator("#fal-frame-size").count() == 0, \
            "E: returning to Simple must REMOVE the control, not hide it"
        readable = page.evaluate(
            "() => { const el = document.getElementById('fal-frame-size'); return el ? el.value : null; }")
        assert readable is None, "E: and the abandoned value must not be readable from the DOM at all"

        before = len(captured_submits)
        page.locator("#fal-frame-submit").click()
        page.wait_for_timeout(1500)
        assert len(captured_submits) == before + 1, \
            f"E: the dialog did not submit; captured {captured_submits[before:]}"
        body = captured_submits[-1]
        assert "resolution" not in body, \
            f"E: a size chosen under Advanced reached a Simple request: {body!r}"
        for key in EXPERT_KEYS:
            assert key not in body, f"E/D: {key} must never be in a paid request body for this model"
        assert body.get("prompt"), "E: and the request itself must be intact"
        assert body.get("quality"), "E: a Simple control must still travel"
        findings.append(f"E: the captured paid-request body carries {sorted(body.keys() & {'quality', 'outputCount', 'resolution'})} "
                        f"- the abandoned Advanced size is absent")

        # ================================ C/F · THE MOTION DIALOG, ITS RANGE AND ITS QUOTE
        # The plan payload the server returns for a MiniMax H3 t2v request, in the shape
        # /api/generation/fal/h3/plan produces. Every field here is one the real response
        # carries; the values are the ones the shipped model and backend really resolve to.
        H3_REQUEST = {
            "durationSeconds": 8, "durationRange": [5, 15], "modelDurationRange": [4, 15],
            "resolution": "2K", "resolutions": ["768P", "2K"],
            "carriesAspectRatio": True, "aspectSupported": ["16:9", "9:16", "1:1"],
            "aspectRequested": "16:9", "aspectOk": True, "aspectRatio": "16:9",
            "maxPromptCharacters": 7000, "seedSupported": False,
            "durationNote": "MiniMax H3 itself renders 4-15s; this backend renders 5-15s.",
            "options": None, "selectedOptionId": "",
        }

        def open_motion_dialog():
            """Draw the shipped motion block in the real page.

            The dialog SHELL is minted here rather than compiled, for the reason given in
            the module docstring; everything inside it - the control plan, the duration
            control, the configured-rate read and the quote - is the product's own code
            running in a real browser against the real served CONFIG."""
            page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
            # RELOAD, not just navigate. CONFIG is fetched once at page load, and section G
            # rewrites the rate on disk between the two calls to this helper — a goto to an
            # identical URL is a no-op, so the second dialog would have quoted from the
            # FIRST config and the section would have proved nothing.
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=15000)
            page.wait_for_timeout(1200)
            reset_view_preference()
            page.evaluate(
                """request => {
                  openModal('<div class="h3-generation-modal">'
                    + '<div id="fal-h3-generation-view"></div>'
                    + '<div id="fal-h3-cost-estimate" class="h3-cost-estimate"></div></div>');
                  window._falH3MotionRequest = request;
                  window._generationViewRefresh = () => renderFalH3GenerationView();
                  renderFalH3GenerationView();
                  updateFalH3CostEstimate();
                }""", H3_REQUEST)
            page.wait_for_selector("#fal-h3-duration", timeout=20000)
            page.wait_for_timeout(400)

        open_motion_dialog()
        assert view_mode() == "simple", f"A: the motion block rendered as {view_mode()!r}"
        findings.append("A: the shipped MiniMax H3 motion block renders Simple by default in a real browser")

        durations = page.evaluate(
            "() => [...document.querySelectorAll('#fal-h3-duration option')].map(o => Number(o.value))")
        effective = page.evaluate("() => window._falH3MotionRequest.durationRange")
        assert durations == list(range(effective[0], effective[1] + 1)), \
            f"C: the durations offered must be the effective range {effective}, got {durations}"
        assert page.locator("#fal-h3-seed").count() == 0, "D: no H3 endpoint documents a seed, so none may be drawn"
        findings.append(f"C: the motion dialog offers exactly the effective duration range {effective}")

        def quote_amount():
            text = page.locator("#fal-h3-cost-estimate").inner_text()
            return text

        eight = quote_amount()
        recorded_eight = node_recorded_estimate(config_path, 8)
        assert recorded_eight["confidence"] == "estimated", \
            f"F: a configured rate must record an estimate, got {recorded_eight}"
        expected = f"{recorded_eight['amount']:.2f}"
        assert expected in eight, \
            f"F: the dialog quoted {eight!r}, which does not carry the recorded {expected}"
        assert "Estimated" in eight, "F/H: the quote must lead with the word estimated"
        assert MOTION_RATE["source"] in eight and MOTION_RATE["asOf"] in eight, \
            f"K: the quote must carry its provenance and freshness, got {eight!r}"
        findings.append(f"F: at 8s the dialog quoted the recorded ${expected} and named its source and date")

        # C · a capability change re-renders the block and moves the quote with it. The
        # shipped onchange re-compiles through the server; here the same update path is
        # entered directly, because what is under test is that the quote FOLLOWS the
        # quantity rather than that the compiler answers.
        page.evaluate(
            """seconds => {
              const control = document.getElementById('fal-h3-duration');
              control.value = String(seconds);
              window._falH3MotionRequest.durationSeconds = seconds;
              updateFalH3CostEstimate();
            }""", effective[1])
        page.wait_for_timeout(400)
        assert page.locator("#fal-h3-duration").input_value() == str(effective[1]), \
            "C: the duration control did not take the new value"
        longest = quote_amount()
        recorded_longest = node_recorded_estimate(config_path, effective[1])
        assert f"{recorded_longest['amount']:.2f}" in longest, \
            f"C/F: after changing the duration the dialog quoted {longest!r}, not the recorded {recorded_longest['amount']:.2f}"
        assert longest != eight, "C: a longer shot must not quote the same number as a shorter one"
        findings.append(f"C/F: changing the duration to {effective[1]}s re-rendered the block and the quote moved to the "
                        f"recorded ${recorded_longest['amount']:.2f}")

        # ============================= H · LOCAL SAYS $0 PROVIDER CHARGE, NOBODY SAYS FREE
        local = page.evaluate(
            "() => generationPriceLine({ rate: configuredMotionRate(CONFIG), quantity: 8, local: true })")
        assert local["headline"] == "$0 provider charge", \
            f"H: a local route must read \"$0 provider charge\", got {local['headline']!r}"
        assert "free" not in (local["headline"] + local["detail"]).lower(), "H: and must never say Free"
        for text in (page.locator(".h3-generation-modal").inner_text(), page.locator("#main").inner_text()):
            assert "free" not in text.lower(), f"H: a generation surface said Free: {text[:200]!r}"
        findings.append("H: the local route reads \"$0 provider charge\", and no generation surface says Free")

        # ============================ A · THE AUTOMATION PLANNER AGREES WITH THE DIALOGS
        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.wait_for_timeout(1000)
        reset_view_preference()
        page.evaluate("() => openShotAutomationModal('%s')" % SHOT)
        page.wait_for_selector("#shot-generation-view .gen-view", timeout=20000)
        page.wait_for_timeout(500)
        assert view_mode() == "simple", f"A: the automation planner opened on {view_mode()!r}"
        assert page.locator("#shot-auto-frame-quality").count() == 1, "A: the planner keeps its quality decision in Simple"
        assert page.locator("#shot-auto-frame-resolution").count() == 0, "A: and moves resolution to Advanced"
        planner_cost = page.locator("#shot-generation-view .gen-view-price").inner_text()
        assert "$0.00" not in planner_cost, "J: the planner must not quote a confident zero"
        findings.append("A: the full-shot planner opens on Simple, with the same tiering as the dialogs")

        # ===================== G · REMOVE THE RATE: UI AND RECORDER BECOME UNKNOWN TOGETHER
        write_config(None)
        recorded_none = node_recorded_estimate(config_path, 8)
        assert recorded_none["confidence"] == "unknown", \
            f"G: with no configured rate a new job must record unknown, got {recorded_none}"
        assert recorded_none["amount"] is None, "G: and must carry no amount at all"

        open_motion_dialog()
        unavailable = quote_amount()
        assert "unavailable" in unavailable.lower(), \
            f"G/J: with no rate the dialog must say unavailable, got {unavailable!r}"
        assert "$0.00" not in unavailable and "$0 " not in unavailable, \
            f"G/J: an unknown price must never be rendered as zero, got {unavailable!r}"
        assert "free" not in unavailable.lower(), "G: nor as free"
        assert "still paid" in unavailable.lower(), "G: an unpriced paid route must still say it is paid"
        findings.append("G: with the rate removed the dialog says unavailable and the recorder says unknown - "
                        "consistently, and neither says $0.00")

        # ===== J · THE ENTITY-STATE SHORTCUTS CANNOT REACH THE PAID ENDPOINT ALONE
        #
        # Both buttons used to build a request body and POST it straight to
        # /api/generation/fal/jobs — a paid provider charge with no preflight, no provider
        # or cost disclosure and no payload gate. Driven here through the real shipped
        # function, with the paid route still intercepted.
        page.goto(f"{base}/#/{'prop'}/{ENTITY_ID}", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.wait_for_timeout(1200)
        reset_view_preference()

        before_entity = len(captured_submits)
        page.evaluate(
            "args => generateMoreEntityStateCandidates(args[0], args[1], args[2], args[3], false)",
            [ENTITY_LIST, ENTITY_ID, ENTITY_STATE, ENTITY_BUILD])
        page.wait_for_selector("#fal-entity-generation-view .gen-view", timeout=20000)
        page.wait_for_timeout(400)
        assert len(captured_submits) == before_entity, \
            "J: GENERATE 3 MORE must not reach the paid endpoint on its own"

        # The disclosure it now goes through is the real one.
        entity_always = page.locator("#fal-entity-generation-view .gen-view-always").inner_text()
        for expected in ("Provider cost", "Where it runs", "Model"):
            assert expected in entity_always, \
                f"J: the entity-state preflight must state {expected!r} before the paid button, got {entity_always!r}"
        assert view_mode() == "simple", f"J: and open on Simple, got {view_mode()!r}"
        assert page.locator("#fal-entity-output-count").input_value() == "3", \
            "J: pre-set to the three candidates the button promises"
        assert page.locator("#fal-entity-resolution").count() == 0, \
            "J: with the expert control behind Advanced like everywhere else"

        # And the submission it does make is gated.
        page.locator("button.approve-btn.large", has_text="START GENERATION").first.click()
        page.wait_for_timeout(1500)
        assert len(captured_submits) == before_entity + 1, \
            f"J: pressing generate must submit; captured {captured_submits[before_entity:]}"
        entity_body = captured_submits[-1]
        assert entity_body.get("purpose") == "entity-reference", \
            f"J: the submission must be the entity-reference request, got {entity_body.get('purpose')!r}"
        assert entity_body.get("outputCount") == 3, \
            f"J: carrying the three candidates the preflight showed, got {entity_body.get('outputCount')!r}"
        assert entity_body.get("continuityStateId") == ENTITY_STATE, "J: targeted at the state it was pressed for"
        assert "resolution" not in entity_body, "J: and not the expert size Simple never asked about"
        for key in EXPERT_KEYS:
            assert key not in entity_body, f"J: {key} must never reach a paid entity-state request"
        findings.append(f"J: the entity-state shortcut opened the real preflight, dispatched nothing on its own, and its "
                        f"gated body carries {sorted(entity_body.keys() & {'outputCount', 'quality', 'resolution'})}")

        # ===== K · THE GUIDE'S AUTHORED REASONING SURVIVES THE REAL WIRE
        #
        # The route preserved a recommendation's identity and dropped the reason beside
        # it. Asserted over real HTTP against the shipped catalogue, whose one guide is
        # UNDECIDED and carries a long authored note explaining why — so this proves the
        # field travels without manufacturing a recommendation that does not exist.
        wire = page.evaluate("""async () => {
          const response = await fetch('/api/generation/options', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: 'blocking-frame', references: [] }),
          });
          const data = await response.json();
          return data.guide;
        }""")
        assert wire, "K: the blocking-frame guide must reach the browser"
        assert wire.get("note"), "K: and carry the decision's authored reasoning rather than dropping it on the wire"
        assert len(wire["note"]) > 80, f"K: the real authored note, not a stub: {wire['note']!r}"
        assert wire.get("decisionState") == "undecided-pending-evaluation", \
            f"K: the shipped guide is undecided, got {wire.get('decisionState')!r}"
        rendered = page.evaluate("guide => generationRecommendation({ guide, options: [] })", wire)
        assert rendered["available"] is False, \
            "K: an undecided guide must still produce no recommendation, note or no note"
        assert wire["note"][:40] not in rendered["detail"], \
            "K: and its note explains an ABSENCE — it must never be served as a rationale"
        findings.append(f"K: the guide's {len(wire['note'])}-character authored note survives the real API response, "
                        f"and an undecided guide still yields no recommendation")

        # ===== L · CANDIDATE CORRECTION IS NOT A PRIVATE PAID PATH
        #
        # This dialog drew count, quality and resolution side by side whatever the model
        # supported, rendered no plan, showed no price before a paid edit request even with
        # a per-image rate configured, and POSTed its own raw body. Driven here through the
        # real shipped entry point, with the paid route still intercepted.
        write_config(MOTION_RATE)
        page.goto(f"{base}/#/shot/{CORRECTION_SHOT}", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.wait_for_timeout(1200)
        reset_view_preference()

        before_correction = len(captured_submits)
        page.evaluate(
            "args => openCandidateCorrectionModal(args[0], args[1], args[2], args[3])",
            [CORRECTION_SHOT, CORRECTION_FRAME, CORRECTION_CANDIDATE, CORRECTION_BUILD])
        page.wait_for_selector("#candidate-correction-generation-view .gen-view", timeout=20000)
        page.wait_for_timeout(400)
        assert len(captured_submits) == before_correction, \
            "L: opening the correction dialog must not dispatch anything"

        # SIMPLE IS WHAT OPENS, and the three controls are no longer side by side.
        assert view_mode() == "simple", f"L: the correction dialog opened on {view_mode()!r}"
        assert page.locator("#candidate-correction-output-count").count() == 1, \
            "L: Simple keeps the candidate count"
        assert page.locator("#candidate-correction-quality").count() == 1, "L: and the quality decision"
        assert page.locator("#candidate-correction-resolution").count() == 0, \
            "L: but not the expert size, which used to sit beside them unconditionally"

        # PROVIDER AND COST TRUTH BEFORE THE PAID BUTTON, from the configured image rate.
        correction_always = page.locator("#candidate-correction-generation-view .gen-view-always").inner_text()
        for expected in ("Provider cost", "Where it runs", "Model"):
            assert expected in correction_always, \
                f"L: the correction preflight must state {expected!r}, got {correction_always!r}"
        correction_price = page.locator("#candidate-correction-generation-view .gen-view-price").inner_text()
        assert "Estimated" in correction_price, \
            f"L: a configured image rate must produce an estimate here, got {correction_price!r}"
        assert "$0.00" not in correction_price, "L: and never a confident zero"
        assert "free" not in correction_price.lower(), "L: nor Free"
        # The number is the configured rate times the candidate count, from the one authority.
        expected_correction = float(page.locator("#candidate-correction-output-count").input_value()) * 0.06
        assert f"{expected_correction:.2f}" in correction_price, \
            f"L: the estimate must be the configured rate times the count, got {correction_price!r}"

        # ===== M · THE QUOTE FOLLOWS THE COUNT, BEFORE ANYTHING IS SPENT
        #
        # The reproduced defect: opened at two candidates showing "Estimated $0.12 · 2
        # images", changed to four, and the disclosure stayed at $0.12 / 2 images while the
        # request that left carried outputCount 4. Every number below is read off the
        # screen AFTER the control moved and BEFORE anything is submitted.
        def visible_quote():
            block = page.locator("#candidate-correction-generation-view .gen-view-price").inner_text()
            headline = next((line.strip() for line in block.splitlines() if "Estimated" in line or "unavailable" in line.lower()), "")
            detail = next((line.strip() for line in block.splitlines() if "USD each" in line), "")
            return headline, detail

        def visible_promised_count():
            row = page.locator("#candidate-correction-generation-view .gen-view-limit-rows").inner_text()
            return int(row.strip().split()[0])

        def set_count(n):
            page.select_option("#candidate-correction-output-count", str(n))
            page.wait_for_timeout(400)

        opened_headline, opened_detail = visible_quote()
        assert opened_headline == f"Estimated ${2 * IMAGE_RATE:.2f}", \
            f"M: the dialog must open quoting its own count, got {opened_headline!r}"
        assert opened_detail.startswith("2 images at"), f"M: naming the two it is pricing, got {opened_detail!r}"
        assert visible_promised_count() == 2, "M: and promising two back"

        # 2 -> 4 -> 1 -> 4. Each visible quote must follow the CURRENT count, not the
        # initial one and not the previous one.
        for count in (4, 1, 4):
            set_count(count)
            headline, detail = visible_quote()
            assert headline == f"Estimated ${count * IMAGE_RATE:.2f}", \
                f"M: at {count} candidates the visible estimate must be ${count * IMAGE_RATE:.2f}, got {headline!r}"
            assert detail.startswith(f"{count} image{'' if count == 1 else 's'} at"), \
                f"M: and must say it is pricing {count}, got {detail!r}"
            assert visible_promised_count() == count, \
                f"M: the candidates-returned row must follow the count too, got {visible_promised_count()}"
            assert page.locator("#candidate-correction-output-count").input_value() == str(count), \
                "M: and the control itself must hold it"

        # THE NUMBER ON SCREEN IS THE NUMBER IN THE BODY. Captured immediately before the
        # paid button, then compared against what the restricted payload actually carried.
        quote_before_submit, detail_before_submit = visible_quote()
        count_before_submit = int(page.locator("#candidate-correction-output-count").input_value())
        promised_before_submit = visible_promised_count()

        # ADVANCED DISCLOSES ONLY WHAT THIS ROUTE SUPPORTS.
        open_advanced()
        assert page.locator("#candidate-correction-resolution").count() == 1, "L: Advanced discloses the size"
        correction_labels = page.evaluate(
            "() => [...document.querySelectorAll('#candidate-correction-generation-view .gen-view-controls label')]"
            "  .filter(node => node.querySelector('input, select, textarea'))"
            "  .map(node => (node.querySelector('span')?.textContent || '').trim().toLowerCase())")
        for word in ("guidance", "cfg", "sampling steps", "seed", "reference strength"):
            assert not any(word in label for label in correction_labels), \
                f"L: {word!r} is unsupported on this route and must not be drawn: {correction_labels}"

        # AND A SIMPLE DISPATCH CARRIES ONLY WHAT SIMPLE OFFERED.
        open_simple()
        assert page.locator("#candidate-correction-resolution").count() == 0, \
            "L: returning to Simple must remove the expert control, not hide it"
        page.locator("button.approve-btn.large", has_text="GENERATE CORRECTION WITH FAL").first.click()
        page.wait_for_timeout(1500)
        assert len(captured_submits) == before_correction + 1, \
            f"L: pressing generate must submit; captured {captured_submits[before_correction:]}"
        correction_body = captured_submits[-1]
        assert correction_body.get("purpose") == "correction", \
            f"L: the submission must be the correction request, got {correction_body.get('purpose')!r}"
        assert "resolution" not in correction_body, "L: and must not carry the size Simple never asked about"
        for key in EXPERT_KEYS:
            assert key not in correction_body, f"L: {key} must never reach a paid correction request"
        assert correction_body.get("quality"), "L: while a Simple control does travel"

        # M · the three numbers are one number.
        assert correction_body.get("outputCount") == count_before_submit, \
            (f"M: the visible count {count_before_submit} and the submitted outputCount "
             f"{correction_body.get('outputCount')!r} must be the same number")
        assert promised_before_submit == correction_body["outputCount"], \
            "M: and so must the candidates-returned row the filmmaker read"
        assert quote_before_submit == f"Estimated ${correction_body['outputCount'] * IMAGE_RATE:.2f}", \
            (f"M: the estimate shown immediately before dispatch ({quote_before_submit!r}) must be the configured "
             f"rate times the submitted outputCount ({correction_body['outputCount']})")
        assert detail_before_submit.startswith(f"{correction_body['outputCount']} images at"), \
            f"M: and must have named that same count, got {detail_before_submit!r}"
        findings.append(f"M: 2 -> 4 -> 1 -> 4 each re-quoted before dispatch; the screen showed {quote_before_submit!r} "
                        f"for {count_before_submit} and the restricted payload carried outputCount="
                        f"{correction_body['outputCount']}")

        # CORRECTION SEMANTICS AND PROVENANCE ARE UNTOUCHED BY THE GATE.
        assert correction_body.get("sourceCandidate") == CORRECTION_CANDIDATE, \
            f"L: the correction must still target its candidate, got {correction_body.get('sourceCandidate')!r}"
        assert correction_body.get("sourceBuildId") == CORRECTION_BUILD, \
            f"L: and its build, got {correction_body.get('sourceBuildId')!r}"
        assert correction_body.get("packageId") == CORRECTION_PACKAGE, "L: and its package identity"
        assert correction_body.get("parentPackageId") == "SAMPLE-01-A-R01", "L: and its parent package"
        assert correction_body.get("frameId") == CORRECTION_FRAME, "L: and the frame it repairs"
        assert (correction_body.get("references") or [])[0].get("role") == "base", \
            "L: with the editable base still first in the package"
        assert "CORRECTION:" in (correction_body.get("prompt") or ""), "L: and the correction instruction intact"
        correction_headline = next((line for line in correction_price.splitlines() if "Estimated" in line), correction_price)
        # ===== M · WITH NO RATE, A COUNT CHANGE MUST NOT INVENT ONE
        write_config(MOTION_RATE, image_rate=0)
        page.goto(f"{base}/#/shot/{CORRECTION_SHOT}", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.wait_for_timeout(1200)
        reset_view_preference()
        page.evaluate(
            "args => openCandidateCorrectionModal(args[0], args[1], args[2], args[3])",
            [CORRECTION_SHOT, CORRECTION_FRAME, CORRECTION_CANDIDATE, CORRECTION_BUILD])
        page.wait_for_selector("#candidate-correction-generation-view .gen-view", timeout=20000)
        page.wait_for_timeout(400)
        for count in (2, 4, 1):
            if count != 2:
                set_count(count)
            unpriced_headline, _ = visible_quote()
            assert "unavailable" in unpriced_headline.lower(), \
                f"M: with no configured rate the disclosure stays unavailable, got {unpriced_headline!r}"
            assert "$" not in unpriced_headline, f"M: and never grows a figure, got {unpriced_headline!r}"
            assert visible_promised_count() == count, \
                "M: while the candidates-returned row still follows the count"
        unpriced_block = page.locator("#candidate-correction-generation-view .gen-view-price").inner_text()
        assert "still paid" in unpriced_block.lower(), "M: an unpriced paid route must still say it is paid"
        assert "free" not in unpriced_block.lower(), "M: and never Free"
        findings.append("M: with the image rate removed, 2 -> 4 -> 1 left the disclosure unavailable throughout — no count "
                        "change invented a price, and the route still said it is paid")

        findings.append(f"L: the correction dialog opened on Simple showing {correction_headline.strip()!r}, "
                        f"disclosed only the size under Advanced, and its gated body kept every provenance field while "
                        f"carrying {sorted(correction_body.keys() & {'outputCount', 'quality', 'resolution'})}")

        # ============================================================ I · NOTHING WAS SPENT
        assert not page_errors, f"I: uncaught errors: {page_errors}"
        assert not offsite, f"I: requests tried to leave this machine: {offsite}"
        assert not not_found, f"I: a request failed on the server: {not_found}"
        # The only console error this suite may produce is the paid POST it deliberately
        # aborted. Named exactly rather than allowed as a class, so a real failure cannot
        # hide behind the intended one.
        unexpected = [line for line in console_errors if "net::ERR_FAILED" not in line]
        assert not unexpected, f"I: unexpected console errors: {unexpected}; failed: {failed_requests}"
        assert failed_requests == [f"POST {base}{PAID_ROUTE} (net::ERR_FAILED)"] * 3, \
            f"I: the only failed requests must be the intercepted paid POSTs, got {failed_requests}"
        assert len(paid_calls) == len(captured_submits) == 3, \
            f"I: expected exactly three intercepted paid submits, saw paid={paid_calls} captured={captured_submits}"
        findings.append(f"I: 3 paid POSTs were intercepted and aborted before the server saw them, 0 provider calls, "
                        f"0 off-site requests")

        browser.close()

    print(f"{LABEL} passed: Simple is what opens on every generation surface, Advanced discloses the expert controls "
          f"without hiding the price, an abandoned Advanced value never reaches a paid request, and the quote a "
          f"filmmaker reads is the number the ledger would record - or is honestly unavailable.")
    for line in findings:
        print(f"  - {line}")

finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
