#!/usr/bin/env python3
"""Postcompile Braidy lifecycle in real Chromium, with disposable data and mocked advice.

The exact deterministic H3 basis and native request review use CineBraid's real local
server. Only /improve is mocked: no OpenAI credential, provider call, or paid dispatch
can occur. The fake fal readiness string exists solely to open native request review.
"""

import json
import hashlib
import pathlib
import socket
import subprocess
import time

from browser_runtime import require_browser, launch_chromium, disposable_workspace

ROOT = pathlib.Path(__file__).resolve().parents[1]
sync_playwright = require_browser("Braidy postcompile browser lifecycle")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def seed_motion_build(project_file):
    script = r"""
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Kernel = require('./public/shared-authority-kernel');
const BuildHistory = require('./public/shared-build-history');
const { installTestManualActionSource } = require('./tests/authority-test-gesture');
const file = process.argv[1];
const project = JSON.parse(fs.readFileSync(file, 'utf8'));
const { addMotionPromptBuild, baseSpec } = require('./tests/h3-execution-fixture');
const shot = project.shots.find((row) => row.id === 'SAMPLE-03');
const projectDir = path.dirname(file);
const mediaPath = 'shots/SAMPLE-03/takes/SAMPLE-03-OPEN.png';
const frameFile = path.join(projectDir, ...mediaPath.split('/'));
const bytes = fs.readFileSync(frameFile);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const assetId = 'asset-' + digest.slice(0, 32);
const stat = fs.statSync(frameFile);
fs.writeFileSync(path.join(projectDir, 'media-assets.json'), JSON.stringify({ schemaVersion: 1,
  assets: [{ assetId, hashState: 'hashed', contentHash: 'sha256:' + digest,
    mediaType: 'image', role: 'frame-approved', source: 'generated', lifecycle: 'approved',
    scope: {}, storage: { path: mediaPath, bytes: stat.size, mtimeMs: stat.mtimeMs },
    legacy: {}, indexedAt: '2026-10-01T00:00:00.000Z' }],
}));
const manual = installTestManualActionSource(Kernel);
manual.gesture(() => Kernel.approveFrameCanon(project, {
  shotId: shot.id, frameId: 'frame-a', value: 'SAMPLE-03-OPEN.png', assetId,
  at: '2026-10-01T00:00:00.000Z', via: 'disposable-braidy-browser-fixture',
}));
shot.duration = 5;
shot.deliveryIntent = 'video';
shot.creationBrief.deliveryIntent = 'video';
shot.creationBrief.motionDirection = 'Continue the opened blue parcel; one slow camera push-in.';
shot.creationBrief.motionProfileId = 'minimax-h3/i2v';
// Seed through CineBraid's own creation normalizers before recording a build's
// dependency witness; a bare project sample has not materialized those defaults.
const vm = require('vm');
const client = fs.readFileSync('./public/creation-studio.js', 'utf8');
const start = client.indexOf('function ensureShotCreation(s) {');
const end = client.indexOf('function guidedFrameImage(', start);
if (start < 0 || end <= start) throw new Error('creation normalizers unavailable');
const normalizers = vm.runInNewContext(client.slice(start, end) +
  ';({ensureShotCreation,guidedFrameState})', {});
normalizers.ensureShotCreation(shot);
normalizers.guidedFrameState(shot, shot.keyframes[0], 0);
// v607-composer.js wraps the same creation normalizer with these read-time
// composition defaults. Materialize them before recording the saved witness.
const composition = shot.creationBrief.composition;
composition.baseFrame = { source: 'auto', zoom: 1, panX: 0, panY: 0, rotation: 0, fit: 'cover' };
composition.guides = { grid: true, snap: false };
composition.referenceSets = {};
const spec = baseSpec({
  shotId: shot.id, durationSeconds: 5,
  narrativePurpose: 'Hold the opened parcel clearly in the frame.',
  initialState: { subject: 'The opened blue parcel rests on the platform bench.', staging: '', camera: '', environment: 'Rainy platform.' },
  finalState: { subject: 'The opened parcel remains on the same bench.', staging: '', camera: '', environment: '' },
  actions: [], camera: { framing: 'medium-wide', movement: 'slow push-in', stability: 'steady', lensIntent: '', timing: '' },
  performance: {}, environmentMotion: ['subtle rain movement'], stagingLines: [],
  mustPreserve: ['blue paper and open folds'], mustAvoid: ['no new object'],
  identityCanon: [], driftRestatements: [], visualGrounding: [], promptEntities: [],
  productionRisks: [], promptWarnings: [], audio: { mode: 'none' }, references: [],
  visualStyle: ['flat illustrated style'], blockingEntities: [],
  world: { setting: 'Rainy platform.', aspectRatio: '16:9' }, aspectRatio: '16:9',
});
addMotionPromptBuild(project, shot.id, { id: 'braidy-browser-source', mode: 'i2v',
  durationSeconds: 5, spec, prompt: 'Saved authoring package; provider compilation differs.',
  references: [{ key: 'shot-start:frame-a:SAMPLE-03-OPEN.png', label: 'Opening frame SAMPLE-03-OPEN.png',
    role: 'first-frame', mediaType: 'image', approvedAssetId: assetId,
    url: '/assets/shots/SAMPLE-03/takes/SAMPLE-03-OPEN.png' }],
});
const source = project.promptBuildsById['braidy-browser-source'];
shot.deliveryRoute = 'i2v';
shot.clips = [{ id: 'sample-03-motion', suffix: 'a', label: 'A', title: 'Primary motion',
  kind: 'i2v', fromFrame: 'frame-a', toFrame: '', dur: 5,
  motionPrompt: shot.creationBrief.motionDirection, note: '', generationPackages: [],
  line: '', speakerId: '', audioNote: '', voiceEntityId: '', vo: '', sfx: '',
  ambience: '', music: '', emotion: '', delivery: '', language: '', pace: '',
  volume: '', sync: '', motionPlan: null, motionProfileId: '',
  motionIntensity: '', preserveComposition: null }];
source.mode = 'i2v';
source.segmentId = 'sample-03-motion';
source.dependencySnapshot = {
  ...BuildHistory.packageProjectInputs(project, shot, source,
    BuildHistory.packageDirection(shot, source)),
  ...BuildHistory.packageMotionInputs(shot, source),
  references: source.references.map((row) =>
    [row.key || '', row.url || '', row.role || '', row.mediaType || '', row.instruction || '']),
  durationSeconds: source.durationSeconds, profileId: source.profileId, mode: source.mode,
  canonContext: BuildHistory.packageCanonContextInputs(project, shot, source),
};
fs.writeFileSync(file, JSON.stringify(project, null, 2));
"""
    subprocess.run(["node", "-e", script, str(project_file)], cwd=ROOT, check=True)


workspace = disposable_workspace("braidy-postcompile-browser", sample=True, active_project="cinebraid-sample")
server = None
try:
    config_path = workspace.config_path
    projects_root = workspace.projects_root
    project_file = projects_root / "cinebraid-sample" / "project.json"
    seed_motion_build(project_file)
    initial_project = project_file.read_bytes()
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    cfg.setdefault("generation", {}).setdefault("fal", {}).update({"enabled": True, "h3Resolution": "2K"})
    config_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    port = free_port()
    server = subprocess.Popen(["node", "server.js"], cwd=ROOT,
        env=workspace.env(port, FAL_KEY="braidy-browser-placeholder-not-a-credential"),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.time() + 25
    while time.time() < deadline:
        if server.poll() is not None:
            out, err = server.communicate(timeout=2)
            raise RuntimeError(f"CineBraid exited during fixture startup ({server.returncode}): {out}\n{err}")
        try:
            with socket.create_connection(("127.0.0.1", port), .25):
                break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError(f"CineBraid did not start on {port}")

    base = f"http://127.0.0.1:{port}"
    basis = None
    advisory_calls = []
    paid_calls = []
    offsite = []
    errors = []
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label="Braidy postcompile browser lifecycle")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda error: errors.append(str(error)))

        def guard(route):
            request = route.request
            url = request.url
            if request.method == "POST" and url.endswith("/api/generation/fal/jobs"):
                paid_calls.append(url)
                return route.abort("blockedbyclient")
            if request.method == "POST" and url.endswith("/api/assistant/braidy/improve"):
                body = json.loads(request.post_data or "{}")
                advisory_calls.append(body)
                current_basis = basis_box[0]
                assert current_basis and body["baselineFingerprint"] == current_basis["basisFingerprint"]
                blocking = body.get("purpose") == "blocking"
                proposed = (current_basis["currentSubmittedTargetPrompt"] + "\nKeep grayscale forms readable.") if blocking else \
                    "The approved first frame holds the opened blue parcel on the rainy platform bench. Keep medium-wide framing with one steady slow camera push-in; preserve the blue paper, open folds, platform and flat illustrated style. No new object."
                result = {**current_basis, "proposal": {
                    "proposedPrompt": proposed,
                    "materialChanges": ["Clarified the target prompt without changing inputs."],
                    "warnings": [], "unsupportedOrAmbiguous": [],
                    "reasoningSummary": "Retains the target's current directed elements.",
                    "model": "fixture-luna", "responseId": "fixture-advisory-only",
                    "sendable": True, "sendRefusal": None, "editedCoverage": {"lost": []},
                }}
                return route.fulfill(status=200, content_type="application/json", body=json.dumps(result))
            if request.method == "POST" and url.endswith("/api/assistant/braidy/basis"):
                response = route.fetch()
                if response.ok:
                    basis_box[0] = response.json()
                return route.fulfill(response=response)
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if url.startswith("https://fonts.googleapis.com") or url.startswith("https://fonts.gstatic.com"):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(url)
            return route.abort("blockedbyclient")

        basis_box = [None]
        page.route("**/*", guard)
        page.goto(f"{base}/#/shot/SAMPLE-03", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.wait_for_function("() => typeof P !== 'undefined' && !!P?.shots?.find(s => s.id === 'SAMPLE-03')")
        page.evaluate("() => document.querySelectorAll('#main details').forEach(el => { el.open = true; })")
        before_normal_build = page.evaluate("() => JSON.parse(JSON.stringify(P.shots.find(s=>s.id==='SAMPLE-03')))")
        page.evaluate("""() => { const original=packageCanonContextInputs; window.__canonTrace=[]; window.packageCanonContextInputs=(...args)=>{ const result=original(...args), s=args[1], u=s?.clips?.[0]; window.__canonTrace.push({sha:result.sha256,caller:String(new Error().stack||'').split('\\n').slice(2,4).join(' / '),audio:s?.audio,unit:{note:u?.note,audioNote:u?.audioNote,motionBrief:u?.motionBrief,motionProfileId:u?.motionProfileId}}); return result; }; }""")
        source_id = page.evaluate("""async () => { await buildGuidedMotionPrompt('SAMPLE-03', false); const s=P.shots.find(s=>s.id==='SAMPLE-03'); return latestPromptBuild(P,s.creationBrief.motionPromptBuilds)?.id || ''; }""")
        assert source_id and source_id != "braidy-browser-source", "normal deterministic H3 Build did not create a fresh current package"
        normal_build = page.evaluate("""id => { const s=P.shots.find(s=>s.id==='SAMPLE-03'), b=P.promptBuildsById[id]; return {reasons:packageStaleReasons(s,b), saved:b.dependencySnapshot?.canonContext, current:packageCanonContextInputs(P,s,b), audio:s.audio, unit:s.clips.find(u=>u.id===b.segmentId)}; }""", source_id)
        if normal_build["reasons"]:
            after_normal_build = page.evaluate("() => JSON.parse(JSON.stringify(P.shots.find(s=>s.id==='SAMPLE-03')))")
            changed = []
            def walk(a, b, prefix="shot"):
                if isinstance(a, dict) and isinstance(b, dict):
                    for key in sorted(set(a) | set(b)):
                        walk(a.get(key), b.get(key), prefix + "." + key)
                elif isinstance(a, list) and isinstance(b, list):
                    for index in range(max(len(a), len(b))):
                        walk(a[index] if index < len(a) else None,
                             b[index] if index < len(b) else None, prefix + "[" + str(index) + "]")
                elif a != b:
                    changed.append(prefix)
            walk(before_normal_build, after_normal_build)
            trace = page.evaluate("() => window.__canonTrace")
            raise AssertionError(f"Normal H3 Build immediately stale: {normal_build!r}; changed_paths={changed[:80]!r}; trace={trace[-12:]!r}")
        page.evaluate("id => openBraidyPromptReview('h3', 'SAMPLE-03', id)", source_id)
        page.locator("#braidy-deterministic-prompt").wait_for()
        try:
            page.wait_for_function("() => !!document.querySelector('#braidy-deterministic-prompt')?.textContent", timeout=7000)
        except Exception as error:
            freshness = page.evaluate("""id => { const s=P.shots.find(s=>s.id==='SAMPLE-03'); const b=P.promptBuildsById[id]; return {reasons:packageStaleReasons(s,b), available:currentPackageReferenceOptions(s,b).map(x=>({key:x.key,assetId:x.approvedAssetId,url:x.url})), saved:b.references}; }""", source_id)
            seed_shot = next(s for s in json.loads(initial_project)["shots"] if s["id"] == "SAMPLE-03")
            loaded_shot = page.evaluate("() => JSON.parse(JSON.stringify(P.shots.find(s=>s.id==='SAMPLE-03')))")
            keys = ["motionPlan", "composition", "motionDirection", "motionDuration", "motionProfileId",
                "blockingFrameBrief", "blockingAdditionalDirection", "blockingRevisionRequest",
                "blockingIncludeLabels", "blockingEmphasis", "blockingProfileId", "frameWorkflows"]
            changed_brief = {k: (seed_shot.get("creationBrief", {}).get(k), loaded_shot.get("creationBrief", {}).get(k))
                for k in keys if seed_shot.get("creationBrief", {}).get(k) != loaded_shot.get("creationBrief", {}).get(k)}
            clip_delta = (seed_shot.get("clips"), loaded_shot.get("clips")) if seed_shot.get("clips") != loaded_shot.get("clips") else "unchanged"
            frame_delta = (seed_shot.get("keyframes"), loaded_shot.get("keyframes")) if seed_shot.get("keyframes") != loaded_shot.get("keyframes") else "unchanged"
            loaded_project = page.evaluate("() => JSON.parse(JSON.stringify(P))")
            seeded_project = json.loads(initial_project)
            shot_keys = ["id", "title", "scene", "desc", "positioning", "motionPrompt", "codes", "characters", "audio", "risks", "safe", "dur", "duration", "durationSeconds", "continuityStateSelections", "deliveryRoute", "packagePlanner"]
            shot_delta = {k: (seed_shot.get(k), loaded_shot.get(k)) for k in shot_keys if seed_shot.get(k) != loaded_shot.get(k)}
            meta_delta = {k: (seeded_project.get("meta", {}).get(k), loaded_project.get("meta", {}).get(k))
                for k in ["title", "format", "world", "globalStylePrompt", "globalNegativePrompt", "styleBlocks", "aspectRatio", "promptDefaults"]
                if seeded_project.get("meta", {}).get(k) != loaded_project.get("meta", {}).get(k)}
            scene_delta = "changed" if seeded_project.get("scenes") != loaded_project.get("scenes") else "unchanged"
            entity_delta = [list_name for list_name in ["characters", "locations", "props", "vehicles", "audio"]
                if seeded_project.get(list_name) != loaded_project.get(list_name)]
            raise AssertionError(f"Braidy basis did not render: status={page.locator('#braidy-review-status').inner_text()!r}; freshness={freshness!r}; changed_brief={changed_brief!r}; clip_delta={clip_delta!r}; frame_delta={frame_delta!r}; shot_delta={shot_delta!r}; meta_delta={meta_delta!r}; scene_delta={scene_delta!r}; entity_delta={entity_delta!r}; basis={basis_box[0]!r}; errors={errors!r}") from error
        basis = basis_box[0]
        source_before_accept = page.evaluate("id => JSON.stringify(P.promptBuildsById[id])", source_id)
        canon_before_accept = page.evaluate("""() => { const s=P.shots.find(s=>s.id==='SAMPLE-03'), b=s.creationBrief; const pick=(o,k)=>Object.fromEntries(k.map(x=>[x,o?.[x]])); return {project:pick(P.meta,['world','style','styleBlocks','aspectRatio','promptDefaults']),shot:pick(s,['id','title','desc','description','scene','action','positioning','characters','locations','props','vehicles','continuityStateSelections','motionPrompt']),creation:pick(b,['deliveryIntent','action','staging','camera','notes','motionDirection','motionDuration','motionProfileId','motionPlan','motionIntensity','preserveComposition','continuityStateSelections','frameWorkflowId','locationId','propIds','vehicleIds']),frames:s.keyframes.map(x=>pick(x,['id','label','title','description','winner','approvedAssetId','continuityStateSelections','required'])),entities:['characters','locations','props','vehicles','audio'].flatMap(list=>(P[list]||[]).filter(x=>[...(s.characters||[]),...(s.locations||[]),...(s.props||[]),...(s.vehicles||[])].includes(x.id)).map(x=>({list,record:x}))),receipts:P.productionAuthority?.receipts||[]}; }""")
        assert basis and basis["target"]["mode"] == "i2v", basis
        frame_file = projects_root / "cinebraid-sample" / "shots" / "SAMPLE-03" / "takes" / "SAMPLE-03-OPEN.png"
        assert basis["inputManifest"][0]["mediaIdentity"]["sha256"] == hashlib.sha256(frame_file.read_bytes()).hexdigest()
        assert basis["inputManifest"][0]["approvalStatus"] == "current-receipt-verified", basis["inputManifest"]
        assert basis["inputManifest"][0]["approvalReceiptId"], basis["inputManifest"]
        assert "MiniMax H3 · Image to Video" in page.locator("#braidy-target-label").inner_text()
        manifest = page.locator("#braidy-bound-inputs").text_content() or ""
        assert "SAMPLE-03-OPEN.png" in manifest and "first-frame" in manifest, (manifest, basis.get("inputManifest"))
        baseline = page.locator("#braidy-deterministic-prompt").inner_text()
        assert baseline and "Saved authoring package" not in baseline
        assert page.locator("#braidy-package-difference").is_visible()
        page.get_by_role("button", name="Ask Braidy").click()
        page.locator("#braidy-proposed-prompt").wait_for()
        page.get_by_role("button", name="Reject / keep current package").click()
        assert len(advisory_calls) == 1
        assert page.evaluate("id => JSON.stringify(P.promptBuildsById[id])", source_id) == source_before_accept,             "Reject changed the deterministic source package"
        assert not page.evaluate("() => Object.values(P.promptBuildsById || {}).some(b => b?.braidyReview?.acceptedPrompt)"),             "Reject created a target revision"

        page.evaluate("id => openBraidyPromptReview('h3', 'SAMPLE-03', id)", source_id)
        try:
            page.wait_for_function("() => !!document.querySelector('#braidy-deterministic-prompt')?.textContent", timeout=7000)
        except Exception as error:
            freshness = page.evaluate("""id => { const s=P.shots.find(s=>s.id==='SAMPLE-03'); const b=P.promptBuildsById[id]; return {reasons:packageStaleReasons(s,b), available:currentPackageReferenceOptions(s,b).map(x=>({key:x.key,assetId:x.approvedAssetId,url:x.url})), saved:b.references}; }""", source_id)
            seed_shot = next(s for s in json.loads(initial_project)["shots"] if s["id"] == "SAMPLE-03")
            loaded_shot = page.evaluate("() => JSON.parse(JSON.stringify(P.shots.find(s=>s.id==='SAMPLE-03')))")
            keys = ["motionPlan", "composition", "motionDirection", "motionDuration", "motionProfileId",
                "blockingFrameBrief", "blockingAdditionalDirection", "blockingRevisionRequest",
                "blockingIncludeLabels", "blockingEmphasis", "blockingProfileId", "frameWorkflows"]
            changed_brief = {k: (seed_shot.get("creationBrief", {}).get(k), loaded_shot.get("creationBrief", {}).get(k))
                for k in keys if seed_shot.get("creationBrief", {}).get(k) != loaded_shot.get("creationBrief", {}).get(k)}
            clip_delta = (seed_shot.get("clips"), loaded_shot.get("clips")) if seed_shot.get("clips") != loaded_shot.get("clips") else "unchanged"
            frame_delta = (seed_shot.get("keyframes"), loaded_shot.get("keyframes")) if seed_shot.get("keyframes") != loaded_shot.get("keyframes") else "unchanged"
            loaded_project = page.evaluate("() => JSON.parse(JSON.stringify(P))")
            seeded_project = json.loads(initial_project)
            shot_keys = ["id", "title", "scene", "desc", "positioning", "motionPrompt", "codes", "characters", "audio", "risks", "safe", "dur", "duration", "durationSeconds", "continuityStateSelections", "deliveryRoute", "packagePlanner"]
            shot_delta = {k: (seed_shot.get(k), loaded_shot.get(k)) for k in shot_keys if seed_shot.get(k) != loaded_shot.get(k)}
            meta_delta = {k: (seeded_project.get("meta", {}).get(k), loaded_project.get("meta", {}).get(k))
                for k in ["title", "format", "world", "globalStylePrompt", "globalNegativePrompt", "styleBlocks", "aspectRatio", "promptDefaults"]
                if seeded_project.get("meta", {}).get(k) != loaded_project.get("meta", {}).get(k)}
            scene_delta = "changed" if seeded_project.get("scenes") != loaded_project.get("scenes") else "unchanged"
            entity_delta = [list_name for list_name in ["characters", "locations", "props", "vehicles", "audio"]
                if seeded_project.get(list_name) != loaded_project.get(list_name)]
            raise AssertionError(f"Braidy basis did not render: status={page.locator('#braidy-review-status').inner_text()!r}; freshness={freshness!r}; changed_brief={changed_brief!r}; clip_delta={clip_delta!r}; frame_delta={frame_delta!r}; shot_delta={shot_delta!r}; meta_delta={meta_delta!r}; scene_delta={scene_delta!r}; entity_delta={entity_delta!r}; basis={basis_box[0]!r}; errors={errors!r}") from error
        page.get_by_role("button", name="Ask Braidy").click()
        editor = page.locator("#braidy-proposed-prompt")
        editor.wait_for()
        accepted = editor.input_value()
        page.get_by_role("button", name="Accept proposal").click()
        page.wait_for_function("() => !!document.querySelector('#braidy-omission-ack') || " +
            "Object.values(P.promptBuildsById || {}).some(b => b?.braidyReview?.acceptedPrompt)")
        if page.locator("#braidy-omission-ack").count():
            assert "no longer covers" in page.locator("#braidy-omission-confirm").inner_text()
            page.locator("#braidy-omission-ack").check()
            page.get_by_role("button", name="Accept proposal").click()
        try:
            page.wait_for_function("() => Object.values(P.promptBuildsById || {}).some(b => b?.braidyReview?.acceptedPrompt)", timeout=7000)
        except Exception as error:
            raise AssertionError(f"Accept did not save a target revision: status={page.locator('#braidy-review-status').inner_text()!r}; omission={page.locator('#braidy-omission-confirm').inner_text()!r}; errors={errors!r}") from error
        revised_id = page.evaluate("() => Object.values(P.promptBuildsById).find(b => b?.braidyReview?.acceptedPrompt)?.id")
        assert revised_id and revised_id != source_id
        assert page.evaluate("id => JSON.stringify(P.promptBuildsById[id])", source_id) == source_before_accept, "Accept mutated the original source package"
        assert len(advisory_calls) == 2
        assert page.evaluate("() => P.shots.find(s => s.id === 'SAMPLE-03').creationBrief.motionDirection") == \
            "Continue the opened blue parcel; one slow camera push-in."
        assert page.evaluate("id => P.promptBuildsById[id].braidyReview.basisFingerprint", revised_id) == basis["basisFingerprint"]
        # Flush the normal project save, then wait on observable disk state
        # and reload; an in-memory-only revision cannot pass this fixture.
        page.evaluate("async () => { await flushPendingProjectSave(); }")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            durable = json.loads(project_file.read_text(encoding="utf-8"))
            if durable.get("promptBuildsById", {}).get(revised_id, {}).get("braidyReview", {}).get("acceptedPrompt") == accepted:
                break
            time.sleep(.05)
        else:
            state = page.evaluate("""() => ({saveState:document.querySelector('#save-status')?.textContent,
                saveRevision:typeof SAVE_REVISION==='undefined'?null:SAVE_REVISION,
                savedRevision:typeof SAVED_REVISION==='undefined'?null:SAVED_REVISION,
                saveBlocked:typeof SAVE_BLOCKED==='undefined'?null:SAVE_BLOCKED,
                authoritySaveRefused:typeof AUTHORITY_SAVE_REFUSED==='undefined'?null:AUTHORITY_SAVE_REFUSED,
                projectSlug:typeof ACTIVE_PROJECT_SLUG==='undefined'?null:ACTIVE_PROJECT_SLUG})""")
            raise AssertionError(f"Accepted H3 target revision did not persist to the disposable project: "
                f"save={state!r}; disk_builds={list(durable.get('promptBuildsById', {}))[-4:]!r}; "
                f"memory_revision={revised_id!r}; errors={errors!r}")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("() => typeof P !== 'undefined' && !!P?.promptBuildsById")
        assert page.evaluate("id => P.promptBuildsById[id]?.braidyReview?.acceptedPrompt", revised_id) == accepted,             "Accepted target revision did not survive reload"
        page.evaluate("id => openFalH3MotionModal('SAMPLE-03', id)", revised_id)
        try:
            page.locator("#fal-h3-prompt-editor").wait_for(timeout=10000)
        except Exception as error:
            diagnostic = page.evaluate("""async ({id, old}) => { const b=P.promptBuildsById[id]; const s=P.shots.find(s=>s.id==='SAMPLE-03'); const r=await fetch('/api/assistant/braidy/basis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'h3',shotId:'SAMPLE-03',sourceBuildId:b.braidyReview.sourceBuildId,profileMode:'i2v',durationSeconds:5,resolution:'2K',aspectRatio:'16:9',submittedPrompt:b.prompt})}); const fresh=await r.json(); const keys=['source','sourceFreshness','deterministicPrompt','currentSubmittedTargetPrompt','inputManifest','coverage','warnings','generationSettings','target']; const differences=Object.fromEntries(keys.filter(k=>JSON.stringify(old[k])!==JSON.stringify(fresh[k])).map(k=>[k,{before:old[k],after:fresh[k]}])); return {freshness:packageStaleReasons(s,b), storedBasis:b.braidyReview.basisFingerprint, freshBasis:fresh.basisFingerprint, differences, verified:await verifyBraidyRevisionBasis('h3','SAMPLE-03',b), modal:document.getElementById('modal')?.innerText}; }""", {"id": revised_id, "old": basis})
            canon_after_accept = page.evaluate("""() => { const s=P.shots.find(s=>s.id==='SAMPLE-03'), b=s.creationBrief; const pick=(o,k)=>Object.fromEntries(k.map(x=>[x,o?.[x]])); return {project:pick(P.meta,['world','style','styleBlocks','aspectRatio','promptDefaults']),shot:pick(s,['id','title','desc','description','scene','action','positioning','characters','locations','props','vehicles','continuityStateSelections','motionPrompt']),creation:pick(b,['deliveryIntent','action','staging','camera','notes','motionDirection','motionDuration','motionProfileId','motionPlan','motionIntensity','preserveComposition','continuityStateSelections','frameWorkflowId','locationId','propIds','vehicleIds']),frames:s.keyframes.map(x=>pick(x,['id','label','title','description','winner','approvedAssetId','continuityStateSelections','required'])),entities:['characters','locations','props','vehicles','audio'].flatMap(list=>(P[list]||[]).filter(x=>[...(s.characters||[]),...(s.locations||[]),...(s.props||[]),...(s.vehicles||[])].includes(x.id)).map(x=>({list,record:x}))),receipts:P.productionAuthority?.receipts||[]}; }""")
            canon_delta = {section: {k: (canon_before_accept[section].get(k), canon_after_accept[section].get(k))
                for k in canon_after_accept[section] if canon_before_accept[section].get(k) != canon_after_accept[section].get(k)}
                for section in ["project", "shot", "creation"]}
            canon_delta["frames"] = (canon_before_accept["frames"], canon_after_accept["frames"]) if canon_before_accept["frames"] != canon_after_accept["frames"] else "unchanged"
            canon_delta["entities"] = "changed" if canon_before_accept["entities"] != canon_after_accept["entities"] else "unchanged"
            canon_delta["receipts"] = (len(canon_before_accept["receipts"]), len(canon_after_accept["receipts"])) if canon_before_accept["receipts"] != canon_after_accept["receipts"] else "unchanged"
            raise AssertionError(f"Accepted H3 native review did not open: {diagnostic!r}; canon_delta={canon_delta!r}; errors={errors!r}") from error
        assert page.locator("#fal-h3-prompt-editor").input_value() == accepted
        request = page.evaluate("() => window._falH3MotionRequest")
        assert request["prompt"] == accepted
        assert request.get("clientRequestId") and request.get("buildId") == revised_id, list(request)
        page.evaluate("() => closeModal()")

        # A later native manual edit is authored by the filmmaker, not a new Braidy
        # acceptance. Keep the accepted parent and its receipt, but do not attach
        # that receipt to different manual wording or refuse it after reload.
        manual_prompt = accepted + "\nOne human clarification: keep the frame stable."
        page.evaluate("id => openGuidedMotionPromptEditor('SAMPLE-03', id)", revised_id)
        page.locator("#guided-motion-prompt-editor").fill(manual_prompt)
        page.locator("#guided-motion-prompt-edit-reason").fill("Clarified the target wording after Braidy review.")
        page.locator("#guided-motion-prompt-editor-save").click()
        page.wait_for_function("({parent, prompt}) => Object.values(P.promptBuildsById || {}).some(b => b.parentBuildId === parent && b.prompt === prompt && b.id !== parent)",
            arg={"parent": revised_id, "prompt": manual_prompt})
        manual_id = page.evaluate("({parent, prompt}) => Object.values(P.promptBuildsById).find(b => b.parentBuildId === parent && b.prompt === prompt && b.id !== parent)?.id",
            {"parent": revised_id, "prompt": manual_prompt})
        assert manual_id and page.evaluate("id => !P.promptBuildsById[id].braidyReview", manual_id), \
            "A different manual prompt must not inherit the old Braidy review receipt"
        assert page.evaluate("id => !!P.promptBuildsById[id].braidyReview", revised_id), \
            "The accepted Braidy parent must retain its original provenance"
        page.evaluate("async () => { await flushPendingProjectSave(); }")
        durable = json.loads(project_file.read_text(encoding="utf-8"))
        assert durable.get("promptBuildsById", {}).get(manual_id, {}).get("prompt") == manual_prompt
        assert not durable["promptBuildsById"][manual_id].get("braidyReview")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("() => typeof P !== 'undefined' && !!P?.promptBuildsById")
        page.evaluate("id => openFalH3MotionModal('SAMPLE-03', id)", manual_id)
        page.locator("#fal-h3-prompt-editor").wait_for(timeout=10000)
        assert page.locator("#fal-h3-prompt-editor").input_value() == manual_prompt, \
            "The manually edited descendant must reopen in native review with its exact saved text"
        page.evaluate("() => closeModal()")

        # Qualified GPT Image 2 Blocking uses inline builds, not frame prompt history.
        blocking_id = page.evaluate("async () => (await buildBlockingPrompt('SAMPLE-03', false))?.id")
        assert blocking_id, "deterministic Blocking Build did not return a package"
        has_snapshot = page.evaluate("id => !!P.shots.find(s => s.id === 'SAMPLE-03').creationBrief.blockingBuilds.find(b => b.id === id)?.dependencySnapshot?.blockingInputs", blocking_id)
        assert has_snapshot, "new Blocking Build must record its specific authoring inputs"
        page.locator(".focused-task-button", has_text="Look & blocking").first.click()
        page.wait_for_selector(".blocking-prompt-result", state="attached")
        assert page.locator(".blocking-prompt-result button", has_text="Improve with Braidy").count() == 1
        page.evaluate("id => openBraidyPromptReview('blocking', 'SAMPLE-03', id)", blocking_id)
        try:
            page.wait_for_function("() => !!document.querySelector('#braidy-deterministic-prompt')?.textContent", timeout=7000)
        except Exception as error:
            freshness = page.evaluate("""id => { const s=P.shots.find(s=>s.id==='SAMPLE-03'); const b=P.promptBuildsById[id]; return {reasons:packageStaleReasons(s,b), available:currentPackageReferenceOptions(s,b).map(x=>({key:x.key,assetId:x.approvedAssetId,url:x.url})), saved:b.references}; }""", source_id)
            seed_shot = next(s for s in json.loads(initial_project)["shots"] if s["id"] == "SAMPLE-03")
            loaded_shot = page.evaluate("() => JSON.parse(JSON.stringify(P.shots.find(s=>s.id==='SAMPLE-03')))")
            keys = ["motionPlan", "composition", "motionDirection", "motionDuration", "motionProfileId",
                "blockingFrameBrief", "blockingAdditionalDirection", "blockingRevisionRequest",
                "blockingIncludeLabels", "blockingEmphasis", "blockingProfileId", "frameWorkflows"]
            changed_brief = {k: (seed_shot.get("creationBrief", {}).get(k), loaded_shot.get("creationBrief", {}).get(k))
                for k in keys if seed_shot.get("creationBrief", {}).get(k) != loaded_shot.get("creationBrief", {}).get(k)}
            clip_delta = (seed_shot.get("clips"), loaded_shot.get("clips")) if seed_shot.get("clips") != loaded_shot.get("clips") else "unchanged"
            frame_delta = (seed_shot.get("keyframes"), loaded_shot.get("keyframes")) if seed_shot.get("keyframes") != loaded_shot.get("keyframes") else "unchanged"
            loaded_project = page.evaluate("() => JSON.parse(JSON.stringify(P))")
            seeded_project = json.loads(initial_project)
            shot_keys = ["id", "title", "scene", "desc", "positioning", "motionPrompt", "codes", "characters", "audio", "risks", "safe", "dur", "duration", "durationSeconds", "continuityStateSelections", "deliveryRoute", "packagePlanner"]
            shot_delta = {k: (seed_shot.get(k), loaded_shot.get(k)) for k in shot_keys if seed_shot.get(k) != loaded_shot.get(k)}
            meta_delta = {k: (seeded_project.get("meta", {}).get(k), loaded_project.get("meta", {}).get(k))
                for k in ["title", "format", "world", "globalStylePrompt", "globalNegativePrompt", "styleBlocks", "aspectRatio", "promptDefaults"]
                if seeded_project.get("meta", {}).get(k) != loaded_project.get("meta", {}).get(k)}
            scene_delta = "changed" if seeded_project.get("scenes") != loaded_project.get("scenes") else "unchanged"
            entity_delta = [list_name for list_name in ["characters", "locations", "props", "vehicles", "audio"]
                if seeded_project.get(list_name) != loaded_project.get(list_name)]
            raise AssertionError(f"Braidy basis did not render: status={page.locator('#braidy-review-status').inner_text()!r}; freshness={freshness!r}; changed_brief={changed_brief!r}; clip_delta={clip_delta!r}; frame_delta={frame_delta!r}; shot_delta={shot_delta!r}; meta_delta={meta_delta!r}; scene_delta={scene_delta!r}; entity_delta={entity_delta!r}; basis={basis_box[0]!r}; errors={errors!r}") from error
        assert "GPT Image 2 · Blocking" in page.locator("#braidy-target-label").inner_text(), (page.locator("#braidy-target-label").inner_text(), page.locator("#braidy-review-status").inner_text(), basis_box[0].get("target") if basis_box[0] else None)
        page.get_by_role("button", name="Ask Braidy").click()
        blocking_editor = page.locator("#braidy-proposed-prompt")
        blocking_editor.wait_for()
        accepted_blocking = blocking_editor.input_value()
        page.get_by_role("button", name="Accept proposal").click()
        page.wait_for_function("() => P.shots.find(s => s.id === 'SAMPLE-03').creationBrief.blockingBuilds.some(b => b?.braidyReview?.acceptedPrompt)")
        blocking_revision = page.evaluate("() => P.shots.find(s => s.id === 'SAMPLE-03').creationBrief.blockingBuilds.find(b => b?.braidyReview?.acceptedPrompt)?.id")
        assert blocking_revision != blocking_id
        assert page.evaluate("() => P.shots.find(s => s.id === 'SAMPLE-03').creationBrief.motionDirection") == \
            "Continue the opened blue parcel; one slow camera push-in."
        page.evaluate("id => openFalFrameGenerationModal('blocking', 'SAMPLE-03', '', id)", blocking_revision)
        page.locator("#fal-frame-prompt-editor").wait_for(timeout=20000)
        assert page.locator("#fal-frame-prompt-editor").input_value() == accepted_blocking
        image_request = page.evaluate("() => window._falFrameRequest")
        assert image_request["prompt"] == accepted_blocking
        assert image_request.get("clientRequestId") and image_request.get("buildId") == blocking_revision
        assert paid_calls == [] and offsite == [] and errors == [], (paid_calls, offsite, errors)
        browser.close()

    print("braidy-postcompile-real-browser: real H3 I2V and GPT Image 2 Blocking basis, Reject, Accept, target-only revision and native request review passed; 0 OpenAI calls, 0 paid calls")
finally:
    if server is not None:
        server.terminate()
        try:
            server.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.communicate(timeout=10)
    workspace.cleanup()
