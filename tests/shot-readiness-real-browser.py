#!/usr/bin/env python3
"""Shot readiness and Historic confirmation, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. Everything semantic about the derivation is proven
in Node by tests/shot-readiness.js and its negative controls. Three claims cannot
be, and each has cost this repository a defect before:

  1. THE MODULE ACTUALLY LOADS. Every public/*.js shares one lexical scope, so a
     duplicate top-level `const` between two of them is a SyntaxError that blanks
     the WHOLE product - and no Node suite can see it, because Node has no shared
     scope. shared-shot-readiness.js is a new file in that scope and app.js gained
     new top-level declarations beside it.

  2. THE CONFIRMATION IS A REAL HUMAN GESTURE. The authority kernel scopes Canon to
     the EVENT CURRENTLY BEING DISPATCHED - not to a span of time - and refuses
     anything whose `event.isTrusted !== true`. A Node harness supplies its own
     event target, so it can only prove the rule is obeyed by a composition it
     controls. Only a real user agent can prove a real click writes a receipt.

  3. THE REFUSAL IS REAL TOO. This suite carries its own NEGATIVE CONTROL: the same
     kernel command, called from page script outside any trusted event, must be
     refused. Without it, "the button worked" could pass on a build where the
     gesture check had stopped working entirely.

It also proves the fourth thing a surface must do: after a confirmation, readiness
RECALCULATES FROM CURRENT TRUTH rather than from whatever it rendered a moment ago.

NOTHING HERE IS PAID. Config and projects live in a temporary directory reached
through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped
sample are never touched; the route guard aborts the paid route and anything
off-loopback.
"""

import os, pathlib, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Shot readiness real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"

page_errors, offsite, paid_calls = [], [], []
findings = []


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-shot-readiness-"))
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
        page.goto(f"{base}/#/production", wait_until="domcontentloaded")
        page.wait_for_selector(".production-readiness", timeout=20000)
        page.wait_for_timeout(500)
        assert not page_errors, f"the production view raised uncaught errors: {page_errors}"

        # ---- 1. THE MODULE IS LOADED, AND THE SHARED SCOPE SURVIVED IT ---------------
        loaded = page.evaluate("""() => ({
            evaluate: typeof window.evaluateProjectReadiness,
            queue: typeof window.historicConfirmationQueue,
            predicate: typeof window.productionInputSatisfaction,
            statuses: (window.SHOT_READINESS_STATUSES || []).slice(),
            methods: (window.ANIMATE_METHODS || []).slice(),
            app: typeof window.route,
            kernel: typeof (window.CineBraidAuthorityKernel || {}).approveEntityStateCanon,
        })""")
        assert loaded["evaluate"] == "function", "shared-shot-readiness.js did not load in the browser"
        assert loaded["queue"] == "function" and loaded["predicate"] == "function", \
            f"the readiness exports are incomplete in the page: {loaded}"
        assert loaded["app"] == "function", \
            "the app itself did not load - a duplicate top-level declaration would blank the shared scope"
        assert loaded["statuses"] == ["READY", "BLOCKED", "NEEDS_DECISION"], \
            f"the browser received an unexpected status vocabulary: {loaded['statuses']}"
        assert loaded["methods"], "the method probe set is empty in the browser, so resolveTaskModes did not load first"
        findings.append(f"1. module loaded in Chromium; methods={'/'.join(loaded['methods'])}")

        # ---- 2. THE FEED AND THE DEDUPLICATED QUEUE RENDER ----------------------------
        before = page.evaluate("""() => {
            const feed = evaluateProjectReadiness(P, {
                mediaListing: (list) => entityMediaPool(list),
                shotMediaListing: (id) => takesFor(id),
            });
            return {
              counts: feed.counts,
              unique: feed.historic.uniqueTargets,
              occurrences: feed.historic.occurrences,
              statuses: feed.shots.map(s => s.status),
              rows: [...document.querySelectorAll('.historic-confirm-list > li')].length,
              feedRows: [...document.querySelectorAll('.shot-readiness-list > a')].length,
              firstStatus: document.querySelector('.shot-readiness-list .readiness-status')?.textContent || '',
            };
        }""")
        assert before["unique"] > 0, "the demo project should have unconfirmed Historic selections"
        assert before["occurrences"] > before["unique"], \
            f"deduplication should collapse occurrences: {before['occurrences']} -> {before['unique']}"
        assert before["rows"] == before["unique"], \
            f"the surface must render one row per unique authority target: {before['rows']} vs {before['unique']}"
        assert before["feedRows"] == len(before["statuses"]), "every shot appears in the readiness feed"
        assert "·" in before["firstStatus"], \
            f"a status must never render without the action it is the status of: {before['firstStatus']!r}"
        findings.append(
            f"2. feed rendered: {before['occurrences']} requirements -> {before['unique']} confirmations, "
            f"counts={before['counts']['ready']}R/{before['counts']['blocked']}B/{before['counts']['needsDecision']}D")

        # ---- 2b. THE PAGE LEADS WITH THE NEXT ACTION, NOT WITH THE BACKLOG ------------
        #
        # The confirmation queue is administration: real, required, and not what a
        # filmmaker opens a production page to read. It used to ship expanded, above the
        # NEXT ACTION card, so four rows of it owned the first viewport while the one
        # thing to do next sat below the fold. Nothing was removed to fix that -- the
        # card moved up and the queue ships behind its own summary line.
        #
        # Measured against the real fold, not against source order.
        hierarchy = page.evaluate(r"""() => {
            const box = (sel) => {
                const n = document.querySelector(sel);
                if (!n) return null;
                const b = n.getBoundingClientRect();
                return { top: Math.round(b.top + window.scrollY), height: Math.round(b.height) };
            };
            const backlog = document.querySelector('.historic-confirm');
            return {
                next: box('.production-next'),
                backlog: box('.historic-confirm'),
                backlogOpen: backlog ? backlog.open : null,
                summary: backlog ? backlog.querySelector('summary').textContent.replace(/\s+/g, ' ').trim() : '',
                rows: document.querySelectorAll('.historic-confirm-list > li').length,
                fold: window.innerHeight,
            };
        }""")
        assert hierarchy["next"], "2b. the production page must still carry a next action"
        assert hierarchy["backlog"], "2b. and must still carry the confirmation backlog"
        assert hierarchy["next"]["top"] < hierarchy["backlog"]["top"], (
            f"2b. the next action must come before the backlog "
            f"({hierarchy['next']['top']}px vs {hierarchy['backlog']['top']}px)")
        assert hierarchy["next"]["top"] < hierarchy["fold"], (
            f"2b. and must be in the first viewport, at {hierarchy['next']['top']}px of {hierarchy['fold']}px")
        assert hierarchy["backlogOpen"] is False, "2b. the backlog ships behind its own summary line"
        # NOT HIDDEN. Collapsed is only acceptable because the closed line still states
        # the count and what it is a count OF, and every row is still in the document.
        assert "confirmation" in hierarchy["summary"], (
            f"2b. the closed backlog must still say what it is: {hierarchy['summary']!r}")
        assert any(ch.isdigit() for ch in hierarchy["summary"]), (
            f"2b. and must still carry its count: {hierarchy['summary']!r}")
        assert hierarchy["rows"] == before["unique"], (
            f"2b. and every row must still be in the document while closed "
            f"({hierarchy['rows']} vs {before['unique']})")
        findings.append(f"2b. next action at {hierarchy['next']['top']}px leads the backlog at "
                        f"{hierarchy['backlog']['top']}px; the backlog ships closed with all "
                        f"{hierarchy['rows']} rows present and its summary reading {hierarchy['summary']!r}")

        # ---- 2c. SHOT NEXT ACTION REACHES THE PRODUCTION CONFIRMATION CONTROL --------
        routed_shot = page.evaluate("""() => {
            const row = P.shots.map((shot) => ({ shot, readiness: shotReadinessFor(shot) }))
                .find((item) => item.readiness?.nextAction?.code === 'confirm-existing-reference');
            return row ? row.shot.id : '';
        }""")
        assert routed_shot, "no shot emitted confirm-existing-reference for the browser routing proof"
        page.goto(f"{base}/#/shot/{routed_shot}", wait_until="domcontentloaded")
        page.wait_for_selector("button.shot-primary-action", timeout=15000)
        route_before = page.evaluate("""(shotId) => {
            const shot = P.shots.find((row) => row.id === shotId);
            const readiness = shotReadinessFor(shot);
            const destination = shotReadinessDestinationForAction(readiness.nextAction.code);
            return {
                action: readiness.nextAction.code,
                destination: destination?.destinationId || '',
                route: destination?.navigation?.route || '',
                selected: boundedShotSelectedTask(shot, takesFor(shot.id)),
                call: document.querySelector('button.shot-primary-action')?.getAttribute('onclick') || '',
            };
        }""", routed_shot)
        assert route_before["action"] == "confirm-existing-reference", f"wrong browser precondition: {route_before}"
        assert route_before["destination"] == "production" and route_before["route"] == "#/production", \
            f"historic confirmation is not declared on Production: {route_before}"
        assert f"openShotReadinessAction('{routed_shot}','confirm-existing-reference')" in route_before["call"], \
            f"the primary action bypasses the declared router: {route_before['call']!r}"
        page.locator("button.shot-primary-action").first.click()
        page.wait_for_function("location.hash === '#/production'", timeout=15000)
        page.wait_for_selector('[data-readiness-action-surface="production-historic-confirmation"]', timeout=15000)
        route_after = page.evaluate("""(shotId) => {
            const shot = P.shots.find((row) => row.id === shotId);
            return {
                selected: boundedShotSelectedTask(shot, takesFor(shot.id)),
                inputs: !!document.querySelector('[data-guided-panel="inputs"]'),
                surface: !!document.querySelector('[data-readiness-action-surface="production-historic-confirmation"]'),
                control: !!document.querySelector('.historic-confirm-list button[onclick*="confirmHistoricSelection"]'),
            };
        }""", routed_shot)
        assert route_after["selected"] == route_before["selected"], \
            f"Production navigation silently changed the shot task: {route_before} -> {route_after}"
        assert not route_after["inputs"] and route_after["surface"] and route_after["control"], \
            f"the routed surface cannot perform historic confirmation: {route_after}"
        findings.append(f"2c. {routed_shot} confirm-existing-reference routed to Production; "
                        "the confirmation control rendered and Inputs was not selected")
        # ---- 3. NEGATIVE CONTROL: THE SAME COMMAND OUTSIDE A TRUSTED EVENT IS REFUSED -
        # Run FIRST, so a build whose gesture check had stopped working could not pass
        # step 4 by accident.
        refusal = page.evaluate("""() => {
            const feed = evaluateProjectReadiness(P, { mediaListing: (l) => entityMediaPool(l), shotMediaListing: (i) => takesFor(i) });
            const item = feed.historic.items.find(row => row.target.kind === 'entity-state' && !row.ownership.wouldRefuse);
            if (!item) return { skipped: true };
            try {
                CineBraidAuthorityKernel.approveEntityStateCanon(P, {
                    list: item.target.list, entityId: item.target.entityId, stateId: item.target.stateId,
                    value: item.value, assetId: item.assetId || "", at: new Date().toISOString(), via: "page-script",
                });
                return { refused: false, key: item.key };
            } catch (error) {
                return { refused: true, code: error.code || "", key: item.key };
            }
        }""")
        assert not refusal.get("skipped"), "no confirmable entity-state row was offered"
        assert refusal["refused"] is True, \
            "page script wrote Canon with no user gesture at all - the trusted-event boundary is not in force"
        assert refusal["code"] == "MANUAL_ACTION_REQUIRED", \
            f"refused for the wrong reason: {refusal.get('code')!r}"
        findings.append(f"3. NEGATIVE CONTROL: the same command from page script was refused ({refusal['code']})")

        # ---- 4. A REAL CLICK WRITES A REAL RECEIPT ------------------------------------
        target_key = page.evaluate("""() => {
            const feed = evaluateProjectReadiness(P, { mediaListing: (l) => entityMediaPool(l), shotMediaListing: (i) => takesFor(i) });
            const item = feed.historic.items.find(row => !row.ownership.wouldRefuse);
            return item ? item.key : "";
        }""")
        assert target_key, "no confirmable row to click"
        # The queue ships closed (see 2b), so the click path a filmmaker takes is: open
        # the list, then confirm a row. Opened through the real <summary>, because a
        # disclosure that could not be opened by a person would make 2b a regression
        # rather than a hierarchy.
        page.locator(".historic-confirm > summary").first.click()
        page.wait_for_timeout(300)
        assert page.evaluate("() => document.querySelector('.historic-confirm').open") is True, \
            "the confirmation backlog must open when a person clicks its summary"
        button = page.query_selector(f".historic-confirm-list button[onclick*=\"{target_key}\"]")
        assert button, f"the confirmation button for {target_key} is not in the page"
        assert button.is_visible(), "and the row it offers must be visible once the list is open"
        button.click()
        page.wait_for_timeout(600)
        assert not page_errors, f"confirming raised uncaught errors: {page_errors}"

        after = page.evaluate("""(key) => {
            const receipts = (P.productionAuthority || {}).receipts || [];
            const feed = evaluateProjectReadiness(P, {
                mediaListing: (list) => entityMediaPool(list),
                shotMediaListing: (id) => takesFor(id),
            });
            const receipt = receipts.find(row => row.targetKey === key) || null;
            return {
              receipts: receipts.length,
              receipt: receipt ? { actor: receipt.actor, act: receipt.act, status: receipt.status, command: receipt.command } : null,
              unique: feed.historic.uniqueTargets,
              stillListed: feed.historic.items.some(row => row.key === key),
              rows: [...document.querySelectorAll('.historic-confirm-list > li')].length,
            };
        }""", target_key)
        assert after["receipts"] == 1, f"one click must write exactly one receipt, got {after['receipts']}"
        assert after["receipt"], f"no receipt was written for {target_key}"
        assert after["receipt"]["actor"] == "human" and after["receipt"]["act"] == "explicit-approval", \
            f"the receipt does not record a human explicit approval: {after['receipt']}"
        assert after["receipt"]["status"] == "current", f"the receipt is not current: {after['receipt']}"
        findings.append(f"4. a real trusted click wrote one {after['receipt']['command']} receipt for {target_key}")

        # ---- 5. READINESS RECALCULATES FROM CURRENT TRUTH -----------------------------
        assert after["unique"] == before["unique"] - 1, \
            f"the confirmed target must leave the queue: {before['unique']} -> {after['unique']}"
        assert not after["stillListed"], "the confirmed target is still offered for confirmation"
        assert after["rows"] == after["unique"], \
            f"the re-rendered surface must show the new truth: {after['rows']} vs {after['unique']}"
        findings.append(f"5. readiness recalculated: {before['unique']} -> {after['unique']} confirmations outstanding")

        # ---- 6. THE SERVER ANSWERS THE SAME QUESTION THROUGH THE SAME MODULE ----------
        # And it answers it ONCE. The audit found `issues: []` sitting beside
        # `readiness.status: "NEEDS_DECISION"`, so the shape is asserted here too:
        # nothing in this payload except `readiness` may be read as a verdict.
        api = page.evaluate("""async () => {
            const response = await fetch('/api/project/readiness', { cache: 'no-store' });
            const data = await response.json();
            return {
              status: response.status,
              contract: data.readiness ? data.readiness.contract : "",
              topLevelIssues: Object.prototype.hasOwnProperty.call(data, 'issues'),
              setupIssues: Array.isArray(data.setup && data.setup.issues),
              setupAnswers: data.setup ? data.setup.answers : "",
              setupIsVerdict: data.setup ? data.setup.isReadinessVerdict : null,
              shots: data.readiness ? data.readiness.shots.length : -1,
              mediaCheck: data.readiness ? data.readiness.mediaCheck : "",
              projectAction: data.readiness && data.readiness.nextAction ? data.readiness.nextAction.code : null,
            };
        }""")
        assert api["status"] == 200, f"/api/project/readiness answered {api['status']}"
        assert api["contract"] == "cinebraid.shot-readiness/1", f"unexpected contract {api['contract']!r}"
        assert api["setupIssues"], "the legacy rows are still served, under the setup envelope"
        assert api["setupAnswers"] == "project-setup-completeness", \
            f"the setup envelope must name what it answers, got {api['setupAnswers']!r}"
        assert api["setupIsVerdict"] is False, "and must state in the payload that it is not a readiness verdict"
        assert not api["topLevelIssues"], \
            "a top-level `issues` array is a second readiness truth: an empty one reads as an all-clear"
        assert api["shots"] == len(before["statuses"]), "the server projection covers every shot"
        assert api["mediaCheck"] == "resolveApprovalMedia", \
            f"the server must resolve media through the canonical resolver, got {api['mediaCheck']!r}"
        assert api["projectAction"] is None, \
            "a healthy ledger carries no project-level action, so nothing else can declare the project ready"
        findings.append(f"6. GET /api/project/readiness: one verdict, {api['shots']} shots, "
                        f"mediaCheck={api['mediaCheck']}, setup nested and marked non-verdict")

        # ---- 7. THE RENDERED SURFACE SHOWS ONE READINESS VERDICT ----------------------
        surface = page.evaluate("""() => ({
            verdicts: document.querySelectorAll('[data-readiness-verdict="1"]').length,
            setups: document.querySelectorAll('[data-project-setup="1"]').length,
            saysProjectReadiness: document.body.innerHTML.includes('PROJECT READINESS'),
            saysReadyForProduction: document.body.innerHTML.includes('Ready for production work'),
            setupText: (document.querySelector('[data-project-setup="1"]') || {}).textContent || '',
        })""")
        # `NEEDS ATTENTION` is checked inside the setup block only, not page-wide: the
        # creator shell uses the same words for its own unrelated activity state, and a
        # page-wide ban would fail on a surface this change never touched.
        assert surface["verdicts"] == 1, \
            f"exactly one readiness verdict may be on the page, found {surface['verdicts']}"
        assert surface["setups"] == 1, f"and exactly one setup block, found {surface['setups']}"
        assert not surface["saysProjectReadiness"], "the legacy block must not call itself readiness"
        assert not surface["saysReadyForProduction"], \
            "the legacy block must never claim the project is ready for production"
        for banned in ("READY", "NEEDS ATTENTION"):
            assert banned not in surface["setupText"], \
                f"{banned!r} must not appear in the setup block: {surface['setupText'][:160]!r}"
        findings.append("7. rendered surface carries ONE readiness verdict; setup block declares no verdict")

        # ---- 8. CORRECTED STATE PRODUCERS REACH THEIR OWN REPAIR SURFACES -----------
        # This is deliberately driven through the rendered NEXT ACTION button and the
        # shipped controls. The Node suite owns the exhaustive owner/refusal matrix;
        # Chromium proves that the two formerly overloaded producers are actionable.
        correction = page.evaluate("""() => {
            const entity = P.characters[0];
            if (!entity) throw new Error('the demo has no character for the state-action fixture');
            entity.continuityStates = [
              { id: 'state-browser-clean', name: 'Browser clean', isDefault: true, approvedFile: entity.approvedFile || '' },
              { id: 'state-browser-rain', name: 'Browser rain', isDefault: false, approvedFile: entity.approvedFile || '' },
            ];
            const shot = JSON.parse(JSON.stringify(P.shots[0]));
            shot.id = 'SHOT-STATE-BROWSER';
            shot.title = 'State action browser fixture';
            shot.characters = [];
            shot.codes = [];
            shot.creationBrief = {
              ...(shot.creationBrief || {}),
              locationId: '', propIds: [], vehicleIds: [], frameWorkflows: {},
            };
            shot.continuityStateSelections = { [entity.id]: 'state-browser-rain' };
            P.shots.push(shot);
            return { shotId: shot.id, entityId: entity.id };
        }""")

        page.goto(f"{base}/#/shot/{correction['shotId']}", wait_until="domcontentloaded")
        page.wait_for_selector("button.shot-primary-action", timeout=15000)
        stale_before = page.evaluate("""(shotId) => {
            const shot = P.shots.find((row) => row.id === shotId);
            const readiness = shotReadinessFor(shot);
            return {
              action: readiness.nextAction.code,
              attached: resolveShotEntities(P, shot).characters.map((row) => row.id),
              call: document.querySelector('button.shot-primary-action')?.getAttribute('onclick') || '',
            };
        }""", correction["shotId"])
        assert stale_before["action"] == "remove-stale-state-declaration", \
            f"the declaration-only producer did not become the rendered next action: {stale_before}"
        assert correction["entityId"] not in stale_before["attached"], \
            f"the declaration key incorrectly established attachment: {stale_before}"
        assert "remove-stale-state-declaration" in stale_before["call"], \
            f"the rendered NEXT ACTION did not carry the stale action token: {stale_before['call']!r}"
        page.locator("button.shot-primary-action").first.click()
        page.wait_for_selector('[data-readiness-action-surface="shot-stale-state-declaration"]', timeout=15000)
        stale_surface = page.evaluate("""(entityId) => ({
            stale: !!document.querySelector(`[data-stale-shot-state-declaration="${CSS.escape(entityId)}"] button`),
            shotSelector: !!document.querySelector(`[data-shot-state-entity="${CSS.escape(entityId)}"] select`),
        })""", correction["entityId"])
        assert stale_surface["stale"] and not stale_surface["shotSelector"], \
            f"stale NEXT ACTION did not reach truthful cleanup exclusively: {stale_surface}"
        page.locator(f'[data-stale-shot-state-declaration="{correction["entityId"]}"] button').click()
        page.wait_for_function("""({ shotId, entityId }) => {
            const shot = P.shots.find((row) => row.id === shotId);
            return shot && !Object.prototype.hasOwnProperty.call(shot.continuityStateSelections || {}, entityId);
        }""", arg=correction)
        stale_after = page.evaluate("""({ shotId, entityId }) => {
            const shot = P.shots.find((row) => row.id === shotId);
            return {
              action: shotReadinessFor(shot).nextAction.code,
              attached: resolveShotEntities(P, shot).characters.some((row) => row.id === entityId),
            };
        }""", arg=correction)
        assert stale_after["action"] != "remove-stale-state-declaration" and not stale_after["attached"], \
            f"explicit cleanup did not resolve only the stale key: {stale_after}"
        findings.append("8a. declaration-only NEXT ACTION rendered explicit stale cleanup; a real click removed the key without attaching the entity")

        correction["frameId"] = page.evaluate("""({ shotId, entityId }) => {
            const shot = P.shots.find((row) => row.id === shotId);
            delete P.productionAuthority;
            const currentFrame = (shotReadinessFor(shot).units || []).find((unit) => String(unit.id || '').startsWith('frame:'));
            const frameId = String(currentFrame?.id || '').replace(/^frame:/, '') || 'frame-a';
            shot.characters = [entityId];
            shot.continuityStateSelections = { [entityId]: 'state-browser-clean' };
            shot.creationBrief.frameWorkflows = { ...(shot.creationBrief.frameWorkflows || {}) };
            shot.creationBrief.frameWorkflows[frameId] = {
              ...(shot.creationBrief.frameWorkflows[frameId] || {}),
              characterStateSelections: { [entityId]: 'state-browser-missing' },
            };
            return frameId;
        }""", correction)
        page.goto(f"{base}/#/shot/{correction['shotId']}", wait_until="domcontentloaded")
        page.wait_for_selector("button.shot-primary-action", timeout=15000)
        frame_before = page.evaluate("""(shotId) => {
            const shot = P.shots.find((row) => row.id === shotId);
            const readiness = shotReadinessFor(shot);
            return {
              action: readiness.nextAction.code,
              call: document.querySelector('button.shot-primary-action')?.getAttribute('onclick') || '',
              units: (readiness.units || []).map((unit) => ({ id: unit.id, required: unit.required, action: unit.nextAction?.code || '', reasons: (unit.requirements || []).map((row) => row.reason || row.state) })),
            };
        }""", correction["shotId"])
        assert frame_before["action"] == "resolve-frame-state-declaration", \
            f"the invalid frame producer did not become the rendered next action: {frame_before}"
        assert "resolve-frame-state-declaration" in frame_before["call"], \
            f"the rendered NEXT ACTION did not carry the frame action token: {frame_before['call']!r}"
        page.locator("button.shot-primary-action").first.click()
        page.wait_for_selector('[data-readiness-action-surface="shot-frame-state-declaration"]', timeout=15000)
        frame_surface = page.evaluate("""() => ({
            frame: !!document.querySelector('[data-frame-state-declaration-invalid="1"] select'),
            shotSurface: !!document.querySelector('[data-readiness-action-surface="shot-state-declaration"]'),
        })""")
        assert frame_surface["frame"] and not frame_surface["shotSurface"], \
            f"frame NEXT ACTION presented the wrong repair surface: {frame_surface}"

        false_success = page.evaluate("""({ shotId, entityId, frameId }) => {
            const result = chooseShotContinuityState(shotId, entityId, 'state-browser-rain');
            const shot = P.shots.find((row) => row.id === shotId);
            return {
              status: result.status,
              action: shotReadinessFor(shot).nextAction.code,
              shotState: shot.continuityStateSelections[entityId],
              frameState: shot.creationBrief.frameWorkflows[frameId].characterStateSelections[entityId],
            };
        }""", correction)
        assert false_success == {
            "status": "applied", "action": "resolve-frame-state-declaration",
            "shotState": "state-browser-rain", "frameState": "state-browser-missing",
        }, f"changing the shot declaration was mistaken for frame repair: {false_success}"

        frame_select = page.locator('[data-frame-state-declaration-invalid="1"] select').first
        frame_select.select_option("state-browser-clean")
        page.wait_for_function("""({ shotId }) => {
            const shot = P.shots.find((row) => row.id === shotId);
            const requirements = (shotReadinessFor(shot).units || []).flatMap((unit) => unit.requirements || []);
            return !requirements.some((row) => row.reason === 'frame-state-not-on-entity');
        }""", arg=correction)
        frame_after = page.evaluate("""({ shotId, entityId, frameId }) => {
            const shot = P.shots.find((row) => row.id === shotId);
            return {
              shotState: shot.continuityStateSelections[entityId],
              frameState: shot.creationBrief.frameWorkflows[frameId].characterStateSelections[entityId],
              action: shotReadinessFor(shot).nextAction.code,
            };
        }""", correction)
        assert frame_after["shotState"] == "state-browser-rain", \
            f"the frame owner silently rewrote the shot declaration: {frame_after}"
        assert frame_after["frameState"] == "state-browser-clean" \
            and frame_after["action"] != "resolve-frame-state-declaration", \
            f"the real frame control did not clear its own blocker: {frame_after}"
        findings.append("8b. frame NEXT ACTION rendered the existing frame control; shot mutation left the blocker, then a real frame selection cleared it without rewriting shot state")

        assert not paid_calls, f"a paid route was called: {paid_calls}"
        assert not offsite, f"a request left this machine: {offsite}"
        assert not page_errors, f"uncaught page errors: {page_errors}"

        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()

for line in findings:
    print(f"[browser] {line}")
print("Shot readiness real-browser suite passed: the shared derivation loads in the page, the "
      "deduplicated confirmation surface renders one row per authority target, a real trusted click "
      "writes exactly one human receipt while the same command from page script is refused, readiness "
      "recalculates from current truth, and the server answers the same question through the same module. "
      "Paid calls: 0. Offsite requests: 0.")
