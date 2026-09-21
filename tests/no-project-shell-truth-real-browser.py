#!/usr/bin/env python3
"""NO_PROJECT_SHELL_TRUTH_V1 — the first sixty seconds, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. tests/no-project-shell-truth.js proves the predicate and
pins the places in the shipped source that are now required to ask it. None of that is
the thing a filmmaker experienced, which was entirely about what a press DOES:

  * pressing Shots moved the address bar and left the welcome card on screen;
  * pressing Settings did the same, so no integration could be configured until a
    project existed;
  * pressing ＋ Add → New project closed the chooser and did nothing at all;
  * pressing Activity reported an open drawer over a dock of zero height;
  * typing #/board rendered Production with the Shots item lit.

Every one of those is a claim about a running document — a hash that did or did not move,
a request that was or was not made, a rendered height, a lit rail item — so every one of
them is measured here against the shipped page.

THREE SERVERS, because the contracts are about states being different: a true first run
with an EMPTY projects root; a second empty install on which one project is created, to
prove where it lands and that the shell recovers; and an ordinary window with a disposable
project open, to prove the repair changed nothing a working build does.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because an assertion that cannot fail is worth
nothing. Each one rebuilds a defect IN THE SHIPPED SOURCE — the file is read from disk,
one anchored mutation is applied, and the patched text is served to the browser through
a request interception — and then requires the assertion responsible for that contract to
raise. Nothing is written to disk, so two suites can run at once and a crash cannot leave
a patched source behind.

  N1  the no-project navigation guard is removed
  N2  Settings is allowed to fall through to the welcome card
  N3  the unknown-route fallback to Production is restored
  N4  the inert ＋ Add → New project action is restored
  N5  first run is read from a null record, so a project still OPENING is refused —
      the defect the browser gate found in this slice's first draft
  N6  the topbar search is left enabled and inert with no project
  N7  runSearch() posts with no project again — on a first run that request makes the
      local server exit, so it is intercepted here and named by the assertion instead

NOTHING IS CONFIGURED, PAID FOR, OR SENT ANYWHERE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched. Every paid route is aborted, every request
host is recorded, and the run fails if anything but 127.0.0.1 is contacted.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time, urllib.request

# The findings and assertion messages name the ＋ Add control and use arrows. On Windows a
# PIPED stdout is cp1252, which cannot encode either, and a UnicodeEncodeError raised while
# printing an assertion would hide the assertion itself. The stream keeps its encoding;
# anything it cannot represent is escaped instead of raising.
for _stream in (sys.stdout, sys.stderr):
    try: _stream.reconfigure(errors="backslashreplace")
    except Exception: pass

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "No-project shell truth real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTES = ("/api/generation/fal/submit", "/api/generation/civitai/jobs", "/api/generation/comfy/jobs")

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


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-no-project-shell-"))

# ---------------------------------------------------------------- the empty install.
# A true first run is an EMPTY projects root and a config with nothing in it. It is built
# by hand rather than by scripts/qa-sandbox.js, which exists to produce the opposite.
first_root = sandbox / "first"
(first_root / "projects").mkdir(parents=True)
(first_root / "config.json").write_text("{}", encoding="utf-8")
# A SECOND empty install, for the one contract that creates a project. The first one
# must still be empty when the negative controls run against it.
create_root = sandbox / "create"
(create_root / "projects").mkdir(parents=True)
(create_root / "config.json").write_text("{}", encoding="utf-8")

# ---------------------------------------------------------------- the ordinary window.
project_root = sandbox / "open"
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(project_root), "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
# Search with a project open tries local embeddings first and, if they answer, writes
# data/embeddings.json into the REPOSITORY'S data/ — which the browser gate requires to be
# byte-identical. The embedding endpoint is pinned to a closed loopback port so search
# deterministically takes its plain-text fallback and nothing can be written or contacted.
_open_config_path = project_root / "config.json"
_open_config = json.loads(_open_config_path.read_text(encoding="utf-8"))
_open_config["ollamaUrl"] = "http://127.0.0.1:9"
_open_config_path.write_text(json.dumps(_open_config, indent=2), encoding="utf-8")

servers = {}
for name, folder in (("first", first_root), ("open", project_root), ("create", create_root)):
    port = free_port()
    servers[name] = {
        "port": port,
        "base": f"http://127.0.0.1:{port}",
        "process": subprocess.Popen(
            ["node", "server.js"], cwd=ROOT,
            env={**os.environ, "PORT": str(port),
                 "CINEBRAID_CONFIG_PATH": str(folder / "config.json"),
                 "CINEBRAID_PROJECTS_ROOT": str(folder / "projects")},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    }

# ===========================================================================
# READING THE PAGE. One evaluation, so every contract below reasons about one
# consistent snapshot rather than a sequence of separate reads that can disagree.
SHELL = """
() => {
  const note = (id) => { const n = document.getElementById(id); return n ? { text: n.textContent.trim(), hidden: n.hidden } : null; };
  const described = (el) => {
    const id = el.getAttribute('aria-describedby');
    const target = id ? document.getElementById(id) : null;
    return target && !target.hidden ? target.textContent.trim() : '';
  };
  const nav = [...document.querySelectorAll('.nav-btn[data-view]')].map((b) => ({
    view: b.dataset.view,
    label: b.dataset.label,
    active: b.classList.contains('active'),
    unavailable: b.getAttribute('aria-disabled') === 'true',
    domDisabled: b.disabled,
    reason: described(b) || b.title || '',
    focusable: !b.disabled,
    opacity: getComputedStyle(b).opacity,
  }));
  const activity = document.getElementById('automation-activity-toggle');
  const rescan = document.getElementById('rescan');
  const dock = document.getElementById('cb-shell-dock');
  const braidy = document.getElementById('creator-rail-toggle');
  return {
    hash: location.hash,
    nav,
    activeNav: nav.filter((n) => n.active).map((n) => n.view),
    unavailableNav: nav.filter((n) => n.unavailable).map((n) => n.view),
    topbarView: document.getElementById('topbar-view').textContent.trim(),
    topbarProject: document.getElementById('topbar-project').textContent.trim(),
    mainText: document.getElementById('main').textContent.trim(),
    firstRun: !!document.querySelector('.first-run-state'),
    notFound: !!document.querySelector('.not-found-state'),
    needsProject: (document.querySelector('[data-no-project-view]') || {}).dataset
      ? document.querySelector('[data-no-project-view]').dataset.noProjectView : '',
    settingsScope: (document.querySelector('[data-settings-scope]') || {}).textContent || '',
    settingsTab: (document.querySelector('[data-settings-tab]') || {}).dataset
      ? document.querySelector('[data-settings-tab]').dataset.settingsTab : '',
    settingsRefusal: !!document.querySelector('[data-settings-refusal="no-project"]'),
    connectionCards: document.querySelectorAll('.studio-connection').length,
    navNote: note('nav-availability-note'),
    rescanNote: note('rescan-availability-note'),
    rescanUnavailable: rescan ? rescan.getAttribute('aria-disabled') === 'true' : null,
    rescanReason: rescan ? described(rescan) : '',
    activityExpanded: activity ? activity.getAttribute('aria-expanded') : 'MISSING',
    activityUnavailable: activity ? activity.getAttribute('aria-disabled') === 'true' : null,
    activityState: activity ? (activity.querySelector('.activity-state') || {}).textContent || '' : '',
    activityLabel: activity ? activity.getAttribute('aria-label') || '' : '',
    dockHeight: dock ? Math.round(dock.getBoundingClientRect().height) : -1,
    searchUnavailable: (document.getElementById('global-search') || {}).getAttribute
      ? document.getElementById('global-search').getAttribute('aria-disabled') === 'true' : null,
    searchReadOnly: (document.getElementById('global-search') || {}).readOnly === true,
    searchPlaceholder: (document.getElementById('global-search') || {}).placeholder || '',
    searchValue: (document.getElementById('global-search') || {}).value || '',
    searchReason: document.getElementById('global-search') ? described(document.getElementById('global-search')) : '',
    /* EFFECTIVE opacity — the product up the ancestor chain — because that is what a person
       sees: a box at .58 holding an input at .58 reads at about a third. */
    searchOpacity: (() => { const el = document.getElementById('global-search'); let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return +o.toFixed(3); })(),
    searchInputOpacity: document.getElementById('global-search') ? +getComputedStyle(document.getElementById('global-search')).opacity : null,
    searchBoxOpacity: document.querySelector('#topbar .topbar-search') ? +getComputedStyle(document.querySelector('#topbar .topbar-search')).opacity : null,
    rescanOpacity: (() => { let o = 1; for (let n = rescan; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return +o.toFixed(3); })(),
    welcomeMark: (() => {
      const box = document.querySelector('.first-run-state .first-run-mark');
      if (!box) return null;
      const img = box.querySelector('img');
      const b = box.getBoundingClientRect(), i = img ? img.getBoundingClientRect() : null;
      return {
        text: box.textContent.trim(),
        src: img ? img.getAttribute('src') : '',
        alt: img ? img.getAttribute('alt') : null,
        decoded: !!(img && img.complete && img.naturalWidth > 0),
        box: [Math.round(b.width), Math.round(b.height)],
        inside: !!(i && i.left >= b.left && i.right <= b.right && i.top >= b.top && i.bottom <= b.bottom),
      };
    })(),
    welcomeHeadingLines: (() => {
      const h = document.querySelector('.first-run-state h1');
      if (!h) return 0;
      const lh = parseFloat(getComputedStyle(h).lineHeight) || parseFloat(getComputedStyle(h).fontSize) * 1.2;
      return Math.round(h.getBoundingClientRect().height / lh);
    })(),
    braidyHidden: braidy ? braidy.hidden : 'MISSING',
    braidyDisabled: braidy ? braidy.disabled : 'MISSING',
    modalOpen: !document.getElementById('modal').classList.contains('hidden'),
    modalText: document.getElementById('modal').textContent.trim().slice(0, 120),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    renderReady: document.body.dataset.renderReady || '',
    routeError: document.body.dataset.routeError || '',
  };
}
"""

# WAITING FOR THE REQUESTED THING — a render that ran FOR this hash and finished.
#
# `data-render-ready` alone is not that, and this suite found out the hard way. A route
# that is superseded because the hash has ALREADY moved marks the page ready before the
# replacing route's hashchange has even been dispatched (route()'s superseded branch
# calls markRouteRenderSettled(), and the token still matches because nothing has
# replaced it yet). The Working Bible's own fetchAuthority() re-render is exactly such a
# route, so pressing Reports straight after Bible read "ready" at #/reports with Bible
# still on screen. That is inherited behaviour of the flag, not of this slice.
#
# `cinebraid:route-rendered` is dispatched only by a render that completed for the hash
# it was asked about — a superseded render returns before it. So the wait is for that
# event at the requested hash, collected fresh for each navigation. It is independent of
# the rail, the topbar and the content, which is the point: those are what the contracts
# ASSERT, and a wait that also required them would turn every negative control into a
# timeout instead of a failed assertion.
SETTLED = """
(wanted) => (window.__shellRenders || []).includes(wanted)
  && document.body.dataset.renderReady === '1'
  && (location.hash || '#/production') === wanted
"""
LISTEN = """
() => {
  window.__shellRenders = [];
  if (!window.__shellRenderListener) {
    window.__shellRenderListener = true;
    window.addEventListener('cinebraid:route-rendered',
      () => window.__shellRenders.push(location.hash || '#/production'));
  }
}
"""
NAVIGATE = """
(h) => {
  window.__shellRenders = [];
  if (!window.__shellRenderListener) {
    window.__shellRenderListener = true;
    window.addEventListener('cinebraid:route-rendered',
      () => window.__shellRenders.push(location.hash || '#/production'));
  }
  if ((location.hash || '#/production') === h) route(); else location.hash = h;
}
"""
ARM = LISTEN


QUIET_MS = 350


def observe_quiet(page):
    """PROVING THAT SOMETHING DID NOT HAPPEN needs a window, because there is no event
    for absence. Every use below follows a gesture whose correct outcome is "nothing":
    no hash, no request, no modal, no expanded drawer. The bound is short and it is
    never used to wait for a thing that DOES happen — those wait on the thing itself."""
    page.wait_for_timeout(QUIET_MS)


RENDER_BOUND_MS = 20000


def settle(page, wanted):
    """THE ROUTER ANSWERED THIS ADDRESS — or an assertion that says it did not.

    A render that never arrives is not a generic timeout here. It is the first defect
    this slice exists to remove: on 3b20a4f route() returned the moment it found no
    project, so the address bar moved and nothing on screen did. That is named as what
    it is, so the failure points at the contract rather than at a clock."""
    try:
        page.wait_for_function(SETTLED, arg=wanted, timeout=RENDER_BOUND_MS)
    except Exception as error:
        if "Timeout" not in type(error).__name__ and "Timeout" not in str(error):
            raise
        seen = page.evaluate("() => ({ hash: location.hash, renders: window.__shellRenders || [], main: document.getElementById('main').textContent.trim().slice(0, 60) })")
        raise AssertionError(
            f"no route render completed for {wanted} within {RENDER_BOUND_MS // 1000}s — the router did not answer "
            f"the address it was given, so the page still shows {seen['main']!r} under {seen['hash']!r} "
            f"(renders seen: {seen['renders']})") from None
    return page.evaluate(SHELL)


def go(page, wanted):
    page.evaluate(NAVIGATE, wanted)
    return settle(page, wanted)


def press_and_settle(page, selector, wanted):
    """A real click on a control that navigates, armed first for the same reason as go()."""
    page.evaluate(ARM)
    page.click(selector)
    return settle(page, wanted)


def go_home(page):
    """Back to the shell home before a contract — WITHOUT a navigation when the page is
    already there. A fresh page opens on the home, and asking the router to re-answer an
    address it already answered would make the first thing a contract measures the
    router's willingness to run, instead of the contract's own claim."""
    if page.evaluate("() => (location.hash || '#/production') === '#/production'"):
        return page.evaluate(SHELL)
    return go(page, "#/production")


def serve_text(body):
    """A ONE-ARGUMENT handler, built by a closure. Playwright inspects a route handler's
    arity and passes (route, request) to anything that takes two parameters — so the
    obvious `lambda route, body=body:` receives the Request object as its body, the
    fulfil throws inside the dispatcher, and the script request hangs until the page
    load times out. That is a generic failure, which is exactly what a negative control
    is not allowed to be."""
    def handler(route):
        route.fulfill(status=200, content_type="application/javascript; charset=utf-8", body=body)
    return handler


def open_page(browser, base, routes=None, viewport=(1440, 900), record=True, hold_project=False):
    """A fresh page. `routes` maps a URL glob to a text body, which is how a negative
    control serves a mutated copy of a shipped file without writing one. A control's
    page is not recorded: it is running a deliberately broken build."""
    page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
    if record:
        page.on("pageerror", lambda e: page_errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: console_errors.append(
            (m.text, (m.location or {}).get("url", ""), base)) if m.type == "error" else None)
    page.on("request", lambda r: offsite.append(r.url)
            if r.url.startswith("http") and "127.0.0.1" not in r.url else None)
    page.on("request", lambda r: paid_calls.append(r.url) if any(p in r.url for p in PAID_ROUTES) else None)
    for pattern in PAID_ROUTES:
        page.route(f"**{pattern}", lambda route: route.abort())
    for glob, body in (routes or {}).items():
        page.route(glob, serve_text(body))
    if hold_project:
        page.add_init_script(HOLD_PROJECT_ANSWER)
    page.goto(f"{base}/?shell={int(time.time() * 1000)}", wait_until="domcontentloaded")
    if not hold_project:
        page.wait_for_function("() => document.body.dataset.renderReady === '1'", timeout=25000)
    return page


# THE WINDOW WHILE A PROJECT IS STILL OPENING, held open deterministically. The app's
# first GET /api/project is parked until the test calls __releaseProject(), so "during
# the load" is a state the test controls rather than a race it hopes to win. Every other
# request, and every later /api/project, passes straight through.
HOLD_PROJECT_ANSWER = """
(() => {
  const real = window.fetch.bind(window);
  window.__heldProject = false;
  window.__releasedProject = false;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!window.__releasedProject && /\\/api\\/project(\\?|$)/.test(url)) {
      window.__heldProject = true;
      await new Promise((resolve) => { window.__releaseProject = resolve; });
      window.__releasedProject = true;
    }
    return real(input, init);
  };
})();
"""


def mutate(relative, anchor, replacement, label):
    """One anchored mutation against a COPY of a shipped file, held in memory. The anchor
    must appear exactly once, or the control is patching something that has moved and
    would silently prove nothing."""
    source = (ROOT / relative).read_text(encoding="utf-8").replace("\r\n", "\n")
    assert source.count(anchor) == 1, (
        f"{label}: the anchor for {relative} appears {source.count(anchor)} times, not once — "
        f"the control has drifted off the seam it exists to break:\n{anchor}")
    return source.replace(anchor, replacement)


# ===========================================================================
# THE CONTRACTS. Each one is a function so a negative control can re-run exactly the
# assertion it claims to break, rather than "the suite" in general.

def contract_navigation(page):
    """Every project-dependent rail item reports itself unavailable, with a reason a
    keyboard user can reach, and activating one does nothing at all."""
    state = go_home(page)
    assert state["unavailableNav"] == ["shots", "library", "results", "bible", "reports"], \
        f"the five project workspaces must report themselves unavailable, got {state['unavailableNav']}"
    assert state["activeNav"] == ["production"], f"the home item is the one lit, got {state['activeNav']}"
    for row in state["nav"]:
        if not row["unavailable"]:
            continue
        assert row["reason"], f"{row['view']} is unavailable with no reason — that is a greyed button and nothing else"
        assert row["reason"].endswith("Create a project or open an existing one first."), \
            f"{row['view']} must name the way out, got {row['reason']!r}"
        assert row["focusable"], \
            f"{row['view']} uses the DOM `disabled` attribute, so a keyboard user can never reach its explanation"
    assert state["navNote"] and not state["navNote"]["hidden"] and state["navNote"]["text"], \
        "the reason must be visible on screen, not only in a tooltip"
    for label in ("Shots", "References", "Production media", "Project Bible", "Reports"):
        assert label in state["navNote"]["text"], f"the visible note must name {label}"

    # ACTIVATING ONE. Pointer and keyboard, with every request made during the gesture
    # recorded, because "nothing happened" has to mean nothing.
    seen = []
    page.on("request", lambda r: seen.append(r.url))
    for view in ("shots", "bible"):
        before = page.evaluate("() => location.hash")
        page.click(f'.nav-btn[data-view="{view}"]', force=True)
        observe_quiet(page)
        after = page.evaluate(SHELL)
        assert after["hash"] == before, \
            f"pressing the unavailable {view} moved the address bar to {after['hash']} — the hash must not move"
        assert after["activeNav"] == ["production"], \
            f"pressing the unavailable {view} lit {after['activeNav']} — a disabled item must not claim to be current"
        assert not after["modalOpen"], f"pressing the unavailable {view} opened a modal"
        assert after["firstRun"], "the home surface must still be the thing on screen"
    # KEYBOARD. Tab from the home item must land on the next rail item even though it is
    # unavailable — that is what makes its reason reachable — and Enter on one must leave
    # focus exactly where the person put it, rather than dropping it on the body.
    page.focus('.nav-btn[data-view="production"]')
    page.keyboard.press("Tab")
    tabbed = page.evaluate("() => (document.activeElement.dataset || {}).view || document.activeElement.id || ''")
    assert tabbed == "shots", \
        f"Tab from the home item must reach the unavailable Shots item so its reason can be heard, focus went to {tabbed!r}"
    described = page.evaluate(
        "() => { const id = document.activeElement.getAttribute('aria-describedby'); const n = id && document.getElementById(id); return n ? n.textContent.trim() : ''; }")
    assert described, "the focused unavailable item must be described by visible text"
    page.focus('.nav-btn[data-view="reports"]')
    page.keyboard.press("Enter")
    observe_quiet(page)
    after = page.evaluate(SHELL)
    assert after["hash"] in ("", "#/production"), f"Enter on an unavailable item moved the hash to {after['hash']}"
    assert after["activeNav"] == ["production"], "Enter on an unavailable item lit it"
    kept = page.evaluate("() => (document.activeElement.dataset || {}).view || ''")
    assert kept == "reports", f"a refused Enter must leave focus on the control that was pressed, focus is on {kept!r}"
    told = page.evaluate("() => (document.getElementById('toast').textContent || '').trim()")
    assert told.endswith("Create a project or open an existing one first."), \
        f"a refused press must say why at the moment it is refused, the toast reads {told!r}"
    api = [u for u in seen if "/api/" in u]
    assert not api, f"activating an unavailable navigation control made requests: {api}"
    return ("navigation: five items unavailable, in the tab order, described by visible text; pointer and Enter "
            "change no hash, open no modal, make no request, keep focus and say why")


def contract_settings(page):
    """Settings renders, is lit, and exposes Connections with no project open."""
    state = go(page, "#/settings")
    assert not state["firstRun"], \
        "#/settings rendered the welcome card — the URL, the rail and the page disagree, which is the shipped defect"
    assert state["activeNav"] == ["settings"], f"the Settings item must be lit, got {state['activeNav']}"
    assert state["topbarView"] == "Settings", f"the topbar must read Settings, got {state['topbarView']!r}"
    assert state["settingsTab"], "a Settings panel must actually be mounted"
    connections = go(page, "#/settings/connections")
    assert connections["connectionCards"] >= 7, \
        f"Connections must list the integrations before a first project exists, found {connections['connectionCards']} cards"
    assert "Application-wide" in connections["settingsScope"], \
        f"studio settings are application-wide with no project, scope read {connections['settingsScope']!r}"
    assert not connections["settingsRefusal"], "an application-wide section must not refuse"
    return "settings: #/settings renders Settings with Settings lit, and Connections lists every integration with no project open"


def contract_project_scoped_settings(page):
    """The two sections stored in a project record refuse visibly instead of pretending."""
    for section in ("project", "project-recovery"):
        state = go(page, f"#/settings/{section}")
        assert state["settingsRefusal"], f"#/settings/{section} must refuse visibly with no project open"
        assert not state["routeError"], f"#/settings/{section} threw instead of refusing: {state['routeError']}"
        assert "no project is open" in state["settingsScope"], \
            f"the scope line must say so, got {state['settingsScope']!r}"
        assert "Create a project" in state["mainText"], "and the refusal must offer the way out"
        fields = page.evaluate(
            "() => document.querySelectorAll('.settings-selected-tab input, .settings-selected-tab select, .settings-selected-tab textarea').length")
        assert fields == 0, \
            f"#/settings/{section} drew {fields} editable fields that cannot be saved — a field that cannot save should never accept a keystroke"
    return "project-scoped settings: both sections refuse in words, draw no unsaveable field, and name the way out"


def contract_unknown_routes(page):
    """A hash naming no view is answered as that, under no rail item."""
    for view in ("board", "scenes", "queue", "activity", "sessions", "runs", "canon", "sources", "zzz-no-such-route"):
        state = go(page, f"#/{view}")
        assert state["notFound"], \
            f"#/{view} names no view in this build and did not render the not-found treatment"
        assert state["activeNav"] == [], \
            f"#/{view} lit {state['activeNav']} — three of these ghosts used to light Shots over a Production page"
        assert state["topbarView"] == "Not found", f"#/{view} left the topbar reading {state['topbarView']!r}"
        assert state["firstRun"] is False, f"#/{view} rendered the welcome card"
        assert "#/" + view in state["mainText"], f"the not-found page must name the hash it could not find (#/{view})"
    return "unknown routes: eight ghost hashes and one nonsense hash are answered as not found, under no rail item and a topbar that says so"


def contract_add_chooser(page):
    """＋ Add offers only the record that can exist, and it opens the real dialog."""
    go_home(page)
    page.click("#global-add")
    page.wait_for_selector(".global-add-grid button", timeout=10000)
    choices = page.evaluate("() => [...document.querySelectorAll('.global-add-grid button b')].map((b) => b.textContent.trim())")
    assert choices == ["New project"], \
        f"with no project open the chooser may offer only New project, it offered {choices}"
    before = page.evaluate("() => location.hash")
    page.click(".global-add-grid button")
    observe_quiet(page)
    state = page.evaluate(SHELL)
    assert state["modalOpen"], \
        "＋ Add → New project closed the chooser and did nothing, which is the shipped defect"
    assert "New CineBraid project" in state["modalText"], \
        f"it must open the existing new-project dialog, the modal reads {state['modalText']!r}"
    assert page.evaluate("() => !!document.getElementById('ff-title')"), \
        "the dialog must be the real one, with its title field"
    assert page.evaluate("() => location.hash") == before, \
        "and it must not move the address bar to a surface that cannot render"
    page.evaluate("() => closeModal()")
    return "add chooser: one choice with no project, and pressing it opens the shipped New CineBraid project dialog"


def contract_utilities(page):
    """Neither utility can enter a false active state, and Braidy keeps its own."""
    state = go_home(page)
    assert state["rescanUnavailable"], "Sync local folders reported itself available with nothing to sync"
    assert state["rescanReason"], "and gave no reason"
    assert state["activityUnavailable"], "the Activity control reported itself available with no project"
    assert state["activityExpanded"] == "false", \
        f"Activity claimed aria-expanded={state['activityExpanded']!r} before it was even pressed"
    assert state["activityState"].strip(), "the chip must show a word, not only a dimmer"
    assert "Create a project" in state["activityLabel"], \
        f"and its accessible name must carry the reason, got {state['activityLabel']!r}"

    seen = []
    page.on("request", lambda r: seen.append(r.url))
    page.click("#automation-activity-toggle", force=True)
    observe_quiet(page)
    after = page.evaluate(SHELL)
    assert after["activityExpanded"] == "false", \
        f"pressing Activity left it claiming aria-expanded={after['activityExpanded']!r} over a dock of {after['dockHeight']}px"
    assert after["dockHeight"] == 0, f"the dock grew to {after['dockHeight']}px with nothing to put in it"
    page.click("#rescan", force=True)
    observe_quiet(page)
    scans = [u for u in seen if "/api/scan" in u]
    assert not scans, f"Sync local folders reached the scan route with no project open: {scans}"
    toasted = page.evaluate("() => (document.getElementById('toast').textContent || '').trim()")
    assert toasted != "Local folders synced", \
        f"it reported {toasted!r} — a receipt for work that did not happen"
    assert toasted.endswith("Create a project or open an existing one first."), \
        f"pressing it must say why it cannot act, the toast reads {toasted!r}"

    assert after["braidyHidden"] is True and after["braidyDisabled"] is True, \
        "Braidy's existing correct unavailable state must be preserved exactly"
    return "utilities: Activity cannot report an open drawer over a zero-height dock, Sync local folders reaches no route, Braidy is untouched"


def contract_search(page):
    """The topbar search cannot be typed into, cannot reach the server, and says why.

    MEASURED ON FIRST RUN: 3b20a4f left the box enabled and inert, and wiring it the way a
    project window does sends POST /api/search to a server with no project file — which
    makes the whole local server EXIT. /api/search is intercepted and aborted for the
    length of this contract, so a regression is reported by the assertion that names the
    request rather than by every later contract failing on a dead server."""
    attempts = []
    listener = lambda r: attempts.append(r.url) if "/api/search" in r.url else None
    page.on("request", listener)
    page.route("**/api/search", lambda route: route.abort())
    try:
        go_home(page)
        # Computed opacity is read AFTER running transitions settle: the rail's ghost buttons
        # ease their opacity, and a read taken mid-ease compares a frame, not a style.
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.wait_for_function("() => document.getAnimations().every((a) => a.playState !== 'running')", timeout=5000)
        state = page.evaluate(SHELL)
        assert state["searchUnavailable"], "the topbar search must report itself unavailable with no project open"
        assert state["searchReadOnly"], "an aria-disabled input still accepts keystrokes, so it must also be read-only"
        assert state["searchPlaceholder"] == "Open a project to search canon", \
            f"the box must say why in its own words, it reads {state['searchPlaceholder']!r}"
        assert state["searchReason"].endswith("Create a project or open an existing one first."), \
            f"and its accessible description must carry the full reason, got {state['searchReason']!r}"
        assert state["searchOpacity"] == state["rescanOpacity"] and float(state["searchOpacity"]) < 1, \
            f"it must look unavailable exactly as the rail's controls do ({state['searchOpacity']} vs {state['rescanOpacity']})"

        # THE SHORTCUT. "/" still lands on the box: focus goes to the control that explains
        # itself, which is truthful, and nothing else happens.
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("/")
        assert page.evaluate("() => document.activeElement && document.activeElement.id") == "global-search", \
            "the / shortcut must still focus the search, where the reason can be read and heard"
        before = page.evaluate("() => location.hash")
        page.keyboard.type("courier")
        observe_quiet(page)
        after = page.evaluate(SHELL)
        assert after["searchValue"] == "", f"the unavailable search accepted a query: {after['searchValue']!r}"
        assert after["hash"] == before, f"typing into the unavailable search moved the hash to {after['hash']}"
        assert not after["modalOpen"], f"typing into the unavailable search opened a modal: {after['modalText']!r}"
        told = page.evaluate("() => (document.getElementById('toast').textContent || '').trim()")
        assert told == state["searchReason"], f"a refused keystroke must say why, the toast reads {told!r}"
        page.keyboard.press("Tab")
        assert page.evaluate("() => document.activeElement && document.activeElement.id") != "global-search", \
            "Tab must leave the unavailable search — focus is never trapped in it"

        # THE SECOND LAYER. Whatever calls the search — not only this box — must not reach
        # the server without a project to search.
        # The rejection is caught IN the page: the interception above aborts any request that
        # does go out, and an aborted fetch rejects — which must be reported as the request it
        # is, by the assertion below, not as a generic evaluation error.
        page.evaluate("() => Promise.resolve(runSearch('courier')).catch(() => 'request-aborted')")
        observe_quiet(page)
        assert not attempts, f"a search request was made with no project open (it takes the server down): {attempts}"
        assert not page.evaluate(SHELL)["modalOpen"], "and no result state was shown"
    finally:
        page.unroute("**/api/search")
        page.remove_listener("request", listener)
    return ("search: aria-disabled, read-only, 'Open a project to search canon', dimmed like the rail; / focuses it, "
            "typing is refused with the reason, Tab leaves it, and no /api/search request is ever made")


def contract_welcome_mark(page):
    """The welcome card carries the shipped CineBraid logo in the badge's unchanged box."""
    state = go_home(page)
    mark = state["welcomeMark"]
    assert mark, "the welcome card must still have its badge"
    assert mark["text"] != "CB", "the welcome card still shows the \"CB\" monogram instead of the CineBraid mark"
    assert mark["src"] == "/cinebraid-logo-xs.png", f"the badge must show the production logo, it shows {mark['src']!r}"
    assert mark["decoded"], "the production logo must actually load and decode"
    assert mark["alt"] == "", "\"WELCOME TO CINEBRAID\" already names the product; the logo must not be announced again"
    assert mark["inside"], "the logo must sit inside the badge's box"
    width = page.evaluate("() => window.innerWidth")
    expected = [104, 104] if width > 720 else [72, 72]
    assert mark["box"] == expected, f"the badge's footprint must not move: {mark['box']} at {width}px, expected {expected}"
    return f"welcome mark at {width}px: the production logo, decoded, alt=\"\", inside the unchanged {expected[0]}px box"


def contract_project_opens(page):
    """Creating a project from the welcome screen lands exactly where it always did, and
    the shell stops refusing the moment a project is open."""
    # Through the welcome card's own Create a project, which works on both builds, so
    # this measures WHERE A NEW PROJECT LANDS and nothing about the ＋ Add chooser — that
    # has its own contract above.
    page.wait_for_selector(".first-run-state .assemble-btn", timeout=10000)
    page.click(".first-run-state .assemble-btn")
    page.wait_for_selector("#ff-title", timeout=10000)
    page.fill("#ff-title", "Shell Truth Disposable")
    page.evaluate(LISTEN)
    page.click("#modal .lock-btn")
    # THE LANDING, UNCHANGED. The default start mode sets #/create BEFORE the project it
    # created is loaded, so for a moment the projectless router is answering #/create.
    # It must answer in place and never move the address: this is where a new project
    # landed on 3b20a4f, and moving it is PROJECT_CREATION_LANDING_V1's decision.
    page.wait_for_function(
        "() => (window.__shellRenders || []).includes('#/create') && document.body.dataset.renderReady === '1'"
        " && location.hash === '#/create' && typeof ACTIVE_PROJECT_SLUG !== 'undefined' && !!ACTIVE_PROJECT_SLUG"
        " && document.getElementById('topbar-project').textContent.trim() === 'Shell Truth Disposable'",
        timeout=30000)
    state = page.evaluate(SHELL)
    assert state["hash"] == "#/create", \
        f"a new project must still land on #/create for the default start mode, it landed on {state['hash']}"
    assert state["topbarView"] == "New Project", f"and the topbar must read New Project, got {state['topbarView']!r}"
    # THE SHELL RECOVERS. Nothing the no-project state wrote survives it.
    assert state["unavailableNav"] == [], f"with a project open no rail item may stay unavailable, got {state['unavailableNav']}"
    assert not (state["navNote"] and not state["navNote"]["hidden"]), "the availability note must be withdrawn"
    assert not state["rescanUnavailable"], "Sync local folders must work again"
    assert not (state["rescanNote"] and not state["rescanNote"]["hidden"]), "and its note must be withdrawn"
    assert not state["activityUnavailable"], "Activity must work again"
    assert state["activityState"].strip() and state["activityState"].strip() != "No project", \
        f"and the chip must stop saying there is no project, it says {state['activityState']!r}"
    return ("a project opens: Create a project → SAVE lands on #/create exactly as on 3b20a4f, and every rail "
            "item, Activity and Sync local folders become available at once")


def contract_opening_is_not_first_run(page):
    """A project that is still OPENING has a null record too, and it is not first run.

    The browser gate found this: refusing on `P === null` silently dropped an Activity
    request made in the moments after a reload, before load() had committed. The page
    here was opened with its /api/project answer parked (HOLD_PROJECT_ANSWER), so the
    window is held in exactly that state until the test lets it go."""
    try:
        page.wait_for_function(
            "() => window.__heldProject === true && !!document.querySelector('#automation-activity-toggle .activity-state')",
            timeout=RENDER_BOUND_MS)
    except Exception as error:
        raise AssertionError(f"the held /api/project request never started, so this contract measured nothing: {error}") from None
    during = page.evaluate(SHELL)
    assert during["unavailableNav"] == [], \
        f"a project still opening is not first run, but the rail refused {during['unavailableNav']}"
    assert not during["activityUnavailable"], \
        f"the Activity control must stay usable while a project opens; it reads {during['activityState']!r} / {during['activityLabel']!r}"
    page.evaluate("() => window.CineBraidCreatorSurfaces.expandTerminal()")
    assert page.evaluate("() => !window.CineBraidCreatorSurfaces.terminalCollapsed()"), \
        "an Activity request made while a project was still opening was refused — the drawer's preference never moved"
    page.evaluate("() => window.__releaseProject()")
    try:
        page.wait_for_function(
            "() => document.body.dataset.renderReady === '1' && typeof ACTIVE_PROJECT_SLUG !== 'undefined' && !!ACTIVE_PROJECT_SLUG"
            " && !!document.querySelector('.cb-terminal[data-collapsed=\"0\"]')",
            timeout=RENDER_BOUND_MS)
    except Exception:
        after = page.evaluate(SHELL)
        raise AssertionError(
            "once the project opened, the drawer requested during the load was not open "
            f"(hash {after['hash']!r}, Activity expanded {after['activityExpanded']!r})") from None
    after = page.evaluate(SHELL)
    assert after["unavailableNav"] == [] and not after["activityUnavailable"], \
        "and nothing in the shell is refused once it has opened"
    assert after["activityExpanded"] == "true", "the Activity control reports the drawer it opened"
    return ("a project still opening is not first run: nothing is refused while /api/project is held, and an "
            "Activity request made then opens the drawer once the project arrives")


def contract_ordinary_window(page):
    """With a project open, the shell is the shell it always was. The one intended change
    — an unknown hash is answered as not found — is contract_unknown_routes's, not this."""
    state = page.evaluate(SHELL)
    assert state["unavailableNav"] == [], \
        f"a window with a project open must have no unavailable rail item, got {state['unavailableNav']}"
    assert not (state["navNote"] and not state["navNote"]["hidden"]), "and no availability note"
    assert not state["rescanUnavailable"] and not state["activityUnavailable"], \
        "both utilities work with a project open"
    assert state["activeNav"] == ["production"] and state["topbarView"] == "Production", \
        f"Production is Production, got {state['activeNav']} / {state['topbarView']!r}"
    for view, label in (("shots", "Shots"), ("library", "References"), ("results", "Production media"),
                        ("bible", "Project Bible"), ("reports", "Reports"), ("settings", "Settings"),
                        ("production", "Production")):
        row = press_and_settle(page, f'.nav-btn[data-view="{view}"]', f"#/{view}")
        assert row["activeNav"] == [view], f"{view} must light itself, got {row['activeNav']}"
        assert row["topbarView"] == label, f"{view} must read {label}, got {row['topbarView']!r}"
        assert not row["notFound"] and not row["needsProject"], f"{view} must render its own workspace"
        assert not row["routeError"], f"{view} failed to render: {row['routeError']}"
    page.click("#global-add")
    page.wait_for_selector(".global-add-grid button", timeout=10000)
    choices = page.evaluate("() => [...document.querySelectorAll('.global-add-grid button b')].map((b) => b.textContent.trim())")
    assert choices == ["Shot", "Scene", "Character", "Location", "Prop", "Vehicle", "Audio", "New project"], \
        f"every ＋ Add action must remain available with a project open, got {choices}"
    # New project with a project open still goes to the start surface, exactly as it did.
    page.evaluate(ARM)
    page.click(".global-add-grid button:has-text('New project')")
    create = settle(page, "#/create")
    assert create["topbarView"] == "New Project" and not create["modalOpen"], \
        f"with a project open, ＋ Add → New project must still open #/create, got {create['topbarView']!r}"
    project_settings = go(page, "#/settings/project")
    assert not project_settings["settingsRefusal"], "project settings must render normally with a project open"
    assert "dogfood" in project_settings["settingsScope"].lower(), \
        f"and name the open project, got {project_settings['settingsScope']!r}"
    # ORDINARY SEARCH STILL WORKS. The box is available, typing runs the real search, and
    # the result list opens — the same request and the same modal as on 3b20a4f.
    go(page, "#/production")
    state = page.evaluate(SHELL)
    assert not state["searchUnavailable"] and not state["searchReadOnly"], \
        "with a project open the topbar search must be available and editable"
    assert state["searchPlaceholder"] == "Search canon", f"and read as it shipped, got {state['searchPlaceholder']!r}"
    answered = []
    listener = lambda r: answered.append(r.status) if "/api/search" in r.url else None
    page.on("response", listener)
    page.click("#global-search")
    page.keyboard.type("parcel")
    try:
        page.wait_for_function(
            "() => !document.getElementById('modal').classList.contains('hidden')"
            " && !!document.querySelector('#modal [data-global-navigation] h3')"
            " && document.querySelectorAll('#modal .qc-item').length > 0",
            timeout=RENDER_BOUND_MS)
    except Exception:
        raise AssertionError(f"typing into the search with a project open did not show results "
                             f"(responses: {answered}, modal: {page.evaluate(SHELL)['modalText']!r})") from None
    page.remove_listener("response", listener)
    assert answered and all(code == 200 for code in answered), f"the search request must succeed, got {answered}"
    results = page.evaluate("() => document.querySelectorAll('#modal .qc-item').length")
    page.keyboard.press("Escape")
    return ("an ordinary window. every rail item, every ＋ Add action, the project-scoped settings and the topbar "
            f"search ({results} results for 'parcel') behave exactly as they did; only the unknown-hash fall-through changed")


def contract_home_round_trip(page):
    """Settings and back again, without creating a project and without browser Back."""
    go_home(page)
    settings = press_and_settle(page, '.nav-btn[data-view="settings"]', "#/settings")
    assert settings["activeNav"] == ["settings"], "the rail's Settings item must open Settings with no project"
    assert not settings["firstRun"], "and must not leave the welcome card up"
    # Leaving Settings behaves as it does with a project open: an unsaved appearance
    # preview is discarded rather than left painted over the welcome screen.
    go(page, "#/settings/appearance")
    page.select_option("#cfg-theme-accent", "amber")
    assert page.evaluate("() => !!APPEARANCE_PREVIEW"), "choosing an accent must start an unsaved preview"
    home = press_and_settle(page, '.nav-btn[data-view="production"]', "#/production")
    assert page.evaluate("() => APPEARANCE_PREVIEW === null"), \
        "leaving Settings with no project open must discard the unsaved appearance preview, as route() does"
    assert home["firstRun"], "the rail's home item must return to the welcome screen"
    assert home["activeNav"] == ["production"], f"and light itself, got {home['activeNav']}"
    assert home["topbarView"] == "Welcome", f"the topbar must name what is on screen, got {home['topbarView']!r}"
    assert "Create a project" in home["mainText"], "the welcome screen still offers project creation"
    history = page.evaluate("() => history.length")
    assert history > 1, "the round trip is ordinary navigation, not a replacement that erases history"
    return "home round trip: Settings and back to the welcome screen using the rail alone, with no project and no browser Back"


# ===========================================================================
try:
    for name, server in servers.items():
        wait_for_server(server["base"])

    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        first = servers["first"]["base"]

        # ------------------------------------------------ 1-7. the first run.
        page = open_page(browser, first)
        state = page.evaluate(SHELL)
        assert state["firstRun"], "a server with an empty projects root must open on the welcome screen"
        assert state["topbarProject"] == "CineBraid", f"the topbar names no project, got {state['topbarProject']!r}"
        assert state["topbarView"] == "Welcome", f"and names the surface, got {state['topbarView']!r}"
        findings.append("1. first run. an empty projects root opens on the welcome screen, with the topbar naming it")

        for index, contract in enumerate((
            contract_welcome_mark, contract_navigation, contract_settings, contract_project_scoped_settings,
            contract_unknown_routes, contract_add_chooser,
            contract_utilities, contract_search, contract_home_round_trip), start=2):
            findings.append(f"{index}. " + contract(page))

        # ------------------------------------------------ geometry and the console.
        # The welcome mark and the unavailable search are re-read at each width, because
        # both are where a narrow header or a stacked card could quietly change them.
        for width, height in ((1440, 900), (390, 844)):
            page.set_viewport_size({"width": width, "height": height})
            go(page, "#/production")
            wide = page.evaluate(SHELL)
            assert not wide["horizontalOverflow"], f"the welcome shell overflows horizontally at {width}px"
            contract_welcome_mark(page)
            assert wide["searchUnavailable"] and wide["searchPlaceholder"] == "Open a project to search canon", \
                f"the search must stay unavailable, with its reason, at {width}px"
            if width <= 1180:
                # The narrow header folds the search into an icon with an INVISIBLE input over it.
                # The application's disabled opacity must not make that overlay visible.
                assert wide["searchInputOpacity"] == 0, \
                    f"the folded search's hidden input became visible ({wide['searchInputOpacity']}) at {width}px"
            page.focus("#global-search")
            page.wait_for_function("() => document.getAnimations().every((a) => a.playState !== 'running')", timeout=5000)
            focused = page.evaluate(SHELL)
            assert not focused["horizontalOverflow"], f"the focused (expanded) search overflows horizontally at {width}px"
            assert focused["searchOpacity"] == focused["rescanOpacity"] and focused["searchOpacity"] > 0.5, \
                f"the focused search must read as the application's other unavailable controls do, legibly " \
                f"({focused['searchOpacity']} vs {focused['rescanOpacity']}) at {width}px"
            if width <= 1180:
                assert focused["searchBoxOpacity"] == 1, \
                    f"the expanded search is an overlay across the header and must stay opaque, or the controls " \
                    f"beneath show through its text (box opacity {focused['searchBoxOpacity']}) at {width}px"
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
            go(page, "#/settings")
            assert not page.evaluate(SHELL)["horizontalOverflow"], f"Settings overflows horizontally at {width}px"
        page.set_viewport_size({"width": 1440, "height": 900})
        findings.append(f"{index + 1}. geometry. no horizontal overflow on the welcome screen, the focused search or "
                        "Settings at 1440x900 or 390x844; the mark keeps its box and the search its reason at both")

        page.close()

        # ------------------------------------------------ 10. a project opens.
        # On its own empty install, because it is the one step that leaves a project
        # behind and the negative controls below need the first one still empty.
        creating = open_page(browser, servers["create"]["base"])
        findings.append(f"{index + 2}. " + contract_project_opens(creating))
        creating.close()

        # ------------------------------------------------ 11. an ordinary window.
        opened = open_page(browser, servers["open"]["base"])
        findings.append(f"{index + 3}. " + contract_ordinary_window(opened))
        opened.close()

        # ------------------------------------------------ 12. a project still opening.
        opening = open_page(browser, servers["open"]["base"], hold_project=True)
        findings.append(f"{index + 4}. " + contract_opening_is_not_first_run(opening))
        opening.close()

        # ------------------------------------------------ the negative controls.
        CONTROLS = [
            ("N1 the no-project navigation guard is removed", "first", contract_navigation, {
                "**/app.js*": lambda: mutate(
                    "public/app.js",
                    "    applyShellControlAvailability(button, answer.available, answer.reason, \"nav-availability-note\");",
                    "    applyShellControlAvailability(button, true, answer.reason, \"nav-availability-note\");",
                    "N1"),
            }),
            ("N2 Settings falls through to the welcome card", "first", contract_settings, {
                "**/shared-shell-availability.js*": lambda: mutate(
                    "public/shared-shell-availability.js",
                    '      return { kind: "settings", view: key, navView: "settings", label: SHELL_VIEW_LABELS.settings, reason: "" };',
                    '      return { kind: "home", view: key, navView: SHELL_HOME_VIEW, label: SHELL_HOME_LABEL, reason: "" };',
                    "N2"),
            }),
            ("N3 the unknown-route fallback to Production is restored", "open", contract_unknown_routes, {
                "**/app.js*": lambda: mutate(
                    "public/app.js",
                    "    const fn = routeKnown ? ROUTES[view] : null;",
                    "    const fn = ROUTES[view] || ROUTES.production;",
                    "N3"),
            }),
            ("N4 the inert New project action is restored", "first", contract_add_chooser, {
                "**/app.js*": lambda: mutate(
                    "public/app.js",
                    "    if (shellInFirstRun()) return newProject();\n",
                    "",
                    "N4"),
            }),
            ("N5 first run is read from a null record, so a project still opening is refused", "open",
             contract_opening_is_not_first_run, {
                "**/app.js*": lambda: mutate(
                    "public/app.js",
                    "  return !P && !PROJECT_QUARANTINE && SHELL_FIRST_RUN_EPOCH === PROJECT_OPEN_EPOCH;",
                    "  return !P;",
                    "N5"),
            }, {"hold_project": True}),
            ("N6 the topbar search is left enabled and inert with no project", "first", contract_search, {
                "**/app.js*": lambda: mutate(
                    "public/app.js",
                    "    applyShellControlAvailability(search, answer.available, answer.reason, \"search-availability-note\");\n"
                    "    applySearchAvailability(search, answer);\n",
                    "",
                    "N6"),
            }),
            ("N7 runSearch() posts with no project again — the request that takes the server down", "first",
             contract_search, {
                "**/review.js*": lambda: mutate(
                    "public/review.js",
                    "  if (typeof P === \"undefined\" || !P) return;\n",
                    "",
                    "N7"),
            }),
        ]

        for entry in CONTROLS:
            label, server_name, contract, patches = entry[:4]
            open_options = entry[4] if len(entry) > 4 else {}
            routes = {glob: build() for glob, build in patches.items()}
            broken, caught = None, None
            try:
                broken = open_page(browser, servers[server_name]["base"], routes=routes, record=False, **open_options)
                contract(broken)
            except AssertionError as error:
                caught = str(error).split("\n")[0][:170]
            except Exception as error:                      # noqa: BLE001 — a timeout here is a FAILED control
                raise AssertionError(
                    f"{label}: the contract did not fail at its own assertion — it raised "
                    f"{type(error).__name__}, which is a generic failure and proves nothing: {error}") from error
            finally:
                if broken: broken.close()
            assert caught, f"{label}: the contract PASSED against the reconstructed defect, so it proves nothing"
            findings.append(f"NC. {label}\n        caught by: {caught}")

        # The controls patched nothing on disk. Proven rather than asserted in prose.
        for relative in ("public/app.js", "public/shared-shell-availability.js"):
            assert "applyShellControlAvailability(button, true," not in (ROOT / relative).read_text(encoding="utf-8"), \
                f"{relative} was mutated on disk — the controls must hold their copies in memory"

        clean = open_page(browser, first)
        assert clean.evaluate(SHELL)["unavailableNav"] == ["shots", "library", "results", "bible", "reports"], \
            "the unpatched page must behave normally after the controls, or one of them leaked"
        clean.close()
        findings.append("NC. every control held its mutation in memory; the shipped tree is untouched and still passes")

        browser.close()
finally:
    for server in servers.values():
        server["process"].terminate()
        try: server["process"].wait(timeout=10)
        except Exception: server["process"].kill()
    # The sandbox is this run's own temporary directory and nothing else. The servers are
    # stopped first, because Windows will not delete a folder a live process holds open.
    shutil.rmtree(sandbox, ignore_errors=True)

assert not page_errors, f"the page raised uncaught errors: {page_errors}"
# ONE console line is expected, and it is accounted for exactly rather than filtered by
# keyword: on the EMPTY install, GET /api/project answers 404 — that is how this server
# says there is no project, and the welcome screen is rendered from it. Chromium logs the
# 404 as a resource error. It is the server's protocol, not a script error, and it is
# present on the pristine build. Anything else, or the same line on the window that HAS
# a project from the start, fails the run.
empty_installs = (servers["first"]["base"], servers["create"]["base"])
expected = [e for e in console_errors
            if e[2] in empty_installs and e[1].endswith("/api/project")
            and e[0].startswith("Failed to load resource") and "404" in e[0]]
unexpected = [e for e in console_errors if e not in expected]
assert not unexpected, f"console errors: {unexpected}"
assert not offsite, f"requests left the machine: {sorted(set(offsite))}"
assert not paid_calls, f"a paid route was called: {sorted(set(paid_calls))}"

print("\n".join("  " + line for line in findings))
print(f"  console: {len(expected)} expected /api/project 404 on the empty install, 0 other errors, 0 uncaught exceptions")
print(f"  project data isolated in a temporary sandbox (removed): data/ and the shipped sample untouched")
print("  no offsite request and no paid route: 0 attempted, 0 reached")
print("no-project shell truth real-browser audit passed")
