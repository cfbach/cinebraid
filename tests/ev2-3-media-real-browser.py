#!/usr/bin/env python3
"""EV2-3 focused workflow acceptance. Synthetic projects only; no sample reads."""
import json, os, pathlib, socket, struct, subprocess, sys, time, zlib, urllib.request, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from browser_runtime import require_browser, launch_chromium, disposable_workspace, canon_receipts
def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port

def png(width, height, rgb):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    raw = b""
    # A tiny procedural set: horizon, practical lighting and a human-scale silhouette.
    for y in range(height):
        row=bytearray()
        for x in range(width):
            shade=.45+.55*(1-y/height)
            color=tuple(int(c*shade) for c in rgb)
            if y>height*.68:color=tuple(int(c*.3) for c in rgb)
            if width*.08<x<width*.28 and height*.18<y<height*.66:color=(int(150+y*.3),int(100+y*.15),65)
            if width*.68<x<width*.77 and height*.37<y<height*.86:color=(13,19,22)
            if ((x-width*.725)/(width*.035))**2+((y-height*.32)/(height*.055))**2<1:color=(13,19,22)
            row.extend(color)
        raw += b"\x00"+bytes(row)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))

def iso(day):
    return f"2026-08-{day:02d}T12:00:00.000Z"

def build_fixture(projects_root):
    slug = "o5-media-qa"
    root = projects_root / slug
    for sub in ("anchors", "plates", "props", "vehicles", "audio", "media", "docs"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    for shot in ("SH010", "SH020"):
        for sub in ("takes", "locked", "blocking"):
            (root / "shots" / shot / sub).mkdir(parents=True, exist_ok=True)

    files = {
        "anchors/KAI_DEFAULT_V001.png": (58, 96, 74),
        "anchors/KAI_FAL_CANDIDATE_2.png": (70, 78, 96),
        "anchors/KAI_FAL_CANDIDATE_3.png": (104, 58, 52),
        "plates/HULL_DEFAULT_V001.png": (52, 68, 88),
        "media/animatic-opening.png": (72, 64, 84),
        "shots/SH010/takes/SH010_FRAME_A_V001.png": (46, 84, 92),
        "shots/SH010/takes/SH010_FRAME_B_V001.png": (58, 62, 104),
        "shots/SH010/takes/SH010_FRAME_A_FAL_2.png": (110, 60, 58),
        "shots/SH010/blocking/SH010_BLOCKING_FAL_1.png": (96, 96, 96),
        "shots/SH010/locked/SH010_FRAME_A_V001.png": (46, 84, 92),
        "shots/SH020/takes/SH020_FRAME_A_FAL_1.png": (46, 84, 92),
    }
    for rel, rgb in files.items():
        (root / rel).write_bytes(png(320, 200, rgb))
    # A motion take, so the metered-but-unpriced cost state is reachable. The bytes are a
    # placeholder: nothing here decodes video, and the Inspector's <video> element is asked
    # only for metadata. What matters is that the FILE EXISTS, because the scan enumerates
    # the directory and a missing file would drop the record the cost case lives on.
    (root / "shots/SH010/takes/SH010_MOTION_H3_1.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)

    project = {
        "meta": {"id": slug, "title": "O5 Media QA", "version": "6.6.4-studio.2", "code": "O5QA",
                 "styleBlocks": [], "iterBudget": {"A": 12, "B": 3},
                 "world": {"setting": "", "include": "", "reject": ""}, "refSyntax": "@imageN",
                 "models": [], "aiPolicy": "project-default", "workflowEmphasis": "manual",
                 "defaults": {"stillModel": "", "videoModel": ""}},
        "scenes": [{"id": "SC01", "title": "Hull sequence", "tier": "A", "whatHappens": "", "howItFeels": ""}],
        "characters": [{
            "id": "KAI", "name": "Kai", "prefix": "KAI", "block": "Kai identity block",
            "status": "APPROVED", "workflowStatus": "APPROVED",
            "approvedFile": "KAI_DEFAULT_V001.png", "approvedAt": iso(1),
            "continuityStates": [{"id": "state-default", "name": "Default", "isDefault": True,
                                  "approvedFile": "KAI_DEFAULT_V001.png", "approvedAt": iso(1)}],
            # A COVERAGE VIEW IS A SELECTION, NOT AN APPROVAL. Batch 1C removed the
            # claim that a chosen view is production authority, and the app migrates a
            # legacy `approvedFile`/`approved` slot to `selectedFile`/`selected` on load
            # -- a write this suite's own no-mutation guard then read as browsing having
            # changed an approval. Authored in the shape the app actually persists, so
            # loading the fixture rewrites nothing.
            "coverageSlots": [{"id": "front", "label": "Front", "selectedFile": "KAI_DEFAULT_V001.png", "status": "selected"}],
            "candidateFiles": [
                {"stored": "KAI_DEFAULT_V001.png", "addedAt": iso(1), "decision": "approved-reference",
                 "humanApproved": True, "decidedAt": iso(1),
                 "approvalProvenance": {"source": "human", "aiReviewed": True, "aiPassed": True, "approvedAt": iso(1)},
                 "generationProvider": "fal", "generationModel": "openai/gpt-image-2",
                 "generationJobId": "job-kai-1", "generationRequestId": "req-kai-1",
                 "prompt": "Kai, head and shoulders, neutral studio light, front view.",
                 "structuredReviews": {"state-default": {
                     "contractVersion": "reference-authority-v3",
                     "reviewer": {"provider": "openai", "model": "gpt-5.0-vision-2026-03"},
                     "reviewedAt": iso(1), "pass": True, "modelPass": True, "score": 94,
                     "recommendation": "approve", "summary": "Identity and state both match.",
                     "semanticOutcome": "validated-strong", "semanticLabel": "Declared state observed",
                     "semanticSatisfied": True, "stateEvidence": {"requirements": []}, "blockers": []}}},
                # AI RECOMMENDED. NOBODY APPROVED. The headline semantic-safety case.
                {"stored": "KAI_FAL_CANDIDATE_2.png", "addedAt": iso(2), "decision": "unreviewed",
                 "generationProvider": "fal", "generationModel": "openai/gpt-image-2",
                 "generationJobId": "job-kai-2", "prompt": "Kai, three-quarter view.",
                 "structuredReviews": {"state-default": {
                     "contractVersion": "reference-authority-v3",
                     "reviewer": {"provider": "openai", "model": "gpt-5.0-vision-2026-03"},
                     "reviewedAt": iso(2), "pass": True, "modelPass": True, "score": 88,
                     "recommendation": "approve", "summary": "Passes every declared check.",
                     "stateEvidence": {"requirements": []}, "blockers": []}}},
                # REJECTED, retained, no reason recorded anywhere.
                {"stored": "KAI_FAL_CANDIDATE_3.png", "addedAt": iso(3), "decision": "rejected", "decidedAt": iso(3),
                 "generationProvider": "fal", "generationModel": "openai/gpt-image-2", "generationJobId": "job-kai-3"},
            ]}],
        "locations": [{"id": "HULL", "name": "Hull bay", "prefix": "HULL", "status": "APPROVED",
                       "workflowStatus": "APPROVED", "approvedFile": "HULL_DEFAULT_V001.png",
                       "continuityStates": [{"id": "state-default", "name": "Default", "isDefault": True,
                                             "approvedFile": "HULL_DEFAULT_V001.png"}],
                       "candidateFiles": [{"stored": "HULL_DEFAULT_V001.png", "addedAt": iso(1),
                                           "decision": "approved-reference", "humanApproved": True, "decidedAt": iso(1)}]}],
        "props": [], "vehicles": [], "audio": [], "decisions": [], "jobs": [], "agentRuns": [],
        "shots": [
            {"id": "SH010", "scene": "SC01", "title": "Hull check", "desc": "Kai checks the hull panel",
             "status": "BUILT", "workflowStatus": "IN PROGRESS", "reviewStatus": "PENDING",
             "winner": "SH010_FRAME_A_V001.png",
             "keyframes": [{"id": "kf-a", "label": "A", "title": "Opening", "winner": "SH010_FRAME_A_V001.png"},
                           {"id": "kf-b", "label": "B", "title": "Closing", "winner": "SH010_FRAME_B_V001.png"}],
             "clips": [{"id": "clip-1", "suffix": "A", "label": "A", "kind": "motion", "title": "Panel open", "videoWinner": ""}],
             "candidateFiles": [
                 {"stored": "SH010_FRAME_A_V001.png", "addedAt": iso(4), "decision": "shortlist",
                  "approvedAt": iso(5), "approvedTarget": "frame:kf-a", "frameId": "kf-a",
                  "renamedFrom": ["SH010_FRAME_A_FAL_1.png"], "renamedAt": iso(5), "sourceBuildId": "build-frame-a",
                  "generationProvider": "fal", "generationModel": "openai/gpt-image-2",
                  "generationJobId": "job-frame-a", "generationRequestId": "req-frame-a",
                  # AI SAID CORRECT. THE HUMAN APPROVED ANYWAY.
                  "aiReview": {"score": 62, "pass": False, "notes": "Camera height drifts from the brief.",
                               "reviewedAt": iso(4), "strategy": "strict"}},
                 # LEGACY: the job is in the ledger and recorded no accounting.
                 {"stored": "SH010_FRAME_B_V001.png", "addedAt": iso(4), "decision": "shortlist",
                  "approvedAt": iso(5), "approvedTarget": "frame:kf-b", "frameId": "kf-b",
                  "generationProvider": "fal", "generationModel": "openai/gpt-image-2", "generationJobId": "job-frame-b"},
                 {"stored": "SH010_FRAME_A_FAL_2.png", "addedAt": iso(4), "decision": "rejected", "reviewedAt": iso(6),
                  "frameId": "kf-a", "correctionOf": "SH010_FRAME_A_V001.png",
                  "generationProvider": "fal", "generationModel": "openai/gpt-image-2", "generationJobId": "job-frame-a"},
                 # METERED AND HONESTLY UNPRICED: the fourth money state.
                 {"stored": "SH010_MOTION_H3_1.mp4", "addedAt": iso(7), "decision": "unreviewed",
                  "labels": ["MiniMax H3", "i2v"],
                  "generationProvider": "fal", "generationModel": "minimax/h3/image-to-video",
                  "generationJobId": "job-motion-1", "generationRequestId": "req-motion-1",
                  "generationProfileMode": "i2v", "generationResolution": "2K"},
             ]},
            {"id": "SH020", "scene": "SC01", "title": "Panel close", "desc": "The panel closes",
             "status": "BUILT", "workflowStatus": "IN PROGRESS",
             "keyframes": [{"id": "kf-a", "label": "A", "title": "Opening", "winner": ""}], "clips": [],
             # NAMES A JOB THE LEDGER DOES NOT CONTAIN.
             "candidateFiles": [{"stored": "SH020_FRAME_A_FAL_1.png", "addedAt": iso(8), "decision": "unreviewed",
                                 "frameId": "kf-a", "generationProvider": "fal",
                                 "generationModel": "openai/gpt-image-2", "generationJobId": "job-vanished"}]},
        ],
        "mediaAssets": [
            {"id": "blocking-media-1", "file": "SH010_BLOCKING_FAL_1.png",
             "storagePath": "shots/SH010/blocking/SH010_BLOCKING_FAL_1.png",
             "originalName": "blocking.png", "title": "SH010 - FAL blocking 1", "kind": "image",
             "notes": "Blocking frame - geometric planning scaffold, not visual canon.",
             "generationRecord": {"provider": "fal", "model": "openai/gpt-image-2", "requestId": "req-blocking-1",
                                  "jobId": "job-blocking-1", "prompt": "Greyscale blocking scaffold.",
                                  "quality": "low", "resolution": "1k", "date": iso(3)},
             "createdAt": iso(3),
             "links": [{"id": "link-b1", "targetType": "shot", "targetId": "SH010", "role": "blocking-frame",
                        "order": 0, "blockingFrameId": "kf-a", "blockingVersion": "B01",
                        "generationInput": False, "agentContext": True}]},
            {"id": "media-planning-1", "file": "animatic-opening.png", "originalName": "animatic-opening.png",
             "title": "Animatic - opening", "kind": "image", "createdAt": iso(1),
             "links": [{"id": "link-p1", "targetType": "shot", "targetId": "SH010", "role": "animatic-frame",
                        "order": 0, "generationInput": False, "agentContext": True}]},
        ],
    }
    # THE APPROVED DISPOSITION IS A RECEIPT, NOT A POINTER. The three dispositions this
    # suite exists to tell apart - approved / candidate / rejected - are read through the
    # production-truth projection, so a fixture that only sets approvedFile and winner has
    # nothing approved in it and the whole disposition case is untested. These are the
    # approvals the fixture always meant to describe.
    project["productionAuthority"] = canon_receipts([
        {"kind": "entity-state", "list": "characters", "entityId": "KAI", "stateId": "state-default",
         "value": "KAI_DEFAULT_V001.png"},
        {"kind": "entity-state", "list": "locations", "entityId": "HULL", "stateId": "state-default",
         "value": "HULL_DEFAULT_V001.png"},
        {"kind": "shot-frame", "shotId": "SH010", "frameId": "kf-a", "value": "SH010_FRAME_A_V001.png"},
        {"kind": "shot-frame", "shotId": "SH010", "frameId": "kf-b", "value": "SH010_FRAME_B_V001.png"},
    ], via="production-media-fixture")
    (root / "project.json").write_text(json.dumps(project, indent=2) + "\n", encoding="utf-8")

    def estimate(amount=None, confidence="estimated", unpriced=None):
        est = {"costClass": "metered_api", "unit": "usd", "confidence": confidence}
        if amount is not None:
            est["amount"] = amount
        basis = {"unitBasis": "image", "quantity": 1}
        if unpriced:
            basis["unpricedReason"] = unpriced
        return {"costClass": "metered_api", "estimate": est, "recordedAt": iso(1), "basis": basis}

    jobs = [
        {"id": "job-kai-1", "purpose": "entity-reference", "provider": "fal", "model": "openai/gpt-image-2",
         "externalId": "req-kai-1", "status": "COMPLETED", "createdAt": iso(1), "updatedAt": iso(1), "ingestedAt": iso(1),
         "accounting": estimate(0.04),
         "outputs": [{"type": "entity-candidate", "name": "KAI_DEFAULT_V001.png", "url": "/assets/anchors/KAI_DEFAULT_V001.png"}]},
        {"id": "job-kai-2", "purpose": "entity-reference", "provider": "fal", "model": "openai/gpt-image-2",
         "status": "COMPLETED", "createdAt": iso(2), "updatedAt": iso(2), "accounting": estimate(0.02), "outputs": []},
        {"id": "job-kai-3", "purpose": "entity-reference", "provider": "fal", "model": "openai/gpt-image-2",
         "status": "COMPLETED", "createdAt": iso(3), "updatedAt": iso(3), "outputs": []},
        {"id": "job-frame-a", "purpose": "frame", "provider": "fal", "model": "openai/gpt-image-2",
         "externalId": "req-frame-a", "status": "COMPLETED", "createdAt": iso(4), "updatedAt": iso(5),
         "accounting": estimate(0.06), "outputs": []},
        # LEGACY: no accounting object at all -> cost not recorded.
        {"id": "job-frame-b", "purpose": "frame", "provider": "fal", "model": "openai/gpt-image-2",
         "status": "COMPLETED", "createdAt": iso(4), "updatedAt": iso(4), "outputs": []},
        # Metered by duration with no server-side rate: accounting EXISTS and says it does
        # not know, which is a different answer from having no accounting at all.
        {"id": "job-motion-1", "purpose": "motion-h3", "provider": "fal", "model": "minimax/h3/image-to-video",
         "externalId": "req-motion-1", "profileMode": "i2v", "durationSeconds": 6, "resolution": "2K",
         "status": "COMPLETED", "createdAt": iso(7), "updatedAt": iso(7), "ingestedAt": iso(7),
         "accounting": estimate(None, "unknown", "no-per-image-rate-for-this-output"), "outputs": []},
        {"id": "job-blocking-1", "purpose": "blocking", "provider": "fal", "model": "openai/gpt-image-2",
         "externalId": "req-blocking-1", "status": "COMPLETED", "createdAt": iso(3), "updatedAt": iso(3),
         "accounting": estimate(0.01), "outputs": []},
    ]
    (root / "generation-jobs.json").write_text(json.dumps(jobs, indent=2) + "\n", encoding="utf-8")
    return slug

OUT=pathlib.Path(os.environ.get('EV2_ACCEPTANCE_DIR') or tempfile.mkdtemp(prefix='cinebraid-ev2-3-captures-'))
OUT.mkdir(parents=True,exist_ok=True)
workspace=disposable_workspace('ev2-3-media',sample=False,active_project='o5-media-qa')
slug=build_fixture(workspace.projects_root)
project_root=workspace.projects_root/slug
# Additional real synthetic playable audio and video, plus enough images to exercise pagination.
import wave
with wave.open(str(project_root/'audio'/'room-tone.wav'),'wb') as wav:
    wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(8000);wav.writeframes(b'\x00\x00'*16000)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0x334d57:s=320x200:d=2','-c:v','libx264','-pix_fmt','yuv420p',str(project_root/'shots/SH010/takes/SH010_MOTION_H3_1.mp4')],check=True)
project=json.loads((project_root/'project.json').read_text())
project['meta']['title']='The Last Signal · EV2-3 synthetic production'
project['shots'][1]['keyframes'][0]['id']='kf-c'
project['shots'][1]['candidateFiles'][0]['frameId']='kf-c'
project['characters'][0]['continuityStates'].append({'id':'state-night','name':'Night shift','isDefault':False})
project['characters'][0]['candidateFiles'][1]['targetStateId']='state-night'
for i in range(55):
    name=f'contact-{i:03d}.png';(project_root/'media'/name).write_bytes(png(320,200,(35+i,55+i//2,65+i//3)))
    project['mediaAssets'].append({'id':f'media-contact-{i}','file':name,'kind':'image','title':f'Harbor study {i+1:02d}','createdAt':f'2026-09-{i%14+1:02d}T12:00:00Z','links':[{'targetType':'scene','targetId':'SC01'}]})
(project_root/'project.json').write_text(json.dumps(project),encoding='utf-8')
port=free_port();base=f'http://127.0.0.1:{port}'
log=open(OUT/'runtime.log','w',encoding='utf-8')
server=subprocess.Popen(['node','server.js'],cwd=ROOT,env=workspace.env(port),stdout=log,stderr=log)
checks=[];errors=[];blocked=[];allow_enroll=False
def check(name,value):
    checks.append({'check':name,'passed':bool(value)})
    if not value:raise AssertionError(name)
try:
    for _ in range(120):
        try:urllib.request.urlopen(base+'/api/project',timeout=1);break
        except Exception:time.sleep(.25)
    sync=require_browser('EV2-3 media acceptance')
    with sync() as pw:
        browser=launch_chromium(pw,headless=True)
        context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
        def guard(route):
            url=route.request.url
            if url.startswith(('data:','blob:')):return route.continue_()
            if not url.startswith(base+'/'):
                if 'fonts.google' in url:return route.fulfill(status=200,body='')
                blocked.append(url);return route.abort()
            if allow_enroll and '/api/references/enroll' in url:return route.continue_()
            if route.request.method not in ('GET','HEAD') and any(x in url for x in ('/generation/','/agent/','/approve','/enroll','/upload','/prepare-identity')):
                blocked.append(url);return route.abort()
            route.continue_()
        context.route('**/*',guard)
        page=context.new_page();page.on('pageerror',lambda ex:errors.append(str(ex)))
        page.goto(base+'/#/results');page.locator('[data-md="production"]').wait_for(timeout=30000)
        check('Current and Recently added defaults',page.locator('[data-md-tab="current"]').get_attribute('aria-pressed')=='true' and page.locator('[data-md-field="sort"]').input_value()=='recent')
        check('Unique page bounded to 48',page.locator('.md-card').count()==48)
        page.wait_for_function('projectSaveSettled().settled')
        page.wait_for_timeout(250)
        page.wait_for_selector('#toast.hidden',state='attached',timeout=5000)
        for width,height in ((1280,720),(1440,900),(1920,1080),(390,844)):
            page.set_viewport_size({'width':width,'height':height})
            page.screenshot(path=str(OUT/f'workspace-{width}.png'))
            check(f'{width}: workspace no document overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        page.locator('[data-md-page="1"]').click()
        check('Next page has bounded remaining assets',page.locator('.md-card').count()<48)
        page.locator('.md-open').last.scroll_into_view_if_needed()
        scroll=page.locator('#main').evaluate('(el)=>el.scrollTop')
        page.locator('.md-open').last.click();page.locator('[data-media-inspector] .cancel').click()
        check('Inspector retains exact result page',page.evaluate('CineBraidMediaBrowser.instances.get("production").state.page')==1)
        check('Inspector retains workspace scroll',abs(page.locator('#main').evaluate('(el)=>el.scrollTop')-scroll)<2)
        page.locator('[data-md-page="0"]').click()
        first=page.locator('.md-open').first;first.focus();first.press('ArrowRight')
        check('Arrow keys navigate result cards',page.evaluate('document.activeElement.dataset.mdOpen')==page.locator('.md-open').nth(1).get_attribute('data-md-open'))
        page.set_viewport_size({'width':1440,'height':900})
        page.locator('[data-md-field="query"]').fill('SH020')
        card=page.locator('.md-open').first;key=card.get_attribute('data-md-open');card.click()
        page.locator('[data-media-inspector]').wait_for()
        check('Inspector has no quick decision controls',page.locator('[data-mi-action="approve"],[data-mi-action="reject"],[data-mi-action="restore"]').count()==0)
        for width,height in ((1280,720),(1440,900),(1920,1080),(390,844)):
            page.set_viewport_size({'width':width,'height':height})
            page.screenshot(path=str(OUT/f'inspector-{width}.png'))
            check(f'{width}: Inspector no horizontal overflow',page.locator('#modal .modal-box').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'))
            close=page.locator('[data-media-inspector] .cancel');close.scroll_into_view_if_needed()
            check(f'{width}: Inspector close reachable',close.is_visible())
        page.set_viewport_size({'width':1440,'height':900})
        page.locator('[data-mi-action="open-owner"]').first.click()
        page.locator('[data-media-return]').wait_for()
        check('Exact shot review handoff', '/shot/SH020/review/' in page.url)
        page.locator('[data-media-return]').click()
        page.locator('[data-md="production"]').wait_for()
        page.wait_for_timeout(120)
        check('Owner round trip retains search',page.locator('[data-md-field="query"]').input_value()=='SH020')
        check('Owner round trip retains selected asset',page.locator('.md-card.is-selected').get_attribute('data-md-key')==key)
        check('Owner round trip restores focus',page.evaluate('document.activeElement?.dataset.mdOpen')==key)
        page.locator('[data-md-field="query"]').fill('')
        page.locator('[data-md-view="list"]').click()
        check('Optional compact list works',page.locator('.md-list').count()==1)
        page.goto(base+'/#/character/KAI')
        page.locator('[data-rd-action="choose"]').first.click()
        page.locator('[data-md="reference-picker"]').wait_for()
        check('Selector shares browser controls',page.locator('#modal [data-md-field="query"]').count()==1)
        check('Unavailable hidden with visible count',not page.locator('[data-md-field="showUnavailable"]').is_checked())
        page.locator('#modal [data-md-field="query"]').fill('Harbor')
        page.locator('#modal .md-open').first.click()
        page.locator('#modal [data-md-inspect]').first.click()
        page.locator('[data-media-inspector]').wait_for()
        page.locator('[data-media-inspector] .cancel').click()
        page.locator('[data-md="reference-picker"]').wait_for()
        check('Selector inspector retains search',page.locator('#modal [data-md-field="query"]').input_value()=='Harbor')
        for width,height in ((1280,720),(1440,900),(1920,1080),(390,844)):
            page.set_viewport_size({'width':width,'height':height})
            page.screenshot(path=str(OUT/f'selector-{width}.png'))
            page.locator('#rd-add-candidate').scroll_into_view_if_needed()
            check(f'{width}: Add candidate reachable',page.locator('#rd-add-candidate').is_visible())
            check(f'{width}: selector no horizontal overflow',page.locator('#modal .modal-box').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'))
        page.set_viewport_size({'width':1440,'height':900})
        # Inspecting another result must never change which image will be enrolled.
        selected=page.locator('#modal .md-card.is-selected').get_attribute('data-md-key')
        second=page.locator('#modal [data-md-inspect]').nth(1)
        second.scroll_into_view_if_needed()
        inner_scroll=page.locator('.rd-picker-library').evaluate('(el)=>el.scrollTop')
        second.click()
        check('Selector Inspector receives keyboard focus',page.evaluate('!!document.activeElement.closest("[data-media-inspector]")'))
        page.locator('[data-media-inspector] .cancel').click()
        check('Inspect B preserves selected A',page.locator('#modal .md-card.is-selected').get_attribute('data-md-key')==selected)
        page.wait_for_timeout(60)
        check('Selector Inspector retains library scroll',abs(page.locator('.rd-picker-library').evaluate('(el)=>el.scrollTop')-inner_scroll)<2)
        page.locator('#modal [data-md-field="query"]').fill('KAI_FAL_CANDIDATE_2')
        page.locator('#modal [data-md-inspect]').first.click()
        page.locator('[data-mi-action="open-full-preview"]').click()
        page.locator('[data-theatre-return]').click()
        check('Full preview retains selector return',page.locator('[data-media-inspector] .cancel').inner_text()=='Back to selection')
        page.locator('[data-mi-action="open-owner"]').first.click()
        page.locator('[data-media-return]').wait_for()
        check('Reference owner receives exact candidate',page.locator('[data-rd-candidate="KAI_FAL_CANDIDATE_2.png"]').get_attribute('aria-pressed')=='true')
        check('Reference handoff selects exact nondefault continuity state',page.locator('#rd-state').input_value()=='state-night')
        page.locator('[data-media-return]').click()
        page.locator('[data-md="reference-picker"]').wait_for()
        check('Owner round trip reopens unfinished selector',page.locator('#modal [data-md-field="query"]').input_value()=='KAI_FAL_CANDIDATE_2')
        check('Owner round trip keeps original selected asset',page.evaluate('CineBraidMediaBrowser.instances.get("reference-picker").state.selected')==selected)
        page.locator('#modal [data-md-field="query"]').fill('KAI_FAL_CANDIDATE_3')
        check('Rejected result hidden by default',page.locator('#modal .md-card').count()==0)
        page.locator('[data-md-field="showRejected"]').check()
        page.locator('#modal .md-open').first.click()
        page.locator('#rd-assign-slot').select_option('front')
        page.locator('#rd-single').check()
        check('Revealed rejected result cannot be added',page.locator('#rd-add-candidate').is_disabled())
        page.locator('#modal [data-md-inspect]').first.click()
        page.locator('[data-mi-action="open-owner"]').first.click()
        check('Rejected owner offers restore before approval',page.locator('[data-rd-action="restore"]').count()==1 and page.locator('[data-rd-action="approve"]').count()==0)
        page.locator('[data-rd-action="restore"]').click()
        page.locator('[data-media-return]').click()
        page.locator('[data-md="reference-picker"]').wait_for()
        page.wait_for_function('!document.getElementById("rd-add-candidate").disabled')
        check('Restored candidate becomes reusable only after owner save and revalidation',page.locator('#rd-add-candidate').is_enabled())
        page.locator('#rd-picker-cancel').click()
        # Original disappears only inside this suite's disposable project.
        (project_root/'media'/'contact-000.png').unlink()
        page.locator('[data-rd-action="choose"]').first.click()
        page.locator('[data-md="reference-picker"]').wait_for()
        page.locator('#modal [data-md-field="query"]').fill('contact-000.png')
        check('Missing original hidden from selector',page.locator('#modal .md-card').count()==0)
        page.locator('[data-md-field="showUnavailable"]').check()
        page.locator('#modal .md-open').first.click()
        check('Missing selection clears old preview',page.locator('#rd-picker-preview').count()==0)
        check('Missing selection cannot be added',page.locator('#rd-add-candidate').is_disabled())
        page.locator('#modal [data-md-inspect]').click()
        check('Missing result stays inspectable',page.locator('[data-media-inspector]').count()==1)
        page.locator('[data-media-inspector] .cancel').click()
        page.locator('#rd-picker-cancel').click()
        page.goto(base+'/#/results');page.locator('[data-md="production"]').wait_for()
        page.locator('#main [data-md-field="type"]').select_option('audio')
        check('Audio is discoverable',page.locator('#main .md-card').count()>=1)
        page.locator('#main .md-open').first.click()
        page.wait_for_function('document.querySelector("[data-media-inspector] audio")?.readyState>=1')
        check('Audio Inspector has decoded native playback',page.locator('[data-media-inspector] audio').count()==1)
        page.locator('[data-media-inspector] .cancel').click()
        page.locator('#main [data-md-field="type"]').select_option('video')
        page.locator('#main .md-open').first.click()
        page.wait_for_function('document.querySelector("[data-media-inspector] video")?.readyState>=1')
        check('Video Inspector has decoded native playback',page.locator('[data-media-inspector] video').count()==1)
        page.locator('[data-mi-action="open-owner"]').click()
        check('Motion receives exact review claim','/shot/SH010/review/' in page.url)
        page.locator('[data-media-return]').click();page.locator('[data-md="production"]').wait_for()
        page.locator('#main [data-md-field="type"]').select_option('all')
        page.locator('#main [data-md-field="query"]').fill('BLOCKING')
        page.locator('#main .md-open').first.click();page.locator('[data-mi-action="open-owner"]').click()
        check('Blocking opens shot preparation without false review claim',page.url.endswith('/shot/SH010'))
        page.locator('[data-media-return]').click();page.locator('[data-md="production"]').wait_for()
        page.locator('#main [data-md-field="query"]').fill('no such production image')
        check('Empty filter has recovery control',page.locator('#main [data-md-reset]').count()==1)
        page.screenshot(path=str(OUT/'empty-filter.png'))
        # Retained unsupported-record presentation only; document importing is not part of EV2-3.
        page.evaluate("SCAN.mediaInventory.push({assetId:'asset-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',mediaType:'document',source:'imported',title:'Production notes',sourceName:'notes.pdf',available:true,url:'/assets/media/notes.pdf'});route()")
        page.locator('#main [data-md-field="query"]').fill('Production notes')
        page.locator('#main .md-open').click()
        check('Unsupported document uses honest fallback without broken image',page.locator('[data-media-inspector] img').count()==0 and 'No preview for this media type' in page.locator('[data-media-inspector]').inner_text())
        page.screenshot(path=str(OUT/'unsupported-media.png'))
        page.locator('[data-media-inspector] .cancel').click()
        page.goto(base+'/#/character/KAI')
        page.wait_for_function('projectSaveSettled().settled',timeout=15000)
        before=page.evaluate('({authority:JSON.stringify(P.productionAuthority), count:P.characters.find(e=>e.id==="KAI").candidateFiles.length})')
        page.locator('[data-rd-slot="front"]').click()
        page.locator('[data-md="reference-picker"]').wait_for()
        page.locator('#modal [data-md-field="query"]').fill('contact-001.png')
        page.locator('#modal .md-open').click()
        selected_id=page.locator('#modal .md-card.is-selected').get_attribute('data-md-key').removeprefix('asset:')
        check('Choosing never implies single-view identification',not page.locator('#rd-single').is_checked())
        page.locator('#rd-single').check()
        page.wait_for_function('!document.getElementById("rd-add-candidate").disabled')
        allow_enroll=True
        page.locator('#rd-add-candidate').click()
        page.wait_for_selector('#modal.hidden',state='attached',timeout=15000)
        page.wait_for_function('P.characters.find(e=>e.id==="KAI").candidateFiles.some(r=>r.referenceBinding?.assetId==="'+selected_id+'")')
        allow_enroll=False
        after=page.evaluate('({authority:JSON.stringify(P.productionAuthority), rows:P.characters.find(e=>e.id==="KAI").candidateFiles})')
        check('Actual synthetic enrollment adds exactly one binding',len(after['rows'])==before['count']+1)
        check('Enrollment uses the visibly selected durable asset',after['rows'][-1]['referenceBinding']['assetId']==selected_id)
        check('Enrollment leaves human authority unchanged',after['authority']==before['authority'])
        check('Enrollment returns to actual Reference Desk target',page.locator('[data-reference-desk]').count()==1)
        page.screenshot(path=str(OUT/'enrolled-candidate.png'))
        context.route('**/api/references/media?*',lambda route:route.fulfill(status=503,content_type='application/json',body='{"error":"Synthetic inventory failure"}'))
        page.locator('[data-rd-action="choose"]').first.click()
        page.locator('#rd-picker-retry').wait_for()
        check('Failed selector load has explicit recovery',page.locator('#rd-picker-error').inner_text()=='Synthetic inventory failure')
        check('Inventory failure never claims an empty production',page.locator('[data-md-load-failure]').count()==1 and 'No production media yet' not in page.locator('.rd-picker-library').inner_text())
        page.screenshot(path=str(OUT/'selector-error.png'))
        context.unroute('**/api/references/media?*')
        page.locator('#rd-picker-retry').click()
        page.locator('#modal .md-card').first.wait_for()
        check('Retry returns to usable selector',page.locator('#modal .md-card').count()>0)
        page.locator('#rd-picker-cancel').click()
        check('No uncaught browser errors',not errors)
        check('No blocked external or paid operation attempted',not blocked)
        browser.close()
finally:
    server.terminate();server.wait(timeout=15);log.close();workspace.cleanup()
    (OUT/'browser-results.json').write_text(json.dumps({'checks':checks,'errors':errors,'blocked':blocked},indent=2),encoding='utf-8')
print(f'EV2-3 browser: {len(checks)} checks passed')

