#!/usr/bin/env python3
"""UX B2a candidate review, read off the real modal in a real Chromium.

The audit's finding was about what a filmmaker SEES. A contract that computes the
right verdict and a screen that still leads with "96/100 · PASS · All required
gates passed" is the same defect with a longer path, so this suite reads the
rendered DOM rather than the payload behind it.

What it establishes:

  A  a genuine semantic PASS reads as a pass, and still waits for a person
  B  a declared-condition ISSUE is on screen, with the declared expectation beside
     the observed evidence, and the audit's all-clear sentence is unreachable
  C  an unreadable observation reads as UNCERTAIN, not as a pass
  D  the score is supporting context, read AFTER the semantic verdict in DOM order
  E  the provider/model shown is the one recorded with that review, and a review
     that recorded none says so instead of borrowing the current Settings value
  F  the human approval control is a separate, still-undecided act
  G  no paid route is contacted at any point

HONEST COVERAGE LIMIT: the review endpoint is fulfilled by a Playwright route
handler rather than by a live vision model, because there is no local vision
service in this environment and a real one would be a paid or unavailable
dependency. The RESPONSE BODY is computed by the real reference-review contract
in a real node process, so it is what the real route would have returned;
everything downstream of it — the client store, the record it writes, the modal
markup, the DOM — is real product code. The SERVER half of the same path (prompt
assembly, the vision dispatch, parsing, the contract, and reviewer attribution)
is exercised against a real server process in tests/candidate-review-semantics.js
part 2. /api/agents/status is likewise fulfilled, because the capability gate
requires a reachable assistant and this suite is not testing that gate.

NOTHING HERE IS PAID. /api/generation/fal/jobs is aborted and counted if it is
ever reached, and every off-host request is aborted.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped
sample are never touched, and the directory is removed at the end.
"""

import json, os, pathlib, shutil, socket, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL = "UX B2a candidate review semantics real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
REVIEW_ROUTE = "/api/llm/review-entity-candidate"
STATUS_ROUTE = "/api/agents/status"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")

ENTITY = "PROP-ENVELOPE"
CANDIDATE = "PROP-ENVELOPE-CANDIDATE.png"
STATE = "state-opened"
DELTA = "Wax seal broken but still present, flap open, same red envelope."
REQUIREMENTS = [{"id": "delta-1", "text": "Wax seal broken but still present"},
                {"id": "delta-2", "text": "flap open"},
                {"id": "delta-3", "text": "same red envelope"}]

CONTRACT_SCRIPT = (
    "const C=require('./reference-review-contract');"
    "const a=JSON.parse(process.argv[1]);"
    "const rec=(i,f,c,e)=>({requirementId:a.requirements[i].id,feature:a.requirements[i].text,"
    "expectedFeature:'must-remain',observedFeature:f,observedCondition:c,evidence:e});"
    "const parsed={score:96,pass:true,"
    "hardChecks:{sameUnderlyingEntity:{pass:true,note:'The same envelope.'},"
    "onlyRequestedDelta:{pass:true,note:'Only the requested delta changed.'}},"
    "stateMatch:{matchesRequestedState:true,closerState:'',note:'The opened state.'},"
    "categories:Object.fromEntries(['design','state','requirements','usefulness','cleanliness','context']"
    ".map(k=>[k,{severity:'pass',note:'No finding.'}])),"
    "summary:'Attractive opened-envelope candidate.',recommendation:'approve',"
    "stateEvidence:[rec(0,a.seal[0],a.seal[1],a.seal[2]),"
    "rec(1,'present','as-required','The flap is open.'),"
    "rec(2,'present','as-required','Red paper envelope.')],parentDrift:[]};"
    "process.stdout.write(JSON.stringify(C.normalizeEntityCandidateReview(parsed,{authorityMode:'validate',"
    "requiredHardChecks:['sameUnderlyingEntity','onlyRequestedDelta'],authoritySignature:'b2a-browser',"
    "declaredRequirements:a.requirements,driftComparisonAvailable:true,derivedState:true,parentStateName:'Sealed'})));"
)


def contract_review(seal):
    """What the real route would have returned, computed by the real contract."""
    proc = subprocess.run(["node", "-e", CONTRACT_SCRIPT,
                           json.dumps({"requirements": REQUIREMENTS, "seal": list(seal)})],
                          cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-b2a-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"

# The reviewer the operator has configured TODAY. Case E proves it never becomes
# the attribution of a review that ran under something else.
config = json.loads(config_path.read_text(encoding="utf-8"))
config["assistant"] = {**config.get("assistant", {}), "provider": "ollama", "visionProvider": "same"}
config["ollamaVisionModel"] = "settings-model-changed-since"
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

# The candidate has to exist on disk, or the workspace has no media row to open a
# review for. One byte in the sandbox's own project folder; nothing is generated.
active = config.get("activeProject") or next(p.name for p in sorted(projects_root.iterdir()) if p.is_dir())
props_dir = projects_root / active / "props"
props_dir.mkdir(parents=True, exist_ok=True)
(props_dir / CANDIDATE).write_bytes(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154"
    "789c6300010000050001"))

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

console_errors, page_errors, offsite, paid_calls, failed_requests, review_calls = [], [], [], [], [], []
findings = []
state = {"seal": ("absent", "not-applicable", "There is no wax seal on the envelope."),
         "reviewer": {"provider": "ollama", "model": "reviewer-that-actually-ran"}}

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
            if STATUS_ROUTE in url:
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "capabilities": {
                        # `standing` is what decides whether Vision may run; without it the
                        # record normalizes to "checking" and the review action stays off.
                        "vision": {"standing": "ready", "ready": True, "message": "", "action": ""},
                        "assistant": {"standing": "ready", "ready": True, "message": "", "action": ""},
                    },
                }))
            if REVIEW_ROUTE in url and route.request.method == "POST":
                review_calls.append(url)
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "review": contract_review(state["seal"]),
                    "state": {"id": STATE, "name": "Opened", "appliesTo": ""},
                    "relatedStates": [],
                    "inputLabels": [{"image": 1, "label": CANDIDATE, "role": "candidate under review"}],
                    "requiredHardChecks": ["sameUnderlyingEntity", "onlyRequestedDelta"],
                    "declaredRequirements": REQUIREMENTS,
                    "authorityMode": "validate",
                    "authoritySignature": "b2a-browser",
                    "reviewer": state["reviewer"],
                    "contractVersion": "reference-authority-v3",
                    "assistantAttempts": 1,
                }))
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)

        page.goto(f"{base}/#/settings", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.wait_for_timeout(800)
        page.evaluate("() => refreshAgentStatus(false)")

        # Written through the real client, so nothing bypasses the app's own
        # normalisation on the way in.
        page.evaluate("""async ([entityId, delta, candidate]) => {
            P.props = (P.props || []).filter((row) => row.id !== entityId);
            P.props.push({
                id: entityId, name: "The red envelope", prefix: entityId, status: "DRAFT",
                block: "A red paper envelope closed with a gold wax seal.", approvedFile: "",
                continuityStates: [
                    { id: "state-default", name: "Sealed", isDefault: true, approvedFile: "",
                      notes: "Red paper envelope, intact gold wax seal, flap closed." },
                    { id: "state-opened", name: "Opened", isDefault: false, parentStateId: "state-default",
                      approvedFile: "", notes: delta },
                ],
                candidateFiles: [{ stored: candidate, original: candidate, decision: "unreviewed",
                                   targetStateId: "state-opened", targetStateName: "Opened" }],
            });
            dirty();
            if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
        }""", [ENTITY, DELTA, CANDIDATE])
        page.wait_for_timeout(400)

        def run_review():
            """Drive the real review action, then reopen the real modal and read it."""
            page.evaluate("""([entityId, candidate, stateId]) => {
                window._entityCandidateReview = { list: "props", id: entityId, fileName: candidate, stateId, continueAction: "" };
            }""", [ENTITY, CANDIDATE, STATE])
            page.evaluate("() => runEntityCandidateVisionReview()")
            page.wait_for_timeout(1200)
            page.evaluate("""([entityId, candidate, stateId]) => openEntityCandidateReview("props", entityId, candidate, stateId)""",
                          [ENTITY, CANDIDATE, STATE])
            page.wait_for_selector(".entity-candidate-review-modal", timeout=15000)
            page.wait_for_timeout(200)
            return page.locator(".entity-candidate-review-modal").inner_html()

        def text_of(selector):
            node = page.locator(selector)
            return node.first.inner_text() if node.count() else ""

        # ---- B. the audit's own candidate: absent seal, 96/100 --------------
        markup = run_review()
        assert review_calls, "B: the real review action never reached the review route"
        assert not page_errors, f"B: the workspace raised uncaught errors: {page_errors}"
        overall = text_of(".entity-review-summary")
        assert "FLAG" in overall, f"B: the absent-seal candidate rendered as {overall!r}"
        assert "DECLARED STATE ISSUE" in overall, f"B: the semantic verdict is not in the overall result: {overall!r}"
        assert "All required gates passed" not in markup, "B: the audit's all-clear sentence is still reachable"

        declared = text_of(".entity-review-declared-state")
        assert "EXPECTED vs OBSERVED" in declared, "B: the declared-state panel is missing"
        assert "Wax seal broken but still present" in declared, "B: the declared expectation is not shown"
        assert "absent" in declared, "B: the observation is not shown beside it"
        assert "ISSUE" in declared, "B: the outcome word is not rendered"
        assert "must still be there to be in that condition" in declared, \
            "B: the modal does not explain why absence is not the requested change"
        findings.append("B: the 96/100 absent-seal candidate renders FLAG · DECLARED STATE ISSUE, with the declared "
                        "expectation beside the observed evidence, and the audit's all-clear is gone")

        # ---- D. the score is context, and comes after the verdict ------------
        assert "Supporting score 96/100" in markup, "D: the score must remain available as context"
        assert markup.index("DECLARED STATE ISSUE") < markup.index("Supporting score 96/100"), \
            "D: the score is rendered before the semantic verdict"
        assert "it cannot clear a declared requirement the candidate did not satisfy" in markup, \
            "D: the score is not stated to be subordinate"
        assert markup.index("entity-review-declared-state") < markup.index("entity-review-hard-checks"), \
            "D: the declared-state panel must lead the results column"
        findings.append("D: the score renders as supporting context after the semantic verdict and says in words "
                        "that it cannot clear a failed requirement")

        # ---- E. attribution is the reviewer that actually ran ----------------
        provenance = text_of(".entity-review-provenance")
        assert "reviewer-that-actually-ran" in provenance, f"E: the recorded reviewer is not shown: {provenance!r}"
        assert "settings-model-changed-since" not in markup, \
            "E: the currently configured model leaked into the attribution"
        findings.append("E: the modal attributes the review to the recorded 'ollama · reviewer-that-actually-ran', "
                        "not to the configured 'settings-model-changed-since'")

        state["reviewer"] = {"provider": "", "model": ""}
        markup = run_review()
        assert "Not recorded for this review" in markup, "E: a review with no recorded reviewer must say so"
        assert "settings-model-changed-since" not in markup, \
            "E: an unattributed review must not borrow the current Settings value"
        findings.append("E: a review that recorded no reviewer reads 'Not recorded for this review' and still "
                        "refuses to name the configured model")
        state["reviewer"] = {"provider": "ollama", "model": "reviewer-that-actually-ran"}

        # ---- C. unreadable evidence -------------------------------------------
        state["seal"] = ("present", "uncertain", "The seal region is behind a fold.")
        markup = run_review()
        overall = text_of(".entity-review-summary")
        assert "DECLARED STATE UNCERTAIN" in overall, f"C: unreadable evidence rendered as {overall!r}"
        assert "FLAG" in overall, "C: unreadable evidence must not read as a pass"
        declared = text_of(".entity-review-declared-state")
        assert "UNCERTAIN" in declared
        assert "condition could not be read" in declared, "C: the unreadable observation is not described"
        findings.append("C: an unreadable observation renders UNCERTAIN with the unread condition named, not a pass")

        # ---- A. the positive control -------------------------------------------
        state["seal"] = ("present", "as-required", "Gold wax seal, cracked in two.")
        markup = run_review()
        overall = text_of(".entity-review-summary")
        assert "PASS" in overall and "DECLARED STATE EXPECTED" in overall, \
            f"A: a satisfied derived state rendered as {overall!r}"
        assert "Every declared requirement was observed in the candidate." in markup
        assert "All authority-comparison gates passed" in markup, "A: the authority gates keep their own scoped answer"
        findings.append("A: a genuinely satisfied derived state renders PASS · DECLARED STATE EXPECTED")

        # ---- F. human approval is separate and still undecided ------------------
        human = text_of(".entity-review-human-decision")
        assert "HUMAN DECISION" in human and "NO HUMAN DECISION YET" in human, \
            f"F: the human decision panel is missing or pre-decided: {human!r}"
        assert "The AI result is advisory." in human, "F: the AI result must be stated as advisory"
        approved = page.evaluate("""([entityId]) => {
            const e = P.props.find((row) => row.id === entityId);
            return { state: e.continuityStates.find((s) => s.id === "state-opened").approvedFile,
                     entity: e.approvedFile, decision: e.candidateFiles[0].decision };
        }""", [ENTITY])
        assert approved == {"state": "", "entity": "", "decision": "unreviewed"}, \
            f"F: a passing AI review approved something by itself: {approved}"
        assert "APPROVE FOR OPENED" in markup, "F: the human approval control must still be offered"
        findings.append("F: after a passing AI review nothing is approved, the human decision reads "
                        "'NO HUMAN DECISION YET', and the approval control is still the filmmaker's to press")

        assert not page_errors, f"the audit raised uncaught errors: {page_errors}"
        assert not console_errors, f"the audit logged console errors: {console_errors}; failed: {failed_requests}"
        browser.close()

    assert not paid_calls, f"a paid route was called: {paid_calls}"
    assert not offsite, f"a request left this machine: {offsite}"

    print(f"{LABEL} passed: the candidate-review modal leads with the declared-state verdict, shows the declared "
          f"expectation beside the observed evidence, demotes the score to supporting context, attributes the review "
          f"to the reviewer that actually ran it, keeps approval human, and contacted no paid route "
          f"({len(review_calls)} reviews driven, 0 paid calls).")
    for line in findings:
        print(f"  - {line}")

finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
