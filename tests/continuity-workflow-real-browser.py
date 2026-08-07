"""CineBraid declared-entity continuity — the shot workspace in a real browser.

Renders the shipped client against a real CineBraid server, and stubs only the
provider: a local OpenAI-compatible endpoint answers each single-image
observation, so the compare route, the cache, the manifest and the whole
deterministic comparison are the real ones. Nothing here needs Nemotron.

What it proves, in the order a user would do it:
  open a shot -> Frames -> Check continuity -> read the findings ->
  declare a frame state -> recheck -> mark a change expected -> reload ->
  the declarations are still there -> re-observe -> no console errors.

The project and config live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped
sample are never touched.
"""

import json, os, pathlib, shutil, socket, subprocess, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('Continuity workspace real-browser audit skipped: Python Playwright is not installed.')
    raise SystemExit(0)
CHROMIUM = shutil.which('chromium') or shutil.which('chromium-browser') or shutil.which('google-chrome')
if not CHROMIUM:
    print('Continuity workspace real-browser audit skipped: Chromium is unavailable.')
    raise SystemExit(0)


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def wait_for(port, timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), .25):
                return
        except OSError:
            time.sleep(.1)
    raise RuntimeError('server did not start')


# ---------------------------------------------------------------- the provider

PNG = ('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')


def present(**patch):
    row = {'presence': 'present', 'occlusion': 'none', 'identifiable': 'yes',
           'bbox': [100, 100, 300, 300], 'color': 'not-applicable',
           'state': 'not-applicable', 'markings': 'not-applicable', 'evidence': 'visible'}
    row.update(patch)
    return row


ABSENT = {'presence': 'absent', 'occlusion': 'not-applicable', 'identifiable': 'no', 'bbox': None,
          'color': 'not-applicable', 'state': 'not-applicable', 'markings': 'not-applicable', 'evidence': 'gone'}

# Frame A: everything present, Kai in Default, the watch silver.
# Frame B: the mug is gone, Kai has changed state, the watch colour is unreadable.
REPLIES = {
    'A': {'CHAR-KAI': present(state='Default'), 'PROP-MUG': present(),
          'PROP-WATCH': present(color='silver'), 'LOC-BRIDGE': present(state='Default')},
    'B': {'CHAR-KAI': present(state='Jacket removed'), 'PROP-MUG': dict(ABSENT),
          'PROP-WATCH': present(color='uncertain'), 'LOC-BRIDGE': present(state='Default')},
}
observations = []


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _json(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.endswith('/models'):
            return self._json({'data': [{'id': 'stub-continuity-model'}]})
        if self.path == '/api/tags':
            return self._json({'models': [{'name': 'stub-text-model'}, {'name': 'stub-vision-model'}]})
        self._json({})

    def do_POST(self):
        length = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(length) or b'{}')
        parts = [p for p in (body.get('messages') or [{}, {}])[1].get('content', []) if isinstance(p, dict) and p.get('type') == 'image_url']
        if not parts:
            return self._json({'choices': [{'message': {'content': '{}'}}]})
        url = parts[0]['image_url']['url']
        import base64
        raw = base64.b64decode(url.split('base64,')[1]).decode('latin1')
        tag = raw[-1]
        observations.append(tag)
        self._json({'choices': [{'message': {'content': json.dumps({'coordinate_mode': 'permille', 'entities': REPLIES[tag]})}}]})


# ---------------------------------------------------------------- the fixture

STATES = [
    {'id': 'state-default', 'name': 'Default', 'isDefault': True, 'notes': 'Primary approved reference.'},
    {'id': 'state-jacket-off', 'name': 'Jacket removed', 'isDefault': False,
     'parentStateId': 'state-default', 'notes': 'The jacket has been taken off.'},
]


def project_json():
    return {
        'meta': {'title': 'Continuity workspace audit', 'format': 'Short film', 'version': 'v1',
                 'hubVersion': 'v6.0.0', 'schemaVersion': '6.6', 'aiPolicy': 'project-default',
                 'world': {}, 'styleBlocks': []},
        'qcChecklist': [],
        'characters': [{'id': 'CHAR-KAI', 'name': 'Kai', 'block': 'Late-30s, lean.',
                        'approvedFile': '', 'continuityStates': json.loads(json.dumps(STATES))}],
        'props': [
            {'id': 'PROP-MUG', 'name': 'Enamel mug', 'description': 'White enamel mug.',
             'approvedFile': '', 'continuityStates': [dict(STATES[0])]},
            # Colour tracking is off by default, so this one asks for it explicitly.
            {'id': 'PROP-WATCH', 'name': 'Wristwatch', 'description': 'Brushed steel wristwatch.',
             'approvedFile': '', 'tracking': {'color': True}, 'continuityStates': [dict(STATES[0])]},
        ],
        'locations': [{'id': 'LOC-BRIDGE', 'name': 'Bridge', 'description': 'Steel footbridge.',
                       'approvedFile': '', 'continuityStates': [dict(STATES[0])]}],
        'vehicles': [], 'audio': [], 'mediaAssets': [],
        'scenes': [{'id': 'SC-01', 'title': 'Scene one'}],
        'shots': [{
            'id': 'S-01', 'scene': 'SC-01', 'title': 'Bridge handover', 'desc': 'Kai sets the mug down.',
            'workflowStatus': 'IN PROGRESS', 'status': 'BUILT',
            'characters': ['CHAR-KAI'], 'codes': [], 'risks': [], 'notes': '',
            'creationBrief': {'locationId': 'LOC-BRIDGE', 'propIds': ['PROP-MUG', 'PROP-WATCH'],
                              'vehicleIds': [], 'frameWorkflows': {}},
            'continuityStateSelections': {},
            'keyframes': [
                {'id': 'frame-a', 'label': 'A', 'title': 'Opening frame', 'winner': 'A.png',
                 'description': 'Kai at the rail.', 'required': True, 'generationPackages': []},
                {'id': 'frame-b', 'label': 'B', 'title': 'Ending frame', 'winner': 'B.png',
                 'description': 'Kai turns away.', 'required': True, 'generationPackages': []},
            ],
            'clips': [], 'candidateFiles': [], 'promptBuilds': [],
        }],
        'jobs': [], 'agentRuns': [], 'decisions': [], 'sessions': [],
    }


TEMP = pathlib.Path(tempfile.mkdtemp(prefix='cinebraid-continuity-ui-'))
provider_port = free_port()
provider = HTTPServer(('127.0.0.1', provider_port), Provider)
threading.Thread(target=provider.serve_forever, daemon=True).start()

projects_root = TEMP / 'projects'
project_dir = projects_root / 'continuity-audit'
takes = project_dir / 'shots' / 'S-01' / 'takes'
takes.mkdir(parents=True)
for folder in ('anchors', 'plates', 'props', 'vehicles', 'audio', 'media', 'docs'):
    (project_dir / folder).mkdir(parents=True, exist_ok=True)
import base64
for tag in ('A', 'B'):
    # Distinct bytes per frame, so each has its own content identity in the cache.
    (takes / f'{tag}.png').write_bytes(base64.b64decode(PNG) + tag.encode())
(project_dir / 'project.json').write_text(json.dumps(project_json(), indent=2), encoding='utf-8')

# A second project with the SAME shot id. Ids are only unique inside a project,
# so this is the routine case in which a verdict could be shown under the wrong
# one — which is exactly what packaged acceptance caught.
project_b = projects_root / 'continuity-audit-b'
(project_b / 'shots' / 'S-01' / 'takes').mkdir(parents=True)
for folder in ('anchors', 'plates', 'props', 'vehicles', 'audio', 'media', 'docs'):
    (project_b / folder).mkdir(parents=True, exist_ok=True)
other = project_json()
other['meta']['title'] = 'Second project, same shot id'
(project_b / 'project.json').write_text(json.dumps(other, indent=2), encoding='utf-8')
for tag in ('A', 'B'):
    (project_b / 'shots' / 'S-01' / 'takes' / f'{tag}.png').write_bytes(base64.b64decode(PNG) + tag.encode())

config_path = TEMP / 'config.json'
config_path.write_text(json.dumps({
    'activeProject': 'continuity-audit',
    'assistant': {'provider': 'custom', 'visionProvider': 'ollama'},
    'customBaseUrl': f'http://127.0.0.1:{provider_port}/v1',
    'customModel': 'stub-continuity-model',
    'customVisionModel': 'stub-continuity-model',
    'continuity': {'visionProvider': 'custom', 'visionModel': 'stub-continuity-model'},
    'ollamaUrl': f'http://127.0.0.1:{provider_port}',
    'ollamaModel': 'stub-text-model',
    'ollamaVisionModel': 'stub-vision-model',
    'agents': {'enabled': True},
}, indent=2), encoding='utf-8')

port = free_port()
server = subprocess.Popen(
    ['node', 'server.js'], cwd=ROOT,
    env={**os.environ, 'PORT': str(port), 'CINEBRAID_CONFIG_PATH': str(config_path),
         'CINEBRAID_PROJECTS_ROOT': str(projects_root)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

BASE = f'http://127.0.0.1:{port}'
console_errors = []


def stored_project():
    return json.loads((project_dir / 'project.json').read_text(encoding='utf-8'))


def open_shot(page, marker):
    """A fresh document every time. A URL differing only in its hash does not
    reload, which would leave the previous project state in memory."""
    page.goto(f'{BASE}/?audit={marker}#/shot/S-01', wait_until='domcontentloaded', timeout=30000)
    page.wait_for_function("document.body.dataset.renderReady === '1'", timeout=30000)
    page.wait_for_selector('.shot-continuity', timeout=15000)


def check_continuity(page):
    page.get_by_role('button', name='CHECK CONTINUITY').or_(page.get_by_role('button', name='CHECK AGAIN')).first.click()
    page.wait_for_selector('.continuity-outcome-counts, .continuity-analysis-error', timeout=30000)


def outcome_count(page, outcome):
    return int(page.locator(f'.continuity-outcome-counts .outcome-{outcome} b').inner_text())


try:
    wait_for(port)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROMIUM, headless=True,
                                     args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: console_errors.append(str(e)))
        # The Frames stage is the one under test.
        page.add_init_script("localStorage.setItem('cinebraid-focused:continuity-audit:shot-task:S-01','frames');"
                             "localStorage.setItem('cinebraid-workspace-section:continuity-audit:S-01:continuity-frame-states','1');")

        # 1-5. open the shot, see both frames and the continuity card, run a check
        open_shot(page, 'open')
        assert page.locator('.guided-frame-rail button', has_text='Frame A').count() == 1
        assert page.locator('.guided-frame-rail button', has_text='Frame B').count() == 1
        assert 'Frame A → Frame B' in page.locator('.shot-continuity > header b').inner_text()
        assert page.get_by_role('button', name='CHECK CONTINUITY').is_visible()
        check_continuity(page)
        assert sorted(observations) == ['A', 'B'], f'expected one observation per frame, got {observations}'

        # 6-7. the findings, in the five-word vocabulary
        assert outcome_count(page, 'issue') == 2, 'the missing mug and the undeclared state change are both issues'
        assert outcome_count(page, 'review') == 1, 'the unreadable watch colour needs a person'
        assert outcome_count(page, 'stable') == 1, 'the bridge is unchanged'
        mug = page.locator('.continuity-entity', has_text='Enamel mug')
        assert 'ISSUE' in mug.inner_text()
        assert 'Presence changed' in mug.inner_text()
        assert 'present' in mug.inner_text() and 'absent' in mug.inner_text()
        watch = page.locator('.continuity-entity', has_text='Wristwatch')
        assert 'REVIEW' in watch.inner_text()
        assert 'Colour could not be compared' in watch.inner_text()
        assert watch.inner_text().count('REVIEW') == 1, 'a single-finding card must not repeat its outcome word'
        assert 'MARK EXPECTED' not in watch.inner_text(), 'unreadable evidence must never offer a declaration'
        assert 'both cached' not in page.locator('.continuity-provenance').inner_text()
        assert '2 new analyses' in page.locator('.continuity-provenance').inner_text()
        # Nothing technical reaches the surface.
        surface = page.locator('.shot-continuity').inner_text()
        for leak in ('permille', 'bbox', 'invalid_enum', '127.0.0.1', 'coordinate_mode'):
            assert leak not in surface, f'the continuity surface leaked {leak}'

        # 11. declare the frame state that makes Kai's change intentional
        kai_select = page.locator('.continuity-state-row', has_text='Kai').locator('select').nth(1)
        kai_select.select_option(label='Jacket removed')
        page.wait_for_timeout(1400)
        stored = stored_project()
        assert stored['shots'][0]['creationBrief']['frameWorkflows']['frame-b']['characterStateSelections']['CHAR-KAI'] == 'state-jacket-off'
        assert stored['meta']['schemaVersion'] == '6.7', 'writing a continuity field must move the project to 6.7'

        # 9. recheck — cached observations, and the state change is now expected
        observations.clear()
        check_continuity(page)
        assert observations == [], 'a recheck after a declaration must not re-observe anything'
        assert 'both cached' in page.locator('.continuity-provenance').inner_text()
        kai = page.locator('.continuity-entity', has_text='Kai')
        assert 'EXPECTED' in kai.inner_text()
        assert 'as declared' in kai.inner_text()
        assert outcome_count(page, 'expected') == 1
        assert outcome_count(page, 'issue') == 1

        # 8. mark the remaining issue expected
        page.locator('.continuity-entity', has_text='Enamel mug').get_by_role('button', name='MARK EXPECTED').click()
        page.wait_for_timeout(1500)
        assert outcome_count(page, 'expected') == 2
        assert outcome_count(page, 'issue') == 0
        assert page.locator('.continuity-entity', has_text='Enamel mug').count() == 1, 'a declared change stays visible'
        assert stored_project()['shots'][0]['continuityIntent']['PROP-MUG']['allowPresenceChange'] == 'may-leave'

        # 12-13. reload — every declaration is still there
        open_shot(page, 'reload')
        assert page.locator('.continuity-state-row', has_text='Kai').locator('select').nth(1).input_value() == 'state-jacket-off'
        page.locator('.continuity-intent').first.click()
        page.wait_for_timeout(150)
        mug_intent = page.locator('.continuity-intent-row', has_text='Enamel mug').locator('select').first
        assert mug_intent.input_value() == 'may-leave'
        check_continuity(page)
        assert outcome_count(page, 'issue') == 0, 'declarations must survive a reload'
        assert outcome_count(page, 'expected') == 2

        # 14. an entity tracking choice persists too
        page.goto(f'{BASE}/?audit=prop#/prop/PROP-WATCH', wait_until='domcontentloaded', timeout=30000)
        page.wait_for_function("document.body.dataset.renderReady === '1'", timeout=30000)
        page.evaluate("selectBoundedItem('entity-coverage-view','props:PROP-WATCH','states')")
        page.wait_for_selector('.continuity-tracking', timeout=10000)
        page.locator('.continuity-tracking').first.click()
        page.wait_for_timeout(120)
        colour = page.locator('.continuity-track-option', has_text='Colour').locator('input')
        assert colour.is_checked(), 'the fixture asked for colour tracking explicitly'
        colour.uncheck()
        page.wait_for_timeout(1400)
        assert stored_project()['props'][1].get('tracking') in (None, {}), 'returning colour to its default must store nothing'

        # 15. re-observe discards the stored analysis and asks again
        open_shot(page, 'reobserve')
        check_continuity(page)
        observations.clear()
        page.get_by_role('button', name='RE-OBSERVE', exact=True).click()
        page.wait_for_selector('#modal-confirm-action', timeout=10000)
        assert 'not touched' in page.locator('.modal-confirm-message').inner_text()
        page.locator('#modal-confirm-action').click()
        page.wait_for_selector('.continuity-outcome-counts', timeout=30000)
        assert sorted(observations) == ['A', 'B'], 'RE-OBSERVE must look at both frames again'
        assert '2 new analyses' in page.locator('.continuity-provenance').inner_text()
        # The media and the project record are untouched by a purge.
        assert (takes / 'A.png').exists() and (takes / 'B.png').exists()
        assert stored_project()['shots'][0]['continuityIntent']['PROP-MUG']['allowPresenceChange'] == 'may-leave'

        # narrower viewport: the card must stack rather than overflow
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(200)
        overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        assert overflow <= 2, f'the continuity workspace overflowed by {overflow}px at 390px'

        # 17. a verdict belongs to the project that produced it (acceptance D1)
        open_shot(page, 'switch-a')
        check_continuity(page)
        assert page.locator('.continuity-outcome-counts').count() == 1
        page.evaluate("switchProject('continuity-audit-b')")
        # ACTIVE_PROJECT_SLUG is a script-scoped binding, not a window property.
        page.wait_for_function("continuityProjectKey() === 'continuity-audit-b'", timeout=20000)
        page.evaluate("localStorage.setItem('cinebraid-focused:continuity-audit-b:shot-task:S-01','frames');"
                      "location.hash = '#/shot/S-01'; route();")
        page.wait_for_selector('.shot-continuity', timeout=15000)
        page.wait_for_timeout(200)
        card = page.locator('.shot-continuity').inner_text()
        assert 'STABLE' not in card, 'no stale verdict may survive a project switch'
        assert 'Enamel mug' not in card, 'no stale finding may survive a project switch'
        assert 'CHECK CONTINUITY' in card, 'the second project must start idle'
        page.evaluate("switchProject('continuity-audit')")
        page.wait_for_function("window.ACTIVE_PROJECT_SLUG === 'continuity-audit'", timeout=20000)

        # 18. continuity configures independently of the main assistant (D2)
        page.request.put(f'{BASE}/api/config', data={'assistant': {'provider': 'ollama', 'visionProvider': 'ollama'},
                                                     'customBaseUrl': '', 'customModel': '', 'customVisionModel': '',
                                                     'continuity': {'visionProvider': 'custom',
                                                                    'baseUrl': f'http://127.0.0.1:{provider_port}/v1',
                                                                    'visionModel': 'stub-continuity-model'}})
        open_shot(page, 'independent')
        assert "isn't configured" not in page.locator('.shot-continuity').inner_text(), \
            'continuity must be ready on its own endpoint with no generic custom text model'
        assert page.get_by_role('button', name='CHECK CONTINUITY').or_(
            page.get_by_role('button', name='CHECK AGAIN')).first.is_enabled()

        # 19. readiness follows a save, with no page reload
        page.goto(f'{BASE}/?audit=settings#/settings', wait_until='domcontentloaded', timeout=30000)
        page.wait_for_function("document.body.dataset.renderReady === '1'", timeout=30000)
        page.evaluate("selectBoundedTask('settings-task','settings','assistant')")
        page.wait_for_selector('#cfg-continuity-provider', timeout=10000)
        assert page.locator('#cfg-continuity-base').input_value() == f'http://127.0.0.1:{provider_port}/v1'
        page.locator('#cfg-continuity-provider').select_option('')
        page.get_by_role('button', name='Save assistant settings').click()
        page.wait_for_timeout(1200)
        # Same document — no reload between the save and the workspace.
        page.evaluate("localStorage.setItem('cinebraid-focused:continuity-audit:shot-task:S-01','frames');"
                      "location.hash = '#/shot/S-01'; route();")
        page.wait_for_selector('.shot-continuity', timeout=15000)
        page.wait_for_timeout(200)
        assert "isn't configured" in page.locator('.shot-continuity').inner_text(), \
            'removing the continuity provider must be reflected without a page reload'
        page.evaluate("selectBoundedTask('settings-task','settings','assistant'); location.hash = '#/settings'; route();")
        page.wait_for_selector('#cfg-continuity-provider', timeout=10000)
        page.locator('#cfg-continuity-provider').select_option('custom')
        page.locator('#cfg-continuity-model').fill('stub-continuity-model')
        page.locator('#cfg-continuity-base').fill(f'http://127.0.0.1:{provider_port}/v1')
        page.get_by_role('button', name='Save assistant settings').click()
        page.wait_for_timeout(1200)
        page.evaluate("location.hash = '#/shot/S-01'; route();")
        page.wait_for_selector('.shot-continuity', timeout=15000)
        page.wait_for_timeout(200)
        assert "isn't configured" not in page.locator('.shot-continuity').inner_text(), \
            'saving a valid continuity provider must become available without a page reload'

        # 16. nothing broke on the way
        assert not console_errors, f'console errors: {console_errors}'
        browser.close()
    print('Continuity workspace real-browser audit passed: the Frames stage renders the continuity card, '
          'one observation per frame reaches the provider and none compares two, the five outcome states render, '
          'a declared frame state reclassifies an undeclared change as expected without re-observing, '
          'MARK EXPECTED persists a structured declaration and keeps the finding visible, declarations and '
          'tracking survive a reload, the project moves to schema 6.7 only when a field is written, RE-OBSERVE '
          'discards only the stored analysis, the surface leaks no endpoint or contract internal, the layout '
          'contains at 390px, and the console stays clean.')
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
    provider.shutdown()
    shutil.rmtree(TEMP, ignore_errors=True)
