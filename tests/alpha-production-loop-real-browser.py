#!/usr/bin/env python3
"""The private-alpha production loop, executed in a real Chromium.

THE DEFECT THIS SUITE EXISTS FOR, in one line: "Add motion" opened nothing,
because the button wrote a state the bounded shot workspace does not read.

public/creation-studio.js renders exactly ONE task panel per shot, chosen by
boundedShotSelectedTask() from the focused-task state in localStorage.
openGuidedPanel() wrote the legacy `c.openPanels` map instead, which decides
whether a panel is OPEN once it exists and not whether it is BUILT — so the
motion workspace was never in the DOM, the scroll poll that followed timed out,
and the app told the filmmaker "Could not find the motion workspace" about a
workspace it had never asked for.

Nothing caught it. tests/bounded-rendering.js proves the workspace builds only
the selected task; nothing drove the button that was supposed to change it. A
Node suite can prove the repair, and does — but the defect was a claim about what
the shipped page actually renders after a real click, so the proof is a real
click in a real browser.

What it establishes:

  1  from Frames, clicking the shipped "Add motion" control selects the Motion
     task and the motion workspace is in the real DOM
  2  no "Could not find the motion workspace" toast is raised
  3  the motion target the picker opens on is DISPATCHABLE — decided by the page's
     own resolver, on a project whose stored default is the old unwired one
  4  targets CineBraid cannot run are visibly unavailable, and selecting one (the
     way an existing project already carries one) states the reason and names a
     working alternative BEFORE any paid action, with no paid action offered
  5  an explicit batch approval, confirmed through the shipped modal, renders as a
     human approval

NOTHING HERE IS PAID. /api/generation/fal/jobs is aborted and counted if it is
ever reached, and every off-host request is aborted.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped
sample are never touched, and the directory is removed at the end.
"""

import json, os, pathlib, shutil, socket, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import canon_receipts, require_browser, launch_chromium

LABEL = "Private-alpha production loop real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
MODULE = "creation-studio.js"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")
MODULE_SOURCE = (ROOT / "public" / MODULE).read_text(encoding="utf-8")

SHOT = "SAMPLE-01"
# An unwired family the prompt catalogue still describes. This is also the value
# the shipped sample project stores as its default video profile, which is the
# whole point of case 3: an existing project must not be left on a dead target.
UNWIRED = "seedance-2/i2v"


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


class Red(Exception):
    """A negative control that failed to go red."""


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-alpha-loop-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"

# MOTION READINESS IS CANON since the closure pass: a raw `frame.winner` no
# longer unlocks the motion workspace. The sandbox demo project is generated
# legacy data, so this stamps the receipts a creator who had approved those
# frames would have left. It writes only inside the temp sandbox — the shipped
# sample and every real project are untouched.
def _stamp_sandbox_canon():
    for project_file in projects_root.rglob("project.json"):
        data = json.loads(project_file.read_text(encoding="utf-8"))
        entries = []
        for shot in data.get("shots") or []:
            for frame in shot.get("keyframes") or []:
                if frame.get("winner"):
                    entries.append({"kind": "shot-frame", "shotId": shot["id"],
                                    "frameId": frame["id"], "value": frame["winner"]})
        for list_name in ("characters", "locations", "props", "vehicles"):
            for entity in data.get(list_name) or []:
                value = entity.get("approvedFile")
                if not value:
                    continue
                states = entity.get("continuityStates") or []
                state = next((row for row in states if row.get("isDefault")), states[0] if states else {})
                entries.append({"kind": "entity-state", "list": list_name,
                                "entityId": entity["id"], "stateId": state.get("id", "state-default"),
                                "value": value})
        if entries:
            data["productionAuthority"] = canon_receipts(entries, via="alpha-loop-sandbox")
            project_file.write_text(json.dumps(data, indent=2), encoding="utf-8")


_stamp_sandbox_canon()

console_errors, page_errors, offsite, paid_calls, failed_requests = [], [], [], [], []
findings, controls = [], []
# When armed, the guard below serves a MUTATED module instead of the shipped one:
# the defect is reintroduced in flight, nothing on disk is touched, and no control
# can be "restored" by a checkout that also discards real work.
served = {"mutation": None}

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
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("requestfailed", lambda request: failed_requests.append(
            f"{request.method} {request.url} ({(request.failure or '')})"))

        def guard(route):
            """No request leaves this machine, the paid route is never called, and an
            armed negative control gets its mutated module."""
            url = route.request.url
            if PAID_ROUTE in url and route.request.method == "POST":
                paid_calls.append(f"{route.request.method} {url}")
                return route.abort("failed")
            if MODULE in url and served["mutation"] is not None:
                return route.fulfill(status=200, content_type="application/javascript",
                                     body=served["mutation"])
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)

        def open_shot_on_frames():
            """Load the shot from scratch — so an armed mutation is really fetched —
            and put the workspace on Frames through the app's own task selector."""
            page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=15000)
            page.wait_for_timeout(900)
            page.evaluate(f"() => selectBoundedTask('shot-task', {json.dumps(SHOT)}, 'frames')")
            page.wait_for_timeout(700)
            # Case 4 leaves an explicit unwired selection on the shot, and an explicit
            # selection is deliberately never replaced. Clearing it through the app's
            # own setter is what puts the picker back on the DEFAULT, which is the
            # thing case 3 is about.
            page.evaluate(f"() => setGuidedMotionField({json.dumps(SHOT)}, 'motionProfileId', '')")
            page.wait_for_timeout(500)
            # Every toast raised from here on is collected, so case 2 is a claim about
            # what the app actually said rather than about what it happened to be
            # showing when the assertion ran.
            page.evaluate("""() => {
                window.__toasts = [];
                const node = document.getElementById('toast');
                if (!node) return;
                new MutationObserver(() => {
                    const text = (node.textContent || '').trim();
                    if (text && !node.classList.contains('hidden')) window.__toasts.push(text);
                }).observe(node, { childList: true, characterData: true, subtree: true, attributes: true });
            }""")

        def clear_motion_selection():
            """Back to no explicit target, through the app's own setter. A selected
            option is deliberately never disabled — it has to stay renderable — so a
            check about UNSELECTED unwired targets has to start from here."""
            page.evaluate(f"() => setGuidedMotionField({json.dumps(SHOT)}, 'motionProfileId', '')")
            page.wait_for_timeout(600)

        def workspace_state():
            return page.evaluate("""() => {
                const shell = document.querySelector('[data-bounded-task]');
                return {
                    task: shell ? shell.dataset.boundedTask : '',
                    motionPanel: !!document.querySelector('[data-guided-panel="motion"]'),
                    toasts: window.__toasts || [],
                };
            }""")

        def click_add_motion():
            """The shipped control, found by what it DOES rather than by its label."""
            buttons = page.locator("button.shot-primary-action")
            found = None
            for index in range(buttons.count()):
                node = buttons.nth(index)
                if "openGuidedPanel" in (node.get_attribute("onclick") or "") and "motion" in (node.get_attribute("onclick") or ""):
                    found = node
                    break
            assert found is not None, "the shot's next-action card offered no Add motion control to click"
            found.click()
            page.wait_for_timeout(1500)

        # ---- the checks, written once so a negative control can demand the
        # ---- same assertion FAIL rather than a paraphrase of it ---------------

        def check_navigation():
            """CASES 1 and 2 — the motion workspace is selected, built, and nothing
            was refused."""
            seen = workspace_state()
            assert seen["task"] == "motion", f"case 1: Add motion left the workspace on {seen['task']!r}"
            assert seen["motionPanel"], f"case 1: the motion workspace is not in the DOM ({seen})"
            missing = [t for t in seen["toasts"] if "Could not find" in t or "Could not open" in t]
            assert not missing, f"case 2: the app refused with {missing!r}"

        def check_default_is_dispatchable():
            """CASE 3 — the target the picker opens on can actually be run, decided by
            the page's own resolver rather than by a family name spelled out here."""
            seen = page.evaluate("""() => {
                const select = document.querySelector('.guided-video-target-control select');
                const chosen = select ? select.value : '';
                const profile = guidedVideoProfiles().find((row) => row.id === chosen) || null;
                const option = select ? [...select.options].find((row) => row.value === chosen) : null;
                return {
                    chosen,
                    dispatchable: guidedVideoProfileDispatchable(profile),
                    disabled: option ? option.disabled : null,
                    storedProjectDefault: (P.meta.promptDefaults || {}).videoProfile || '',
                    label: option ? option.textContent : '',
                };
            }""")
            assert seen["chosen"], f"case 3: the motion picker rendered no selected target ({seen})"
            assert seen["dispatchable"], f"case 3: the picker opened on a target CineBraid cannot run ({seen})"
            assert seen["disabled"] is False, f"case 3: the opening target is not selectable ({seen})"
            assert "not available" not in seen["label"], f"case 3: the opening target is labelled unavailable ({seen})"
            return seen

        def check_unwired_targets_explain_themselves():
            """CASE 4 — listed, not selectable, and when one is already stored the
            reason and a working alternative are on screen before any paid action."""
            options = page.evaluate("""() => {
                const select = document.querySelector('.guided-video-target-control select');
                return select ? [...select.options].map((row) => ({
                    id: row.value, disabled: row.disabled, label: row.textContent,
                })) : [];
            }""")
            dead = [row for row in options if row["id"] == UNWIRED]
            assert dead, f"case 4: the unwired target is no longer listed at all ({[o['id'] for o in options]})"
            assert dead[0]["disabled"], f"case 4: an unwired target is still selectable ({dead[0]})"
            assert "not available" in dead[0]["label"], f"case 4: an unwired target is not labelled ({dead[0]})"

            # An existing project can already carry one, so this is what that looks
            # like: the shipped setter, then the shipped re-render.
            page.evaluate(f"() => setGuidedMotionField({json.dumps(SHOT)}, 'motionProfileId', {json.dumps(UNWIRED)})")
            page.wait_for_timeout(900)
            seen = page.evaluate("""() => {
                const refusal = document.querySelector('[data-video-profile-unsupported]');
                const select = document.querySelector('.guided-video-target-control select');
                return {
                    chosen: select ? select.value : '',
                    refusal: refusal ? refusal.textContent : '',
                    paidAction: !!document.querySelector('.h3-generate-btn'),
                };
            }""")
            assert seen["chosen"] == UNWIRED, \
                f"case 4: an explicit selection was silently replaced with another model ({seen})"
            assert seen["refusal"], f"case 4: the unwired target failed silently ({seen})"
            assert "cannot generate with" in seen["refusal"], f"case 4: the refusal does not say what is wrong ({seen})"
            assert "no adapter for seedance-2 ships" in seen["refusal"], \
                f"case 4: the refusal gives no specific reason ({seen})"
            assert "MiniMax H3" in seen["refusal"], f"case 4: the refusal names no working alternative ({seen})"
            assert not seen["paidAction"], f"case 4: a paid generation action was offered for an unwired target ({seen})"
            return seen

        def check_batch_approval_reads_as_human():
            """CASE 5 — the shipped batch-approval modal, confirmed with a real click."""
            page.goto(f"{base}/#/library", wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=15000)
            page.wait_for_timeout(900)
            seeded = page.evaluate("""async () => {
                const entity = P.characters[0];
                const file = entity.approvedFile;
                entity.candidateFiles = [{ stored: file, decision: 'unreviewed' }];
                entity.candidateReviewBatches = [{
                    id: 'browser-batch-1',
                    results: [{
                        fileName: file, status: 'completed', pass: true, score: 93,
                        contractVersion: ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION,
                        targetKey: 'state:state-default', targetLabel: entity.name,
                        type: 'reference', stateId: 'state-default', slotId: '', approvable: true,
                    }],
                }];
                dirty();
                if (typeof flushPendingProjectSave === 'function') await flushPendingProjectSave();
                openEntityBatchApproval('characters', entity.id, 'browser-batch-1');
                return { id: entity.id, file };
            }""")
            page.wait_for_selector("[data-batch-approval-index]", timeout=10000)
            confirm = page.locator("button.approve-btn", has_text="CONFIRM SELECTED APPROVALS")
            assert confirm.count(), "case 5: the batch approval modal offered no confirmation control"
            confirm.first.click()
            page.wait_for_timeout(1200)
            seen = page.evaluate("""([id, file]) => {
                const entity = P.characters.find((row) => row.id === id);
                const row = (entity.candidateFiles || []).find((item) => (item.stored || item.name) === file);
                return {
                    decision: row ? row.decision : '',
                    humanApproved: row ? row.humanApproved === true : false,
                    rendered: entityReviewHumanDecisionMarkup(row, { pass: true, score: 93 }),
                    aiOnly: entityReviewHumanDecisionMarkup({ decision: 'unreviewed' }, { pass: true, score: 93 }),
                };
            }""", [seeded["id"], seeded["file"]])
            assert seen["decision"] == "approved-reference", \
                f"case 5: the batch approval did not record its decision ({seen['decision']!r})"
            assert seen["humanApproved"], f"case 5: an explicit batch approval was not a human decision ({seen})"
            assert "APPROVED BY YOU" in seen["rendered"], \
                f"case 5: the human-decision panel does not read as an approval ({seen['rendered'][:200]!r})"
            assert "NO HUMAN DECISION YET" in seen["aiOnly"], \
                "case 5: a passing AI review alone must still render as undecided"
            return seen

        def expect_red(name, why, check, *args):
            """Run a positive check that MUST now fail, and record the receipt."""
            try:
                check(*args)
            except AssertionError as error:
                controls.append((name, why, str(error).splitlines()[0][:140]))
                return
            raise Red(f"{name} did not go red: {why}")

        # =====================================================================
        # PART 1 — the positive cases, against the shipped module.
        # =====================================================================

        open_shot_on_frames()
        before = workspace_state()
        assert before["task"] == "frames", f"the shot must start on Frames, or nothing is being proved ({before})"
        assert not before["motionPanel"], f"Frames must not already render the motion workspace ({before})"

        click_add_motion()
        check_navigation()
        findings.append("1/2: from Frames, the shipped Add motion control selected the Motion task, the motion "
                        "workspace is in the real DOM, and no 'Could not find the motion workspace' toast was raised")

        opening = check_default_is_dispatchable()
        findings.append(f"3: the picker opened on {opening['chosen']} — dispatchable by the page's own resolver — "
                        f"on a project whose stored default is still {opening['storedProjectDefault']}")

        refusal = check_unwired_targets_explain_themselves()
        findings.append("4: unwired targets stay listed, are not selectable, and a stored one states its reason "
                        f"and names MiniMax H3 with no paid action offered — {refusal['refusal'].strip()[:150]!r}")

        approval = check_batch_approval_reads_as_human()
        findings.append("5: a batch approval confirmed through the shipped modal renders as APPROVED BY YOU, while a "
                        "passing AI review with no human decision still renders as NO HUMAN DECISION YET")

        # =====================================================================
        # PART 2 — negative controls. Each reintroduces one defect IN FLIGHT and
        # must make the case above it fail. A load crash proves nothing, so every
        # control also asserts the page raised no error and the defect is live.
        # =====================================================================

        def arm(name, *pairs):
            source = MODULE_SOURCE
            for before_text, after_text in pairs:
                assert source.count(before_text) == 1, \
                    f"{name}: the anchor it patches appears {source.count(before_text)} times: {before_text[:70]!r}"
                source = source.replace(before_text, after_text)
            served["mutation"] = source

        # ---- NC-A: openGuidedPanel back to writing only the legacy openPanels map,
        # ---- and back to deciding from the scroll poll. The defect verbatim.
        arm("NC-A",
            ("  const s = shotById(id), c = ensureShotCreation(s);\n  const task = selectGuidedPanelTask(s, key);",
             "  const s = shotById(id), c = ensureShotCreation(s);\n  const task = \"\";"),
            ("  if (task && boundedShotSelectedTask(s, takesFor(s.id)) !== task)\n"
             "    return toast(`Could not open the ${key} workspace.`);\n"
             "  await focusGuidedWorkspaceTarget(`[data-guided-panel=\"${key}\"]`);",
             "  const found = await focusGuidedWorkspaceTarget(`[data-guided-panel=\"${key}\"]`);\n"
             "  if (!found) toast(`Could not find the ${key} workspace.`);"))
        del page_errors[:]
        open_shot_on_frames()
        assert not page_errors, f"the mutated module raised an uncaught error: {page_errors}"
        click_add_motion()
        page.wait_for_timeout(1200)
        live = workspace_state()
        assert live["task"] == "frames" and not live["motionPanel"], \
            f"NC-A: the defect is not live — the workspace moved anyway ({live})"
        assert any("Could not find the motion workspace" in t for t in live["toasts"]), \
            f"NC-A: the defect is not live — the app raised no missing-workspace toast ({live['toasts']})"
        expect_red("NC-A", "openGuidedPanel writing only the legacy openPanels map — the audit's exact symptom, "
                           "reproduced in the shipped browser", check_navigation)

        # ---- NC-B: an unwired target allowed to look dispatchable ---------------
        arm("NC-B", ("function guidedVideoProfileDispatchable(profile) {\n  return profile?.execution?.dispatchable === true;\n}",
                     "function guidedVideoProfileDispatchable(profile) {\n  return !!profile;\n}"))
        del page_errors[:]
        open_shot_on_frames()
        click_add_motion()
        page.wait_for_timeout(900)
        assert not page_errors, f"the mutated module raised an uncaught error: {page_errors}"
        live = page.evaluate("""([unwired]) => {
            const select = document.querySelector('.guided-video-target-control select');
            const option = select ? [...select.options].find((row) => row.value === unwired) : null;
            return { present: !!option, disabled: option ? option.disabled : null, label: option ? option.textContent : '' };
        }""", [UNWIRED])
        assert live["present"] and live["disabled"] is False and "not available" not in live["label"], \
            f"NC-B: the defect is not live — the unwired target is still marked unavailable ({live})"
        expect_red("NC-B", "an unwired target selectable and unlabelled again, which is how a dead end is reached",
                   check_unwired_targets_explain_themselves)

        # ---- NC-C: the refusal removed, leaving a silent dead end ---------------
        # ANCHOR MOVED BY BATCH 2 SLICE 5b, and the control is unchanged. The renderer now
        # handles a SECOND reason a target can be unusable — the shot's declared intent
        # excluding it — and that branch sits above this one. NC-C is still about the
        # DISPATCH refusal going silent, so it still mutates the dispatch branch; this
        # scenario declares no intent, so the branch above returns "" and control reaches
        # this one exactly as it always did.
        arm("NC-C", ("  if (!profile || guidedVideoProfileDispatchable(profile)) return \"\";\n  const execution = profile.execution || {};",
                     "  if (profile || !profile) return \"\";\n  const execution = profile.execution || {};"))
        del page_errors[:]
        open_shot_on_frames()
        click_add_motion()
        page.wait_for_timeout(900)
        assert not page_errors, f"the mutated module raised an uncaught error: {page_errors}"
        page.evaluate(f"() => setGuidedMotionField({json.dumps(SHOT)}, 'motionProfileId', {json.dumps(UNWIRED)})")
        page.wait_for_timeout(900)
        live = page.evaluate("""() => ({
            refusal: !!document.querySelector('[data-video-profile-unsupported]'),
            paidAction: !!document.querySelector('.h3-generate-btn'),
        })""")
        assert not live["refusal"] and not live["paidAction"], \
            f"NC-C: the defect is not live — an explanation is still on screen ({live})"
        # The probe above left the unwired target SELECTED, and a selected option is
        # never disabled. Clearing it first is what makes the guard below fail on the
        # missing explanation rather than on a receipt about something else.
        clear_motion_selection()
        expect_red("NC-C", "no paid action and no explanation — the silent dead end the audit found",
                   check_unwired_targets_explain_themselves)

        # ---- the shipped module again, so the reds came from the mutations ------
        served["mutation"] = None
        del page_errors[:]
        open_shot_on_frames()
        click_add_motion()
        check_navigation()
        check_default_is_dispatchable()
        check_unwired_targets_explain_themselves()
        findings.append("the shipped module was re-served after the controls and every case passed again, so the "
                        "three red results came from the mutations and not from the environment")

        # ---- B1 REMEDIATION RUNTIME: complete-shot NEXT ACTION is a panel key --------
        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.evaluate("""async () => {
            const shot = P.shots.find((row) => row.id === 'SAMPLE-01');
            delete shot.deliveryRoute;
            shot.clips = [];
            shot.deliveryIntent = 'still';
            const creation = ensureShotCreation(shot);
            creation.deliveryIntent = 'still';
            creation.approvedMotionFile = '';
            creation.finalVideoFile = '';
            selectBoundedTask('shot-task', shot.id, 'frames');
            dirty();
            if (typeof flushPendingProjectSave === 'function') await flushPendingProjectSave();
            route();
        }""")
        page.wait_for_timeout(700)
        primary = page.locator("button.shot-primary-action").first
        primary_call = primary.get_attribute("onclick") or ""
        assert "openGuidedPanel('SAMPLE-01','finish')" in primary_call,             f"B1: complete-shot NEXT ACTION must resolve to the finish panel, got {primary_call!r}"
        assert "'deliver'" not in primary_call, "B1: a stage id must not be passed as a panel key"
        primary.click()
        page.wait_for_timeout(900)
        b1_state = page.evaluate("""() => ({
            task: document.querySelector('[data-bounded-task]')?.dataset.boundedTask || '',
            finish: !!document.querySelector('[data-guided-panel="finish"]'),
        })""")
        assert b1_state == {"task": "deliver", "finish": True},             f"B1: NEXT ACTION did not reach the Deliver workspace: {b1_state}"
        findings.append("B1 runtime: the complete-shot primary action carried panel 'finish', selected stage "
                        "'deliver', and rendered the Finish & Delivery workspace with no silent no-op")

        # ---- B2 REMEDIATION RUNTIME: returned media outlives generation readiness ----
        returned_name = "PAID-RETURN.mp4"
        returned_file = projects_root / "dogfood-sample" / "shots" / SHOT / "takes" / returned_name
        returned_file.parent.mkdir(parents=True, exist_ok=True)
        # The media browser needs a returned file identity, not a decodable production
        # asset. A tiny local ftyp marker is sufficient for DOM/review-path validation.
        returned_file.write_bytes(b"\x00\x00\x00\x18ftypmp42cinebraid-runtime-fixture")
        page.evaluate("""async () => {
            const shot = P.shots.find((row) => row.id === 'SAMPLE-01');
            shot.deliveryRoute = 'r2v';
            shot.deliveryIntent = 'motion';
            shot.clips = [{
                id: 'motion-a', label: 'A', suffix: 'a', title: 'Returned motion', kind: 'r2v',
                fromFrame: '', toFrame: '', dur: 1, motionPrompt: 'Returned provider motion.',
                generationPackages: [], videoWinner: '',
            }];
            const creation = ensureShotCreation(shot);
            creation.deliveryIntent = 'motion';
            creation.activeMotionUnitId = 'motion-a';
            creation.approvedMotionFile = '';
            creation.finalVideoFile = '';
            /* Keep every pointer and byte, but remove entity authority: the exact state
               where a current route prerequisite becomes unmet after work returned. */
            P.productionAuthority.receipts = (P.productionAuthority.receipts || [])
                .filter((row) => row.kind !== 'entity-state');
            dirty();
            if (typeof flushPendingProjectSave === 'function') await flushPendingProjectSave();
        }""")
        page.goto(f"{base}/#/production", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.evaluate("""async () => {
            SCAN = await (await fetch('/api/scan')).json();
            route();
        }""")
        page.wait_for_timeout(700)
        assert returned_name in page.content(), "B2: Production inbox stopped advertising the returned video"

        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.evaluate(f"() => selectBoundedTask('shot-task', {json.dumps(SHOT)}, 'motion')")
        page.wait_for_selector('[data-generation-readiness="blocked"]', timeout=15000)
        b2_before = page.evaluate("""() => {
            const shot = P.shots.find((row) => row.id === 'SAMPLE-01');
            const readiness = shotReadinessFor(shot);
            const unit = readiness.units.find((row) => row.id === 'motion:motion-a');
            const panel = document.querySelector('[data-generation-readiness="blocked"]');
            return {
                status: readiness.status, generationStatus: unit?.status || '',
                stage: shotStageState('motion', shotStageModelFacts(shot, takesFor(shot.id))).availability,
                returned: !![...panel.querySelectorAll('b')].find((node) => node.textContent.includes('PAID-RETURN.mp4')),
                inspect: !!panel.querySelector('.media-enlarge-btn'),
                approve: [...panel.querySelectorAll('button')].some((node) => node.textContent.includes('APPROVE VIDEO')),
                importInput: !!panel.querySelector('#motion-file'),
                buildPrompt: [...panel.querySelectorAll('button')].some((node) => node.textContent.includes('Build prompt')),
                paidAction: !!panel.querySelector('.h3-generate-btn'),
            };
        }""")
        assert b2_before["status"] == "NEEDS_DECISION" and b2_before["generationStatus"] == "NEEDS_DECISION",             f"B2: the route prerequisite must really be unmet: {b2_before}"
        assert b2_before["stage"] == "available", f"B2: returned work must keep Motion reachable: {b2_before}"
        assert all(b2_before[key] for key in ("returned", "inspect", "approve", "importInput")),             f"B2: returned media lost a review/approval/import path: {b2_before}"
        assert not b2_before["buildPrompt"] and not b2_before["paidAction"],             f"B2: fresh or paid generation leaked through the blocked route: {b2_before}"

        page.locator('[data-generation-readiness="blocked"] .media-enlarge-btn').first.click()
        page.wait_for_selector(".media-theatre-modal", timeout=10000)
        page.keyboard.press("Escape")
        page.locator('[data-generation-readiness="blocked"] button.approve-btn', has_text="APPROVE VIDEO").first.click()
        page.wait_for_timeout(1000)
        b2_after = page.evaluate("""() => {
            const shot = P.shots.find((row) => row.id === 'SAMPLE-01');
            const readiness = shotReadinessFor(shot);
            const unit = readiness.units.find((row) => row.id === 'motion:motion-a');
            return {
                winner: shot.clips.find((row) => row.id === 'motion-a')?.videoWinner || '',
                receipt: (P.productionAuthority.receipts || []).some((row) => row.kind === 'shot-motion'
                    && row.unitKey === 'motion-a' && row.value === 'PAID-RETURN.mp4' && row.status === 'current'),
                generationStatus: unit?.status || '',
                blocked: !!document.querySelector('[data-generation-readiness="blocked"]'),
                approved: document.querySelector('[data-guided-panel="motion"]')?.textContent.includes('APPROVED') || false,
            };
        }""")
        assert b2_after["winner"] == returned_name and b2_after["receipt"],             f"B2: existing approval authority did not accept the returned video: {b2_after}"
        assert b2_after["generationStatus"] in ("BLOCKED", "NEEDS_DECISION") and b2_after["blocked"],             f"B2: approving returned work must not bypass fresh-generation readiness: {b2_after}"
        assert b2_after["approved"], f"B2: approved returned media stopped being reachable: {b2_after}"
        findings.append("B2 runtime: with r2v entity Canon removed after PAID-RETURN.mp4 arrived, Motion stayed "
                        "reachable for theatre review, approval and import; approval wrote shot-motion Canon, "
                        "while prompt creation and paid generation remained blocked")

        assert not page_errors, f"the audit raised uncaught errors: {page_errors}"
        assert not console_errors, f"the audit logged console errors: {console_errors}; failed: {failed_requests}"
        browser.close()

    assert not paid_calls, f"a paid route was called: {paid_calls}"
    assert not offsite, f"a request left this machine: {offsite}"
    assert len(controls) == 3, f"expected 3 negative controls, recorded {len(controls)}"

    print(f"{LABEL} passed: Add motion reaches the motion workspace from Frames in a real Chromium, the picker opens "
          f"on a dispatchable target on a project whose stored default is not, unwired targets state why they cannot "
          f"run and offer no paid action, and a batch approval reads as a human approval "
          f"({len(controls)} negative controls reintroduced, {len(controls)} caught, {len(paid_calls)} paid calls).")
    for line in findings:
        print(f"  - {line}")
    for name, why, detail in controls:
        print(f"  {name}   detected: {why}\n           receipt: {detail}")

finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
