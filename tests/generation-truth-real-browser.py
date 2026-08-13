#!/usr/bin/env python3
"""Generation truth, read off the real compile routes in a real Chromium.

The two headline repairs in this batch are about what a PAID REQUEST WOULD CARRY, and
a helper assertion cannot establish that: the browser's motion-reference collector is
replaced at load time by public/v607-composer.js, and the package that matters is the
one the server compiles from the stored project. So this suite drives the shipped UI
writers in a real page and then reads the real /api/prompt/compile and
/api/generation/fal/h3/plan answers.

What it establishes:

  A  the MiniMax H3 keyframe panel's authored sequence - which frames are active, in
     what order, and the beat written against each - reaches the compiled package and
     is bound to consecutive provider reference slots. Before this batch the live
     collector emitted no `sequential-keyframe` role at all, so a three-beat shot
     compiled with one approved frame and the panel was decorative.

  B  minimax-h3/t2v is selectable, is not disabled, gathers no reference images, and
     builds a prompt. It resolves to the same wired fal adapter as i2v and flf and was
     filtered out of the picker, so the one prompt-only route CineBraid can run had no
     way to be chosen.

  C  the prompt ceiling the paid dialog states is the model-and-backend one, and the
     retired 2,000-character refusal is not what the editor enforces.

NOTHING HERE IS PAID. Every route used is local computation: /api/prompt/compile and
/api/generation/fal/h3/plan both compile and return. The suite fails if any request
leaves the loopback host or if /api/generation/fal/jobs - the only route that spends
money - is ever called. FAL_KEY is a string that is not a credential, purely so the
client-side "is fal configured" gate opens.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped sample are
never touched, and the directory is removed at the end.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Generation truth / routing real-browser audit"
sync_playwright = require_browser(LABEL)

SHOT = "SAMPLE-01"
PAID_ROUTE = "/api/generation/fal/jobs"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")

console_errors, page_errors, offsite, paid_calls = [], [], [], []
findings = []


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-gentruth-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_dir = projects_root / "dogfood-sample"

# A three-beat shot: the shape the multi-frame workflow exists for, and the shape the
# panel can order. The takes are copies of the sample's own approved frame, so no new
# binary enters the repository.
takes_dir = project_dir / "shots" / SHOT / "takes"
for name in ("SAMPLE-01-BEAT-B.png", "SAMPLE-01-BEAT-C.png"):
    shutil.copyfile(takes_dir / "SAMPLE-01-ARRIVAL.png", takes_dir / name)

project_file = project_dir / "project.json"
project = json.loads(project_file.read_text(encoding="utf-8"))
shot = next(row for row in project["shots"] if row["id"] == SHOT)
shot["keyframes"] = [
    {"id": "frame-a", "label": "A", "title": "First frame", "winner": "SAMPLE-01-ARRIVAL.png",
     "description": "Courier steps onto the platform.", "required": True,
     "generationPackages": [], "selectedCandidate": ""},
    {"id": "frame-b", "label": "B", "title": "Middle beat", "winner": "SAMPLE-01-BEAT-B.png",
     "description": "Courier reaches the bench.", "required": True,
     "generationPackages": [], "selectedCandidate": ""},
    {"id": "frame-c", "label": "C", "title": "Final frame", "winner": "SAMPLE-01-BEAT-C.png",
     "description": "Courier sets the parcel down.", "required": True,
     "generationPackages": [], "selectedCandidate": ""},
]
shot["creationBrief"]["frames"] = [
    {"id": row["id"], "label": row["label"], "title": row["title"], "action": row["description"],
     "selectedCandidate": "", "promptBuilds": []} for row in shot["keyframes"]]
project_file.write_text(json.dumps(project, indent=2), encoding="utf-8")

config = json.loads(config_path.read_text(encoding="utf-8"))
config["generation"] = {"fal": {"enabled": True, "frameOutputs": 2, "blockingOutputs": 2}}
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "FAL_KEY": "generation-truth-browser-qa-placeholder-not-a-credential"},
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
        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=20000)
        page.wait_for_timeout(1500)

        assert not page_errors, f"the workspace raised uncaught errors: {page_errors}"

        # The premise: the composer that replaces the collector is the one running.
        owner = page.evaluate("""() => ({
            ready: !!window.__CINEBRAID_COMPOSER_607_READY,
            collector: guidedMotionReferences.name,
            profiles: guidedVideoProfiles.name,
        })""")
        assert owner["ready"], "the v6.0.7 composer must be active in the shipped page"
        assert owner["collector"] == "guidedMotionReferences607", \
            f"the live collector must be the composer's, got {owner['collector']!r}"
        findings.append(f"ownership: the page runs {owner['collector']} and {owner['profiles']}")

        # ---- A. the authored keyframe sequence reaches the compiled package ----
        built = page.evaluate("""async shotId => {
            const target = guidedVideoProfiles().find(p => p.family === 'minimax-h3' && p.mode === 'r2v');
            if (!target) return { error: 'no minimax-h3 r2v profile in the picker' };
            setGuidedMotionField(shotId, 'motionProfileId', target.id);
            // the panel's own writers: activate the middle waypoint and direct each beat
            setH3KeyframeEnabled(shotId, 'frame-b', true);
            setH3KeyframeNote(shotId, 'frame-a', 'BEAT-OPEN: parcel still held high');
            setH3KeyframeNote(shotId, 'frame-b', 'BEAT-MIDDLE: reaches the bench');
            setH3KeyframeNote(shotId, 'frame-c', 'BEAT-CLOSE: parcel set down');
            setH3SequenceNote(shotId, 'SEQ-NOTE: pass through each beat, never hold as a slideshow');
            setGuidedMotionField(shotId, 'motionDirection', 'Measured push in across the platform.');
            await new Promise(r => setTimeout(r, 200));
            await buildGuidedMotionPrompt(shotId, false);
            await new Promise(r => setTimeout(r, 600));
            const c = ensureShotCreation(shotById(shotId));
            const build = resolvePromptBuildList(P, c.motionPromptBuilds || []).at(-1);
            if (!build) return { error: 'no motion package was produced' };
            return {
              buildId: build.id,
              profileId: build.profileId,
              waypoints: (build.references || []).filter(r => r.role === 'sequential-keyframe')
                .map(r => ({ file: String(r.url || '').split('/').pop(), instruction: String(r.instruction || '') })),
              promptHasSequenceNote: String(build.prompt || '').includes('SEQ-NOTE'),
              promptHasMiddleBeat: String(build.prompt || '').includes('BEAT-MIDDLE'),
            };
        }""", SHOT)
        assert not built.get("error"), f"A: {built.get('error')}"
        assert built["profileId"] == "minimax-h3/multi-frame", \
            f"A: the package must compile for the chosen multi-frame target, got {built['profileId']!r}"
        files = [row["file"] for row in built["waypoints"]]
        assert files == ["SAMPLE-01-ARRIVAL.png", "SAMPLE-01-BEAT-B.png", "SAMPLE-01-BEAT-C.png"], \
            f"A: all three authored waypoints must travel in the panel's order, got {files}"
        assert "BEAT-MIDDLE" in built["waypoints"][1]["instruction"], \
            "A: the beat directed against the middle frame must reach its reference"
        assert built["promptHasSequenceNote"], "A: the sequence direction must reach the compiled prompt"
        assert built["promptHasMiddleBeat"], "A: the per-frame beats must reach the compiled prompt"
        findings.append("A: the authored three-beat sequence reaches the compiled package in the panel's order, "
                        "each waypoint carrying the beat directed against its frame")

        # ---- and the provider request binds them to consecutive image slots -----
        plan = page.evaluate("""async ([shotId, buildId]) => {
            if (typeof flushPendingProjectSave === 'function') await flushPendingProjectSave();
            const response = await fetch('/api/generation/fal/h3/plan', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shotId, sourceBuildId: buildId, durationSeconds: 5, profileMode: 'r2v' }),
            });
            const data = await response.json();
            if (!response.ok) return { httpError: response.status, body: data };
            return {
              mode: data.mode,
              dispatchModel: data.dispatch && data.dispatch.model,
              bindings: (data.dispatch && data.dispatch.bindings || [])
                .map(b => ({ field: b.field, index: b.index, role: b.role })),
              maxPromptCharacters: data.maxPromptCharacters,
              modelMaxPromptCharacters: data.modelMaxPromptCharacters,
              refusal: data.refusal || null,
            };
        }""", [SHOT, built["buildId"]])
        assert not plan.get("httpError"), f"A: the H3 plan route refused: {plan}"
        assert plan["refusal"] is None, f"A: the compiled multi-frame request must be dispatchable, got {plan['refusal']}"
        waypoint_slots = [b for b in plan["bindings"] if b["role"] == "sequential-keyframe"]
        assert [b["index"] for b in waypoint_slots] == [0, 1, 2], \
            f"A: waypoints must fill consecutive provider image slots, got {waypoint_slots}"
        assert all(b["field"] == "reference_image_urls" for b in waypoint_slots), \
            f"A: waypoints must bind to the reference image field, got {waypoint_slots}"
        findings.append(f"A: the provider request binds them to {plan['bindings'][0]['field']}[0..2] on "
                        f"{plan['dispatchModel']}, and the request carries no refusal")

        # ---- C. the ceiling stated beside the paid action is the real one ------
        assert plan["maxPromptCharacters"] == plan["modelMaxPromptCharacters"] == 7000, \
            f"C: the dispatch ceiling must be the model-and-backend one, got {plan['maxPromptCharacters']}"
        editor_ceiling = page.evaluate(
            "() => motionPromptCharacterLimit({ profileId: 'minimax-h3/multi-frame' })")
        assert editor_ceiling == 7000, \
            f"C: the prompt editor must not enforce the retired 2,000 refusal, got {editor_ceiling}"
        findings.append(f"C: the paid dialog and the prompt editor both state {editor_ceiling:,} characters, "
                        "and the retired 2,000 refusal is gone")

        # ---- B. t2v is reachable, selectable, and carries nothing --------------
        t2v = page.evaluate("""async shotId => {
            const target = guidedVideoProfiles().find(p => p.family === 'minimax-h3' && p.mode === 't2v');
            if (!target) return { inPicker: false };
            const markup = guidedVideoProfileOptions(target.id);
            const row = markup.match(/<option value="minimax-h3\\/t2v"[^>]*>[^<]*/);
            setGuidedMotionField(shotId, 'motionProfileId', target.id);
            setGuidedMotionField(shotId, 'motionDirection', 'Rain on an empty platform, slow drift.');
            await new Promise(r => setTimeout(r, 200));
            await buildGuidedMotionPrompt(shotId, false);
            await new Promise(r => setTimeout(r, 600));
            const c = ensureShotCreation(shotById(shotId));
            const build = resolvePromptBuildList(P, c.motionPromptBuilds || []).at(-1);
            return {
              inPicker: true,
              dispatchable: !!(target.execution && target.execution.dispatchable === true),
              optionRow: row ? row[0] : null,
              optionDisabled: row ? / disabled/.test(row[0]) : null,
              builtProfileId: build ? build.profileId : null,
              buildRoles: build ? (build.references || []).map(r => r.role) : null,
              buildPromptLength: build ? String(build.prompt || '').length : 0,
            };
        }""", SHOT)
        assert t2v["inPicker"], "B: minimax-h3/t2v must appear in the guided motion picker"
        assert t2v["dispatchable"], "B: minimax-h3/t2v must be annotated dispatchable by the server"
        assert t2v["optionDisabled"] is False, f"B: a wired route must stay selectable, got {t2v['optionRow']!r}"
        assert t2v["builtProfileId"] == "minimax-h3/t2v", \
            f"B: the package must compile for t2v, got {t2v['builtProfileId']!r}"
        assert t2v["buildRoles"] == [], f"B: text-to-video must carry no references, got {t2v['buildRoles']}"
        assert t2v["buildPromptLength"] > 0, "B: text-to-video must still produce a prompt"
        findings.append(f"B: t2v is selectable, compiles a {t2v['buildPromptLength']:,}-character prompt, "
                        "and carries no reference images")

        assert not page_errors, f"the workspace raised uncaught errors: {page_errors}"
        assert not console_errors, f"console errors: {console_errors}"
        browser.close()

    assert not paid_calls, f"a paid route was called: {paid_calls}"
    assert not offsite, f"a request left this machine: {offsite}"
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)

print(f"{LABEL} passed: the H3 keyframe panel's authored sequence reaches the compiled package and the "
      f"provider request in order, text-to-video is reachable and carries nothing, prompt ceilings agree "
      f"across the editor and the paid dialog, and no paid route was contacted (0 paid calls).")
for line in findings:
    print(f"  - {line}")
