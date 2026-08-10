#!/usr/bin/env python3
"""Durable reference automation, driven in a real Chromium.

The Node suite (tests/reference-automation-closed-loop.js) proves the loop's
arithmetic: how many passes ran, how many candidates were generated, what the
correction plan aggregated, where the spending stopped. It cannot prove the half
of this repair the filmmaker actually reported, because both halves of that
report were about what a browser renders.

  1  a failed pass left no visible trace: the run log line was inside a
     collapsed disclosure and the review workspace said nothing at all, so an
     automation that did advance looked exactly like one that had stopped.
  2  a rejected candidate's card showed "AI 48 · FLAG" and offered one action,
     RESTORE. The review was on disk the whole time with no way in.

What this establishes, in the order a director meets it:

  A  the reference workspace loads with no uncaught or console error
  B  the real AUTOMATE DEFAULT button starts a bounded run
  C  pass 1 generates the configured candidates and reviews every one
  D  an all-failed pass 1 advances to pass 2 without anyone asking it to
  E  the pass progression is on screen: scores, why it failed, what changed
  F  a strong pass in pass 2 stops the run and still waits for a human
  G  a rejected candidate offers its review, and the image viewer stays separate
  H  reading the review does not un-reject the candidate
  I  a second entity that never passes exhausts exactly and says so

NOTHING HERE IS PAID. /api/generation/fal/jobs and /api/llm/review-entity-candidate
are fulfilled locally by this file; the suite fails if any request leaves the
loopback host, and it counts the generation submissions so an unbounded run
cannot pass unnoticed. The prompt compiler is the real one: only the optional
local-advisor call is stubbed out (as unavailable, which is what the deterministic
compiler is the fallback for), so the pass-2 directive asserted below is text
CineBraid's own compiler produced.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped
sample are never touched, and the directory is removed at the end.
"""

import base64, json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium
LABEL = "Durable reference automation real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")
# A 1x1 PNG. The reviewer is stubbed, so only the extension and the bytes being a
# real image matter; what is asserted is the workflow around the file.
PIXEL = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def flag(score, categories, summary):
    return {"score": score, "pass": False, "modelPass": False, "explicitPass": False, "explicitScore": True,
            "autoApprove": False, "contractVersion": "reference-authority-v2", "requiredHardChecks": [],
            "hardChecks": {}, "hardGateFailures": ["score-below-85", "model-did-not-pass"],
            "categories": categories, "summary": summary, "recommendation": "correct"}


def strong(score, summary):
    clean = {key: {"severity": "pass", "note": "Correct."} for key in
             ("design", "state", "requirements", "usefulness", "cleanliness")}
    return {"score": score, "pass": True, "modelPass": True, "explicitPass": True, "explicitScore": True,
            "autoApprove": True, "contractVersion": "reference-authority-v2", "requiredHardChecks": [],
            "hardChecks": {}, "hardGateFailures": [], "categories": clean, "summary": summary,
            "recommendation": "approve"}


# The dogfood pass 1, verbatim: three candidates, three different reasons, one
# of them shared. Wardrobe is clean on all three, which is what PRESERVE is for.
REVIEWS = {
    "MARA-P1-A.png": flag(62, {
        "design": {"severity": "major", "note": "Face too dark; the eyes are difficult to read."},
        "state": {"severity": "pass", "note": "Soaked coat and wet hair are correct."},
        "requirements": {"severity": "pass", "note": "Required identity details are present."},
        "usefulness": {"severity": "minor", "note": "Usable but underexposed."},
        "cleanliness": {"severity": "pass", "note": "No artifacts."},
    }, "Face too dark; eyes difficult to read. Wardrobe otherwise correct."),
    "MARA-P1-B.png": flag(48, {
        "design": {"severity": "pass", "note": "Identity is consistent where visible."},
        "state": {"severity": "pass", "note": "Soaked coat and wet hair are correct."},
        "requirements": {"severity": "major", "note": "Face occupies too little of the frame to judge."},
        "usefulness": {"severity": "major", "note": "Framing too wide; poor reference pose."},
        "cleanliness": {"severity": "pass", "note": "No artifacts."},
    }, "Framing too wide; face insufficiently readable. Reference pose poor."),
    "MARA-P1-C.png": flag(52, {
        "design": {"severity": "major", "note": "Dramatic lighting obscures identity across the face."},
        "state": {"severity": "pass", "note": "Soaked coat and wet hair are correct."},
        "requirements": {"severity": "pass", "note": "Silhouette is acceptable."},
        "usefulness": {"severity": "major", "note": "Unsuitable as a durable reference."},
        "cleanliness": {"severity": "pass", "note": "No artifacts."},
    }, "Dramatic lighting obscures identity; silhouette acceptable."),
    "MARA-P2-A.png": strong(86, "Clear, evenly lit, reference-appropriate framing."),
    "MARA-P2-B.png": flag(70, {
        "design": {"severity": "major", "note": "Still shadowed."},
        "state": {"severity": "pass", "note": "State correct."},
        "requirements": {"severity": "pass", "note": "Details present."},
        "usefulness": {"severity": "pass", "note": "Framing fine."},
        "cleanliness": {"severity": "pass", "note": "No artifacts."},
    }, "Still shadowed."),
    "MARA-P2-C.png": strong(82, "Readable and usable."),
}
# The exhaustion entity: nine candidates, never approvable.
for _pass in (1, 2, 3):
    for _slot, _score in zip("ABC", (44, 46, 48)):
        REVIEWS[f"NELL-P{_pass}-{_slot}.png"] = flag(_score + _pass, {
            "design": {"severity": "major", "note": "Identity cannot be verified in this light."},
            "state": {"severity": "pass", "note": "State correct."},
            "requirements": {"severity": "pass", "note": "Details present."},
            "usefulness": {"severity": "major", "note": "Not usable as a durable reference."},
            "cleanliness": {"severity": "pass", "note": "No artifacts."},
        }, "Identity cannot be verified; not usable as a durable reference.")

BATCHES = {
    "MARA": [["MARA-P1-A.png", "MARA-P1-B.png", "MARA-P1-C.png"], ["MARA-P2-A.png", "MARA-P2-B.png", "MARA-P2-C.png"]],
    "NELL": [[f"NELL-P{p}-{s}.png" for s in "ABC"] for p in (1, 2, 3)],
}

# ---------------------------------------------------------------- the sandbox

sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-refloop-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_dir = projects_root / "dogfood-sample"

config = json.loads(config_path.read_text(encoding="utf-8"))
config["generation"] = {"fal": {"enabled": True}}
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

project_file = project_dir / "project.json"
project = json.loads(project_file.read_text(encoding="utf-8"))
project["characters"] = list(project.get("characters", [])) + [
    {"id": "MARA", "name": "Mara Venn", "status": "IN PROGRESS", "workflowStatus": "IN PROGRESS",
     "block": "Field investigator, late thirties, close-cropped dark hair, long dark coat.",
     "creationDescription": "Mara Venn, field investigator, arriving soaked at night in heavy rain outside the station door.",
     "approvedFile": "", "candidateFiles": [],
     "continuityStates": [{"id": "state-default", "name": "Rain-soaked arrival", "isDefault": True,
                           "notes": "Soaked long coat, wet hair flat to the head, rain-slick skin."}]},
    {"id": "NELL", "name": "Nell Ardan", "status": "IN PROGRESS", "workflowStatus": "IN PROGRESS",
     "block": "Night dispatcher, forties, grey uniform coat.",
     "creationDescription": "Nell Ardan, night dispatcher, standing under a single failing lamp inside the dispatch hut.",
     "approvedFile": "", "candidateFiles": [],
     "continuityStates": [{"id": "state-default", "name": "Lamp-lit dispatch", "isDefault": True,
                           "notes": "Grey uniform coat, single overhead lamp."}]},
]
project_file.write_text(json.dumps(project, indent=2), encoding="utf-8")

anchors = project_dir / "anchors"
anchors.mkdir(parents=True, exist_ok=True)
for name in REVIEWS:
    (anchors / name).write_bytes(PIXEL)

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "FAL_KEY": "reference-loop-browser-qa-placeholder-not-a-credential"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

console_errors, page_errors, offsite, failed_requests = [], [], [], []
submissions, review_calls, compiles, advisor_stubs = [], [], [], []
# The one console error this suite manufactures: the optional local prompt
# advisor is answered 503 on purpose, and the browser logs every failed fetch.
# Forgiven by exact text and exact count, so a real console error still fails.
STUBBED_ADVISOR_ERROR = "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
def product_console_errors():
    return [line for line in console_errors if line != STUBBED_ADVISOR_ERROR]

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
        page = browser.new_page(viewport={"width": 1600, "height": 1100})
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("requestfailed", lambda r: failed_requests.append(f"{r.method} {r.url} ({r.failure or ''})"))

        def json_body(route):
            try: return json.loads(route.request.post_data or "{}")
            except Exception: return {}

        def guard(route):
            """Providers are fulfilled here. Nothing leaves this machine."""
            request, url = route.request, route.request.url
            if PAID_ROUTE in url and request.method == "POST":
                body = json_body(route)
                entity = str(body.get("entityId") or "")
                index = len([row for row in submissions if row["entity"] == entity])
                batches = BATCHES.get(entity, [])
                assert index < len(batches), (
                    f"automation asked {entity} for generation batch {index + 1}; the confirmed "
                    f"authorization only covers {len(batches)}")
                files = batches[index]
                submissions.append({"entity": entity, "files": files, "outputCount": body.get("outputCount"),
                                    "prompt": str(body.get("prompt") or "")})
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "ok": True, "job": {"id": f"job-{entity}-{index + 1}", "status": "COMPLETED",
                                        "purpose": "entity-reference", "model": "GPT Image 2",
                                        "entityList": "characters", "entityId": entity,
                                        "outputs": [{"name": name, "url": f"/assets/anchors/{name}"} for name in files]}}))
            if "/api/llm/review-entity-candidate" in url and request.method == "POST":
                body = json_body(route)
                name = str(body.get("fileName") or "")
                assert name in REVIEWS, f"a review was requested for {name}, which no pass generated"
                review_calls.append(name)
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "review": REVIEWS[name],
                    "inputLabels": [{"image": 1, "fileName": name, "role": "candidate under review"}]}))
            if "/api/prompt/asset-compile" in url and request.method == "POST" and not json_body(route).get("useLLM"):
                # Recorded, then passed through to the real compiler: what the client
                # sent is the difference between "the correction never reached the
                # compiler" and "the compiler ignored it", and those are not the
                # same defect.
                compiles.append(str(json_body(route).get("directive") or ""))
                return route.continue_()
            if "/api/prompt/asset-compile" in url and request.method == "POST" and json_body(route).get("useLLM"):
                # The optional local advisor, reported unavailable. The deterministic
                # compiler is exactly what CineBraid falls back to, and it is the real
                # one - so the pass-2 directive asserted below is its own output.
                advisor_stubs.append(url)
                return route.fulfill(status=503, content_type="application/json",
                                     body=json.dumps({"error": "local prompt advisor unavailable"}))
            if "/api/agents/status" in url:
                response = route.fetch()
                payload = response.json()
                ready = {"ready": True, "label": "ready", "provider": "stub", "model": "browser-qa",
                         "message": "Configured.", "action": ""}
                payload["enabled"] = True
                payload["capabilities"] = {**payload.get("capabilities", {}), "text": ready, "vision": ready,
                                           "verifier": ready, "continuity": ready}
                return route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)

        def open_reference_workspace(entity_id):
            page.goto(f"{base}/#/character/{entity_id}", wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=20000)
            page.wait_for_timeout(900)
            task = page.locator(".focused-task-button", has_text="Reference").first
            if task.count():
                task.click()
                page.wait_for_timeout(400)
            page.evaluate("() => document.querySelectorAll('#main details').forEach(node => { node.open = true; })")
            page.wait_for_timeout(300)

        def start_automation(entity_id):
            button = page.get_by_role("button", name="AUTOMATE DEFAULT", exact=True)
            assert button.count() >= 1, f"the AUTOMATE DEFAULT button is missing for {entity_id}"
            button.first.click()
            page.wait_for_selector(".automation-plan-modal", timeout=15000)
            assert "THREE PASSES MAXIMUM" in page.locator(".automation-plan-modal .modal-sub").inner_text().upper(), \
                "the plan dialog no longer states the pass ceiling it is authorizing"
            start = page.get_by_role("button", name="START", exact=True).first
            assert not start.is_disabled(), (
                "the plan dialog refused to start: "
                f"{page.locator('.automation-plan-modal .guided-prompt-error').all_inner_texts()}")
            start.click()
            try:
                page.wait_for_function(
                    "id => (typeof AUTOMATION_RUNS !== 'undefined' ? AUTOMATION_RUNS : []).some(run => run.targetId === `characters:${id}`"
                    " && run.status === 'awaiting-review')",
                    arg=entity_id, timeout=120000)
            except Exception as error:  # noqa: BLE001 - the timeout IS the finding, but it needs a reason
                state = page.evaluate("() => (typeof AUTOMATION_RUNS !== 'undefined' ? AUTOMATION_RUNS : []).map(run => ({id: run.id,"
                                      " target: run.targetId, status: run.status, stage: run.stage,"
                                      " summary: run.summary, steps: Object.values(run.steps || {}).map(step =>"
                                      " `${step.key}:${step.status}${step.error ? ' ' + step.error : ''}`)}))")
                raise AssertionError(
                    f"{entity_id}: the run never reached a human gate. runs={json.dumps(state, indent=1)} "
                    f"submissions={len(submissions)} reviews={len(review_calls)} compiles={compiles} console={console_errors} "
                    f"pageerrors={page_errors}") from error
            page.wait_for_timeout(600)

        def run_for(entity_id):
            return page.evaluate(
                "id => (typeof AUTOMATION_RUNS !== 'undefined' ? AUTOMATION_RUNS : []).find(run => run.targetId === `characters:${id}`)", entity_id)

        # ---- A. the reference workspace loads ---------------------------
        open_reference_workspace("MARA")
        assert not page_errors, f"A: the reference workspace raised uncaught errors: {page_errors}"
        assert not console_errors, \
            f"A: the reference workspace logged console errors: {console_errors}; failed: {failed_requests}"

        # ---- B / C / D. start, pass 1, and the advance nobody asked for --
        start_automation("MARA")
        mara_submissions = [row for row in submissions if row["entity"] == "MARA"]
        assert len(mara_submissions) == 2, \
            f"D: an all-failed pass 1 must be followed by the authorized pass 2, saw {len(mara_submissions)} batches"
        assert all(row["outputCount"] == 3 for row in mara_submissions), \
            f"C: each pass must request the confirmed three candidates: {[r['outputCount'] for r in mara_submissions]}"
        mara_reviews = [name for name in review_calls if name.startswith("MARA-")]
        assert len(mara_reviews) == 6, f"C: every generated candidate must be reviewed, saw {len(mara_reviews)}"

        # The pass-2 prompt is CineBraid's own compiler carrying pass 1's evidence.
        pass_two_prompt = mara_submissions[1]["prompt"]
        assert pass_two_prompt != mara_submissions[0]["prompt"], \
            f"D: pass 2 resubmitted the pass-1 prompt. directives sent to the compiler: {compiles}"
        for fragment in ("Face too dark", "Framing too wide", "Dramatic lighting obscures identity"):
            assert fragment in pass_two_prompt, f"D: pass 2 does not carry the pass-1 finding {fragment!r}"
        assert "PRESERVE" in pass_two_prompt and "CORRECT" in pass_two_prompt, \
            "D: the pass-2 prompt does not separate what to keep from what to fix"

        # ---- E. the progression is on screen ----------------------------
        page.evaluate("() => document.querySelectorAll('#main details').forEach(node => { node.open = true; })")
        page.wait_for_timeout(400)
        progression = page.locator(".automation-pass-progression")
        assert progression.count() == 1, "E: the pass progression panel is not rendered"
        progression_text = progression.first.inner_text()
        for fragment in ("PASS 1 OF 3", "PASS 2 OF 3", "MARA-P1-A.png", "62", "Preserve", "Correct",
                         "What changed from pass 1"):
            assert fragment in progression_text, f"E: the progression panel omits {fragment!r}"
        assert "Face too dark" in progression_text and "Framing too wide" in progression_text, \
            "E: the panel does not show every candidate's reason, which is the aggregate the next pass used"
        assert "Rain-soaked arrival" in progression_text, "E: the preserved canon state is not shown"

        # ---- F. a strong pass stops and still waits ---------------------
        mara_run = run_for("MARA")
        assert mara_run["status"] == "awaiting-review", f"F: expected a human gate, got {mara_run['status']}"
        assert len(mara_submissions) == 2, "F: a strong pass in pass 2 must not spend pass 3"
        approved = page.evaluate("() => (P.characters.find(row => row.id === 'MARA') || {}).approvedFile || ''")
        assert approved == "", f"F: automation approved {approved!r} on its own; approval is a human decision"
        gate = page.locator(".automation-human-review")
        assert gate.count() == 1, "F: no human review gate is shown"
        assert "MARA-P2-A.png" in gate.first.inner_text(), "F: the passing candidate is not offered for approval"

        # ---- G. a rejected candidate keeps a way into its review --------
        page.locator(".focused-task-button", has_text="Review").first.click()
        page.wait_for_timeout(500)
        page.evaluate("() => document.querySelectorAll('#main details').forEach(node => { node.open = true; })")
        page.wait_for_timeout(300)
        card = page.locator('.entity-candidate-card[data-candidate-file="MARA-P1-B.png"]').first
        assert card.count() == 1, "G: the pass-1 candidate is not listed"
        card.get_by_role("button", name="REJECT", exact=True).click()
        page.wait_for_timeout(700)
        page.evaluate("() => document.querySelectorAll('#main details').forEach(node => { node.open = true; })")
        page.wait_for_timeout(300)
        rejected = page.locator('.entity-rejected-candidates .entity-candidate-card[data-candidate-file="MARA-P1-B.png"]').first
        assert rejected.count() == 1, "G: the rejected candidate is not in the rejected list"
        review_button = rejected.locator("button.rejected-review-action")
        assert review_button.count() == 1, \
            "G: a rejected candidate offers no way into its review; RESTORE was the only action before this repair"
        assert "48" in review_button.inner_text() and "FLAG" in review_button.inner_text(), \
            f"G: the review action does not state what is behind it: {review_button.inner_text()!r}"
        assert rejected.locator("a.entity-candidate-preview").count() == 1, \
            "G: the image viewer must remain a separate action from the review"

        # ---- H. reading the review does not un-reject it ----------------
        review_button.click()
        page.wait_for_selector(".entity-candidate-review-modal", timeout=15000)
        modal_text = page.locator(".entity-candidate-review-modal").inner_text()
        assert "48/100" in modal_text and "FLAG" in modal_text, f"H: the flagged score is not readable: {modal_text[:200]!r}"
        assert "Framing too wide" in modal_text, "H: the reason the candidate failed is not readable"
        assert "HUMAN DECISION" in modal_text and "REJECTED BY YOU" in modal_text, \
            "H: the human decision is not stated separately from the AI one"
        page.locator(".entity-candidate-review-modal .cancel").first.click()
        page.wait_for_timeout(400)
        still_rejected = page.evaluate(
            "() => (P.characters.find(row => row.id === 'MARA').candidateFiles.find(row => (row.stored||row.name) === 'MARA-P1-B.png') || {}).decision")
        assert still_rejected == "rejected", f"H: reading a review changed the human decision to {still_rejected!r}"

        # ---- I. exhaustion, on a second entity --------------------------
        open_reference_workspace("NELL")
        start_automation("NELL")
        nell_submissions = [row for row in submissions if row["entity"] == "NELL"]
        assert len(nell_submissions) == 3, f"I: exactly three authorized passes, saw {len(nell_submissions)}"
        nell_reviews = [name for name in review_calls if name.startswith("NELL-")]
        assert len(nell_reviews) == 9, f"I: exactly nine reviews, saw {len(nell_reviews)}"
        nell_run = run_for("NELL")
        exhaustion = (nell_run.get("result") or {}).get("referenceExhaustion")
        assert exhaustion, "I: exhaustion must be recorded as its own outcome"
        assert exhaustion["passes"] == 3 and exhaustion["candidates"] == 9

        page.evaluate("() => document.querySelectorAll('#main details').forEach(node => { node.open = true; })")
        page.wait_for_timeout(400)
        panel = page.locator(".automation-pass-progression").first.inner_text()
        assert "No candidate passed after 3 passes / 9 candidates" in panel, \
            f"I: exhaustion is not stated on screen: {panel[:300]!r}"
        assert "Identity & design" in panel, "I: the recurring reason is not stated"
        gate_text = page.locator(".automation-human-review").first.inner_text()
        assert "IMPROVE PROMPT" not in gate_text, "I: an exhausted run must not offer another pass"
        assert "No further pass is authorized in this run" in gate_text, \
            f"I: the exhausted run does not say the authorization is spent: {gate_text!r}"
        assert len([row for row in submissions if row["entity"] == "NELL"]) == 3, \
            "I: rendering the exhausted state must not generate anything"

        # ---- A again, after everything ----------------------------------
        assert not page_errors, f"the automation flow raised uncaught errors: {page_errors}"
        assert not product_console_errors(), f"the automation flow logged console errors: {console_errors}"
        browser.close()

    assert not offsite, f"browser QA attempted to leave this machine: {offsite}"
    assert len(submissions) == 5, f"the suite made {len(submissions)} generation submissions, expected 5"
    assert len(review_calls) == 15, f"the suite made {len(review_calls)} review calls, expected 15"
    assert len(console_errors) == len(advisor_stubs), (
        f"console errors ({len(console_errors)}) are not accounted for by the {len(advisor_stubs)} deliberately "
        f"stubbed advisor failures: {console_errors}")

    print(
        f"Durable reference automation real-browser audit passed: the workspace loaded clean, AUTOMATE DEFAULT ran a "
        f"bounded run, an all-failed pass 1 aggregated three candidates' reasons and advanced to a pass 2 whose "
        f"prompt carried every one of them, the progression panel showed the scores / reasons / prompt delta on "
        f"screen, a strong pass stopped the run at 2 of 3 passes without approving anything, a rejected candidate "
        f"kept a VIEW REVIEW action independent of its image viewer and stayed rejected after it was read, and a "
        f"second entity exhausted at exactly 3 passes / 9 candidates with the recurring reason stated and no fourth "
        f"pass offered. {len(submissions)} simulated generation submissions, {len(review_calls)} simulated reviews, "
        f"no request left the loopback host and nothing paid was called.")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
