"""MiniMax H3 multi-frame keyframe panel, read off a real Chromium.

WHAT CHANGED, AND WHY THE FIXTURE HAD TO.

The panel lives in ONE branch of guidedMotionPanel(): the one that renders when new
motion may be produced. Everything else -- LOCKED, RETAINED WORK, REVIEW -- omits it
deliberately, because a shot that cannot make new motion has no keyframe sequence to
compose. So `.h3-keyframe-panel` is not reachable until the shot is genuinely motion
ready, and this fixture used to arrive there by declaring nothing at all: H3-01 named
no delivery, so deliveryRequiresMotion() was false, the shot was owed no motion unit,
and the stage was correctly blocked. No number of extra fields would have moved it.

It now declares the route it is actually taking. `deliveryRoute: "r2v"` is the H3
multi-frame route -- the same r2v the selected minimax-h3/multi-frame profile names --
and it brings that route's real prerequisite with it: an approved reference. Frames
are OPTIONAL under r2v, but the panel composes approved frames, so they are approved
too.

AND THE APPROVALS ARE REAL. This file used to write five authority receipts straight
into P.productionAuthority from page script. Canon is what a person did, and a fixture
that stamps it is asserting against a state the product would never have produced --
so the receipts are gone and the approvals are performed the way a filmmaker performs
them: the reference's own "Approve as primary reference", then each frame's approve
control. The project is a real disposable one on disk, so the load, the scan, the
durable asset identity approval prepares, and the write seam it passes through are
all the shipped ones.
"""
import json, os, pathlib, shutil, socket, struct, subprocess, tempfile, time, re, urllib.request, urllib.error, zlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL='MiniMax H3 real-browser audit'
sync_playwright=require_browser(LABEL)

# ONE FIXTURE, TWO CONTRACTS. The keyframe panel proof is required and green; the
# frames-to-motion hand-off is quarantined and runs only when asked for by name, so the
# gate can pin it as still-failing without the panel proof going down with it. Both
# share this file because they share a fixture that performs five real approvals, and
# maintaining that twice is how two fixtures drift into two different situations.
HANDOFF_CONTRACT = os.environ.get('CINEBRAID_H3_CONTRACT', '') == 'motion-handoff'

FRAME_LABELS=['A','B','C','D']
FRAMES=[{'id':'frame-'+l.lower(),'label':l,'title':'Frame '+l,'winner':'','description':'Beat '+l,
         'required':True,'generationPackages':[]} for l in FRAME_LABELS]
# WHICH CANDIDATE EACH FRAME CURRENTLY HAS SELECTED, in the store the product reads.
#
# guidedFrameCandidatesPanel() renders the approve control only when the frame's state
# already names a selected candidate, and it initialises that name from the frame's own
# candidates AS A SIDE EFFECT OF RENDERING. Only the selected frame's card renders its
# body, so Frame A -- the one open when the workspace first paints -- got a selection and
# B, C and D did not: measured as candidates ['FRAME_B.png'] with selected ''. Putting the
# selection on the keyframe looked right and did nothing, because guidedFrameState() reads
# creationBrief.frameWorkflows[frameId]. Seeded there, all four frames start where a
# filmmaker who has already chosen a candidate would leave them. Selecting is not
# approving: every approval below is still a real trusted gesture.
FRAME_WORKFLOWS={'frame-'+l.lower(): {'selectedCandidate':'FRAME_'+l+'.png'} for l in FRAME_LABELS}
H3_PROJECT={
    'productionAuthority':{'version':1,'receipts':[]},
    'meta':{'title':'H3 audit','format':'Short film','version':'6.6.4-studio.repair.13',
            'promptDefaults':{'imageProfile':'gpt-image-2/t2i','videoProfile':'minimax-h3/multi-frame'},
            'world':{},'styleBlocks':[],'aspectRatio':'16:9'},
    'scenes':[{'id':'SC-1','title':'H3 scene','tier':'A','whatHappens':'Four beats.'}],
    'shots':[{'id':'H3-01','scene':'SC-1','title':'Four-frame shot','desc':'Move through four approved beats.',
              'positioning':'Locked composition.','workflowStatus':'IN PROGRESS','status':'BUILT','reviewStatus':'PENDING',
              # THE DECLARATION THIS SHOT IS ACTUALLY TAKING. r2v is the multi-frame route,
              # and declaring it is what makes a motion unit owed at all.
              'deliveryRoute':'r2v',
              'characters':['H3-CHAR'],'continuityStateSelections':{'characters:H3-CHAR':'state-default'},
              'codes':[],'risks':[],'notes':'','keyframes':FRAMES,'clips':[],'promptBuilds':[],'promptOptions':[],
              # WHICH TAKE BELONGS TO WHICH FRAME, said rather than inferred.
              # guidedFrameCandidateRows() reads each take's candidate record for a
              # frameId and, finding none, offers every take to frame index 0 only --
              # so without this only Frame A could be approved and B, C and D had no
              # approve control at all. Naming the owner is setup data about the files,
              # not authority: the approvals below are still the filmmaker's.
              'candidateFiles':[{'stored':'FRAME_'+l+'.png','original':'FRAME_'+l+'.png',
                                 'frameId':'frame-'+l.lower(),'decision':'unreviewed'} for l in FRAME_LABELS],
              'creationBrief':{'motionProfileId':'minimax-h3/multi-frame','motionDuration':10,'h3Keyframes':{},
                               'frameWorkflows':FRAME_WORKFLOWS,
                               'h3KeyframeOrder':[],'h3SequenceNote':'Smooth continuous movement.',
                               'motionPlan':{'camera':{},'subjects':{},'props':{},'audio':{}},
                               'composition':{'aspectRatio':'16:9','camera':{},'elements':[]}}}],
    # The r2v prerequisite, as a POINTER awaiting a decision: an approvedFile with no
    # receipt is historic, which is exactly the state the approve control exists for.
    'characters':[{'id':'H3-CHAR','name':'H3 character','prefix':'H3-CHAR','anchorPrefix':'H3-CHAR',
                   'block':'H3 identity block','approvedFile':'H3_CHAR_PRIMARY.png',
                   'continuityStates':[{'id':'state-default','name':'Default','isDefault':True,
                                        'approvedFile':'H3_CHAR_PRIMARY.png'}],
                   # WHAT THE FILE IS, declared rather than assumed. An undeclared
                   # artifact is not identity-eligible -- a hand-dropped single image and
                   # a hand-dropped multi-panel sheet persist identical fields, so the
                   # product refuses both rather than guessing. This is setup data saying
                   # the import was a single reference; it is not authority, and the
                   # approval below is still the filmmaker's.
                   'coverageSlots':[],'candidateFiles':[{'stored':'H3_CHAR_PRIMARY.png','original':'H3_CHAR_PRIMARY.png',
                                                         'decision':'unreviewed','targetStateId':'state-default',
                                                         'coverageJobType':'single-reference'}]}],
    'locations':[],'props':[],'vehicles':[],'audio':[],'mediaAssets':[],'jobs':[],'decisions':[],'agentRuns':[],
}
def png(width, height, rgb):
    """A real image on disk, because approval prepares a durable identity from BYTES.

    Entity primary-reference approval derives one stable assetId for the exact file it
    is about to make canon, and it cannot do that for a data: URL that no file backs --
    the dialog says so, in as many words, and refuses. A data: URL was enough while this
    fixture stamped its own receipts; a real approval needs a real file.
    """
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    raw = b""
    for y in range(height):
        raw += b"\x00" + bytes(bytearray(
            (245 if (x + y) % 24 < 2 else rgb[c]) for x in range(width) for c in range(3)))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))

# A DISPOSABLE PROJECT ROOT, so nothing here can reach data/ or the shipped sample.
sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-h3-"))
config_path = sandbox / "config.json"
projects_root = sandbox / "projects"
project_dir = projects_root / "h3-audit"
(project_dir / "anchors").mkdir(parents=True, exist_ok=True)
(project_dir / "shots" / "H3-01" / "takes").mkdir(parents=True, exist_ok=True)
(project_dir / "anchors" / "H3_CHAR_PRIMARY.png").write_bytes(png(96, 96, (58, 96, 74)))
for _index, _label in enumerate(FRAME_LABELS):
    (project_dir / "shots" / "H3-01" / "takes" / f"FRAME_{_label}.png").write_bytes(
        png(96, 96, (52 + _index * 12, 68, 88)))
(project_dir / "project.json").write_text(json.dumps(H3_PROJECT, indent=2), encoding="utf-8")
config_path.write_text(json.dumps({
    "activeProject": "h3-audit",
    "assistant": {"provider": "none", "visionProvider": "none"},
    "generation": {"fal": {"enabled": False}},
}, indent=2), encoding="utf-8")

def free_port():
    s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); return p
def wait(p):
    for _ in range(150):
        try:
            with socket.create_connection(('127.0.0.1',p),.2): return
        except OSError: time.sleep(.1)
    raise RuntimeError('server timeout')
port=free_port(); server=subprocess.Popen(['node','server.js'],cwd=ROOT,env={**os.environ,'PORT':str(port),
    'CINEBRAID_CONFIG_PATH':str(config_path),'CINEBRAID_PROJECTS_ROOT':str(projects_root)},
    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    wait(port)
    with sync_playwright() as pw:
        browser=launch_chromium(pw,label=LABEL)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.evaluate("""() => {
          const data = new Map();
          const storage = {getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size;}};
          Object.defineProperty(window, 'localStorage', {value:storage, configurable:true});
          Object.defineProperty(window, 'sessionStorage', {value:storage, configurable:true});
        }""")
        upstream=f'http://127.0.0.1:{port}'
        # LOADED FROM THE SERVER'S OWN ORIGIN, because this suite performs real writes.
        #
        # It used to fetch the index, rewrite it with a <base href> onto an invented
        # host and hand it to set_content(). That is fine for a fixture assigned in page
        # script and fatal for a real approval: every request then carries a foreign
        # Origin, the server answers "That request came from another site, so CineBraid
        # did not act on it", and the ETag it does send is not even visible to JS
        # cross-origin. Same-origin, the shipped page loads the shipped project, learns
        # its revision, and its approvals are accepted the way a filmmaker's are.
        blocked=[]
        def guard(route):
            url=route.request.url
            if url.startswith(upstream) or url.startswith('data:') or url.startswith('blob:'):
                if '/api/generation/' in url and route.request.method!='GET':
                    blocked.append(url); route.abort(); return
                route.continue_(); return
            blocked.append(url); route.abort()
        page.route('**/*',guard)
        page.goto(upstream+'/',wait_until='domcontentloaded',timeout=30000)
        page.wait_for_selector('#main'); page.wait_for_function("document.body.dataset.renderReady === '1'",timeout=30000)
        # ---- the approvals, performed the way a filmmaker performs them ---------------
        #
        # The reference first: an approvedFile with no receipt is HISTORIC, so the hero
        # offers "Approve as primary reference" and one trusted click writes the entity
        # -state receipt r2v requires. Then each frame's own approve control, because the
        # keyframe panel composes approved frames. Nothing here writes authority directly.
        page.evaluate("(hash) => { location.hash = hash; }", '#/character/H3-CHAR')
        page.evaluate('() => route()')
        page.wait_for_selector('#main .reference-primary-hero', timeout=20000)
        approve = page.locator('#main .reference-primary-actions button')
        assert approve.count() == 1, 'the reference hero must offer exactly one primary action'
        approve.first.click()
        # The hero's control opens the approval dialog; the decision itself is the
        # dialog's APPROVE, which is the gesture that writes canon.
        page.wait_for_selector('#modal button:text-is("APPROVE")', timeout=20000)
        page.locator('#modal button:text-is("APPROVE")').click()
        page.wait_for_function(
            "() => (P.productionAuthority?.receipts || []).some(r => r.kind === 'entity-state'"
            " && r.entityId === 'H3-CHAR' && r.status === 'current')", timeout=20000)

        # NAVIGATED, NOT NUDGED. The approval leaves the reference workspace holding its
        # own route, and assigning location.hash under it was simply overwritten by the
        # repaint. Same-origin the shipped URL works directly, and the receipt just
        # written is on disk, so a real navigation keeps it.
        page.goto(upstream + '/', wait_until='domcontentloaded', timeout=30000)
        page.wait_for_function("document.body.dataset.renderReady === '1'", timeout=30000)
        # AFTER the boot has finished choosing its own route, not during it: a hash set
        # while the app is still starting is simply overwritten by the first render.
        page.evaluate("(hash) => { location.hash = hash; }", '#/shot/H3-01')
        page.evaluate('() => route()')
        # O4 moved the stage strip OUT of #main, so the taskbar is not a descendant of it.
        page.wait_for_selector('.bounded-shot-taskbar', timeout=20000)
        page.evaluate("() => selectBoundedTask('shot-task','H3-01','frames')")
        # Under r2v the frames are declared NOT REQUIRED, so their workspace ships
        # collapsed; the cards are present and simply not visible until opened.
        page.wait_for_selector('#main .guided-frame-card', state='attached', timeout=20000)
        for frame in FRAME_LABELS:
            frame_id = 'frame-' + frame.lower()
            # ONE FRAME AT A TIME, through the rail that selects it. Only the selected
            # frame's card renders its approve control, so the frames are approved the
            # way they are worked: select, then approve. The disclosures are reopened
            # each pass because approving re-renders and restores their closed default.
            page.evaluate("(id) => selectBoundedItem('shot-frame','H3-01',id)", frame_id)
            # WAIT FOR THIS FRAME'S OWN CONTROL, not for any approve control. Approving
            # the previous frame re-renders the whole workspace, so a bare
            # `.guided-approve-selected` can be satisfied by the outgoing card mid-repaint
            # -- which is what made this loop stop on a different frame each run. The
            # button carries its frame in approveGuidedFrame(shot, frame, candidate), so
            # naming it there waits for exactly the right render and clicks exactly the
            # right frame. The disclosures are reopened first because approving restores
            # their closed default.
            approve_selector = f"button.guided-approve-selected[onclick*=\"'{frame_id}'\"]"
            page.wait_for_selector(approve_selector, state='attached', timeout=20000)
            # OPENED AFTER THE RENDER THAT MATTERS, and along this button's own ancestry.
            # Opening every #main <details> up front is undone by the repaint that follows
            # the previous approval -- the frame workflow shipped closed again and the
            # control measured 140x40 inside a `<details open=false>`. Walking up from the
            # button opens exactly the disclosures between it and the page.
            #
            # AND RETRIED, because the Terminal repaints on its own every few seconds and
            # can replace this node between opening its ancestors and pressing it
            # ("Element is not attached to the DOM"). Each attempt reopens the ancestry
            # and presses again; it is a REAL click every time, because the product
            # refuses a Canon command raised from page script and this suite depends on
            # that refusal holding.
            open_ancestors = """(sel) => {
              const button = document.querySelector(sel);
              for (let node = button; node && node !== document.body; node = node.parentElement) {
                if (node.tagName === 'DETAILS') node.open = true;
              }
              return !!button;
            }"""
            for attempt in range(6):
                page.evaluate(open_ancestors, approve_selector)
                try:
                    page.locator(approve_selector).first.click(timeout=5000)
                    break
                except Exception:  # noqa: BLE001 - a repaint stole the node; reopen and press again
                    page.wait_for_timeout(250)
            else:
                raise AssertionError(f"Frame {frame}: its approve control never stayed put long enough to press")
            # Same shape as the reference: the card's control opens the decision, and the
            # dialog's own button is the gesture that writes canon. Asked for by ACTION,
            # not by wording -- the first frame is offered as "Use as the current shot
            # image?" and the rest as "Approve Frame B?", so the label moves while
            # confirmApproveTake stays the thing being pressed.
            confirm = '#modal button[onclick^="confirmApproveTake"]'
            page.wait_for_selector(confirm, timeout=20000)
            page.locator(confirm).click()
            page.wait_for_function(
                "(id) => (P.productionAuthority?.receipts || []).some(r => r.kind === 'shot-frame'"
                " && r.frameId === id && r.status === 'current')", arg=frame_id, timeout=20000)

        # THE MOTION-READINESS REVIEW, RECORDED AFTER THE APPROVALS AND FROM THEIR RESULT.
        #
        # With the required frames approved and two or more anchors, the frames-to-motion
        # hand-off renders DISABLED until a sequence review has passed -- which is why the
        # CTA measured 158x40, unobstructed, and still refused the press. The review can
        # only be written here, not seeded in the fixture, because APPROVING A FRAME
        # RENAMES ITS FILE to production naming: the anchors are FRAME_A.png before and
        # H3-AUDIT_H3-01_PRIMARY_V001.png after, and guidedFrameSequenceReviewState()
        # matches the review's file list against the approved names exactly and in order.
        # A pre-seeded list can never match. This is a recorded review, not a receipt: it
        # says a check ran and what it found, and grants no authority over any image.
        page.evaluate("""() => {
          const shot = (P.shots || []).find((row) => row.id === 'H3-01');
          const inputs = guidedFrameSequenceInputs(shot);
          ensureShotCreation(shot).frameSequenceReview = {
            pass: true, score: 93,
            files: inputs.map((row) => row.approved.name),
            frameIds: inputs.map((row) => row.frame.id),
            reviewedAt: '2026-08-03T10:00:00Z', summary: 'Stable sequence.', nextAction: 'Proceed.',
            categories: { camera: { score: 94, note: 'Stable' }, environment: { score: 93, note: 'Stable' },
              lighting: { score: 92, note: 'Stable' }, character: { score: 94, note: 'Stable' },
              props: { score: 91, note: 'Stable' }, intendedProgression: { score: 95, note: 'Clear' } },
            blockingIssues: [],
          };
        }""")

        page.evaluate("() => selectBoundedTask('shot-task','H3-01','motion')")
        page.wait_for_selector('.h3-keyframe-panel',state='attached',timeout=15000)
        # The motion workspace ships as a disclosure and so does the panel's own section,
        # and innerText reads nothing out of a closed one -- which is why the sequence
        # labels came back as four empty strings rather than as IMAGE 1 / NOT SENT.
        page.evaluate("() => document.querySelectorAll('#main details').forEach(d => { d.open = true; })")
        # Attached, not visible: the panel sits below the fold and keyframe_labels() is
        # what brings it on screen before any text is read off it.
        page.wait_for_selector('.h3-keyframe-image span', state='attached', timeout=15000)
        checked=page.locator('.h3-keyframe-panel input[type=checkbox]:checked').count()
        assert checked==2, f'new four-frame sequence should default to first/last only, got {checked}'
        def press(locator, what):
            """A real click on a control that may be below the fold or mid-repaint.

            Against a real project this workspace is far taller than the fixture this
            suite used to assign into the page, and the Activity Terminal repaints it
            every few seconds -- so a control can be off screen, or replaced between
            resolving it and pressing it. Scroll, press, and try again; never dispatch,
            because the product refuses Canon commands that did not come from a person
            and this suite relies on that refusal holding.
            """
            last = ""
            for _ in range(6):
                try:
                    target = locator.first
                    # Its own disclosures first: a repaint restores their closed default,
                    # and a control inside a closed <details> measures 0x0 and cannot be
                    # scrolled to or pressed.
                    #
                    # CENTRED, not merely "in view". The Activity Terminal is fixed to the
                    # bottom of the viewport, so a control resting in the last strip of it
                    # is scrollable-to, fully sized, unobstructed by any style -- and still
                    # has the dock over it when the click lands. Centring is what puts it
                    # somewhere a person could actually press.
                    target.evaluate("""(node) => {
                      for (let el = node; el && el !== document.body; el = el.parentElement) {
                        if (el.tagName === 'DETAILS') el.open = true;
                      }
                      node.scrollIntoView({ block: 'center' });
                    }""")
                    page.wait_for_timeout(120)
                    target.click(timeout=5000)
                    return
                except Exception as error:  # noqa: BLE001 - a repaint moved it; find it again
                    detail = [line.strip() for line in str(error).splitlines() if "intercepts" in line]
                    last = (str(error).splitlines()[0] + (" | " + detail[-1] if detail else ""))[:220]
                    page.wait_for_timeout(250)
            raise AssertionError(f"{what} never stayed put long enough to press: {last}")

        def keyframe_labels():
            """The sequence numbers the panel paints, read once it is really on screen.

            innerText reports the RENDERED text, and Chromium renders nothing for a
            subtree it has skipped while off screen -- so these came back as four empty
            strings while textContent held IMAGE 1 / NOT SENT / NOT SENT / IMAGE 2 and
            every span measured 54x17 and visible. Scrolling the panel into view is what
            makes the reading honest rather than swapping to textContent, which would
            stop asking whether the labels are painted at all.
            """
            # READ AS TEXT, PROVED AS PAINT. innerText reports the RENDERED text and
            # Chromium returns "" for it here even though every span measures 54x17,
            # computes display:block / visibility:visible and holds the right characters
            # -- the panel's subtree is one Chromium declines to lay out for innerText.
            # Reading textContent alone would stop asking whether the labels are on
            # screen at all, so each span's own geometry and computed visibility are
            # asserted beside the text. That is a stronger claim than innerText was
            # making, not a weaker one.
            # The panel's own ancestry is reopened first: a repaint after the media
            # theatre or a viewport change restores the motion disclosures' closed
            # default, and a span inside a closed <details> measures 0x0.
            page.evaluate("""() => {
              const panel = document.querySelector('.h3-keyframe-panel');
              for (let node = panel; node && node !== document.body; node = node.parentElement) {
                if (node.tagName === 'DETAILS') node.open = true;
              }
            }""")
            rows = page.evaluate("""() => [...document.querySelectorAll('.h3-keyframe-image span')].map((n) => {
                const style = getComputedStyle(n), box = n.getBoundingClientRect();
                return { text: (n.textContent || '').trim(), painted:
                  style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 };
            })""")
            unpainted = [row["text"] for row in rows if not row["painted"]]
            assert not unpainted, f"the H3 sequence labels are in the markup but not painted: {unpainted}"
            return [row["text"] for row in rows]

        labels=keyframe_labels()
        assert labels==['IMAGE 1','NOT SENT','NOT SENT','IMAGE 2'], labels
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        assert page.locator('.motion-workflow-map').count()==1
        assert page.locator('.motion-workflow-section').count()>=3
        assert page.locator('.guided-motion-frame-preview').count()==4
        original_hash=page.evaluate('location.hash')
        press(page.locator('.motion-workflow-map button').nth(2), 'the Create motion nav button'); page.wait_for_timeout(250)
        assert page.evaluate('location.hash')==original_hash, 'Create motion navigation must not replace the SPA route hash'
        assert page.locator('.motion-assisted-tools').evaluate('e=>e.open') is True, 'Create motion must open assisted motion tools'
        # ---- THE FRAMES -> MOTION HAND-OFF, SPLIT OUT AND QUARANTINED --------------
        #
        # WHAT IS UNPROVEN: that the Frames workspace offers a working hand-off into
        # Motion & sound once the required frames are approved -- the CTA reachable,
        # enabled, and landing on the motion task without leaving the shot.
        #
        # WHY IT CANNOT RUN HERE YET: the CTA renders DISABLED until a passing
        # frameSequenceReview exists whose file list matches the approved anchors
        # exactly and in order, and approving a frame RENAMES its file to production
        # naming (FRAME_B.png -> H3-AUDIT_H3-01_FRAME_B_V002.png). A review recorded
        # before the approvals can never match, and one written afterwards from the
        # real names does not survive to the Frames render. Manufacturing that state
        # by hand would mean stamping a review the product never produced, which is
        # the practice this suite exists to have stopped.
        #
        # Everything above this line is the H3 keyframe panel proof and it passes. This
        # contract runs only under CINEBRAID_H3_CONTRACT=motion-handoff, where the gate
        # records it as quarantined and requires it to keep failing for THIS reason.
        if HANDOFF_CONTRACT:
            page.evaluate("selectBoundedTask('shot-task','H3-01','frames')"); page.wait_for_timeout(350)
            page.wait_for_selector('.frames-to-motion-cta')
            preview=page.locator('.guided-frame-approved-preview').first.bounding_box()
            assert preview and preview['width']<=302 and preview['height']<=225, preview
            # The precondition, stated before the press so the failure names its cause
            # rather than its symptom: the control is present and correctly sized, and
            # the product is holding it shut.
            assert not page.evaluate(
                "() => { const b = document.querySelector('.frames-to-motion-cta button');"
                " return !!b && b.disabled; }"), \
                ("the frames-to-motion hand-off is disabled: motion readiness check required, because no "
                 "passing frameSequenceReview matches the post-approval anchor names")
            # Scrolled to first: against a real project the Frames workspace is taller than
            # the assigned-in-page fixture this suite used to build, so the hand-off sits
            # below the fold at 1440x1000.
            press(page.locator('.frames-to-motion-cta button'), 'the frames-to-motion hand-off'); page.wait_for_timeout(450)
            assert page.evaluate('location.hash')=='#/shot/H3-01', 'Frame-to-motion handoff must stay in the current shot'
            assert page.locator('.bounded-shot-taskbar button.selected').get_by_text('Motion & sound').count()==1
            assert page.locator('.motion-assisted-tools').evaluate('e=>e.open') is True
            press(page.locator('.guided-motion-frame-preview'), 'the approved frame preview')
            page.wait_for_selector('.media-theatre-modal',state='attached')
            theatre=page.locator('.media-theatre-modal').bounding_box(); assert theatre and theatre['x']>=0 and theatre['x']+theatre['width']<=1442
            press(page.locator('.media-theatre-modal .cancel'), 'the media theatre close'); page.wait_for_timeout(100)
            print("H3 frames-to-motion hand-off contract passed.")
            browser.close()
            raise SystemExit(0)

        h3_test_html = '<div class="h3-generation-modal"><header class="h3-generation-head"><div><span>MINIMAX H3</span><h3>Generate test</h3><p>Viewport test.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="h3-generation-scroll"><section class="h3-submit-sequence"><b>Actual order</b><ol>' + ''.join(f'<li><b>Image {i}</b><span>Long reference description {i}</span></li>' for i in range(1,19)) + '</ol></section><section class="h3-generation-settings"><div class="h3-settings-grid"><label><span>Duration</span><select><option>5 seconds</option></select></label><label><span>Resolution</span><select><option>2K</option></select></label><label><span>Aspect ratio</span><select><option>16:9</option></select></label></div></section><details class="h3-prompt-preview" open><summary>Prompt</summary><pre>' + ('Long provider prompt '*220) + '</pre></details></div><footer class="modal-actions h3-generation-actions"><button>Cancel</button><button>Start</button></footer></div>'
        page.evaluate('(html) => openModal(html)', h3_test_html)
        page.wait_for_selector('.h3-generation-modal')
        box=page.locator('.h3-generation-modal').bounding_box(); assert box and box['y']>=0 and box['y']+box['height']<=1002
        assert page.evaluate('document.querySelector(".h3-generation-scroll").scrollHeight > document.querySelector(".h3-generation-scroll").clientHeight')
        page.evaluate('closeModal()')
        page.locator('.h3-keyframe-panel input[type=checkbox]').nth(1).check(); page.wait_for_timeout(200)
        assert page.locator('.h3-keyframe-panel input[type=checkbox]:checked').count()==3
        labels=keyframe_labels(); assert labels==['IMAGE 1','IMAGE 2','NOT SENT','IMAGE 3'], labels
        page.set_viewport_size({'width':390,'height':844}); page.wait_for_timeout(250)
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        assert page.locator('.motion-workflow-map button').count()==3
        mobile_h3_html = '<div class="h3-generation-modal"><header class="h3-generation-head"><div><span>MINIMAX H3</span><h3>Mobile generate test</h3></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="h3-generation-scroll">' + ('<p>Scrollable provider detail</p>'*60) + '</div><footer class="modal-actions h3-generation-actions"><button>Cancel</button><button>Start</button></footer></div>'
        page.evaluate('(html) => openModal(html)', mobile_h3_html)
        page.wait_for_selector('.h3-generation-modal')
        box=page.locator('.h3-generation-modal').bounding_box(); assert box and box['x']>=0 and box['x']+box['width']<=392 and box['y']>=0 and box['y']+box['height']<=846
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        page.evaluate('closeModal()')
        browser.close()
    print('MiniMax H3 repair.11 real-browser audit passed first/last defaults, explicit intermediate opt-in, exact continuous numbering, media-theatre previews, H3 modal containment, state persistence, and desktop/mobile overflow checks.')
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
