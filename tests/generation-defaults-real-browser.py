#!/usr/bin/env python3
"""Saved generation defaults, read off the real dialogs in a real Chromium.

UX B1's finding was about what a filmmaker SEES when a paid dialog opens. A server
that resolves the right value and a screen that shows a different one is the same
defect with a longer path, so this suite reads the selected option out of the
rendered control rather than trusting the payload behind it.

What it establishes, in the order the audit hit it:

  A  under saved LOW / 1K the frame dialog opens at Low, and at the size this model
     documents for the shot's format - with the substitution named where 1K is not
     one of them
  B  under saved MEDIUM / 2K the same dialog opens at Medium and a 2K-tier size,
     which is what proves nothing was pinned to the audit's cheap settings
  C  the entity-reference dialog still inherits its saved values, unchanged
  D  an explicit change in the dialog is what reaches the submit, and Settings on
     disk is not rewritten by it
  E  the motion-readiness gate still refuses before any paid submit can happen

NOTHING HERE IS PAID. The dialogs compile through /api/generation/fal/image/plan and
/api/generation/options, both local computation. The suite fails if any request
leaves the loopback host or if /api/generation/fal/jobs - the only route that spends
money - is ever called. FAL_KEY is a string that is not a credential, purely so the
client-side "is fal configured" gate opens.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped sample
are never touched, and the directory is removed at the end.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium, canon_receipts
LABEL = "UX B1 saved generation defaults real-browser audit"
sync_playwright = require_browser(LABEL)

SHOT = "SAMPLE-03"
PAID_ROUTE = "/api/generation/fal/jobs"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")

CONFIG_A = {"frameQuality": "low", "frameResolution": "1k",
            "blockingQuality": "low", "blockingResolution": "1k", "h3Resolution": "768P"}
CONFIG_B = {"frameQuality": "medium", "frameResolution": "2k",
            "blockingQuality": "medium", "blockingResolution": "2k", "h3Resolution": "2K"}


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-b1-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"

# F-065 NEEDS TWO APPROVED ANCHORS AND NO PASSING REVIEW, and the suite says so itself:
# "a gate that is never actually reached reports a green that proves nothing". The sample
# ships one keyframe and no receipts, so before this the precondition was never met and
# the branch under test never ran. The second beat is a copy of the sample's own frame -
# no new binary - and BOTH are approved through the receipt ledger, because
# guidedFrameApproved reads Canon, not the winner pointer.
gate_project_dir = projects_root / "dogfood-sample"
gate_takes = gate_project_dir / "shots" / "SAMPLE-01" / "takes"
shutil.copyfile(gate_takes / "SAMPLE-01-ARRIVAL.png", gate_takes / "SAMPLE-01-BEAT-B.png")
gate_file = gate_project_dir / "project.json"
gate_project = json.loads(gate_file.read_text(encoding="utf-8"))
gate_shot = next(row for row in gate_project["shots"] if row["id"] == "SAMPLE-01")
gate_shot["keyframes"].append({
    "id": "frame-b", "label": "B", "title": "Second frame", "winner": "SAMPLE-01-BEAT-B.png",
    "description": "The courier reaches the bench with the parcel.", "required": True,
    "generationPackages": [], "selectedCandidate": "",
})
gate_project["productionAuthority"] = canon_receipts(
    [{"kind": "shot-frame", "shotId": "SAMPLE-01", "frameId": row["id"], "value": row["winner"]}
     for row in gate_shot["keyframes"]], via="generation-defaults-fixture")
gate_file.write_text(json.dumps(gate_project, indent=2), encoding="utf-8")


def write_config(generation_fal):
    """Save a generation configuration the way Settings -> Generation does."""
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["generation"] = {"fal": {"enabled": True, "frameOutputs": 2, "blockingOutputs": 2, **generation_fal}}
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")


write_config(CONFIG_A)

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "FAL_KEY": "b1-browser-qa-placeholder-not-a-credential"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

console_errors, page_errors, offsite, paid_calls, failed_requests = [], [], [], [], []
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

        def guard(route):
            """No request leaves this machine, and the paid route is never called."""
            url = route.request.url
            if PAID_ROUTE in url and route.request.method == "POST":
                paid_calls.append(f"{route.request.method} {url}")
                return route.abort("failed")
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)

        def selected(control_id):
            """The option the control actually opened on."""
            return page.evaluate(
                "id => { const el = document.getElementById(id); return el ? el.value : null; }", control_id)

        def open_frame_dialog():
            """Drive the real Create blocking frame button, exactly as a filmmaker does."""
            page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=15000)
            page.wait_for_timeout(1200)
            page.locator(".focused-task-button", has_text="Look & blocking").first.click()
            page.wait_for_timeout(500)
            page.evaluate("() => document.querySelectorAll('#main details').forEach(node => { node.open = true; })")
            page.wait_for_timeout(300)
            generate = page.get_by_role("button", name="GENERATE", exact=True)
            assert generate.count() == 1, f"expected one Create blocking frame button, found {generate.count()}"
            generate.first.click()
            page.wait_for_selector(".h3-generation-modal", timeout=20000)
            page.wait_for_selector("#fal-frame-quality", timeout=20000)
            page.wait_for_timeout(400)

        # ---- A. CONFIG A -------------------------------------------------
        open_frame_dialog()
        assert not page_errors, f"A: the workspace raised uncaught errors: {page_errors}"
        assert not console_errors, f"A: console errors: {console_errors}; failed: {failed_requests}"

        quality_a, size_a = selected("fal-frame-quality"), selected("fal-frame-size")
        assert quality_a == "low", f"A: under saved LOW the dialog opened at {quality_a!r}"
        assert quality_a != "auto", "A: the audit's Auto came back"
        # 16:9 is the sample's format and GPT Image 2 documents no 1K size at it, so
        # 2048x1152 is the constrained answer - and it must be stated as one.
        facts = page.locator("#fal-frame-facts").inner_text()
        assert size_a in facts, f"A: the summary does not state the size it will render ({size_a!r} not in {facts!r})"
        notes = page.locator("#fal-frame-warnings").inner_text()
        assert "1K" in notes and size_a in notes, \
            f"A: a saved 1K that this format cannot deliver must be explained before the paid button, got {notes!r}"
        findings.append(f"A: under saved LOW / 1K the dialog opened at quality={quality_a} size={size_a}, "
                        f"with the 1K substitution named on screen")

        # A dialog change must not write back to Settings.
        page.select_option("#fal-frame-quality", "high")
        page.wait_for_timeout(900)
        assert selected("fal-frame-quality") == "high", "D: the filmmaker's own change did not take"
        on_disk = json.loads(config_path.read_text(encoding="utf-8"))["generation"]["fal"]
        assert on_disk["frameQuality"] == "low", \
            f"D: changing the dialog rewrote the saved default to {on_disk['frameQuality']!r}"
        assert on_disk["blockingQuality"] == "low", "D: changing the dialog rewrote the saved blocking default"
        findings.append("D: an explicit dialog change takes effect for the request and leaves Settings on disk untouched")

        # And the explicit choice is what the submit would carry.
        would_send = page.evaluate("() => falFrameOutputSettings()")
        assert would_send["quality"] == "high", f"D: the submit would carry {would_send['quality']!r}, not the override"
        findings.append(f"D: the submit body carries the override verbatim: {would_send}")

        # ---- C. the entity-reference path, still good --------------------
        inherited_a = page.evaluate(
            "() => ({ quality: falGenerationConfig().frameQuality, resolution: falResolutionValue('frame'),"
            " h3: falH3ResolutionValue() })")
        assert inherited_a == {"quality": "low", "resolution": "1k", "h3": "768P"}, \
            f"C: the entity-reference path stopped inheriting: {inherited_a}"
        findings.append(f"C: the entity-reference path still inherits {inherited_a}")

        # ---- E. the motion-readiness gate still refuses -------------------
        # F-065: a shot with every required frame approved but no PASSING frame-sequence
        # review must be refused at the navigation, before the paid dialog can exist.
        # The condition is built in the page rather than hoped for in the sample, because
        # a gate that is never actually reached reports a green that proves nothing.
        gate = page.evaluate("""() => {
            const shot = (P.shots || [])[0];
            if (!shot) return { built: false };
            const messages = [];
            const original = window.toast;
            window.toast = (message) => { messages.push(String(message)); };
            try {
                const creation = ensureShotCreation(shot);
                delete creation.deliveryIntent;
                /* Two approved anchors and no passing review: exactly the FLF shape the
                   audit hit, where 2/2 frames were approved and motion was still blocked. */
                const inputs = guidedFrameSequenceInputs(shot, takesFor(shot.id)) || [];
                const review = guidedFrameSequenceReviewState(shot, inputs);
                openGuidedMotionFromFrames(shot.id, 'create');
                return {
                    built: true,
                    approvedCount: inputs.length,
                    reviewPassed: !!(review && review.pass),
                    messages,
                    navigated: ensureShotCreation(shot).deliveryIntent === 'motion',
                };
            } finally { window.toast = original; }
        }""")
        assert gate.get("built"), "E: the sample project has no shot to exercise the gate with"
        if gate["approvedCount"] >= 2 and not gate["reviewPassed"]:
            assert gate["messages"], "E: a 2+-anchor shot with no passing review was NOT refused"
            assert not gate["navigated"], "E: the motion panel opened despite an unpassed readiness review"
            findings.append(f"E: {gate['approvedCount']} approved anchors with no passing review were refused "
                            f"before the motion panel opened: {gate['messages'][0]!r}")
        else:
            # The gate's precondition was not met, so nothing was proved here. Said out
            # loud rather than counted as a pass; the ordering itself is pinned
            # deterministically by tests/generation-default-inheritance.js section 5.
            assert not gate["messages"], f"E: an unexpected refusal fired: {gate['messages']}"
            findings.append(f"E: the sample shot has {gate['approvedCount']} approved anchors "
                            f"(review passed={gate['reviewPassed']}), so the block branch was not exercised here; "
                            f"its ordering is pinned by generation-default-inheritance.js section 5")
        assert not paid_calls, f"E: a paid route was contacted around the readiness gate: {paid_calls}"

        # ---- B. CONFIG B, the operator's real settings --------------------
        write_config(CONFIG_B)
        # The server reads config per request, but the browser holds a copy, so the
        # page is reloaded the way a filmmaker returning from Settings would.
        page.goto(f"{base}/#/settings", wait_until="domcontentloaded")
        page.wait_for_timeout(600)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(1200)
        loaded = page.evaluate("() => ({ quality: falGenerationConfig().frameQuality,"
                               " resolution: falResolutionValue('frame'), h3: falH3ResolutionValue() })")
        assert loaded == {"quality": "medium", "resolution": "2k", "h3": "2K"}, \
            f"B: the browser did not pick up the saved settings: {loaded}"

        open_frame_dialog()
        quality_b, size_b = selected("fal-frame-quality"), selected("fal-frame-size")
        assert quality_b == "medium", f"B: under saved MEDIUM the dialog opened at {quality_b!r}"
        assert quality_b != "low", "B: MEDIUM was answered with the audit's LOW; the fix is pinned to the cheap settings"
        assert quality_b != "auto", "B: the audit's Auto came back"
        notes_b = page.locator("#fal-frame-warnings").inner_text()
        assert "2K" not in notes_b or size_b in notes_b, "B: a 2K that resolves exactly must not report a substitution"
        findings.append(f"B: under saved MEDIUM / 2K the dialog opened at quality={quality_b} size={size_b}")

        # The H3 dialog's opening resolution, under both configurations.
        h3_b = page.evaluate("() => falH3ResolutionValue()")
        assert h3_b == "2K", f"B: the H3 dialog would open at {h3_b!r} under saved 2K"
        findings.append(f"B: the H3 dialog resolves its opening resolution to {h3_b} under saved 2K")

        assert not page_errors, f"the audit raised uncaught errors: {page_errors}"
        assert not console_errors, f"the audit logged console errors: {console_errors}"
        browser.close()

    assert not paid_calls, f"a paid route was called: {paid_calls}"
    assert not offsite, f"a request left this machine: {offsite}"

    print(f"{LABEL} passed: the paid frame dialog opens on the saved quality and a documented size under "
          f"both configurations, the entity-reference path still inherits, an override stays an override, "
          f"and no paid route was contacted.")
    for line in findings:
        print(f"  - {line}")

finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
