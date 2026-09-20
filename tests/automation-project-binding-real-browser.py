#!/usr/bin/env python3
"""An automation run stays bound to the project it started in, in a real Chromium.

A Braidy reference run started in project A must never write into project B when the
filmmaker switches to B while the run is still working - even when A and B hold the
same entity, shot and state ids, so an identity mistake cannot pass by accident. This
drives the shipped route (reference workspace, Start Braidy run, START) on the real
server and switches to B at three boundaries:

  provider   while the provider is still rendering (the run is polling its job)
  refresh    while the run's result refresh is reading the project
  claim      after the result refresh, immediately before the candidate claim

For each it proves, in this order:

  1  WRONG PROJECT - B's directory is byte-identical, and B's window shows nothing of A:
     no candidate rows, no A run in its activity list, no notice, no revision or save
     indicator change, and the UI stays on B.
  2  the three returned candidates are in A exactly once (collected by the server's own
     sweep of every project when the provider finished after the switch);
  3  A's run record says truthfully that it stopped because its project was closed;
  4  reopening A shows the candidates and that run state with no recovery step.

NEGATIVE CONTROL. The page is then served public/automation.js with ONLY the binding
removed (the run's project is treated as always open), and the refresh and claim
boundaries must fail on the WRONG PROJECT assertion specifically.

Nothing here is paid: submissions and reviews are fulfilled in the route guard;
collection and ingest use the real server against a synthetic provider on 127.0.0.1,
and the suite fails if any browser request leaves the loopback host. Config and
projects live in a temporary directory (CINEBRAID_CONFIG_PATH/CINEBRAID_PROJECTS_ROOT),
removed at the end.
"""

import base64, hashlib, json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import open_reference_tools, require_browser, launch_chromium
LABEL = "Automation project binding real-browser proof"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")
PIXEL = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
A, B = "dogfood-sample", "dogfood-sample-b"
B_TITLE = "Project B (same ids as A)"
SCENARIOS = [row for row in [("provider", "XB1"), ("refresh", "XB2"), ("claim", "XB3")]
             if row[0] in os.environ.get("BINDING_MODES", "provider,refresh,claim").split(",")]
# Removing only the binding lets the run carry on into whatever is open: at both the
# claim and the refresh boundary it claims A's candidates into B's identically-named
# entity, which B's byte-identity catches.
CONTROLS = [("claim", "XB5", "WRONG PROJECT"), ("refresh", "XB4", "WRONG PROJECT")]
BINDING = "  return !origin || origin === ACTIVE_PROJECT_SLUG;"
BINDING_REMOVED = "  return true;"
CATEGORIES = ("design", "state", "requirements", "context", "usefulness", "cleanliness")
STRONG = {"score": 91, "pass": True, "modelPass": True, "explicitPass": True, "explicitScore": True,
          "autoApprove": True, "contractVersion": "reference-authority-v3", "requiredHardChecks": [],
          "hardChecks": {}, "hardGateFailures": [], "authorityMode": "establish",
          "outcome": "validated-strong", "generationCorrectable": False, "readyToEstablishAuthority": False,
          "blockers": [],
          "stateMatch": {"matchesRequestedState": True, "returned": True, "closerState": "", "note": "Correct state."},
          "categories": {key: {"severity": "pass", "note": "Correct."} for key in CATEGORIES},
          "summary": "Clear, evenly lit.", "recommendation": "approve"}

# The page's side. Top-level function declarations are properties of the page's global
# object, so rebinding them is what the application's own internal calls reach.
FORCING = r"""
(() => {
  const cfg = window.__BIND = { mode: "none", target: "", switched: false, committed: false, log: [], toasts: [], indicators: [] };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = String((input && input.url) || input);
    const method = String((init && init.method) || "GET").toUpperCase();
    const path = url.startsWith(location.origin) ? url.slice(location.origin.length) : url;
    if (cfg.holdNextProjectRead && method === "GET" && /^\/api\/project(\?|$)/.test(path)) {
      cfg.holdNextProjectRead = false;
      const gate = cfg.switchDone;
      const response = await nativeFetch(input, init);
      await gate;
      return response;
    }
    return nativeFetch(input, init);
  };
  const switchTo = () => {
    cfg.switched = true;
    return Promise.resolve(window.switchProject(cfg.target)).then(
      () => { cfg.committed = true; cfg.log.push({ event: "switched", slug: ACTIVE_PROJECT_SLUG }); },
      (error) => { cfg.log.push({ event: "switch-failed", error: String(error) }); });
  };
  cfg.switchTo = switchTo;
  const install = () => {
    if (typeof window.load !== "function" || typeof window.v626WaitFalJob !== "function" || typeof window.toast !== "function") return;
    if (window.load.__bind) return;
    const load = window.load;
    const boundLoad = function (options) {
      const refresh = !!(options && options.intent === "refresh");
      const stack = refresh ? String(new Error().stack || "") : "";
      if (refresh && cfg.mode === "refresh" && !cfg.switched && !stack.includes("applyForeignProjectRevision") && stack.includes("v626RefreshFalJob")) {
        /* The result refresh's own project read is held until the switch has committed. */
        let done; cfg.switchDone = new Promise((resolve) => { done = resolve; });
        cfg.holdNextProjectRead = true;
        const pending = load.apply(this, arguments);
        cfg.log.push({ event: "switch-during-result-refresh" });
        switchTo().then(done);
        return pending;
      }
      return load.apply(this, arguments);
    };
    boundLoad.__bind = true;
    window.load = boundLoad;
    const wait = window.v626WaitFalJob;
    window.v626WaitFalJob = async function () {
      const job = await wait.apply(this, arguments);
      if (cfg.mode === "claim" && !cfg.switched) { cfg.log.push({ event: "switch-before-claim" }); await switchTo(); }
      return job;
    };
    const toast = window.toast;
    window.toast = function (message) { if (cfg.committed) cfg.toasts.push(String(message)); return toast.apply(this, arguments); };
    const setSaveState = window.setSaveState;
    window.setSaveState = function (state, label) { if (cfg.committed) cfg.indicators.push(String(label || "")); return setSaveState.apply(this, arguments); };
  };
  document.addEventListener("DOMContentLoaded", install);
  window.addEventListener("load", install);
})();
"""


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def tree_digest(folder):
    out = {}
    for path in sorted(folder.rglob("*")):
        if path.is_file():
            out[path.relative_to(folder).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def json_changes(before, after, prefix=""):
    """Where two JSON documents differ, as paths - for a failure message a person can act on."""
    if type(before) is not type(after): return [prefix or "/"]
    if isinstance(before, dict):
        return [change for key in sorted(set(before) | set(after))
                for change in json_changes(before.get(key), after.get(key), f"{prefix}/{key}")]
    if isinstance(before, list):
        if len(before) != len(after): return [f"{prefix} (length {len(before)} -> {len(after)})"]
        return [change for index, (x, y) in enumerate(zip(before, after)) for change in json_changes(x, y, f"{prefix}/{index}")]
    return [] if before == after else [prefix]


# ---------------------------------------------------------------- the sandbox

sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-run-binding-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
dir_a, dir_b = projects_root / A, projects_root / B
config = json.loads(config_path.read_text(encoding="utf-8"))
config["generation"] = {"fal": {"enabled": True}}
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
subjects = [row[1] for row in SCENARIOS + CONTROLS]
project = json.loads((dir_a / "project.json").read_text(encoding="utf-8"))
project["characters"] = list(project.get("characters", [])) + [
    {"id": subject, "name": f"Courier {subject}", "status": "IN PROGRESS", "workflowStatus": "IN PROGRESS",
     "block": "Night courier, thirties, yellow rain shell.",
     "creationDescription": "A night courier in a yellow rain shell under a sodium street lamp.",
     "approvedFile": "", "candidateFiles": [],
     "continuityStates": [{"id": "state-default", "name": "Street lamp", "isDefault": True, "notes": "Wet pavement."}]}
    for subject in subjects]
(dir_a / "project.json").write_text(json.dumps(project, indent=2), encoding="utf-8")
(dir_a / "anchors").mkdir(parents=True, exist_ok=True)
# B: a copy of A's whole project folder with another title - every entity, shot and
# state id overlaps A's, and the media its shots reference is really there.
shutil.copytree(dir_a, dir_b)
twin = json.loads(json.dumps(project))
twin["meta"]["title"] = B_TITLE
(dir_b / "project.json").write_text(json.dumps(twin, indent=2), encoding="utf-8")

provider_jobs, provider_calls, held = {}, [], set()
class SyntheticProvider(BaseHTTPRequestHandler):
    def log_message(self, *_args): pass
    def do_GET(self):
        provider_calls.append(self.path)
        kind, key = self.path.strip('/').split('/', 1)
        if kind == 'status' and key in provider_jobs:
            data, mime = json.dumps({'status': 'IN_PROGRESS' if key in held else 'COMPLETED'}).encode(), 'application/json'
        elif kind == 'result' and key in provider_jobs and key not in held:
            data = json.dumps({'images': [{'url': f'{provider_origin}/image/{name}', 'file_name': name}
                                         for name in provider_jobs[key]]}).encode()
            mime = 'application/json'
        elif kind == 'image':
            data, mime = PIXEL, 'image/png'
        else:
            self.send_error(404); return
        self.send_response(200); self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_POST(self):
        provider_calls.append('UNEXPECTED POST ' + self.path)
        self.send_error(405)
provider = ThreadingHTTPServer(('127.0.0.1', 0), SyntheticProvider)
provider_origin = f'http://127.0.0.1:{provider.server_port}'
threading.Thread(target=provider.serve_forever, daemon=True).start()

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "FAL_KEY": "run-binding-browser-qa-placeholder-not-a-credential"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

console_errors, page_errors, offsite, submissions, review_calls = [], [], [], [], []
accepted, reuses, upstream_resets = {}, [], []
mutate_binding = {"on": False, "served": 0}
STUBBED_ADVISOR_ERROR = "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"


def stored(slug, subject):
    doc = json.loads((projects_root / slug / "project.json").read_text(encoding="utf-8"))
    entity = next(row for row in doc["characters"] if row["id"] == subject)
    return [row["stored"] for row in entity.get("candidateFiles", [])]


def ledger_rows(slug):
    target = projects_root / slug / "generation-jobs.json"
    if not target.exists(): return []
    data = json.loads(target.read_text(encoding="utf-8"))
    rows = data.get("jobs", []) if isinstance(data, dict) else data
    return [{key: row.get(key) for key in ("id", "status")} for row in rows]


def stored_run(slug, run_id):
    target = projects_root / slug / "automation-runs.json"
    if not target.exists(): return None
    data = json.loads(target.read_text(encoding="utf-8"))
    runs = data.get("runs", data) if isinstance(data, dict) else data
    return next((row for row in runs if row.get("id") == run_id), None)


def wait_until(predicate, label, timeout=60.0):
    """Polls a condition the page cannot express. It waits on the PAGE's clock, never
    time.sleep: route handlers only run while Playwright's loop is pumped."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value: return value
        page.wait_for_timeout(250)
    raise AssertionError(f"timed out waiting for {label}")


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
        page = browser.new_page(viewport={"width": 1600, "height": 1100})
        page.add_init_script(FORCING)
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        not_found, job_polls, run_writes = [], [], []
        page.on("response", lambda r: run_writes.append(
            f"{r.request.method} {r.url.split('/api/')[-1]} -> {r.status}") if "/api/automation/runs/" in r.url else None)
        page.on("response", lambda r: job_polls.append(r.url) if r.request.method == "POST" and "/refresh" in r.url else None)
        page.on("response", lambda r: not_found.append(f"{r.request.method} {r.url.split('://', 1)[-1].partition('/')[2]}") if r.status == 404 else None)

        def json_body(route):
            try: return json.loads(route.request.post_data or "{}")
            except Exception: return {}

        def guard(route):
            """Providers are fulfilled here. Nothing leaves this machine."""
            request, url = route.request, route.request.url
            path = url.split("?")[0]
            if path.endswith("/automation.js") and mutate_binding["on"]:
                source = route.fetch().text()
                assert source.count(BINDING) == 1, "negative control anchor is missing or not unique; update the control"
                mutate_binding["served"] += 1
                return route.fulfill(status=200, content_type="application/javascript",
                                     body=source.replace(BINDING, BINDING_REMOVED))
            if path.endswith(PAID_ROUTE) and request.method == "POST":
                body = json_body(route)
                subject = str(body.get("entityId") or "")
                files = [f"{subject}-{slot}.png" for slot in "ABC"]
                job_id = f"job-{subject}"
                # THE PAID BOUNDARY'S OWN IDEMPOTENCY, modelled: a request that names a
                # run and step already accepted is REUSED, never bought again. Without
                # this the fixture would report a second purchase where the shipped
                # server answers `reused` (src/generation/fal/fal-generation.js).
                durable = (str(body.get("automationRunId") or ""), str(body.get("automationStepKey") or ""))
                if durable in accepted:
                    reuses.append(durable)
                    return route.fulfill(status=200, content_type="application/json",
                                         body=json.dumps({"ok": True, "reused": True, "job": accepted[durable]}))
                submissions.append(subject)
                provider_jobs[job_id] = files
                if current["mode"] == "provider": held.add(job_id)
                job = {**body, "id": job_id, "externalId": job_id, "provider": "fal",
                       "status": "IN_QUEUE", "purpose": "entity-reference", "model": "GPT Image 2",
                       "references": [], "outputs": [], "projectSlug": A,
                       "statusUrl": f"{provider_origin}/status/{job_id}",
                       "responseUrl": f"{provider_origin}/result/{job_id}"}
                subprocess.run(["node", "-e", "const fs=require('fs'),s=require('./src/generation/generation-job-store');"
                                "const x=JSON.parse(fs.readFileSync(0,'utf8'));"
                                "s.writeJobLedgerSync(x.dir,[...s.readJobLedger(x.dir).jobs,x.job]);"],
                               input=json.dumps({"dir": str(dir_a), "job": job}), text=True,
                               cwd=ROOT, check=True, capture_output=True)
                accepted[durable] = job
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "job": job}))
            if "/api/llm/review-entity-candidate" in url and request.method == "POST":
                review_calls.append(str(json_body(route).get("fileName") or ""))
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "review": STRONG, "inputLabels": [{"image": 1, "fileName": json_body(route).get("fileName"), "role": "candidate under review"}]}))
            if "/api/prompt/asset-compile" in url and request.method == "POST" and json_body(route).get("useLLM"):
                return route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": "local prompt advisor unavailable"}))
            if "/api/agents/status" in url:
                try:
                    payload = route.fetch().json()
                except Exception as error:  # noqa: BLE001 - fixture plumbing, not the page
                    upstream_resets.append(f"{url}: {error}")
                    return route.continue_()
                ready = {"standing": "ready", "ready": True, "label": "ready", "provider": "stub", "model": "browser-qa", "message": "Configured.", "action": ""}
                payload["enabled"] = True
                payload["capabilities"] = {**payload.get("capabilities", {}), "text": ready, "vision": ready, "verifier": ready, "continuity": ready}
                return route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)
        current = {"mode": "none"}

        def open_project(slug):
            if page.evaluate("() => typeof ACTIVE_PROJECT_SLUG !== 'undefined' ? ACTIVE_PROJECT_SLUG : ''") != slug:
                page.evaluate("slug => switchProject(slug)", slug)
            page.wait_for_function("slug => ACTIVE_PROJECT_SLUG === slug && P && document.body.dataset.renderReady === '1'", arg=slug, timeout=30000)

        def open_reference_workspace(subject):
            page.goto(f"{base}/#/character/{subject}", wait_until="domcontentloaded")
            page.wait_for_selector('[data-reference-desk]', timeout=30000)
            open_reference_tools(page)
            page.wait_for_selector(".focused-task-button", timeout=20000)
            page.locator(".focused-task-button", has_text="Primary reference").first.click()
            page.wait_for_function("() => { document.querySelectorAll('#main details').forEach(node => { node.open = true; });"
                                   " return [...document.querySelectorAll('button')].some(row => row.textContent.trim() === 'Start Braidy run'"
                                   " && row.offsetParent !== null); }", timeout=20000)
            assert page.evaluate("() => window.load && window.load.__bind === true"), "the forcing init script did not install"

        # Warm-up: open B once, so anything a first open writes is not attributed to a run.
        page.goto(f"{base}/#/production", wait_until="domcontentloaded")
        page.wait_for_function("() => document.body.dataset.renderReady === '1'", timeout=30000)
        open_project(B)
        # B's own media-identity activation runs when B becomes active and stops if the
        # project changes mid-pass; let it finish now, so a later open of B has nothing
        # of its own left to write and every byte that changes is somebody else's.
        # Done means every asset in B's ledger is hashed (or unavailable) and the file is
        # steady; a GET /api/scan is the product's own nudge for the next pass.
        ledger_b, last, steady_since = dir_b / "media-assets.json", None, time.monotonic()
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            raw_ledger = ledger_b.read_bytes() if ledger_b.exists() else b""
            current_digest = hashlib.sha256(raw_ledger).hexdigest() if raw_ledger else None
            pending = sum(1 for asset in (json.loads(raw_ledger).get("assets", []) if raw_ledger else [])
                          if asset.get("hashState") == "unhashed")
            if current_digest != last: last, steady_since = current_digest, time.monotonic()
            elif current_digest and not pending and time.monotonic() - steady_since > 5: break
            page.evaluate("() => fetch('/api/scan').then(() => null)")
            page.wait_for_timeout(1000)
        else:
            raise AssertionError("B's own media-identity activation never finished during warm-up")
        open_project(A)

        def scenario(mode, subject):
            label = f"{mode}/{subject}"
            current["mode"] = mode
            open_project(A)
            open_reference_workspace(subject)
            page.evaluate("([mode, target]) => { Object.assign(window.__BIND, { mode, target, switched: false, committed: false, log: [], toasts: [], indicators: [] }); }", [mode, B])
            b_before = tree_digest(dir_b)
            b_json_before = {path.name: json.loads(path.read_text(encoding="utf-8")) for path in dir_b.glob("*.json")}
            page.get_by_role("button", name="Start Braidy run", exact=True).first.click()
            page.wait_for_selector(".automation-plan-modal", timeout=15000)
            page.get_by_role("button", name="START", exact=True).first.click()
            run_id = page.wait_for_function(
                "id => ((typeof AUTOMATION_RUNS !== 'undefined' ? AUTOMATION_RUNS : []).find(run => run.targetId === `characters:${id}`) || {}).id",
                arg=subject, timeout=20000).json_value()
            if mode == "provider":
                job_id = f"job-{subject}"
                # The RUN's own poll, not the server sweep's: it means the accepted job id
                # is recorded, so a resume has something to re-attach to.
                polls = len(job_polls)
                wait_until(lambda: len(job_polls) > polls, f"{label}: the run polling its own provider job", 30)
                page.evaluate("() => window.__BIND.switchTo()")
                held.discard(job_id)
            page.wait_for_function("() => window.__BIND.committed === true", timeout=60000)
            # The runner has stopped when it no longer holds the run, and anything it wrote is on disk.
            page.wait_for_function("id => !V626_ACTIVE_AUTOMATION_RUNS.has(id)", arg=run_id, timeout=60000)
            page.wait_for_function("() => !projectHasUnsavedEdits()", timeout=15000)
            page.evaluate("() => SAVE_CHAIN.catch(() => null)")

            # 1. WRONG PROJECT
            b_after = tree_digest(dir_b)
            changed = sorted(name for name in set(b_before) | set(b_after) if b_before.get(name) != b_after.get(name))
            detail = {name: json_changes(b_json_before.get(name), json.loads((dir_b / name).read_text(encoding="utf-8")))[:12]
                      for name in changed if name.endswith(".json") and name in b_json_before and (dir_b / name).exists()}
            assert not changed, f"WRONG PROJECT ({label}): project B's files changed while a run of A settled: {changed} {detail}"
            state = page.evaluate("""([subject, runId]) => ({
                slug: ACTIVE_PROJECT_SLUG, title: P && P.meta.title,
                rows: ((P.characters.find(row => row.id === subject) || {}).candidateFiles || []).length,
                listed: (AUTOMATION_RUNS || []).some(run => run.id === runId),
                revision: PROJECT_REVISION, indicator: document.getElementById('save-state').textContent,
                toasts: window.__BIND.toasts.slice(), indicators: window.__BIND.indicators.slice(), log: window.__BIND.log.slice() })""",
                [subject, run_id])
            b_revision = page.evaluate("slug => fetch(`/api/projects/${slug}/revision`).then(r => r.json()).then(d => d.revision)", B)
            active = page.evaluate("() => fetch('/api/projects').then(r => r.json()).then(d => d.active)")
            assert state["slug"] == B and active == B and state["title"] == B_TITLE, \
                f"WRONG PROJECT ({label}): the window did not stay on B: {state} server active={active}"
            assert state["rows"] == 0, f"WRONG PROJECT ({label}): A's candidates appeared in B's {subject}: {state}"
            assert not state["listed"], f"WRONG PROJECT ({label}): A's run was listed in B's activity"
            assert not state["toasts"], f"WRONG PROJECT ({label}): A's run raised notices in B: {state['toasts']}"
            assert not any(word in label_ for label_ in state["indicators"] for word in ("refresh required", "Not saved")), \
                f"WRONG PROJECT ({label}): B's save indicator was repainted: {state['indicators']}"
            assert "Saved" in state["indicator"] and state["revision"] == b_revision, \
                f"WRONG PROJECT ({label}): B's indicator or revision moved: {state} server {b_revision}"

            # 2 + 3. A holds the result exactly once, and says truthfully why the run stopped.
            names = wait_until(lambda: (lambda rows: rows if len(rows) == 3 else None)(stored(A, subject)), f"{label}: the candidates in A", 75)
            assert len(set(names)) == 3, f"{label}: A must hold each candidate once: {names}"
            try:
                run = wait_until(lambda: (lambda row: row if row and row.get("status") != "running" else None)(stored_run(A, run_id)), f"{label}: A's run settled", 30)
            except AssertionError:
                raise AssertionError(f"TRUTHFUL RUN STATE ({label}): A's run is still recorded as running after its runner stopped: "
                                     f"{(stored_run(A, run_id) or {}).get('summary')!r}") from None
            assert run["status"] == "interrupted", f"{label}: A's run must be interrupted, not {run['status']}: {run.get('summary')}"
            assert "which was closed while the run was working" in run["summary"] and "Resume Run" in run["summary"], \
                f"{label}: A's run must say why it stopped and what to do: {run['summary']!r}"
            assert stored_run(B, run_id) is None, f"{label}: the run record must exist only in A"

            # 4. Reopen A: everything is already there.
            open_project(A)
            reopened = page.evaluate("""([subject, runId]) => { const e = P.characters.find(row => row.id === subject);
                const run = (AUTOMATION_RUNS || []).find(row => row.id === runId) || {};
                return { rows: (e.candidateFiles || []).map(row => row.stored),
                         available: entityMedia('characters', e).filter(row => row.available).length,
                         status: run.status, summary: run.summary || '' }; }""", [subject, run_id])
            assert sorted(reopened["rows"]) == sorted(names) and reopened["available"] == 3, \
                f"{label}: reopening A must show its three candidates: {reopened}"
            assert reopened["status"] == "interrupted" and "Resume Run" in reopened["summary"], \
                f"{label}: reopening A must show the truthful run state: {reopened}"
            if mode == "provider":
                # And what the run record offers actually continues it, buying nothing again.
                submitted = len(submissions)
                in_page_ledger = page.evaluate("() => (typeof FAL_GENERATION_JOBS !== 'undefined' ? FAL_GENERATION_JOBS : []).map(job => [job.id, job.status])")
                page.evaluate("id => resumeAutomationRun(id)", run_id)
                page.wait_for_function("id => ((AUTOMATION_RUNS || []).find(run => run.id === id) || {}).status === 'awaiting-review'",
                                       arg=run_id, timeout=90000)
                assert len(submissions) == submitted, (
                    f"{label}: Resume Run must not submit a new paid request: {submissions[submitted:]}; "
                    f"steps: {json.dumps({key: {k: step.get(k) for k in ('status', 'childJobId', 'error')} for key, step in (stored_run(A, run_id) or {}).get('steps', {}).items()})}; "
                    f"ledger: {json.dumps(ledger_rows(A)[-3:])}; page ledger before resume: {json.dumps(in_page_ledger)}; "
                    f"at interruption: {json.dumps({key: {k: step.get(k) for k in ('status', 'childJobId')} for key, step in (run.get('steps') or {}).items()})}; "
                    f"run writes: {json.dumps(run_writes[-14:])}")
                assert sorted(stored(A, subject)) == sorted(names), f"{label}: nor change what A holds: {stored(A, subject)}"
            print(f"  {label}: B byte-identical and untouched on screen; A holds 3 candidates once; run interrupted "
                  f"truthfully; A reopens with both. switch log {state['log']}", flush=True)

        for mode, subject in SCENARIOS:
            scenario(mode, subject)

        # ---- negative control: only the binding removed -------------------------
        # The shipped page must have run clean; the controls below are expected to throw.
        assert not page_errors, f"uncaught page errors: {page_errors}"
        product_errors = [line for line in console_errors if line != STUBBED_ADVISOR_ERROR]
        assert not product_errors, f"console errors: {product_errors}; 404s: {not_found}"
        detected = []
        mutate_binding["on"] = True
        # A hash change is a same-document navigation; the mutated script needs a real load.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("() => document.body.dataset.renderReady === '1'", timeout=30000)
        assert page.evaluate("() => /return true;/.test(String(v626RunProjectOpen))"), "the page is not running the mutated binding"
        for mode, subject, expected in CONTROLS:
            try:
                scenario(mode, subject)
            except AssertionError as error:
                message = str(error)
                assert message.startswith(expected), \
                    f"NC {mode}/{subject}: caught, but not by the {expected} assertion: {message[:300]}"
                detected.append(f"{mode}/{subject}: {message[:160]}")
            else:
                raise AssertionError(f"NC {mode}/{subject}: the run wrote nowhere wrong with its project binding removed")
            # B has been written by the control; restore the twin so the next control starts clean.
            (dir_b / "project.json").write_text(json.dumps(twin, indent=2), encoding="utf-8")
        mutate_binding["on"] = False
        assert mutate_binding["served"] >= 1, "the mutated automation.js was never served"
        for line in detected: print(f"  NC detected - {line}", flush=True)

        browser.close()

    assert not offsite, f"browser QA attempted to leave this machine: {offsite}"
    assert not any(call.startswith("UNEXPECTED POST") for call in provider_calls), "collection must not submit provider work"
    assert len(submissions) == len(SCENARIOS) + len(CONTROLS), f"one submission per run: {submissions}"
    for mode, subject in SCENARIOS:
        downloads = [call for call in provider_calls if call.startswith(f"/image/{subject}-")]
        assert len(downloads) == 3, f"{mode}/{subject}: each image must be collected exactly once: {downloads}"
    print(f"Automation project binding real-browser proof passed: {len(SCENARIOS)} Braidy runs switched to a project "
          f"with the same ids at the provider, refresh and claim boundaries left it byte-identical, kept their "
          f"candidates in their own project exactly once, recorded why they stopped, and reopened cleanly; the "
          f"binding-removed control was caught {len(detected)} of {len(CONTROLS)} times, each by the assertion owning its harm. "
          f"Every provider call on 127.0.0.1; nothing paid.")
finally:
    provider.shutdown(); provider.server_close()
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
