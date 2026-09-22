#!/usr/bin/env python3
"""ORPHAN_ENTITY_CREATION_REFUSAL_V1 — no record form without a record to save into, read off a real Chromium.

WHY A BROWSER IS NEEDED. tests/orphan-entity-creation-refusal.js proves the decision and pins
the places in the shipped source that must ask it. What a filmmaker met on 12a338d was about
what a press DOES, and every one of these was measured there against the served page:

  * with no project, openContextualAdd / runGlobalAdd / addEntity / addScene opened a full
    creation form, and SAVE closed it, threw on the missing record and sent nothing — the
    typing was gone and nothing on screen said so;
  * in Recovery mode and after a failed load, ＋ Add offered all eight records, and six of them
    opened that same discarding form, and New project went nowhere;
  * a form opened while a project was still opening lost its input if SAVE came first;
  * a form whose project went away while it was open closed on SAVE and lost its input — and
    one whose project was REPLACED by another saved its record into the other one.

Each contract below reasons about the running document: which dialog is open, what a screen
reader is given (read from Chromium's own accessibility tree over CDP), where focus is, which
requests were made, and what is on disk in each server's projects root.

IT CARRIES ITS OWN NEGATIVE CONTROLS. Each rebuilds one defect in the SHIPPED SOURCE — the file
is read from disk, one anchored mutation is applied in memory, and the patched text is served
through a request interception — and requires the contract that owns it to raise at its own
assertion. Nothing is written to disk.

  N1  the visible entry guard: ＋ Add answers from first run alone again, so Recovery offers all eight
  N2  the direct guard: a creator no longer stops at the door
  N3  the shared decision allows every record
  N4  the accessible reason: the refusal is printed but is no longer the dialog's description
  N5  the SAVE-time guard: SAVE closes the form before it asks
  N6  the offered action: ＋ Add → New project keyed to first run alone, a dead end in Recovery
  N7  the project binding: "a record is installed" passes for "the form's own project"
  N8  the running open: the creators are not told a project is opening
  N9  the redraw: a "still opening" chooser is never corrected once the open settles
  N10 the form's initial focus: a deferred first-field focus lands after focus has moved on, and
      the typing meant for the next field is carried into Code / id

NOTHING IS CONFIGURED, PAID FOR, OR SENT ANYWHERE. Config and projects live in a temporary
directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT; every paid route
is aborted; every request host is recorded and the run fails if anything but 127.0.0.1 is
contacted. Set ORPHAN_ENTITY_EVIDENCE_DIR to keep 1440x900 and 390x844 screenshots.
"""

import hashlib, json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time, urllib.request

for _stream in (sys.stdout, sys.stderr):
    try: _stream.reconfigure(errors="backslashreplace")
    except Exception: pass

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Orphan entity creation refusal real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTES = ("/api/generation/fal/submit", "/api/generation/civitai/jobs", "/api/generation/comfy/jobs")
REASON = "Records like shots and references belong to a project. Create a project or open an existing one first."
OPENING_HEADING = "The project is still opening"
OPENING_REASON = "Records are added to a project once it has opened. Wait until it finishes before adding records."
GONE_REASON = "The project this form was opened in is no longer open, so nothing was saved. Everything you entered is still in the form."
REPLACED_REASON = ("This form was opened in a different project from the one open now, so nothing was saved — saving here "
                   "would put the record in the wrong project. Everything you entered is still in the form.")
CHOOSE_REASON = "Choose the record you need. CineBraid will take you to its one canonical workspace."
ALL_CHOICES = ["Shot", "Scene", "Character", "Location", "Prop", "Vehicle", "Audio", "New project"]
SENTINEL = "Orphan Sentinel Kestrel"
PROJECT_B = "dogfood-sample-b"
EVIDENCE = pathlib.Path(os.environ["ORPHAN_ENTITY_EVIDENCE_DIR"]) if os.environ.get("ORPHAN_ENTITY_EVIDENCE_DIR") else None

findings = []
page_errors, console_errors, offsite, paid_calls = [], [], [], []


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def wait_for_server(base):
    for _ in range(240):
        try:
            urllib.request.urlopen(base + "/api/config", timeout=1); return
        except Exception:
            time.sleep(0.25)
    raise AssertionError(f"the sandbox server at {base} never answered")


def tree(folder):
    """Every file and folder under a root, by content — "nothing written" is measured."""
    rows = {}
    for p in sorted(pathlib.Path(folder).rglob("*")):
        key = str(p.relative_to(folder)).replace("\\", "/")
        rows[key + ("/" if p.is_dir() else "")] = "dir" if p.is_dir() else hashlib.sha256(p.read_bytes()).hexdigest()
    return rows


def tree_diff(before, after):
    return sorted(f"{'created' if k not in before else 'removed' if k not in after else 'changed'} {k}"
                  for k in set(before) | set(after) if before.get(k) != after.get(k))


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-orphan-entity-"))

# A true first run: an EMPTY projects root and an empty config.
first_root = sandbox / "first"
(first_root / "projects").mkdir(parents=True)
(first_root / "config.json").write_text("{}", encoding="utf-8")


def qa_root(name, corrupt=False, second_project=False):
    folder = sandbox / name
    subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(folder), "--force"],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    # Local embeddings pinned to a closed loopback port, so nothing can reach data/ or leave.
    config = json.loads((folder / "config.json").read_text(encoding="utf-8"))
    config["ollamaUrl"] = "http://127.0.0.1:9"
    (folder / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    if second_project:
        # Project B: a copy of A with every entity id in common, so a record written into the
        # wrong one has nowhere to hide — only the file it lands in tells the two apart.
        shutil.copytree(folder / "projects" / "dogfood-sample", folder / "projects" / PROJECT_B)
        b_file = folder / "projects" / PROJECT_B / "project.json"
        b = json.loads(b_file.read_text(encoding="utf-8"))
        b.setdefault("meta", {})["title"] = "Project B Overlap"
        b_file.write_text(json.dumps(b, indent=2), encoding="utf-8")
    if corrupt:
        # Recovery mode: the active project's bytes are not JSON -> 422 invalid-json.
        (folder / "projects" / "dogfood-sample" / "project.json").write_text('{ "meta": { "title": "Broken" ', encoding="utf-8")
    return folder


# Every server that a contract changes has its own install, so no contract or control
# reads a state another one left behind.
roots = {"first": first_root, "open": qa_root("open"), "write": qa_root("write"),
         "recovery": qa_root("recovery", corrupt=True),
         "recovery-exit-1440": qa_root("recovery-exit-1440", corrupt=True), "recovery-exit-390": qa_root("recovery-exit-390", corrupt=True),
         "failure-exit-1440": qa_root("failure-exit-1440"), "failure-exit-390": qa_root("failure-exit-390"),
         "ab-1440": qa_root("ab-1440", second_project=True), "ab-390": qa_root("ab-390", second_project=True),
         "ab-control": qa_root("ab-control", second_project=True)}
servers = {}
for name, folder in roots.items():
    port = free_port()
    servers[name] = {
        "base": f"http://127.0.0.1:{port}", "folder": folder,
        "process": subprocess.Popen(
            ["node", "server.js"], cwd=ROOT,
            env={**os.environ, "PORT": str(port),
                 "CINEBRAID_CONFIG_PATH": str(folder / "config.json"),
                 "CINEBRAID_PROJECTS_ROOT": str(folder / "projects")},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    }

# ===========================================================================
# READING THE PAGE, in one evaluation per question.
STATE = """
() => {
  const modal = document.getElementById('modal');
  const open = !modal.classList.contains('hidden');
  const active = document.activeElement;
  const chooser = open ? modal.querySelector('.global-add-modal') : null;
  return {
    hash: location.hash,
    modalOpen: open,
    heading: open ? ((modal.querySelector('h3') || {}).textContent || '').trim() : '',
    choices: open ? [...modal.querySelectorAll('.global-add-grid button b')].map((b) => b.textContent.trim()) : [],
    buttons: open ? [...modal.querySelectorAll('button')].map((b) => (b.textContent || '').trim().split('\\n')[0].trim()) : [],
    chooserState: chooser ? chooser.getAttribute('data-entity-creation-state') : '',
    fields: open ? [...modal.querySelectorAll('[id^="ff-"]')].map((f) => f.id) : [],
    reason: open ? ((modal.querySelector('#global-add-reason') || {}).textContent || '').trim() : '',
    refusal: (() => { const n = document.getElementById('form-modal-refusal'); return n && open ? { hidden: n.hidden, text: n.textContent.trim(), role: n.getAttribute('role') } : null; })(),
    focus: active ? { id: active.id || '', text: (active.textContent || '').trim().slice(0, 60), inModal: modal.contains(active), tag: active.tagName } : null,
    toast: (document.getElementById('toast').textContent || '').trim(),
    activityExpanded: (document.getElementById('automation-activity-toggle') || { getAttribute: () => 'MISSING' }).getAttribute('aria-expanded'),
    screen: document.querySelector('.project-recovery-state') ? 'recovery'
      : document.querySelector('.project-failure-state') ? 'failure'
      : document.querySelector('.first-run-state') ? 'welcome' : 'other',
    record: typeof P === 'undefined' ? 'undefined' : (P ? 'record' : 'none'),
    slug: typeof ACTIVE_PROJECT_SLUG === 'undefined' ? '' : ACTIVE_PROJECT_SLUG,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    modalBox: (() => { const b = modal.querySelector('.modal-box'); if (!open || !b) return null; const r = b.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), vw: window.innerWidth }; })(),
  };
}
"""


def ax_node(page, selector):
    """What a screen reader is given, from Chromium's own accessibility tree (CDP), not from
    reading attributes back — an aria-describedby pointing at nothing reads as a description
    in the DOM and as nothing here."""
    client = page.context.new_cdp_session(page)
    try:
        root = client.send("DOM.getDocument", {"depth": 0})["root"]["nodeId"]
        node = client.send("DOM.querySelector", {"nodeId": root, "selector": selector})["nodeId"]
        if not node:
            return None
        nodes = client.send("Accessibility.getPartialAXTree", {"nodeId": node, "fetchRelatives": False})["nodes"]
        ax = next((n for n in nodes if not n.get("ignored")), nodes[0] if nodes else {})
        value = lambda key: ((ax.get(key) or {}).get("value") or "")
        return {"role": value("role"), "name": value("name"), "description": value("description")}
    finally:
        client.detach()


QUIET_MS = 350


def observe_quiet(page):
    """Proving that something did NOT happen needs a window; there is no event for absence."""
    page.wait_for_timeout(QUIET_MS)


def serve_text(body):
    """A ONE-ARGUMENT route handler — Playwright hands (route, request) to a two-parameter one."""
    def handler(route):
        route.fulfill(status=200, content_type="application/javascript; charset=utf-8", body=body)
    return handler


HOLD_PROJECT_ANSWER = """
(() => {
  const real = window.fetch.bind(window);
  window.__heldProject = false;
  window.__releasedProject = false;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (!window.__releasedProject && method === 'GET' && /\\/api\\/project(\\?|$)/.test(url)) {
      window.__heldProject = true;
      await new Promise((resolve) => { window.__releaseProject = resolve; });
      window.__releasedProject = true;
    }
    return real(input, init);
  };
})();
"""

FAILURE_BODY = json.dumps({"error": "The project could not be read right now.",
                           "projectFailure": {"slug": "dogfood-sample", "title": "Dogfood", "reason": "server-error"}})


def fail_project_load(route):
    """A server failure that is not a verdict about the stored document: the load-failure screen."""
    if route.request.method == "GET":
        route.fulfill(status=500, content_type="application/json", body=FAILURE_BODY)
    else:
        route.continue_()


def fail_first_project_load():
    """The load-failure screen from ONE failed read — a transient failure — so a project created
    from that screen can then be read and opened like any other."""
    state = {"failed": False}
    def handler(route):
        if route.request.method == "GET" and not state["failed"]:
            state["failed"] = True
            route.fulfill(status=500, content_type="application/json", body=FAILURE_BODY)
        else:
            route.continue_()
    return handler


def open_page(browser, server, routes=None, record=True, hold=False, failing=False, fail_once=False, viewport=(1440, 900)):
    base = servers[server]["base"]
    page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
    page.__requests = []
    page.__server = server
    if record:
        page.on("pageerror", lambda e: page_errors.append(f"{server}: {e}"))
        page.on("console", lambda m: console_errors.append(
            (server, m.text, (m.location or {}).get("url", ""))) if m.type == "error" else None)
    page.on("request", lambda r: page.__requests.append((r.method, r.url.replace(base, ""))))
    page.on("request", lambda r: offsite.append(r.url) if r.url.startswith("http") and "127.0.0.1" not in r.url else None)
    page.on("request", lambda r: paid_calls.append(r.url) if any(p in r.url for p in PAID_ROUTES) else None)
    for pattern in PAID_ROUTES:
        page.route(f"**{pattern}", lambda route: route.abort())
    for glob, body in (routes or {}).items():
        page.route(glob, serve_text(body))
    if failing:
        page.route("**/api/project", fail_project_load)
    if fail_once:
        page.route("**/api/project", fail_first_project_load())
    if hold:
        page.add_init_script(HOLD_PROJECT_ANSWER)
    page.goto(f"{base}/?orphan={int(time.time() * 1000)}", wait_until="domcontentloaded")
    if hold:
        page.wait_for_function("() => window.__heldProject === true", timeout=25000)
    elif server.startswith("recovery"):
        page.wait_for_selector(".project-recovery-state", timeout=25000)
    elif failing or fail_once:
        page.wait_for_selector(".project-failure-state", timeout=25000)
    else:
        page.wait_for_function("() => document.body.dataset.renderReady === '1'", timeout=25000)
    return page


def mutate(relative, anchor, replacement, label):
    source = (ROOT / relative).read_text(encoding="utf-8").replace("\r\n", "\n")
    assert source.count(anchor) == 1, (
        f"{label}: the anchor for {relative} appears {source.count(anchor)} times, not once — "
        f"the control has drifted off the seam it exists to break:\n{anchor}")
    return source.replace(anchor, replacement)


def reset(page):
    # The toast is put away exactly as toast() itself puts it away, not merely emptied — an
    # empty toast is still a box, and at 390px it sits over the top of any dialog.
    page.evaluate("() => { try { closeModal(); } catch (e) {} const t = document.getElementById('toast'); if (t) { clearTimeout(t._h); t.textContent = ''; t.classList.add('hidden'); } }")
    page.wait_for_function("() => document.getElementById('modal').classList.contains('hidden')", timeout=5000)
    page.__requests.clear()


def api_requests(page):
    return [f"{m} {u}" for m, u in page.__requests if "/api/" in u]


UNCOVERED = """
(selector) => {
  const node = document.querySelector(selector);
  if (!node) return 'missing';
  const r = node.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return 'no box';
  if (r.left < 0 || r.right > window.innerWidth || r.top < 0 || r.bottom > window.innerHeight) return 'outside the viewport';
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return top && (top === node || node.contains(top)) ? '' : 'covered by ' + (top ? (top.id || top.className || top.tagName) : 'nothing');
}
"""


def assert_readable(page, selector, what):
    """Visible means a person can read it: inside the viewport and not under anything."""
    problem = page.evaluate(UNCOVERED, selector)
    assert not problem, f"{what} is not readable at {page.viewport_size['width']}px: {problem}"


def settle_animations(page):
    page.wait_for_function("() => document.getAnimations().every((a) => a.playState !== 'running')", timeout=5000)


def shoot(page, name):
    if EVIDENCE:
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        settle_animations(page)
        page.screenshot(path=str(EVIDENCE / f"{name}.png"))


def open_modal_by_keyboard(page):
    page.focus("#global-add")
    page.keyboard.press("Enter")
    page.wait_for_function("() => !document.getElementById('modal').classList.contains('hidden')", timeout=10000)
    page.wait_for_function("() => document.getElementById('modal').contains(document.activeElement)", timeout=5000)


# A NEW FORM IS READY FOR TYPING ONCE ITS OWN INITIAL FOCUS HAS LANDED. openModal() moves focus
# onto the form's first field on a later turn, and Playwright's fill() focuses a field and inserts
# its text in two separate steps — so typing that starts before that move has run can have its
# text carried into the first field. This resolves on the focusin that puts the first .form-field
# control in document.activeElement, or at once if it is already there. The deadline only turns a
# form that never takes focus into a named failure; nothing here waits on elapsed time.
FORM_FOCUS = """
(deadlineMs) => new Promise((resolve, reject) => {
  const modal = document.getElementById('modal');
  const first = () => modal.querySelector('.form-field input, .form-field textarea, .form-field select');
  const owned = () => { const field = first(); return !!field && document.activeElement === field; };
  if (owned()) return resolve(first().id);
  let deadline = 0;
  const landed = () => {
    if (!owned()) return;
    modal.removeEventListener('focusin', landed);
    clearTimeout(deadline);
    resolve(first().id);
  };
  modal.addEventListener('focusin', landed);
  deadline = setTimeout(() => {
    modal.removeEventListener('focusin', landed);
    const field = first(), active = document.activeElement;
    reject(new Error(`the form's first field ${field ? '#' + field.id : '(none)'} never took focus; focus is on `
      + (active ? (active.id ? '#' + active.id : active.tagName) : 'nothing')));
  }, deadlineMs);
})
"""


def wait_for_form_focus(page):
    return page.evaluate(FORM_FOCUS, 10000)


def assert_typed_where_intended(page, intended):
    """Every value typed is in the field it was typed into — and #ff-id, which nothing typed into,
    is still empty, so typing carried into it by a focus move is named for what it is."""
    held = page.evaluate("(ids) => Object.fromEntries(ids.map((id) => { const f = document.querySelector('#modal #' + id); "
                         "return [id, f ? f.value : null]; }))", ["ff-id", *intended])
    assert held["ff-id"] == "", (
        f"typing was diverted into #ff-id (Code / id), a field nothing typed into: it holds {held['ff-id']!r}, "
        f"and the fields it was meant for hold {({k: held[k] for k in intended})!r}")
    misplaced = {k: held[k] for k, v in intended.items() if held[k] != v}
    assert not misplaced, f"typed values are not in the fields they were typed into: {misplaced!r}, expected {intended!r}"


# The seven records, and every way the shipped code can be asked to create one. Read by the
# contracts and by the negative controls alike.
LABELS = {"shot": "Shot", "scene": "Scene", "character": "Character", "location": "Location",
          "prop": "Prop", "vehicle": "Vehicle", "audio": "Audio"}
LISTS = {"character": "characters", "location": "locations", "prop": "props", "vehicle": "vehicles", "audio": "audio"}
# The creators that drew a discarding form on 12a338d come FIRST, so a control that removes the
# door is caught by the assertion about that form, not by a later creator that simply threw.
DIRECT = (
    [(f"addEntity('{l}')", k) for k, l in LISTS.items()]
    + [("addScene()", "scene")]
    + [(f"openContextualAdd('{k}')", k) for k in LABELS]
    + [(f"runGlobalAdd('{k}')", k) for k in LABELS]
    + [("addShot()", "shot"), ("addShot('SC-ORPHAN')", "shot"),
       ("duplicateShot('SC-ORPHAN-01')", "shot"), ("openGlobalAdd('character')", "character")]
)
NO_RECORD = {"heading": lambda key: f"{LABELS[key]} needs an open project", "choices": ["New project"], "reason": REASON, "focus": "New project", "confirm": GONE_REASON}
OPENING = {"heading": lambda key: OPENING_HEADING, "choices": [], "reason": OPENING_REASON, "focus": "Cancel", "confirm": OPENING_REASON}


# ===========================================================================
# THE CONTRACTS. Each is a function so a negative control re-runs exactly the assertion it
# claims to break.

def contract_first_run_chooser(page):
    """＋ Add with no project: New project only, the reason on screen AND in the dialog's
    accessible description, reached and left by keyboard."""
    reset(page)
    open_modal_by_keyboard(page)
    state = page.evaluate(STATE)
    assert state["choices"] == ["New project"], \
        f"with no project open the chooser may offer only New project, it offered {state['choices']}"
    assert state["reason"] == REASON, f"the chooser must say why, in the shared sentence; it says {state['reason']!r}"
    ax = ax_node(page, "#modal .modal-box")
    assert ax and ax["role"] == "dialog", f"the chooser must be a dialog in the accessibility tree, got {ax}"
    assert ax["description"] == REASON, \
        f"a screen reader must be given the reason with the dialog — its accessible description is {ax['description']!r}"
    assert state["focus"]["inModal"] and state["focus"]["text"].startswith("New project"), \
        f"keyboard focus must land on the one record that can be made, it is on {state['focus']}"
    page.keyboard.press("Escape")
    page.wait_for_function("() => document.getElementById('modal').classList.contains('hidden')", timeout=5000)
    page.wait_for_function("() => document.activeElement && document.activeElement.id === 'global-add'", timeout=5000)
    assert not api_requests(page), f"opening and leaving the chooser made requests: {api_requests(page)}"
    return ("first-run chooser: Enter on ＋ Add → New project only; the accessibility tree gives the dialog the reason as "
            "its description; focus lands on New project and Escape returns it to ＋ Add; no request")


def contract_direct_creators(page, where, expect=NO_RECORD):
    """Every direct route to a creator refuses BEFORE a form exists — the shipped build drew one."""
    server = page.__server
    before = tree(servers[server]["folder"])
    screen = page.evaluate(STATE)["screen"]
    for call, key in DIRECT:
        reset(page)
        hash_before, activity_before = page.evaluate("() => location.hash"), page.evaluate(STATE)["activityExpanded"]
        threw = page.evaluate("(js) => { try { new Function(js)(); return ''; } catch (e) { return String(e && e.message || e); } }", call)
        assert not threw, f"{where}: {call} threw instead of refusing: {threw}"
        page.wait_for_function("() => !document.getElementById('modal').classList.contains('hidden')", timeout=5000)
        page.wait_for_function("() => document.getElementById('modal').contains(document.activeElement)", timeout=5000)
        state = page.evaluate(STATE)
        assert not state["fields"], \
            f"{where}: {call} opened a creation form ({state['fields']}) with no project to save it into — the shipped defect"
        assert state["heading"] == expect["heading"](key), \
            f"{where}: {call} must answer with {expect['heading'](key)!r}, the dialog reads {state['heading']!r}"
        assert state["choices"] == expect["choices"] and state["reason"] == expect["reason"], \
            f"{where}: {call} must offer {expect['choices']} and say {expect['reason']!r}, got {state['choices']} / {state['reason']!r}"
        assert state["focus"]["text"].startswith(expect["focus"]), f"{where}: {call} left focus on {state['focus']}"
        assert state["hash"] == hash_before, f"{where}: {call} moved the address to {state['hash']}"
        assert state["activityExpanded"] == activity_before, f"{where}: {call} changed the Activity control"
        assert state["screen"] == screen, f"{where}: {call} replaced the {screen} screen with {state['screen']}"
        assert not api_requests(page), f"{where}: {call} made requests: {api_requests(page)}"
    reset(page)
    told = page.evaluate("() => { confirmDuplicateShot('SC-ORPHAN-01'); return (document.getElementById('toast').textContent || '').trim(); }")
    # A confirm reached with no dialog of its own has no project it was drawn for: it is refused as
    # "gone", or — while an open is running — told to wait, like everything else then.
    assert told == expect["confirm"], f"{where}: the duplicate dialog's confirm must refuse in words ({expect['confirm']!r}), the toast reads {told!r}"
    reset(page)
    changed = tree_diff(before, tree(servers[server]["folder"]))
    assert not changed, f"{where}: refused creators changed the server's files: {changed}"
    return (f"{where}: {len(DIRECT)} direct creator calls — no form; the dialog says {expect['heading']('character')!r}, "
            f"offers {expect['choices'] or 'nothing'}, focus on {expect['focus']}; no hash, Activity, screen or request change; "
            "the duplicate confirm refuses in words; the server's projects root byte-identical")


def contract_unopenable_chooser(page, where, screen):
    """Recovery mode and a failed load hold no record, so ＋ Add offers what can be made there."""
    server = page.__server
    before = tree(servers[server]["folder"])
    reset(page)
    page.click("#global-add")
    page.wait_for_function("() => !document.getElementById('modal').classList.contains('hidden')", timeout=10000)
    state = page.evaluate(STATE)
    assert state["choices"] == ["New project"], \
        f"{where}: ＋ Add must offer only New project — there is no record to add a shot or reference to — it offered {state['choices']}"
    assert state["reason"] == REASON, f"{where}: and say why, it says {state['reason']!r}"
    assert state["screen"] == screen, f"{where}: the {screen} screen must stay up under the chooser, found {state['screen']}"
    observe_quiet(page)
    assert not api_requests(page), f"{where}: ＋ Add made requests: {api_requests(page)}"
    assert not tree_diff(before, tree(servers[server]["folder"])), f"{where}: the project on disk changed"
    assert_readable(page, "#global-add-reason", f"{where}: the chooser's reason")
    assert not state["horizontalOverflow"], f"{where}: the chooser overflows horizontally at {page.viewport_size['width']}px"
    shoot(page, f"{where.replace(' ', '-')}-chooser-{page.viewport_size['width']}")
    reset(page)
    return f"{where}: ＋ Add offers New project only, with the reason, over the {screen} screen; nothing requested or written"


def contract_new_project_escape(page, where, screen, title):
    """The refusal's one offered action must do what it says where it is offered. In Recovery
    mode and after a failed load ＋ Add → New project moved the address to #/create and drew
    nothing on 12a338d — so a refusal that offered it there would be offering a dead end."""
    server = page.__server
    original = (servers[server]["folder"] / "projects" / "dogfood-sample" / "project.json").read_bytes()
    reset(page)
    page.click("#global-add")
    page.wait_for_function("() => !document.getElementById('modal').classList.contains('hidden')", timeout=10000)
    page.click(".global-add-grid button:has(b:text-is('New project'))")
    try:
        page.wait_for_selector("#modal #ff-title", timeout=5000)
    except Exception:
        seen = page.evaluate(STATE)
        raise AssertionError(
            f"{where}: ＋ Add → New project did nothing — the address is {seen['hash']!r}, no dialog is open and the "
            f"{seen['screen']} screen is still up, so the refusal's one offered action is a dead end") from None
    assert page.evaluate(STATE)["heading"] == "New CineBraid project", "it must be the shipped New CineBraid project dialog"
    assert_readable(page, "#modal #ff-title", f"{where}: the New project dialog's title field")
    shoot(page, f"{where.replace(' ', '-')}-new-project-{page.viewport_size['width']}")
    wait_for_form_focus(page)
    page.fill("#modal #ff-title", title)
    page.select_option("#modal #ff-startMode", "scratch")
    page.click("#modal .lock-btn")
    page.wait_for_function(
        "(title) => document.body.dataset.renderReady === '1' && typeof P !== 'undefined' && !!P && !PROJECT_QUARANTINE"
        " && document.getElementById('topbar-project').textContent.trim() === title", arg=title, timeout=30000)
    assert (servers[server]["folder"] / "projects" / "dogfood-sample" / "project.json").read_bytes() == original, \
        f"{where}: leaving by creating a project must not touch the original project"
    assert not page.evaluate(STATE)["horizontalOverflow"], f"{where}: the new project overflows at {page.viewport_size['width']}px"
    return (f"{where} at {page.viewport_size['width']}px: ＋ Add → New project opens the shipped dialog, creates and opens "
            f"\"{title}\" over the {screen} screen, and the original project file is byte-identical")


def contract_opening(page):
    """A project still opening: wait, and nothing else — no New project, no Open project, no
    form — said to sighted, keyboard and screen-reader users alike; and the moment the open
    settles the same dialog offers everything a project allows."""
    width = page.viewport_size["width"]
    state = page.evaluate(STATE)
    assert state["record"] == "none", "the page must still be waiting for its project"
    reset(page)
    open_modal_by_keyboard(page)
    during = page.evaluate(STATE)
    assert during["heading"] == OPENING_HEADING, \
        f"while a project is opening the chooser must say so, it reads {during['heading']!r} and offers {during['choices']}"
    assert during["choices"] == [] and during["buttons"] == ["Cancel"], \
        f"while a project is opening nothing may be offered but Cancel — New project would start a second project operation; it offered {during['buttons']}"
    assert during["reason"] == OPENING_REASON and during["chooserState"] == "opening", \
        f"and it must say to wait, from the shared answer: {during['reason']!r} ({during['chooserState']!r})"
    ax = ax_node(page, "#modal .modal-box")
    assert ax and ax["role"] == "dialog" and ax["name"] == OPENING_HEADING and ax["description"] == OPENING_REASON, \
        f"a screen reader must hear the same heading and reason — accessibility tree gives {ax}"
    assert during["focus"]["text"] == "Cancel", f"keyboard focus must land on Cancel, the only control, it is on {during['focus']}"
    assert_readable(page, "#global-add-reason", "the opening reason")
    assert not during["horizontalOverflow"], f"the opening dialog overflows horizontally at {width}px"
    shoot(page, f"still-opening-{width}")
    page.keyboard.press("Escape")
    page.wait_for_function("() => document.getElementById('modal').classList.contains('hidden')", timeout=5000)
    page.wait_for_function("() => document.activeElement && document.activeElement.id === 'global-add'", timeout=5000)
    contract_direct_creators(page, "still opening", OPENING)
    # THE ANSWER CHANGES WHEN THE FACT DOES: the same open dialog is redrawn, in place.
    page.click("#global-add")
    page.wait_for_function("() => !!document.querySelector('#modal:not(.hidden) .global-add-modal[data-entity-creation-state=\"opening\"]')", timeout=5000)
    page.evaluate("() => window.__releaseProject()")
    try:
        page.wait_for_function("() => document.body.dataset.renderReady === '1' && !!P"
                               " && !!document.querySelector('#modal:not(.hidden) .global-add-modal[data-entity-creation-state=\"open\"]')", timeout=25000)
    except Exception:
        seen = page.evaluate(STATE)
        raise AssertionError(f"the project opened but the chooser still reads {seen['heading']!r} offering {seen['choices']} — "
                             "a dialog saying 'still opening' after it has opened is untrue") from None
    after = page.evaluate(STATE)
    assert after["choices"] == ALL_CHOICES and after["reason"] == CHOOSE_REASON, \
        f"once the project has opened the same dialog must offer every record, got {after['choices']} / {after['reason']!r}"
    assert after["focus"]["inModal"] and after["focus"]["text"].startswith("Shot"), f"and focus moves to its first choice, it is on {after['focus']}"
    reset(page)
    page.evaluate("() => addEntity('characters')")
    page.wait_for_selector("#modal #ff-name", timeout=5000)
    reset(page)
    return (f"still opening at {width}px: '{OPENING_HEADING}' with the wait reason, Cancel the only control (focus on it), the "
            "accessibility tree carries the same name and description, every direct creator gets the same answer; once the "
            "project opens the same dialog is redrawn with all eight and focus on Shot, and addEntity draws its form")


def contract_opening_resolves(page, where, screen):
    """An open that ends in Recovery or a failed load hands the dialog to THAT answer."""
    reset(page)
    page.click("#global-add")
    page.wait_for_function("() => !!document.querySelector('#modal:not(.hidden) .global-add-modal[data-entity-creation-state=\"opening\"]')", timeout=5000)
    page.evaluate("() => window.__releaseProject()")
    try:
        page.wait_for_function(
            "(screen) => !!document.querySelector('#modal:not(.hidden) .global-add-modal[data-entity-creation-state=\"unopenable\"]')"
            " && !!document.querySelector(screen === 'recovery' ? '.project-recovery-state' : '.project-failure-state')", arg=screen, timeout=25000)
    except Exception:
        seen = page.evaluate(STATE)
        raise AssertionError(f"{where}: the open settled into the {seen['screen']} screen but the chooser still reads {seen['heading']!r} "
                             f"offering {seen['choices']} — it never stopped saying the project is opening") from None
    state = page.evaluate(STATE)
    assert state["choices"] == ["New project"] and state["reason"] == REASON, \
        f"{where}: the {screen} answer takes over — New project and the reason — got {state['choices']} / {state['reason']!r}"
    assert state["focus"]["inModal"] and state["focus"]["text"].startswith("New project"), f"{where}: focus moves to New project, it is on {state['focus']}"
    reset(page)
    return f"an open that ends in {where}: the 'still opening' dialog is redrawn in place with New project and the reason, over the {screen} screen"


def contract_save_time_refusal(page):
    """A form whose project goes away while it is open refuses its SAVE and keeps the typing.
    The record is cleared through the runtime's own replacement terminal, showFirstRunWorkspace()."""
    server = page.__server
    reset(page)
    page.click("#global-add")
    page.click(".global-add-grid button:has(b:text-is('Character'))")
    page.wait_for_selector("#modal #ff-name", timeout=10000)
    wait_for_form_focus(page)
    page.fill("#modal #ff-name", SENTINEL)
    page.fill("#modal #ff-description", "Grey wool coat, one silver button missing.")
    assert_typed_where_intended(page, {"ff-name": SENTINEL, "ff-description": "Grey wool coat, one silver button missing."})
    idle = page.evaluate(STATE)
    assert idle["refusal"] and idle["refusal"]["hidden"], "with a record open the refusal slot must be empty and hidden"
    page.evaluate("() => showFirstRunWorkspace()")
    page.wait_for_function("() => typeof P !== 'undefined' && P === null && !document.getElementById('modal').classList.contains('hidden')", timeout=15000)
    before = tree(servers[server]["folder"])
    page.__requests.clear()
    page.focus("#modal .lock-btn")
    page.keyboard.press("Enter")
    observe_quiet(page)
    state = page.evaluate(STATE)
    assert state["modalOpen"] and state["fields"], \
        "SAVE closed the form with no project to save into — the typing is gone, which is the shipped defect"
    kept = page.evaluate("() => [document.getElementById('ff-name').value, document.getElementById('ff-description').value]")
    assert kept == [SENTINEL, "Grey wool coat, one silver button missing."], f"the typing must survive a refused SAVE, the fields hold {kept}"
    assert state["refusal"] and not state["refusal"]["hidden"] and state["refusal"]["text"] == GONE_REASON, \
        f"the refusal must say, inside the form, that the form's project is gone, got {state['refusal']}"
    ax = ax_node(page, "#form-modal-refusal")
    assert ax and ax["role"] == "alert", f"the refusal must be an alert, so pressing SAVE is answered aloud: {ax}"
    assert state["focus"]["tag"] == "BUTTON" and state["focus"]["text"] == "SAVE", \
        f"focus must stay on SAVE, where the person pressed it, it is on {state['focus']}"
    for _ in range(3):
        page.click("#modal .lock-btn")
    observe_quiet(page)
    again = page.evaluate(STATE)
    assert again["modalOpen"] and again["refusal"]["text"] == GONE_REASON, "repeated SAVE must keep refusing the same way"
    writes = [r for r in api_requests(page) if not r.startswith("GET ")]
    assert not writes, f"a refused SAVE sent writes: {writes}"
    assert not tree_diff(before, tree(servers[server]["folder"])), "a refused SAVE changed the project on disk"
    assert_readable(page, "#form-modal-refusal", "the SAVE refusal")
    assert not page.evaluate(STATE)["horizontalOverflow"], f"the refused form overflows horizontally at {page.viewport_size['width']}px"
    shoot(page, f"save-time-refusal-{page.viewport_size['width']}")
    page.click("#modal .cancel")
    page.wait_for_function("() => document.getElementById('modal').classList.contains('hidden')", timeout=5000)
    return (f"save-time at {page.viewport_size['width']}px: a Character form whose project was cleared refuses SAVE (Enter and 3 "
            "clicks) with the 'no longer open' reason in a role=alert inside the form; name and description kept; focus on SAVE; "
            "no write request; disk unchanged")


def contract_wrong_project(page):
    """A form drawn for Project A must never save into Project B. B is a copy of A with every
    entity id in common, so a record written into the wrong one can only be told apart by the
    file it lands in — which is exactly what is read."""
    server = page.__server
    width = page.viewport_size["width"]
    projects = servers[server]["folder"] / "projects"
    file_a, file_b = projects / "dogfood-sample" / "project.json", projects / PROJECT_B / "project.json"
    lists = ["characters", "locations", "props", "vehicles", "audio", "scenes", "shots"]
    overlap = page.evaluate("(lists) => lists.flatMap((l) => (P[l] || []).map((r) => l + ':' + r.id))", lists)
    stored_b = json.loads(file_b.read_text(encoding="utf-8"))
    b_ids = [f"{l}:{r.get('id')}" for l in lists for r in stored_b.get(l, [])]
    assert overlap and overlap == b_ids, f"the fixture must give A and B the same entity ids, A {overlap} B {b_ids}"
    reset(page)
    page.click("#global-add")
    page.click(".global-add-grid button:has(b:text-is('Character'))")
    page.wait_for_selector("#modal #ff-name", timeout=10000)
    wait_for_form_focus(page)
    page.fill("#modal #ff-name", SENTINEL)
    page.fill("#modal #ff-description", "Drawn for Project A.")
    assert_typed_where_intended(page, {"ff-name": SENTINEL, "ff-description": "Drawn for Project A."})
    # B REPLACES A WHILE THE FORM IS OPEN, through the server's own switch and the window's own
    # replacement lifecycle — the path a switch takes, without the switcher closing the dialog.
    page.evaluate("""async (slug) => {
      const r = await fetch('/api/projects/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) });
      if (!r.ok) throw new Error('switch answered ' + r.status);
      await load();
    }""", PROJECT_B)
    page.wait_for_function(
        "(slug) => ACTIVE_PROJECT_SLUG === slug && !!P && P.meta && P.meta.title === 'Project B Overlap'"
        " && !document.getElementById('modal').classList.contains('hidden') && projectSaveSettled().settled", arg=PROJECT_B, timeout=25000)
    bytes_a, bytes_b = file_a.read_bytes(), file_b.read_bytes()
    hash_before = page.evaluate("() => location.hash")
    page.__requests.clear()
    page.focus("#modal .lock-btn")
    page.keyboard.press("Enter")
    # Whatever SAVE did has reached storage before anything is read: a wrongly accepted record
    # is saved, and the save settles, before this returns.
    page.wait_for_function("() => projectSaveSettled().settled", timeout=25000)
    observe_quiet(page)
    text_a, text_b = file_a.read_text(encoding="utf-8"), file_b.read_text(encoding="utf-8")
    assert SENTINEL not in text_b and SENTINEL not in text_a, \
        (f"wrong project changed: the Character typed into a form drawn for Project A was saved into "
         f"{'Project B' if SENTINEL in text_b else 'Project A after it had been replaced'} — a form's SAVE must require the project it was opened for")
    assert file_a.read_bytes() == bytes_a and file_b.read_bytes() == bytes_b, "a refused SAVE wrote to Project A or Project B"
    state = page.evaluate(STATE)
    assert state["modalOpen"] and state["fields"], "the refused form must stay open"
    kept = page.evaluate("() => [document.getElementById('ff-name').value, document.getElementById('ff-description').value]")
    assert kept == [SENTINEL, "Drawn for Project A."], f"every entered value must be kept, the fields hold {kept}"
    assert state["refusal"] and not state["refusal"]["hidden"] and state["refusal"]["text"] == REPLACED_REASON, \
        f"the reason must say the form belongs to a different project, got {state['refusal']}"
    assert ax_node(page, "#form-modal-refusal")["role"] == "alert", "and be announced"
    assert state["focus"]["text"] == "SAVE", f"focus must stay on SAVE, it is on {state['focus']}"
    assert state["slug"] == PROJECT_B and state["hash"] == hash_before, \
        f"no project switch and no route change may follow a refused SAVE, got {state['slug']!r} at {state['hash']!r}"
    writes = [r for r in api_requests(page) if not r.startswith("GET ")]
    assert not writes, f"a refused SAVE sent writes: {writes}"
    assert_readable(page, "#form-modal-refusal", "the wrong-project refusal")
    assert not state["horizontalOverflow"], f"the refused form overflows horizontally at {width}px"
    shoot(page, f"wrong-project-refusal-{width}")
    page.click("#modal .cancel")
    return (f"Project A → B at {width}px: a Character form drawn for A, SAVE pressed after B replaced A — refused with the "
            f"wrong-project reason in an alert; both values kept; focus on SAVE; still in B, no route change; no write request; "
            f"A and B byte-identical and neither holds the record ({len(overlap)} entity ids in common across seven lists)")


def contract_open_project_creators(page):
    """With a project open every creator still opens, saves into THAT project's file, and
    changes only its own list."""
    server = page.__server
    project_file = servers[server]["folder"] / "projects" / "dogfood-sample" / "project.json"
    made = []
    for label, lst, field in (("Character", "characters", "ff-name"), ("Location", "locations", "ff-name"),
                              ("Prop", "props", "ff-name"), ("Vehicle", "vehicles", "ff-name"),
                              ("Audio", "audio", "ff-name"), ("Scene", "scenes", "ff-title"), ("Shot", "shots", "ff-title")):
        reset(page)
        before = page.evaluate("() => JSON.parse(JSON.stringify(P))")
        page.click("#global-add")
        page.click(f".global-add-grid button:has(b:text-is('{label}'))")
        page.wait_for_selector(f"#modal #{field}", timeout=10000)
        form = page.evaluate(STATE)
        assert form["refusal"] and form["refusal"]["hidden"], f"{label}: the refusal slot must be hidden with a project open"
        name = f"{SENTINEL} {label}"
        wait_for_form_focus(page)
        page.fill(f"#modal #{field}", name)
        page.click("#modal .lock-btn")
        # THE REQUESTED THING: the product's own answer that its save has settled, with the
        # new record in the record it saved — then the file. Reading the file while the
        # server is atomically replacing it is a sharing violation on Windows, so a read
        # that loses that race is retried rather than taken as an answer.
        page.wait_for_function(
            f"() => projectSaveSettled().settled && JSON.stringify(P[{json.dumps(lst)}] || []).includes({json.dumps(name)})",
            timeout=20000)
        saved = None
        for _ in range(40):
            try:
                disk = json.loads(project_file.read_text(encoding="utf-8"))
            except (PermissionError, json.JSONDecodeError):
                page.wait_for_timeout(100); continue
            if any(name in json.dumps(row) for row in disk.get(lst, [])):
                saved = disk; break
            page.wait_for_timeout(100)
        assert saved, f"{label}: the save settled but the new record is not in the open project's file on disk"
        added = [row.get("id") for row in saved.get(lst, []) if row.get("id") not in {x.get("id") for x in before.get(lst, [])}]
        assert len(added) == 1, f"{label}: exactly one record must be added to {lst}, got {added}"
        changed = sorted(k for k in set(before) | set(saved) if json.dumps(before.get(k), sort_keys=True) != json.dumps(saved.get(k), sort_keys=True))
        assert changed == [lst], f"{label}: only {lst} may change, but {changed} did"
        route = page.evaluate("() => location.hash")
        assert added[0] in route, f"{label}: it must land on the new record, the address is {route}"
        made.append(f"{label} {added[0]}")
    stray = sorted(p.name for p in (servers[server]["folder"] / "projects").iterdir())
    assert stray == ["dogfood-sample"], f"the open project must be the only project on disk, found {stray}"
    return "open project: " + ", ".join(made) + " — each saved into dogfood-sample/project.json, only its own list changed"


def contract_repeated_and_concurrent(page):
    """Refusals are side-effect free however often and however fast they are asked for."""
    server = page.__server
    before = tree(servers[server]["folder"])
    reset(page)
    page.evaluate("""() => Promise.all(Array.from({ length: 12 }, (_, i) => Promise.resolve().then(() =>
        [() => addEntity('characters'), () => addScene(), () => addShot(), () => runGlobalAdd('prop')][i % 4]())))""")
    for _ in range(20):
        page.evaluate("() => addEntity('locations')")
    observe_quiet(page)
    state = page.evaluate(STATE)
    assert state["modalOpen"] and not state["fields"], f"a burst of creator calls opened a form: {state['fields']}"
    assert page.evaluate("() => document.querySelectorAll('#modal .modal-box').length") == 1, "a burst must leave exactly one dialog"
    assert not api_requests(page), f"a burst of refusals made requests: {api_requests(page)}"
    assert not tree_diff(before, tree(servers[server]["folder"])), "a burst of refusals changed files"
    reset(page)
    return "a burst of 12 concurrent and 20 sequential creator calls: one refusal dialog, no form, no request, no file"


def contract_geometry(page, width, height):
    page.set_viewport_size({"width": width, "height": height})
    reset(page)
    page.evaluate("() => addEntity('characters')")
    page.wait_for_function("() => !document.getElementById('modal').classList.contains('hidden')", timeout=5000)
    settle_animations(page)
    state = page.evaluate(STATE)
    assert not state["horizontalOverflow"], f"the refusal dialog overflows horizontally at {width}px"
    box = state["modalBox"]
    assert box and box["left"] >= 0 and box["right"] <= box["vw"], f"the refusal dialog leaves the viewport at {width}px: {box}"
    assert_readable(page, "#global-add-reason", "the refusal's reason")
    assert_readable(page, "#modal .global-add-grid button", "the New project action")
    shoot(page, f"first-run-refusal-{width}")
    reset(page)
    return f"{width}x{height}: the refusal dialog fits ({box['width']}px wide in {box['vw']}px), the reason visible, no horizontal overflow"


def contract_unreadable_media(page):
    """Recovery mode's damaged project is not written into by any media route, whether or not
    the request names it — asked from the Recovery page itself, the way a stale script would."""
    server = page.__server
    width = page.viewport_size["width"]
    folder = servers[server]["folder"] / "projects"
    before = tree(folder)
    answers = page.evaluate("""async () => {
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const calls = [];
      for (const slug of ['', '&slug=dogfood-sample']) {
        for (const type of ['anchors', 'plates', 'props', 'vehicles', 'audio', 'media'])
          calls.push([`/api/media/upload?type=${type}&name=recovery-${type}.png${slug}`, png]);
        calls.push([`/api/shots/SC-RECOVERY-01/take?name=recovery-take.png${slug}`, png]);
        calls.push([`/api/shots/SC-RECOVERY-01/blocking?name=recovery-blocking.png${slug}`, png]);
        calls.push([`/api/shots/SC-RECOVERY-01/folder${slug ? '?slug=dogfood-sample' : ''}`, null]);
        calls.push(['/api/media/prepare-identity', { dir: 'anchors', name: 'x.png', ...(slug ? { projectSlug: 'dogfood-sample' } : {}) }]);
        calls.push(['/api/media/rename', { dir: 'anchors', from: 'x.png', to: 'y.png', ...(slug ? { projectSlug: 'dogfood-sample' } : {}) }]);
      }
      const out = [];
      for (const [url, body] of calls) {
        const json = body && !(body instanceof Uint8Array);
        const r = await fetch(url, { method: 'POST', body: json ? JSON.stringify(body) : body,
          headers: body ? { 'Content-Type': json ? 'application/json' : 'application/octet-stream' } : {} });
        out.push({ url, status: r.status, body: await r.json().catch(() => null) });
      }
      return out;
    }""")
    changed = tree_diff(before, tree(folder))
    assert not changed, f"the damaged project directory changed — Recovery's project was written into: {changed}"
    wrong = [a for a in answers if not (a["status"] == 422 and (a["body"] or {}).get("code") == "PROJECT_UNREADABLE")]
    assert not wrong, f"every media write into the unreadable project must be refused 422 PROJECT_UNREADABLE, got {wrong[:3]}"
    state = page.evaluate(STATE)
    assert state["screen"] == "recovery" and not state["horizontalOverflow"], "the Recovery screen stays up, and fits"
    shoot(page, f"unreadable-media-refusal-{width}")
    return (f"unreadable project at {width}px: {len(answers)} media writes from the Recovery page (half naming the project) — all 422 "
            "PROJECT_UNREADABLE; the damaged project's folder byte-identical; the Recovery screen untouched")


# ===========================================================================
try:
    for server in servers.values():
        wait_for_server(server["base"])

    with sync_playwright() as pw:
        browser = launch_chromium(pw)

        def page_for(server, **options):
            return open_page(browser, server, **options)

        # 1-5. first run.
        page = page_for("first")
        findings.append("1. " + contract_first_run_chooser(page))
        findings.append("2. " + contract_direct_creators(page, "first run"))
        findings.append("3. " + contract_repeated_and_concurrent(page))
        for n, (w, h) in enumerate(((1440, 900), (390, 844)), start=4):
            findings.append(f"{n}. " + contract_geometry(page, w, h))
        page.close()

        # 6-8. Recovery mode: the chooser, every direct creator, and its unreadable media.
        for w, h in ((1440, 900), (390, 844)):
            page = page_for("recovery", viewport=(w, h))
            line = contract_unopenable_chooser(page, "Recovery mode", "recovery")
            if w == 1440:
                findings.append("6. " + line)
                findings.append("7. " + contract_direct_creators(page, "Recovery mode"))
            findings.append(("8a. " if w == 1440 else "8b. ") + contract_unreadable_media(page))
            page.close()

        # 9-10. a failed load.
        for w, h in ((1440, 900), (390, 844)):
            page = page_for("open", failing=True, viewport=(w, h))
            line = contract_unopenable_chooser(page, "load failure", "failure")
            if w == 1440:
                findings.append("9. " + line)
                findings.append("10. " + contract_direct_creators(page, "load failure"))
            page.close()

        # 11. the way out of Recovery and of a failed load, at both widths.
        for w, h in ((1440, 900), (390, 844)):
            page = page_for(f"recovery-exit-{w}", viewport=(w, h))
            findings.append(f"11. " + contract_new_project_escape(page, "Recovery mode", "recovery", f"Orphan Recovery Exit {w}"))
            page.close()
            page = page_for(f"failure-exit-{w}", fail_once=True, viewport=(w, h))
            findings.append(f"11. " + contract_new_project_escape(page, "load failure", "failure", f"Orphan Failure Exit {w}"))
            page.close()

        # 12. still opening, at both widths, and an open that ends in Recovery or a failed load.
        for w, h in ((1440, 900), (390, 844)):
            page = page_for("open", hold=True, viewport=(w, h))
            findings.append("12. " + contract_opening(page))
            page.close()
        page = page_for("recovery", hold=True)
        findings.append("12. " + contract_opening_resolves(page, "Recovery mode", "recovery"))
        page.close()
        page = page_for("open", hold=True, failing=True)
        findings.append("12. " + contract_opening_resolves(page, "load failure", "failure"))
        page.close()

        # 13. SAVE after the project went away, at both widths.
        for w, h in ((1440, 900), (390, 844)):
            page = page_for("open", viewport=(w, h))
            findings.append("13. " + contract_save_time_refusal(page))
            page.close()

        # 14. SAVE after ANOTHER project replaced the form's own, at both widths.
        for w, h in ((1440, 900), (390, 844)):
            page = page_for(f"ab-{w}", viewport=(w, h))
            findings.append("14. " + contract_wrong_project(page))
            page.close()

        # 15. an open project, unchanged.
        page = page_for("write")
        findings.append("15. " + contract_open_project_creators(page))
        page.close()

        # ------------------------------------------------ the negative controls.
        CONTROLS = [
            ("N1 the visible entry guard: ＋ Add answers from first run alone, so Recovery offers all eight", "recovery",
             lambda p: contract_unopenable_chooser(p, "Recovery mode", "recovery"), {
                "**/app.js*": lambda: mutate("public/app.js",
                    "    ? GLOBAL_ADD_CHOICES.filter(([key]) => shellAddChoiceAvailable(key, facts))",
                    "    ? GLOBAL_ADD_CHOICES.filter(([key]) => shellAddChoiceAvailable(key, { hasProject: facts.hasProject }))", "N1"),
            }, {}),
            ("N2 the direct guard: a creator no longer stops at the door", "first",
             lambda p: contract_direct_creators(p, "first run"), {
                "**/app.js*": lambda: mutate("public/app.js",
                    "  if (!entityCreationRefusal(key)) return false;\n  openGlobalAdd(key);\n  return true;",
                    "  return false;", "N2"),
            }, {}),
            ("N3 the shared decision allows every record", "first", contract_first_run_chooser, {
                "**/shared-shell-availability.js*": lambda: mutate("public/shared-shell-availability.js",
                    '    if (writable) return { record, available: true, state: "open", action: "", heading: "", reason: "" };',
                    '    if (true) return { record, available: true, state: "open", action: "", heading: "", reason: "" };', "N3"),
            }, {}),
            ("N4 the accessible reason: printed, but no longer the dialog's description", "first", contract_first_run_chooser, {
                "**/app.js*": lambda: mutate("public/app.js",
                    '  $("#modal .modal-box")?.setAttribute("aria-describedby", "global-add-reason");\n', "", "N4"),
            }, {}),
            ("N5 the SAVE-time guard: SAVE closes the form before it asks", "open", contract_save_time_refusal, {
                "**/app.js*": lambda: mutate("public/app.js",
                    '    const refusal = refuse ? refuse(openedFor) : "";\n'
                    '    if (refusal) {\n'
                    '      const note = $("#form-modal-refusal");\n'
                    '      if (note) { note.textContent = refusal; note.hidden = false; }\n'
                    '      return;\n'
                    '    }\n', "", "N5"),
            }, {}),
            ("N6 the offered action: ＋ Add → New project answers from first run alone, so it is a dead end in Recovery", "recovery",
             lambda p: contract_new_project_escape(p, "Recovery mode", "recovery", "Orphan Control Exit"), {
                "**/app.js*": lambda: mutate("public/app.js",
                    "    if (!projectRecordInstalled()) return newProject();\n",
                    "    if (shellInFirstRun()) return newProject();\n", "N6"),
            }, {}),
            ("N7 the project binding: \"a record is installed\" passes for \"the form's own project\"", "ab-control", contract_wrong_project, {
                "**/app.js*": lambda: mutate("public/app.js",
                    "  return !!identity && projectRecordInstalled()\n    && identity.slug === ACTIVE_PROJECT_SLUG && identity.epoch === PROJECT_OPEN_EPOCH;\n",
                    "  return !!identity && projectRecordInstalled();\n", "N7"),
            }, {}),
            ("N8 the running open: the creators are not told a project is opening", "open", contract_opening, {
                "**/app.js*": lambda: mutate("public/app.js", "opening: projectOpenInFlight() };", "opening: false };", "N8"),
            }, {"hold": True}),
            ("N9 the redraw: a 'still opening' chooser is never corrected once the open settles", "recovery",
             lambda p: contract_opening_resolves(p, "Recovery mode", "recovery"), {
                "**/app.js*": lambda: mutate("public/app.js",
                    "    if (!PROJECT_OPENS_IN_FLIGHT) try { refreshEntityCreationRefusal(); } catch (_) {}\n", "", "N9"),
            }, {"hold": True}),
            # The form queues its own first-field focus again, and it lands at the worst moment: after
            # something has been typed and focus has moved on to the next field — released by those two
            # events, in the microtask after the move, never by elapsed time. That is the ordering that
            # carried a description into Code / id on a hosted runner.
            ("N10 the form's initial focus: a deferred first-field focus lands after focus has moved within the form", "open",
             contract_save_time_refusal, {
                "**/app.js*": lambda: mutate("public/app.js",
                    '      <button class="lock-btn" onclick="_formSubmit()">SAVE</button></div>`);\n}\n',
                    '      <button class="lock-btn" onclick="_formSubmit()">SAVE</button></div>`);\n'
                    '  const late = $("#ff-" + fields[0].k), box = $("#modal");\n'
                    '  let typed = false;\n'
                    '  const typing = () => { typed = true; };\n'
                    '  const release = (event) => {\n'
                    '    if (!typed || event.target === late || !box.contains(event.target)) return;\n'
                    '    box.removeEventListener("focusin", release);\n'
                    '    box.removeEventListener("input", typing);\n'
                    '    queueMicrotask(() => late.focus());\n'
                    '  };\n'
                    '  box.addEventListener("input", typing);\n'
                    '  box.addEventListener("focusin", release);\n'
                    '}\n', "N10"),
            }, {}, "typing was diverted into #ff-id"),
        ]
        for label, server, contract, patches, options, *must_say in CONTROLS:
            routes = {glob: build() for glob, build in patches.items()}
            broken, caught = None, None
            try:
                broken = open_page(browser, server, routes=routes, record=False, **options)
                contract(broken)
            except AssertionError as error:
                caught = str(error).split("\n")[0][:190]
            except Exception as error:                      # noqa: BLE001 — a timeout here is a FAILED control
                raise AssertionError(f"{label}: the contract did not fail at its own assertion — it raised "
                                     f"{type(error).__name__}, which proves nothing: {error}") from error
            finally:
                if broken: broken.close()
            assert caught, f"{label}: the contract PASSED against the reconstructed defect, so it proves nothing"
            assert not must_say or caught.startswith(must_say[0]), \
                f"{label}: the contract failed, but not at the assertion that owns this defect — expected {must_say[0]!r}, got {caught!r}"
            findings.append(f"NC. {label}\n        caught by: {caught}")

        for relative in ("public/app.js", "public/shared-shell-availability.js"):
            text = (ROOT / relative).read_text(encoding="utf-8")
            assert "if (true) return { record" not in text and "shellAddChoiceAvailable(key, { hasProject: facts.hasProject })" not in text \
                and "opening: false };" not in text, f"{relative} was mutated on disk — the controls must hold their copies in memory"
        clean = page_for("first")
        contract_first_run_chooser(clean)
        clean.close()
        findings.append("NC. every control held its mutation in memory; the shipped tree is untouched and still passes")
        browser.close()
finally:
    for server in servers.values():
        server["process"].terminate()
        try: server["process"].wait(timeout=10)
        except Exception: server["process"].kill()
    shutil.rmtree(sandbox, ignore_errors=True)

assert not page_errors, f"the page raised uncaught errors: {page_errors}"
# Accounted for exactly, not filtered by keyword. Chromium logs every non-2xx response as a
# resource error; these are the ones each server was built to answer:
#   GET /api/project — 404 on the empty install, 422 on each Recovery install, 500 simulated;
#   the Recovery page's own media writes — 422 PROJECT_UNREADABLE, which is the point.
MEDIA_PATHS = ("/api/media/upload", "/api/media/prepare-identity", "/api/media/rename", "/api/shots/SC-RECOVERY-01/")


def expected_console(entry):
    server, text, url = entry
    if not text.startswith("Failed to load resource"):
        return False
    if url.endswith("/api/project"):
        return (server == "first" and "404" in text) or (server.startswith("recovery") and "422" in text) \
            or ((server == "open" or server.startswith("failure-exit")) and "500" in text)
    return server == "recovery" and "422" in text and any(p in url for p in MEDIA_PATHS)


expected = [e for e in console_errors if expected_console(e)]
unexpected = [e for e in console_errors if not expected_console(e)]
assert not unexpected, f"console errors: {unexpected}"
assert not offsite, f"requests left the machine: {sorted(set(offsite))}"
assert not paid_calls, f"a paid route was called: {sorted(set(paid_calls))}"

print("\n".join("  " + line for line in findings))
print(f"  console: {len(expected)} expected resource errors (each server's own /api/project answer, and the Recovery page's "
      "refused media writes); 0 other errors; 0 uncaught exceptions")
print("  project data isolated in a temporary sandbox (removed): data/ and the shipped sample untouched")
print("  no offsite request and no paid route: 0 attempted, 0 reached")
print("orphan entity creation refusal real-browser audit passed")
