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
them: the reference's own "Approve as primary reference", then each frame's approval
in Results, opened from the Shot Desk's Results rail (EV2-7). The project is a real
disposable one on disk, so the load, the scan, the
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

# HOW THIS SUITE READS THE KEYFRAME PANEL, AND WHY IT STOPPED SLEEPING.
#
# Ticking a keyframe runs setH3KeyframeEnabled() synchronously -- it records the opt-in
# on the shot and asks for a render -- but route() is ASYNCHRONOUS and awaits the project
# read and the shot's folder before the panel repaints. The browser ticks the box itself
# at once, so for that whole interval the DOM holds a ticked box beside the PRE-CLICK
# sequence numbers. A fixed 200ms wait read exactly that on a loaded CI runner (PR #80,
# first attempt: three boxes ticked, labels still IMAGE 1 / NOT SENT / NOT SENT / IMAGE 2),
# and it reads it on any machine once the project read takes 400ms -- identically on this
# change's base, so the sleep was always the defect, not the refresh owner.
#
# So the wait is not longer: it is a DIFFERENT QUESTION. The panel is settled when the
# boxes, the painted sequence numbers and the product's OWN derivation of the sequence
# (h3ApprovedFrameRows, the function the panel renders from) all describe the same
# selection, row for row and in order. Nothing about that question is timing.
H3_PANEL_READING = r"""
(() => {
  /* The product's derivation and the painted panel, read together and compared. A
     ticked box that the render has not caught up with disagrees with both. */
  window.__h3Agreement = (shotId) => {
    const panel = document.querySelector('.h3-keyframe-panel');
    if (!panel) return { agree: false, why: 'the keyframe panel is not rendered' };
    /* A repaint restores the motion disclosures' closed default and a span inside a
       closed <details> measures 0x0, so its own ancestry is reopened before reading. */
    for (let node = panel; node && node !== document.body; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
    }
    const painted = [];
    const dom = [...panel.querySelectorAll('.h3-keyframe-sequence article')].map((article) => {
      const box = article.querySelector('input[type=checkbox]');
      const span = article.querySelector('.h3-keyframe-image span');
      const wiring = ((box && box.getAttribute('onchange')) || '').match(/setH3KeyframeEnabled\('([^']*)','([^']*)'/);
      if (span) {
        const style = getComputedStyle(span), box2 = span.getBoundingClientRect();
        painted.push(style.display !== 'none' && style.visibility !== 'hidden' && box2.width > 0 && box2.height > 0);
      } else painted.push(false);
      return { frame: wiring ? wiring[2] : null, on: !!(box && box.checked),
               label: span ? (span.textContent || '').trim() : null };
    });
    const shot = typeof shotById === 'function' ? shotById(shotId) : null;
    const rows = shot && typeof h3ApprovedFrameRows === 'function' ? h3ApprovedFrameRows(shot) : null;
    if (!rows) return { agree: false, why: 'the shot has no approved keyframe rows', dom };
    /* The panel's own cap: only the first nine active frames carry a number, and a row
       without a number renders unticked however it is recorded. Mirrored, not assumed. */
    const numbers = new Map(rows.filter((row) => row.enabled).slice(0, 9)
      .map((row, index) => [String(row.frame.id), index + 1]));
    const wanted = rows.map((row) => {
      const number = numbers.get(String(row.frame.id));
      return { frame: String(row.frame.id), on: !!(row.enabled && number),
               label: number ? 'IMAGE ' + number : 'NOT SENT' };
    });
    const agree = dom.length === wanted.length && painted.every(Boolean) &&
      dom.every((row, index) => row.frame === wanted[index].frame &&
        row.on === wanted[index].on && row.label === wanted[index].label);
    return { agree, dom, wanted, painted: painted.every(Boolean),
             labels: dom.map((row) => row.label), checked: dom.filter((row) => row.on).length,
             selection: wanted.filter((row) => row.on).map((row) => row.frame),
             dirty: typeof projectHasUnsavedEdits === 'function' ? projectHasUnsavedEdits() : null };
  };
})();
"""

# FORCED TIMING, ON PURPOSE. The two reads the repaint awaits are held back by
# CINEBRAID_H3_REQUEST_DELAY_MS (0 by default), and the controlled reproduction below
# raises it for one opt-in whatever the environment asked for. The server still answers
# at once -- what is being modelled is a runner that is slow to come back to the render,
# which is what CI did to this panel.
REQUEST_DELAY_MS = int(os.environ.get('CINEBRAID_H3_REQUEST_DELAY_MS', '0') or 0)
H3_FORCED_TIMING = r"""
(() => {
  window.__h3RequestDelayMs = __DELAY__;
  const native = window.fetch;
  window.fetch = async function (input, init) {
    const url = String((input && input.url) || input || '').split('?')[0];
    const answer = await native.apply(this, arguments);
    const delay = Number(window.__h3RequestDelayMs) || 0;
    if (delay > 0 && /\/api\/(projects\/[^\/]+\/project|shots\/[^\/]+\/folder)$/.test(url)) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return answer;
  };
})();
""".replace('__DELAY__', str(REQUEST_DELAY_MS))


# WHICH CONTROL ON THE DESK OPENS ONE FRAME'S RESULTS -- and, beside it, the frame-blind
# reading the approval fixture used to wait on. Both are computed in the SAME evaluate so
# the two can be compared without a clock: `old` is the predicate that used to stand in
# for "the rail is ready", `keyed` is the fact the assertion after it actually reads.
#
# 'keyed' returns the boolean, for wait_for_function; 'full' returns the parts, for the
# control that shows the old predicate answering true about the wrong frame.
OPENER_READING = """([frameId, mode]) => {
  const old = document.querySelectorAll('#main [data-shot-results-rail] .shot-results-open, #main .guided-next-action .shot-primary-action').length > 0;
  const rail = document.querySelector('#main [data-shot-results-rail]');
  const article = rail && rail.querySelector('article[data-results-target="frame"][data-frame-id="' + frameId + '"]');
  const opener = article && article.querySelector('.shot-results-open');
  const led = article && article.querySelector('[data-results-led="1"]');
  const hero = document.querySelector('#main .guided-next-action .shot-primary-action');
  /* Exactly one way in, which is what the assertion counts: either the rail article has
     its own opener, or it says the hero is carrying the action and the hero is there. */
  const keyed = !!article && (!!opener !== !!(led && hero));
  if (mode === 'keyed') return keyed;
  return { old, keyed, article: !!article, opener: !!opener, led: !!led, hero: !!hero };
}"""

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
# (EV2-7: frames are now approved in Results, which lists each frame's own candidates,
# so this seed no longer gates the approval control; it stays as ordinary setup data.)
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
        page.add_init_script(H3_PANEL_READING)
        page.add_init_script(H3_FORCED_TIMING)
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
        # A historic pointer still needs the Reference Desk's deliberate approval.
        # Nothing in this fixture writes authority directly.
        page.evaluate("(hash) => { location.hash = hash; }", '#/character/H3-CHAR')
        page.evaluate('() => route()')
        page.wait_for_selector('[data-reference-desk]', timeout=20000)
        assert page.locator('#rd-title').inner_text().strip(), 'Reference Desk must identify the reference'
        approve = page.get_by_role('button', name='Approve reference…', exact=True)
        assert approve.count() == 1, 'Reference Desk must offer one explicit reference approval action'
        approve.click()
        page.wait_for_selector('#entity-approve-confirm:not([disabled])', timeout=20000)
        page.get_by_role('button', name='Approve reference', exact=True).click()
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
        # EV2-7 B2.12: A FRAME IS APPROVED IN RESULTS. The Frames stage prepares and
        # imports; the Shot Desk's Results rail opens each frame's exact Results, where the
        # shipped Approve result… / confirmation pair writes the receipt. Approval is bound
        # to a verified media identity, which the server indexes after a scan, so the suite
        # waits for that identity rather than racing it.
        page.evaluate("""async () => {
          for (let i = 0; i < 40; i++) {
            SCAN = await (await fetch('/api/scan')).json();
            const takes = (SCAN.shots && SCAN.shots['H3-01'] && SCAN.shots['H3-01'].takes) || [];
            if (takes.length >= 4 && takes.every((take) => take.assetId)) { await route(); return; }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          throw Error('the H3 frame media identity never became ready');
        }""")
        def press_real(locator, what):
            """A REAL click, retried: the Activity Terminal repaints on its own every few
            seconds and can replace a node between resolving it and pressing it. Never
            dispatched, because the product refuses a Canon command raised from page script
            and this suite depends on that refusal holding."""
            errors = []
            for _ in range(6):
                try:
                    locator.first.scroll_into_view_if_needed(timeout=5000)
                    locator.first.click(timeout=5000)
                    return
                except Exception as error:  # noqa: BLE001 - a repaint stole the node; press again
                    # The first line only says "Timeout 5000ms exceeded."; WHY is in the call
                    # log below it -- not enabled, not stable, another element intercepting.
                    lines = [line.strip() for line in str(error).splitlines() if line.strip()]
                    why = list(dict.fromkeys(line for line in lines[1:] if re.search(
                        r'intercepts pointer events|not enabled|not visible|not stable|detached|disabled', line)))
                    errors.append(' | '.join(([lines[0]] if lines else []) + (why[-3:] or lines[-2:]))[:600])
                    page.wait_for_timeout(250)
            # A GIVE-UP MUST SAY WHY. PR #4's Browser validation stopped here on Frame A's
            # #rx-confirm with nothing but this sentence, and the cause could not be read
            # back: disabled again, covered, or replaced. Each attempt's stated reason and
            # what the control looks like now are the evidence; the verdict is unchanged.
            # Checked by forcing it: a button held disabled reports "element is not
            # enabled" and disabled: True; a covered one names the element that
            # "intercepts pointer events" as what is underneath.
            try:
                now = locator.first.evaluate("""(e) => { const r = e.getBoundingClientRect();
                  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                  return { connected: e.isConnected, disabled: !!e.disabled, visible: e.checkVisibility(), rect: [r.x, r.y, r.width, r.height].map(Math.round),
                    underneath: top === e || e.contains(top) ? 'itself' : (top ? (top.id || top.className || top.tagName) : null),
                    status: (document.getElementById('rx-confirm-status') || {}).textContent || '',
                    pending: typeof approvalSubmissionPending === 'function' ? approvalSubmissionPending() : null }; }""", timeout=5000)
            except Exception as error:  # noqa: BLE001 - reporting only
                now = f'unreadable: {str(error).splitlines()[0][:200]}'
            raise AssertionError(f"{what} never stayed put long enough to press. Attempts: {errors}. Now: {now}")
        for frame in FRAME_LABELS:
            frame_id = 'frame-' + frame.lower()
            rail = page.locator('#main [data-shot-results-rail]')
            rail.wait_for(state='visible', timeout=20000)
            # FOUR DECLARED FRAMES ARE MORE THAN THE RAIL LISTS, so it offers a labelled
            # frame selector beside one Results entry for the chosen frame. Choosing a frame
            # there changes only what the rail shows; it writes nothing.
            picker = rail.locator('select[data-shot-results-frame]')
            assert picker.count() == 1, 'with four declared frames the Results rail offers a labelled frame selector'
            # H-CONTROL, NO CLOCK INVOLVED, AND IT COSTS THE FIXTURE NOTHING.
            #
            # Put the rail on a DIFFERENT frame and read both predicates in one evaluate.
            # The replaced wait answers "ready" -- because the Desk always has some
            # opener on it -- while the rail is demonstrably not showing the frame the
            # assertion is about. That is the whole defect, shown rather than argued: the
            # wait could not distinguish this frame from any other, so a run in which the
            # repaint HAD been late would have read exactly the same "ready" and gone on
            # to assert against the wrong rail. Done once, for the second frame; the
            # loop's own selection immediately afterwards puts the rail back.
            if frame == FRAME_LABELS[1]:
                picker.select_option('frame-' + FRAME_LABELS[-1].lower())
                elsewhere = page.evaluate(OPENER_READING, [frame_id, 'full'])
                assert elsewhere['old'] is True, \
                    'H-control: the replaced wait must be shown answering ready while the rail shows another frame'
                assert elsewhere['article'] is False and elsewhere['keyed'] is False, \
                    'H-control: and the keyed reading must refuse that same state'
                print(f"H-control: with the rail showing Frame {FRAME_LABELS[-1]}, the frame-blind wait "
                                f"this fixture used to synchronise on answers ready={elsewhere['old']} for Frame "
                                f"{frame}, whose target is not on the rail at all (article={elsewhere['article']}); "
                                f"the keyed reading that replaced it answers {elsewhere['keyed']}. No clock was "
                                "involved in either reading.")
            picker.select_option(frame_id)
            # EV2-7 dogfood correction — ONE ACTION PER RESULT TARGET. While the hero is leading
            # this frame's returned result, the hero's exact-key review IS that frame's one
            # action and the rail card says so instead of repeating it as a second button.
            # Either way exactly one control on the Desk opens this frame's Results.
            entry = page.locator('#main [data-shot-results-rail]').get_by_role('button', name=f'Frame {frame} Results', exact=True)
            hero_entry = page.locator('#main .guided-next-action').get_by_role('button', name=f'Review Frame {frame} result', exact=True)
            # THE WAIT AND THE ASSERTION ARE NOW ABOUT THE SAME FRAME.
            #
            # What used to be here counted `.shot-results-open` and `.shot-primary-action`
            # ANYWHERE on the Desk. The Desk always has one of those -- the previous
            # frame's, or the hero's -- so it was satisfied instantly, by a rail that had
            # not necessarily been repainted for the frame just chosen, and the
            # frame-specific assertion on the next line read it anyway. It took
            # `arg=frame` and never looked at it, which is the defect in one line: the
            # wait was not asking about the frame the assertion is about.
            #
            # OPENER_READING asks about THIS frame: the rail is showing this frame's own
            # target article, and exactly one way into its Results is on screen -- the
            # article's own opener, or its "Being reviewed above" marker with the hero
            # carrying the action instead. Those are the same two controls the assertion
            # counts, so the wait now ends exactly when the assertion can be answered.
            # The assertion is unchanged, and it is still the verdict.
            # A GIVE-UP IS NOT A VERDICT: if the Desk never settles on this frame the
            # assertion below still fails in its own words, naming the contract, rather
            # than being replaced by a timeout traceback that names nothing.
            try:
                page.wait_for_function(OPENER_READING, arg=[frame_id, 'keyed'], timeout=20000)
            except Exception:  # noqa: BLE001 - the assertion below is the verdict
                print(f'NOTE: Frame {frame}: the Desk never settled on this frame within 20000ms; '
                      f'the assertion below reports what was on screen: '
                      f'{page.evaluate(OPENER_READING, [frame_id, "full"])}')
            assert entry.count() + hero_entry.count() == 1, f'Frame {frame}: exactly one control on the Desk opens its Results'
            if entry.count():
                press_real(entry, f'Frame {frame} Results')
            else:
                card = page.locator(f'#main [data-shot-results-rail] [data-frame-id="{frame_id}"]')
                assert 'Being reviewed above' in (card.inner_text() or ''), f'Frame {frame}: the rail says where its one action is'
                press_real(hero_entry, f'Review Frame {frame} result')
            page.wait_for_selector('[data-results-desk]', timeout=20000)
            page.wait_for_function("() => { const b = document.getElementById('rx-approve'); return !!b && !b.disabled; }", timeout=20000)
            press_real(page.locator('#rx-approve'), f'Frame {frame}: Approve result…')
            page.wait_for_function("() => { const b = document.getElementById('rx-confirm'); return !!b && !b.disabled; }", timeout=20000)
            press_real(page.locator('#rx-confirm'), f'Frame {frame}: the confirmation')
            page.wait_for_function(
                "(id) => (P.productionAuthority?.receipts || []).some(r => r.kind === 'shot-frame'"
                " && r.frameId === id && r.status === 'current')", arg=frame_id, timeout=20000)
            page.wait_for_function("() => !approvalSubmissionPending()", timeout=20000)
            page.evaluate("(hash) => { location.hash = hash; }", '#/shot/H3-01')
            page.evaluate('() => route()')

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

        def h3_agreement():
            return page.evaluate("() => window.__h3Agreement('H3-01')")

        def h3_settled(what, timeout=20000):
            """Wait until the boxes, the painted numbers and the shot agree, then read.

            This is the replacement for the fixed sleep. It asks an observable question
            about the panel -- does it describe the selection the product derives? -- so
            it is answered as soon as the repaint lands and never before, at any speed.
            """
            try:
                page.wait_for_function("() => { const state = window.__h3Agreement('H3-01');"
                                       " return !!(state && state.agree); }", timeout=timeout)
            except Exception as error:  # noqa: BLE001 - report the disagreement, not the timeout
                state = h3_agreement()
                raise AssertionError(
                    f"{what}: the panel never agreed with the shot it paints. "
                    f"boxes/labels={state.get('dom')} product={state.get('wanted')} "
                    f"painted={state.get('painted')} why={state.get('why','')}") from error
            return keyframe_labels()

        def h3_request_delay(ms):
            page.evaluate("(ms) => { window.__h3RequestDelayMs = ms; }", ms)

        def h3_selection_survives(what, expected):
            """Render again, then re-read the project, and require the same sequence.

            A ticked checkbox in a stale DOM is not a selection. These two re-reads are
            what stop one: the repaint rebuilds the panel from the shot, and the refresh
            rebuilds the shot from what was actually saved.
            """
            try:
                page.wait_for_function(
                    "() => typeof projectHasUnsavedEdits !== 'function' || !projectHasUnsavedEdits()",
                    timeout=20000)
            except Exception as error:  # noqa: BLE001
                raise AssertionError(f"{what}: the keyframe opt-in was never saved") from error
            page.evaluate('() => route()')
            repainted=h3_settled(f"{what}, after a repaint")
            assert repainted==expected, (what, 'after a repaint', repainted)
            page.evaluate("async () => { await load({ intent: 'refresh' }); }")
            reread=h3_settled(f"{what}, after re-reading the project")
            assert reread==expected, (what, 'after re-reading the project', reread)
            assert page.locator('.h3-keyframe-panel input[type=checkbox]:checked').count()==len(
                [label for label in expected if label!='NOT SENT']), (what, 'checkbox count', expected)

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
        # ---- THE FRAMES -> MOTION HAND-OFF -----------------------------------------
        #
        # THE CLAIM: once the required frames are approved, the Frames workspace offers a
        # working hand-off into Motion & sound -- reachable, enabled, and landing on the
        # motion task without leaving the shot. It runs only under
        # CINEBRAID_H3_CONTRACT=motion-handoff (check:h3-motion-handoff).
        #
        # It was quarantined as F2 because the suite waited for a VISIBLE
        # .frames-to-motion-cta, and the hand-off lives inside the Frames workflow
        # disclosure, which folds once the frames step is complete (the accepted EV2-7
        # Shot Desk ruling, f8bbde2). The product was right and the wait was wrong: a
        # filmmaker who wants the hand-off opens the completed section. So the suite does
        # exactly that -- a real click on the section's own summary, never d.open = true --
        # and then presses the hand-off it finds enabled.
        if HANDOFF_CONTRACT:
            page.evaluate("selectBoundedTask('shot-task','H3-01','frames')"); page.wait_for_timeout(350)
            page.wait_for_selector('.frames-to-motion-cta', state='attached', timeout=20000)
            completed = page.locator('#main details.guided-frame-workflow.is-complete')
            assert completed.count() == 1, 'the approved frames fold into one completed Frames section'
            assert completed.evaluate('d => d.contains(document.querySelector(".frames-to-motion-cta"))'), \
                'the hand-off lives inside the completed Frames section'
            if not completed.evaluate('d => d.open'):
                summary = completed.locator(':scope > summary')
                summary.scroll_into_view_if_needed(timeout=5000)
                summary.click(timeout=5000)
                page.wait_for_function("() => document.querySelector('#main details.guided-frame-workflow').open", timeout=10000)
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
        SEQUENCE_WITH_B=['IMAGE 1','IMAGE 2','NOT SENT','IMAGE 3']
        page.locator('.h3-keyframe-panel input[type=checkbox]').nth(1).check()
        # No sleep: wait for the panel to agree with the shot (see H3_PANEL_READING).
        labels=h3_settled('the second frame opted in')
        assert labels==SEQUENCE_WITH_B, labels
        assert page.locator('.h3-keyframe-panel input[type=checkbox]:checked').count()==3
        # And it is a selection, not a ticked box: it survives the next render and a
        # re-read of the project from the server.
        h3_selection_survives('the second frame opted in', SEQUENCE_WITH_B)

        # ---- THE RETIRED MECHANISM, REPRODUCED ON DEMAND -------------------------
        #
        # The same opt-in once more, on the third row, with the reads the repaint awaits
        # held back 1500ms. The fixed 200ms wait reads a DOM carrying FOUR ticked boxes
        # beside the three-image numbering from before the click -- the PR #80 failure
        # exactly, on any machine -- and the agreement wait then catches up with it. If
        # the repaint ever stops awaiting those reads this assertion fails and this
        # control should be retired with it; it must never be softened into a sleep.
        h3_request_delay(1500)
        try:
            page.locator('.h3-keyframe-panel input[type=checkbox]').nth(2).check()
            page.wait_for_timeout(200)
            stale=h3_agreement()
            assert stale['checked']==4 and stale['labels']==SEQUENCE_WITH_B and not stale['agree'], \
                ('the retired fixed wait no longer reads a half-repainted panel under '
                 f"forced latency, so it no longer proves anything: {stale}")
            slow=h3_settled('the third frame opted in under forced latency', timeout=40000)
            assert slow==['IMAGE 1','IMAGE 2','IMAGE 3','IMAGE 4'], slow
            page.locator('.h3-keyframe-panel input[type=checkbox]').nth(2).uncheck()
            back=h3_settled('the third frame withdrawn under forced latency', timeout=40000)
            assert back==SEQUENCE_WITH_B, back
        finally:
            h3_request_delay(REQUEST_DELAY_MS)
        h3_selection_survives('the third frame withdrawn', SEQUENCE_WITH_B)
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
