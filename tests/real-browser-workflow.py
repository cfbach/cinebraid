#!/usr/bin/env python3
"""Optional real Chromium smoke test. Self-skips when Playwright/Chromium are unavailable."""
import copy, json, os, pathlib, shutil, socket, subprocess, sys, time, urllib.request, urllib.error, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = pathlib.Path(os.environ["CINEBRAID_SCREENSHOT_DIR"]) if os.environ.get("CINEBRAID_SCREENSHOT_DIR") else None
if SCREENSHOT_DIR: SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
def checkpoint(label):
    print(f"[browser] {label}", flush=True)
from browser_runtime import require_browser, launch_chromium, project_response, project_save
LABEL = "Real browser workflow"
sync_playwright = require_browser(LABEL)

def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port

def wait_server(port, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.3): return
        except OSError: time.sleep(.15)
    raise RuntimeError("CineBraid server did not start")

port = free_port()
env = dict(os.environ, PORT=str(port))
server = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
try:
    wait_server(port)
    project = json.loads((ROOT / "projects" / "cinebraid-sample" / "project.json").read_text())
    character_id = (project.get("characters") or [{}])[0].get("id", "")
    audit_project = copy.deepcopy(project)
    audit_character = copy.deepcopy((audit_project.get("characters") or [{}])[0])
    audit_character.update({
        "id": "CHAR-AUDIT",
        "prefix": "CHAR-AUDIT",
        "anchorPrefix": "CHAR-AUDIT",
        "name": "Nora Audit",
        "creationDescription": "A practical production reference preserving Nora's face, proportions, short dark hair, and work coveralls.",
        "approvedFile": "CHAR-AUDIT-PRIMARY.png",
        "continuityStates": [
            {"id": "state-default", "name": "Clean overall", "isDefault": True, "approvedFile": "CHAR-AUDIT-PRIMARY.png", "notes": "Primary identity and clean work coveralls."},
            {"id": "state-night", "name": "After the night's work", "isDefault": False, "approvedFile": "", "parentStateId": "state-default", "generationMode": "derive", "notes": "Coveralls are dirty and worn. Preserve identity, face, hair, proportions, and garment construction."},
        ],
        "coverageSlots": [
            {"id": "front", "label": "Front", "required": True, "approvedFile": "", "status": "missing"},
            {"id": "front-three-quarter", "label": "3/4 front", "required": True, "approvedFile": "", "status": "missing"},
            {"id": "profile", "label": "Profile", "required": True, "approvedFile": "", "status": "missing"},
            {"id": "rear", "label": "Rear", "required": True, "approvedFile": "", "status": "missing"},
        ],
        "candidateFiles": [
            {"stored": "CHAR-AUDIT-FRONT-A.png", "original": "CHAR-AUDIT-FRONT-A.png", "decision": "unreviewed", "targetStateId": "state-default", "targetCoverageSlotId": "front", "targetCoverageSlotName": "Front", "coverageGroup": "angles", "generationProvider": "fal"},
            {"stored": "CHAR-AUDIT-FRONT-B.png", "original": "CHAR-AUDIT-FRONT-B.png", "decision": "unreviewed", "targetStateId": "state-default", "targetCoverageSlotId": "front", "targetCoverageSlotName": "Front", "coverageGroup": "angles", "generationProvider": "fal"},
            {"stored": "CHAR-AUDIT-REAR.png", "original": "CHAR-AUDIT-REAR.png", "decision": "unreviewed", "targetStateId": "state-default", "targetCoverageSlotId": "rear", "targetCoverageSlotName": "Rear", "coverageGroup": "angles", "generationProvider": "fal"},
            {"stored": "CHAR-AUDIT-NIGHT.png", "original": "CHAR-AUDIT-NIGHT.png", "decision": "unreviewed", "targetStateId": "state-night", "targetStateName": "After the night's work", "generationProvider": "upload"},
            {"stored": "CHAR-AUDIT-SHEET.png", "original": "CHAR-AUDIT-SHEET.png", "decision": "unreviewed", "coverageJobType": "sheet", "coverageSheetType": "angles", "generationProvider": "fal"},
        ],
    })
    audit_project["characters"] = [audit_character]
    # The creator approved the primary reference. Since the closure pass that is
    # a statement about the RECEIPT LEDGER: derivation, prompt mode and every
    # approved/base role require canon, and a raw pointer is HISTORIC.
    audit_project["productionAuthority"] = {
        "version": 1,
        "receipts": [{
            "id": "authority-000001", "sequence": 1, "actor": "human", "act": "explicit-approval",
            "command": "approve-entity-state", "kind": "entity-state",
            "targetKey": "entity-state:characters:CHAR-AUDIT#state-default",
            "shotId": "", "frameId": "", "unitKey": "", "list": "characters",
            "entityId": "CHAR-AUDIT", "stateId": "state-default", "slotId": "",
            "value": "CHAR-AUDIT-PRIMARY.png", "assetId": "", "at": "2026-08-15T00:00:00.000Z",
            "status": "current", "supersededBy": "", "supersededAt": "", "revokedAt": "",
            "revocationReason": "", "note": "",
            "provenance": {"manualAction": "gesture-browser-fixture", "via": "real-browser-fixture", "gesture": "click"},
        }],
    }
    audit_shot = (audit_project.get("shots") or [{}])[0]
    audit_shot["characters"] = ["CHAR-AUDIT", "MISSING-CHAR"]
    audit_shot["creationBrief"] = {**(audit_shot.get("creationBrief") or {}), "locationId": "MISSING-LOC", "propIds": ["MISSING-PROP"], "vehicleIds": ["MISSING-VEH"]}
    audit_shot_id = audit_shot.get("id", "")
    tiny_image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%232a3038'/%3E%3C/svg%3E"
    audit_names = ["CHAR-AUDIT-PRIMARY.png", "CHAR-AUDIT-FRONT-A.png", "CHAR-AUDIT-FRONT-B.png", "CHAR-AUDIT-REAR.png", "CHAR-AUDIT-NIGHT.png", "CHAR-AUDIT-SHEET.png"]
    audit_scan = {"anchors": [{"name": name, "url": tiny_image} for name in audit_names], "plates": [], "props": [], "vehicles": [], "audio": [], "media": [], "shots": {}}
    audit_mode = {"enabled": False, "compiledProfile": ""}
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.evaluate("""() => {
          const data = new Map();
          const storage = {getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size;}};
          Object.defineProperty(window, 'localStorage', {value:storage, configurable:true});
          Object.defineProperty(window, 'sessionStorage', {value:storage, configurable:true});
        }""")
        upstream = f"http://127.0.0.1:{port}"
        base = "http://cinebraid.test"
        def proxy_local(route):
            request = route.request
            suffix = request.url[len(base):] if request.url.startswith(base) else "/"
            if audit_mode["enabled"]:
                if suffix == "/api/project" and request.method == "GET":
                    body, headers = project_response(audit_project, "audit-fixture")
                    route.fulfill(status=200, headers=headers, body=body)
                    return
                if suffix == "/api/scan" and request.method == "GET":
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(audit_scan))
                    return
                # THE SAVE THE PAGE REALLY MAKES is slug-scoped and carries If-Match;
                # /api/project is never written to. Answered through the shared seam
                # stub so an accepted write commits and publishes its new revision.
                if suffix in ("/api/projects/audit-fixture/project",
                              "/api/projects/audit-fixture/canon-transition"):
                    status, body, headers = project_save(audit_project, "audit-fixture", request)
                    route.fulfill(status=status, headers=headers, body=body)
                    return
                if suffix == "/api/agents/status":
                    # `standing` is the authority every browser consumer reads; `ready` is
                    # the legacy field the record still carries. A fixture that omits the
                    # standing describes a record the server does not send, and is read as
                    # "checking" rather than as ready.
                    ready = {"standing": "ready", "ready": True, "label": "Vision assistance", "provider": "ollama", "model": "fixture-model", "message": "Ready", "action": ""}
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"enabled": True, "manualMode": False, "active": 0, "queued": 0, "maxConcurrent": 2, "capabilities": {"text": ready, "verifier": ready, "vision": ready, "embedding": ready, "technical": ready}, "agents": [], "runs": [], "index": {"ready": True, "stale": False}}))
                    return
                if suffix == "/api/system/health":
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"assistant": {"provider": "ollama", "configured": True, "label": "Local AI"}, "ollama": {"ok": True, "models": ["fixture-model"], "plannerReady": True, "visionReady": True, "embeddingReady": True}, "ffmpeg": {"ok": True}}))
                    return
                if suffix.startswith("/api/automation/runs/") and suffix.endswith("/archive") and request.method == "POST":
                    run_id = suffix.split("/")[-2]
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"run": {"id": run_id, "status": "archived", "updatedAt": "2026-07-30T22:00:00Z"}}))
                    return
                if suffix == "/api/llm/review-entity-candidate" and request.method == "POST":
                    payload = json.loads(request.post_data or "{}")
                    filename = payload.get("fileName", "")
                    if filename == "CHAR-AUDIT-REAR.png":
                        route.fulfill(status=500, content_type="application/json", body=json.dumps({"error": "Malformed vision result"}))
                        return
                    scores = {"CHAR-AUDIT-FRONT-A.png": (88, True), "CHAR-AUDIT-FRONT-B.png": (91, True), "CHAR-AUDIT-NIGHT.png": (84, True), "CHAR-AUDIT-SHEET.png": (90, True), "CHAR-AUDIT-IMPORTED-PROFILE.png": (93, True)}
                    score, passed = scores.get(filename, (72, False))
                    required = ["sameUnderlyingEntity", "requestedViewCorrect"] if "PROFILE" in filename or "FRONT" in filename or "REAR" in filename else ["sameUnderlyingEntity", "onlyRequestedDelta"]
                    hard_checks = {key: {"pass": passed, "note": "Matches the approved authority." if passed else "Authority mismatch."} for key in required}
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"contractVersion": "reference-authority-v3", "authoritySignature": "browser-authority", "review": {"contractVersion": "reference-authority-v3", "authoritySignature": "browser-authority", "score": score, "pass": passed, "modelPass": passed, "explicitPass": True, "explicitScore": True, "autoApprove": passed, "summary": "Meets the target." if passed else "Needs correction.", "requiredHardChecks": required, "hardChecks": hard_checks, "hardGateFailures": [] if passed else required, "categories": {}}, "inputLabels": [{"image": 1, "fileName": filename, "role": "candidate under review"}, {"image": 2, "fileName": "CHAR-AUDIT-PRIMARY.png", "role": "primary identity / design authority"}]}))
                    return
                if suffix == "/api/prompt/asset-compile" and request.method == "POST":
                    payload = json.loads(request.post_data or "{}")
                    audit_mode["compiledProfile"] = payload.get("profileId", "")
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"compiledPrompt": "Edit the approved parent reference so only the coveralls become dirty and worn. Preserve identity and proportions.", "profile": {"id": payload.get("profileId", ""), "name": "GPT Image 2 — Reference Edit", "profileVersion": "browser-test"}, "state": {"generationMode": "derive", "parentStateId": "state-default", "parentStateName": "Clean overall"}, "warnings": [], "confirmations": [], "spec": {}, "providerPayload": None, "llmUsed": False}))
                    return
            target = upstream + (suffix or "/")
            headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "connection", "content-length", "accept-encoding"}}
            data = request.post_data_buffer if request.method not in {"GET", "HEAD"} else None
            req = urllib.request.Request(target, data=data, headers=headers, method=request.method)
            try:
                with urllib.request.urlopen(req, timeout=30) as response:
                    body = response.read()
                    response_headers = {k: v for k, v in response.headers.items() if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
                    route.fulfill(status=response.status, headers=response_headers, body=body)
            except urllib.error.HTTPError as error:
                body = error.read()
                response_headers = {k: v for k, v in error.headers.items() if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
                route.fulfill(status=error.code, headers=response_headers, body=body)
            except Exception as error:
                route.abort("failed")
                raise error
        page.route(base + "/**", proxy_local)
        with urllib.request.urlopen(upstream + "/", timeout=30) as response:
            index_html = response.read().decode("utf-8")
        index_html = re.sub(r'<link[^>]+href=["\']https?://[^>]+>', '', index_html)
        index_html = index_html.replace("<head>", f'<head><base href="{base}/">', 1)
        page.set_content(index_html, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(800)
        def open_hash(hash_value):
            page.evaluate("value => { location.hash = value; window.dispatchEvent(new HashChangeEvent('hashchange')); }", hash_value)
            page.wait_for_timeout(350)
            page.wait_for_selector("#main")

        def open_coverage_detail():
            """BATCH 2 SLICE 3. `Production needs` leads with the demand
            list and keeps the angle / expression / continuity-state boards behind a
            toggle, so that the schema's full catalogue of conceivable coverage is not
            dumped on the filmmaker by default. A suite that drives those boards has to
            open it the way a filmmaker would — by clicking, and then waiting for the
            boards it asked for rather than for a fixed delay."""
            detail = page.locator(".entity-coverage-detail")
            if not detail.count():
                return
            if detail.first.get_attribute("data-coverage-detail-open") != "1":
                page.locator(".entity-coverage-detail-toggle").first.click()
            page.wait_for_selector('.entity-coverage-detail[data-coverage-detail-open="1"]', timeout=10000)
        checkpoint("initial board")
        open_hash("#/shots/board")
        assert page.locator(".slate").count() <= 40, "shot overview rendered more than 40 cards"
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 2, f"desktop shot overview overflowed by {overflow}px"

        open_hash("#/reports")
        assert page.locator(".reports-run-row").count() <= 50, "Reports rendered more than 50 history rows"

        if character_id:
            open_hash(f"#/character/{character_id}")
            page.wait_for_selector(".bounded-entity-page")
            assert page.locator(".entity-candidate-card").count() <= 12, "reference page rendered more than 12 candidates"
            # AMENDED BY BATCH 2 SLICE 3: the coverage workspace is stated as a
            # production demand now, and its detail boards sit behind a disclosure.
            coverage = page.locator(".bounded-entity-taskbar button", has_text="Production needs")
            if coverage.count():
                coverage.first.click()
                page.wait_for_timeout(250)
                open_coverage_detail()
                assert page.locator(".coverage-slot-card").count() <= 1, "more than one complete coverage editor exists"

        checkpoint("base routes complete")
        audit_mode["enabled"] = True
        ready_capability = {"standing": "ready", "ready": True, "label": "Ready", "provider": "ollama", "model": "fixture-model", "message": "Ready", "action": ""}
        # OPENED THROUGH THE SHIPPED LIFECYCLE, NOT ASSIGNED OVER.
        #
        # This used to install the fixture by writing P, SCAN and ACTIVE_PROJECT_SLUG
        # directly, which skips the one step that teaches the page WHICH DOCUMENT it is
        # showing: runProjectReplacement() reads /api/project and commits the slug and
        # revision the server published. Without that PROJECT_REVISION stays empty, and
        # the first edit this suite makes is refused by the Authority Write Seam behind a
        # modal that then intercepts every later click. The audit routes are already
        # stubbed above, so the shipped open reads exactly this fixture -- and the seam
        # is satisfied by the precondition it is entitled to, not bypassed.
        page.evaluate("""async payload => {
          localStorage.clear(); sessionStorage.clear();
          AGENT_STATUS = {enabled:true,manualMode:false,active:0,queued:0,maxConcurrent:2,capabilities:{text:payload.ready,verifier:payload.ready,vision:payload.ready,embedding:payload.ready,technical:payload.ready},agents:[],runs:[],index:{ready:true,stale:false}};
          await runProjectReplacement();
          location.hash = '#/character/CHAR-AUDIT';
          await route();
        }""", {"ready": ready_capability})
        page.wait_for_timeout(250)
        page.wait_for_selector(".bounded-entity-page", timeout=5000)
        checkpoint("audit character loaded")
        # AMENDED BY BATCH 2 SLICE 3: candidate review is contextual to the reference
        # that owns it rather than a peer stage, so the task that carries the
        # candidate grid is Primary reference.
        candidates_task = page.locator(".bounded-entity-taskbar button", has_text=re.compile(r"Primary reference", re.I))
        assert candidates_task.count(), "audit candidate task is missing"
        candidates_task.first.click()
        page.wait_for_timeout(300)
        assert page.locator(".entity-candidate-filters button", has_text="Primary / State").count(), "candidate workflow filters are missing"
        assert page.locator(".entity-candidate-filters button", has_text="Coverage Views").count(), "coverage workflow filter is missing"
        optional_batch = page.locator("details.manual-optional-batch-review")
        if optional_batch.count():
            optional_batch.first.evaluate("node => node.open = true")
            page.wait_for_timeout(100)
        assert page.locator(".entity-batch-review-actions button", has_text="REVIEW ALL VISIBLE").count(), "Review All Visible is missing from optional AI tools"
        front_card = page.locator('.entity-candidate-card[data-candidate-file="CHAR-AUDIT-FRONT-A.png"]')
        assert front_card.get_by_text("ASSIGN TO FRONT", exact=True).count(), "manual-first coverage candidate did not expose direct human assignment"
        # THE ROUTE, NOT THE LABEL. entities.js gives an APPROVED candidate the
        # "OPTIONAL AI CHECK" chip; an unreviewed one -- which this is, its actions
        # being REVIEW / ASSIGN TO FRONT / REJECT -- reaches the very same
        # openEntityCandidateReview() through REVIEW. The claim is that a
        # vision-capable candidate keeps a way into optional AI evidence, so it is
        # read off the control that offers it rather than off the approved card's word.
        review_route = front_card.locator("button.candidate-review-action, button.optional-ai-action")
        assert review_route.count() >= 1, \
            "vision-capable candidate did not retain optional AI evidence"
        assert "openEntityCandidateReview" in (review_route.first.get_attribute("onclick") or ""), \
            "the candidate's review control does not open the AI review surface"
        page.locator(".entity-batch-review-actions button", has_text="REVIEW ALL VISIBLE").click()
        page.wait_for_function("() => { const e=(P.characters||[]).find(x=>x.id==='CHAR-AUDIT'); return e?.candidateReviewBatches?.at(-1)?.status === 'partial'; }", timeout=15000)
        optional_batch = page.locator("details.manual-optional-batch-review")
        if optional_batch.count():
            optional_batch.first.evaluate("node => node.open = true")
            page.wait_for_timeout(100)
        assert page.get_by_text("CHAR-AUDIT-FRONT-B.png · 91", exact=True).count(), "batch shortlist did not rank the strongest Front candidate"
        assert page.get_by_text("No passing candidate", exact=True).count(), "failed Rear review did not survive as an explicit no-pass shortlist result"
        batch_state = page.evaluate("() => { const e=P.characters.find(x=>x.id==='CHAR-AUDIT'); const r=e.candidateReviewBatches.at(-1); return {status:r.status,total:r.total,completed:r.completed,failed:r.failed}; }")
        assert batch_state == {"status": "partial", "total": 5, "completed": 5, "failed": 1}, f"unexpected real-browser batch state: {batch_state}"

        checkpoint("batch review complete")
        coverage_task = page.locator(".bounded-entity-taskbar button", has_text="Production needs")
        assert coverage_task.count(), "Production needs workspace is missing"
        coverage_task.first.click()
        page.wait_for_timeout(250)
        open_coverage_detail()
        states_tab = page.locator(".entity-subworkspace-tabs button", has_text="Continuity states")
        assert states_tab.count(), "Continuity states subworkspace is missing"
        states_tab.first.click()
        page.wait_for_timeout(300)
        state_panel = page.locator('.entity-state-generation[data-entity-state-generation="state-night"]')
        assert state_panel.count(), "derived continuity-state panel is missing"
        # Manual-first keeps assisted state creation collapsed until deliberately opened.
        state_panel.evaluate("node => { node.open = true; node.dispatchEvent(new Event('toggle')); }")
        page.wait_for_timeout(100)
        assert state_panel.locator("option:checked", has_text="GPT Image 2 — Reference Edit").count(), "derived state did not default to the edit/reference profile"
        state_panel.get_by_text("Build state prompt", exact=True).click()
        page.wait_for_selector('.entity-state-generation[data-entity-state-generation="state-night"] .entity-state-prompt-result', timeout=10000)
        assert audit_mode["compiledProfile"] == "gpt-image-2/edit", f"real-browser state prompt compiled with {audit_mode['compiledProfile']}"
        assert page.locator('[data-entity-continuity="characters:CHAR-AUDIT"][open]').count(), "Continuity States collapsed after prompt build"
        assert page.locator('[data-entity-state-generation="state-night"][open]').count(), "selected state generation panel collapsed after prompt build"
        checkpoint("state prompt complete")
        page.evaluate("""() => {
          const entity=P.characters.find(x=>x.id==='CHAR-AUDIT');
          entity.candidateFiles.push({stored:'CHAR-AUDIT-IMPORTED-PROFILE.png',original:'CHAR-AUDIT-IMPORTED-PROFILE.png',decision:'unreviewed'});
          SCAN.anchors.push({name:'CHAR-AUDIT-IMPORTED-PROFILE.png',url:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='48'%3E%3Crect width='32' height='48' fill='%23343c44'/%3E%3C/svg%3E"});
        }""")
        page.evaluate("route()")
        page.wait_for_timeout(250)
        coverage_task = page.locator(".bounded-entity-taskbar button", has_text="Production needs")
        coverage_task.first.click()
        page.wait_for_timeout(250)
        open_coverage_detail()
        angles_tab = page.locator(".entity-subworkspace-tabs button", has_text="Angles / views")
        if angles_tab.count():
            angles_tab.first.click()
            page.wait_for_timeout(200)
        assert page.get_by_text("AI CHECK PASSED · HUMAN ASSIGNMENT REQUIRED", exact=True).count(), "passing coverage reviews were not surfaced as awaiting explicit slot assignment"
        page.get_by_text("Map imported references", exact=True).click()
        page.wait_for_selector("#import-reference-file")
        if SCREENSHOT_DIR:
            page.screenshot(path=str(SCREENSHOT_DIR / "map-imported-reference.png"), full_page=False)
        page.locator("#import-reference-file").select_option("CHAR-AUDIT-IMPORTED-PROFILE.png")
        page.locator("#import-reference-target").select_option("coverage:profile")
        page.get_by_text("MAP FOR OPTIONAL AI CHECK", exact=True).click()
        page.wait_for_selector(".entity-candidate-review-modal")
        # THE CONTROL IS BRAIDY'S NOW. `RUN AI REVIEW` was retired when the review
        # surface started naming who is being asked and stating it above the empty
        # result; tests/reference-ux-convergence.js already asserts the current words,
        # so this reads the same control it does rather than a second vocabulary.
        page.locator("button", has_text=re.compile(r"^Review with Braidy", re.I)).first.click()
        page.wait_for_function("() => P.characters.find(x=>x.id==='CHAR-AUDIT').coverageSlots.find(x=>x.id==='profile').selectedFile === 'CHAR-AUDIT-IMPORTED-PROFILE.png'", timeout=10000)
        # BATCH 1C: a coverage slot is a supporting reference, so committing one
        # records a SELECTION. The old expectation, "approved-coverage", asserted
        # that a view is production authority - the semantics alpha removed.
        # The assignment itself is unchanged and is proved by the wait above.
        assert page.evaluate("() => P.characters.find(x=>x.id==='CHAR-AUDIT').candidateFiles.find(x=>x.stored==='CHAR-AUDIT-IMPORTED-PROFILE.png').decision") == "selected-coverage", "mapped imported reference was reviewed but not selected for its slot"
        if SCREENSHOT_DIR:
            page.screenshot(path=str(SCREENSHOT_DIR / "imported-profile-assigned.png"), full_page=False)
        checkpoint("imported reference mapping complete")
        assert page.locator(".entity-authority-label").count(), "authority label structure is missing"
        assert page.locator(".entity-authority-status").count(), "authority status structure is missing"
        assert "APPROVED AUTHORITY1/" not in page.locator("body").inner_text(), "authority label and state count still run together"
        if SCREENSHOT_DIR:
            page.set_viewport_size({"width": 390, "height": 844})
            page.evaluate("""() => {
              document.body.classList.remove('rail-open');
              const rail=document.getElementById('rail'); if(rail) rail.style.display='none';
              const toast=document.getElementById('toast'); if(toast) toast.style.display='none';
              window.scrollTo(0, 0);
            }""")
            authority_summary = page.locator("#main .entity-authority-summary").first
            authority_summary.evaluate("node => node.scrollIntoView({block:'center',inline:'start'})")
            page.evaluate("() => window.scrollTo(0, window.scrollY)")
            authority_summary.screenshot(path=str(SCREENSHOT_DIR / "authority-header-mobile.png"))
            page.set_viewport_size({"width": 1600, "height": 1000})
            page.evaluate("() => { const rail=document.getElementById('rail'); if(rail) rail.style.removeProperty('display'); }")

        checkpoint("authority typography checked")
        if audit_shot_id:
            checkpoint("opening audit shot")
            page.evaluate("""shotId => {
              localStorage.setItem(`cinebraid-focused:audit-fixture:shot-task:${shotId}`, 'inputs');
              location.hash = `#/shot/${shotId}`;
            }""", audit_shot_id)
            page.wait_for_timeout(400)
            checkpoint("audit shot route requested")
            page.wait_for_selector(".guided-unresolved-dependencies", timeout=5000)
            checkpoint("audit shot unresolved panel loaded")
            if SCREENSHOT_DIR:
                page.evaluate("""() => {
                  AUTOMATION_RUNS=[]; FAL_GENERATION_JOBS=[];
                  document.body.classList.remove('rail-open');
                  v641UpdateActivityButton();
                  const toast=document.getElementById('toast'); if(toast) toast.classList.add('hidden');
                  const panel=document.querySelector('#main .guided-unresolved-dependencies');
                  const details=panel?.closest('details'); if(details) details.open=true;
                }""")
                page.set_viewport_size({"width": 390, "height": 844})
                unresolved_panel = page.locator("#main .guided-unresolved-dependencies").first
                unresolved_panel.scroll_into_view_if_needed()
                unresolved_panel.screenshot(path=str(SCREENSHOT_DIR / "unresolved-shot-inputs-mobile.png"))
                page.set_viewport_size({"width": 1600, "height": 1000})
                unresolved_panel = page.locator("#main .guided-unresolved-dependencies").first
                unresolved_panel.scroll_into_view_if_needed()
                unresolved_panel.screenshot(path=str(SCREENSHOT_DIR / "unresolved-shot-inputs-desktop.png"))
            for missing_id in ("MISSING-CHAR", "MISSING-LOC", "MISSING-PROP", "MISSING-VEH"):
                assert page.locator(f'[data-unresolved-dependency="{missing_id}"]').count(), f"Shot Inputs hid unresolved relationship {missing_id}"
            missing_char = page.locator('[data-unresolved-dependency="MISSING-CHAR"]')
            missing_char.get_by_text("Relink", exact=True).click()
            page.wait_for_selector("#shot-dependency-replacement")
            page.locator("#shot-dependency-replacement").select_option("CHAR-AUDIT")
            page.get_by_text("Relink", exact=True).last.click()
            page.wait_for_timeout(350)
            assert page.locator('[data-unresolved-dependency="MISSING-CHAR"]').count() == 0, "Relink did not remove the stale relationship row"
            assert page.evaluate("shotId => P.shots.find(row=>row.id===shotId).characters.includes('CHAR-AUDIT')", audit_shot_id), "Relink did not update shot data"
            missing_prop = page.locator('[data-unresolved-dependency="MISSING-PROP"]')
            missing_prop.get_by_text("Remove", exact=True).click()
            page.wait_for_selector("#modal:not(.hidden)")
            page.get_by_text("REMOVE", exact=True).click()
            page.wait_for_timeout(350)
            assert page.locator('[data-unresolved-dependency="MISSING-PROP"]').count() == 0, "Remove did not clear the stale relationship row"
            for link in page.locator(".shot-head-nav a").all():
                label = link.get_attribute("aria-label") or ""
                assert len(label) > 3 and "shot" in label.lower(), f"shot navigation glyph lacks a meaningful name: {label!r}"

        checkpoint("orphan repair complete")
        page.evaluate("""() => {
          AUTOMATION_RUNS=[{id:'obsolete-reference-failure',type:'entity-chain',targetId:'props:PROP-MURAL',label:'Obsolete mural failure',status:'failed',stage:'Needs attention',summary:'Old prompt was not built',updatedAt:'2026-07-30T20:00:00Z',steps:{prompt:{key:'prompt',kind:'prompt',status:'failed',error:'Old prompt was not built'}}}];
          v641UpdateActivityButton();
          window.CineBraidCreatorSurfaces.expandTerminal();
          window.CineBraidCreatorSurfaces.paint();
        }""")
        page.wait_for_selector('[data-activity-key="run:obsolete-reference-failure"]')
        # THE TOPBAR SIGNAL AND THE TERMINAL MUST AGREE. The retired drawer's setup line
        # refreshed the chip and then rendered the drawer; only the drawer half was ever
        # asserted. Both halves are checked now, because the chip is the one persistent
        # global indicator and a chip that disagreed with the ledger would be the defect
        # the single-owner rule exists to prevent.
        signal = page.evaluate("""() => {
          const chip = document.getElementById('automation-activity-toggle');
          const rows = [...document.querySelectorAll('.cb-terminal-row')];
          return {
            chipLabel: (chip.textContent || '').trim(),
            chipTitle: chip.getAttribute('title') || '',
            attentionRows: rows.filter((row) => row.dataset.cbKind === 'needs-attention').length,
            terminalMounted: !!document.getElementById('cb-terminal-mount'),
            overlayDrawer: !!document.getElementById('automation-activity-drawer'),
          };
        }""")
        assert signal["terminalMounted"], "the Activity Terminal must be the surface carrying the alert"
        assert not signal["overlayDrawer"], \
            "Activity must not have become an overlay drawer again"
        assert signal["attentionRows"] >= 1, \
            f"the obsolete failure must appear in the Terminal's attention bucket, got {signal}"
        assert "Idle" not in signal["chipTitle"], \
            f"the topbar signal must not read Idle while a run needs attention: {signal['chipTitle']!r}"
        if SCREENSHOT_DIR:
            page.screenshot(path=str(SCREENSHOT_DIR / "dismiss-obsolete-alert.png"), full_page=False)
        page.locator('[data-activity-key="run:obsolete-reference-failure"]').get_by_text("DISMISS", exact=True).click()
        page.wait_for_function("() => AUTOMATION_RUNS.find(x=>x.id==='obsolete-reference-failure')?.status === 'archived'", timeout=5000)
        assert page.locator('[data-activity-key="run:obsolete-reference-failure"]').count() == 0, \
            "dismissed obsolete alert remained in the Activity Terminal"
        checkpoint("obsolete activity alert dismissed")
        audit_mode["enabled"] = False

        # ESCAPE NO LONGER CLOSES ACTIVITY, AND THAT IS THE DECISION. The drawer was a
        # modal overlay, so Escape dismissed it. The Terminal is a persistent dock: Escape
        # belongs to whatever modal is actually open, and a persistent surface that
        # vanished on a keystroke meant for a dialog would be a surprise. What must hold
        # is that Escape leaves it alone.
        toggle = page.locator("#automation-activity-toggle")
        if toggle.count():
            page.evaluate("() => window.CineBraidCreatorSurfaces.expandTerminal()")
            page.wait_for_timeout(100)
            page.keyboard.press("Escape")
            page.wait_for_timeout(150)
            assert page.locator(".cb-terminal-rows").count() == 1, \
                "Escape must not collapse the persistent Activity Terminal"

        checkpoint("activity terminal keyboard complete")
        def activity_overlap_count():
            # THE ONE PERSISTENT GLOBAL INDICATOR. The floating strip was retired in Batch
            # 2 Slice 1; the topbar chip is what remains, and the property this measured -
            # the persistent activity indicator must never cover the filmmaker's work - is
            # asserted of the chip instead, at the same three widths and five routes.
            return page.evaluate("""() => {
              const strip=document.getElementById('automation-activity-toggle');
              if(!strip || strip.hidden) return 0;
              const a=strip.getBoundingClientRect();
              const nodes=[...document.querySelectorAll('#main button,#main a,#main input,#main textarea,#main select,#main summary,#main p,#main span,#main b,#main small,#main h1,#main h2,#main h3')]
                .filter(node=>{ const s=getComputedStyle(node), r=node.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0; });
              return nodes.filter(node=>{ const b=node.getBoundingClientRect(); return Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1; }).length;
            }""")

        checkpoint("responsive activity checks starting")
        responsive_routes = [
            ("Production", "#/production"),
            ("Shot", f"#/shot/{audit_shot_id}"),
            ("Reference", "#/character/CHAR-AUDIT"),
            ("Reports", "#/reports"),
            ("Settings", "#/settings"),
        ]
        for width in (1600, 768, 390):
            page.set_viewport_size({"width": width, "height": 900})
            for route_label, route_hash in responsive_routes:
                open_hash(route_hash)
                page.evaluate("() => { AUTOMATION_RUNS=[]; FAL_GENERATION_JOBS=[]; v641UpdateActivityButton(); }")
                idle_text = page.locator("#automation-activity-toggle").inner_text()
                assert "Idle" in idle_text, f"the idle Activity chip must say so on {route_label} at {width}px, got {idle_text!r}"
                assert page.locator("#automation-global-live-strip").count() == 0, \
                    f"the retired floating Activity strip must not exist on {route_label} at {width}px"
                manual_id = page.evaluate("() => v641StartManualActivity('LOCAL AI','Acceptance activity','Preparing a prompt')")
                page.wait_for_timeout(75)
                active_text = page.locator("#automation-activity-toggle").inner_text()
                assert "Idle" not in active_text, f"the active Activity chip still read idle on {route_label} at {width}px"
                assert activity_overlap_count() == 0, f"the Activity chip overlapped {route_label} controls or text at {width}px"
                if SCREENSHOT_DIR and width == 390 and route_label == "Production":
                    page.evaluate("() => { document.body.classList.remove('rail-open'); const toast=document.getElementById('toast'); if(toast) toast.style.display='none'; }")
                    page.screenshot(path=str(SCREENSHOT_DIR / "activity-docked-production-mobile.png"), full_page=False)
                overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                assert overflow <= 2, f"{route_label} at {width}px overflowed by {overflow}px"
                page.evaluate("id => { const old=setTimeout; window.setTimeout=()=>0; v641FinishManualActivity(id,'completed','Done'); window.setTimeout=old; }", manual_id)
                assert "Idle" in page.locator("#automation-activity-toggle").inner_text(), \
                    f"the Activity chip did not return to idle on {route_label} at {width}px"

        page.set_viewport_size({"width": 390, "height": 900})
        open_hash("#/settings")
        global_style = page.locator('textarea[onchange*="globalStylePrompt"]')
        if global_style.count():
            label = global_style.first.get_attribute("aria-label") or global_style.first.get_attribute("id") or ""
            assert label, "global visual style textarea has no accessible name"
        cdp = page.context.new_cdp_session(page)
        ax_nodes = cdp.send("Accessibility.getFullAXTree").get("nodes", [])
        unnamed_settings = []
        for node in ax_nodes:
            if node.get("ignored"):
                continue
            role = (node.get("role") or {}).get("value", "")
            name = (node.get("name") or {}).get("value", "")
            if role in {"textbox", "combobox"} and not str(name).strip():
                unnamed_settings.append(role)
        assert not unnamed_settings, f"Settings accessibility tree contains unnamed controls: {unnamed_settings}"
        if SCREENSHOT_DIR:
            page.evaluate("() => { document.body.classList.remove('rail-open'); const toast=document.getElementById('toast'); if(toast) toast.style.display='none'; }")
            page.screenshot(path=str(SCREENSHOT_DIR / "settings-mobile.png"), full_page=True)
        checkpoint("all assertions complete")
        browser.close()
    print("Real Chromium workflow passed bounded rendering, repaired continuity-state prompt generation, strict review gating, bounded partial batch review, imported-reference mapping and exact slot assignment, unresolved relationship relink/removal, obsolete alert dismissal, authority typography, accessible shot navigation, active-only docked Activity at desktop/tablet/mobile widths, Activity keyboard close, and overflow checks.")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    if server.returncode not in (0, -15, None):
        err = server.stderr.read() if server.stderr else ""
        if err: print(err, file=sys.stderr)
