#!/usr/bin/env python3
"""The Braidy result refresh and the revision watch, forced to collide in a real Chromium.

PR #79's first browser-CI attempt failed check:reference-loop-browser with "<state>
candidates are unavailable": a finished automation image job re-read the project to
collect its candidates while the revision watch noticed the same durable change and
re-read it too, and the two refused each other. The durable project held the images;
the window never received them.

This drives the shipped route - reference workspace, Start Braidy run, START - and
FORCES the contested timing from a page init script instead of hoping for it:

  result-then-watch  the moment the automation requests its result refresh, the
                     revision watch is run while that refresh is still in flight
  repeated-watch     the same, with several watch observations during the refresh
  watch-then-result  the moment the server has ingested the results, the watch is run
                     and allowed to start its own refresh BEFORE the automation is
                     handed the answer and requests its result refresh

`REFRESH_RACE_DELAYS` adds an in-page delay to every project read (default "0,400"),
so each mode also runs with deliberately slow reads. The ORDER is still decided by the
forcing above, never by the delay. `REFRESH_RACE_ITERATIONS` sets how many runs each
timing gets (default 3); every run uses a fresh reference.

Each run must reach its human gate with its three candidates in the open project,
imported once each, without a 409, with the save indicator truthful, and with every
refresh commit's revision at or after the one before it in the server's own order.
Afterwards a change written straight to the stored project (another writer) must still
reach the window through the ordinary watch interval.

NOTHING HERE IS PAID. Submissions and reviews are fulfilled locally; collection and
ingestion use the real server against a loopback-only synthetic provider. The suite
fails if any browser request leaves the loopback host.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, removed at the end.
"""

import base64, json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import open_reference_tools, require_browser, launch_chromium
LABEL = "Project refresh race real-browser proof"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")
PIXEL = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
MODES = tuple(value.strip() for value in os.environ.get(
    "REFRESH_RACE_MODES", "result-then-watch,repeated-watch,watch-then-result").split(",") if value.strip())
assert MODES and all(mode in ("result-then-watch", "repeated-watch", "watch-then-result") for mode in MODES), MODES
ITERATIONS = max(1, int(os.environ.get("REFRESH_RACE_ITERATIONS", "3")))
DELAYS = [max(0, int(value)) for value in os.environ.get("REFRESH_RACE_DELAYS", "0,400").split(",") if value.strip()]
PLAN = [(delay, MODES[index % len(MODES)]) for delay in DELAYS for index in range(ITERATIONS)]
SUBJECTS = [f"RACE{index + 1:03d}" for index in range(len(PLAN))]

CATEGORIES = ("design", "state", "requirements", "context", "usefulness", "cleanliness")
STRONG = {"score": 91, "pass": True, "modelPass": True, "explicitPass": True, "explicitScore": True,
          "autoApprove": True, "contractVersion": "reference-authority-v3", "requiredHardChecks": [],
          "hardChecks": {}, "hardGateFailures": [], "authorityMode": "establish",
          "outcome": "validated-strong", "generationCorrectable": False, "readyToEstablishAuthority": False,
          "blockers": [],
          "stateMatch": {"matchesRequestedState": True, "returned": True, "closerState": "", "note": "Correct state."},
          "categories": {key: {"severity": "pass", "note": "Correct."} for key in CATEGORIES},
          "summary": "Clear, evenly lit, reference-appropriate framing.", "recommendation": "approve"}

# The page's own side of the forcing. Top-level function declarations are properties
# of the page's global object, so rebinding window.load and window.commitPreparedProject
# is what the application's own internal calls reach.
FORCING = r"""
(() => {
  const config = window.__RACE_CONFIG = { mode: "none", delayMs: 0, onWatchRefresh: null };
  const log = window.__RACE_LOG = [];
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = String((input && input.url) || input);
    const method = String((init && init.method) || "GET").toUpperCase();
    const response = await nativeFetch(input, init);
    const path = url.startsWith(location.origin) ? url.slice(location.origin.length) : url;
    if (config.delayMs && method === "GET" && /^\/api\/project(\?|$)/.test(path))
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    if (config.mode === "watch-then-result" && method === "POST" && /^\/api\/generation\/fal\/jobs\/[^/]+\/refresh$/.test(path)) {
      const body = await response.clone().json().catch(() => ({}));
      if (body && body.job && body.job.status === "COMPLETED") {
        log.push({ event: "forced", what: "watch before the result refresh" });
        const started = new Promise((resolve) => { config.onWatchRefresh = resolve; });
        const watch = Promise.resolve(window.watchProjectRevision()).then((value) => log.push({ event: "watch-settled", value: value ?? null }));
        await Promise.race([started, watch]);
        config.onWatchRefresh = null;
      }
    }
    return response;
  };
  const install = () => {
    if (typeof window.load !== "function" || typeof window.commitPreparedProject !== "function") return false;
    if (window.load.__race) return true;
    const load = window.load;
    const forcedLoad = function (options) {
      const refresh = !!(options && options.intent === "refresh");
      const stack = refresh ? String(new Error().stack || "") : "";
      /* The watch first: when the watch is forced from inside the result's own fetch,
         V8's async stack also names the awaiting v626RefreshFalJob. */
      const origin = !refresh ? "open"
        : stack.includes("applyForeignProjectRevision") ? "watch"
        : stack.includes("v626RefreshFalJob") ? "result" : "other";
      const pending = load.apply(this, arguments);
      log.push({ event: "refresh-requested", origin });
      if (origin === "watch" && config.onWatchRefresh) config.onWatchRefresh();
      if (origin === "result" && (config.mode === "result-then-watch" || config.mode === "repeated-watch")) {
        const ticks = config.mode === "repeated-watch" ? 4 : 1;
        for (let tick = 0; tick < ticks; tick += 1) {
          log.push({ event: "forced", what: "watch while the result refresh is in flight" });
          Promise.resolve(window.watchProjectRevision()).then((value) => log.push({ event: "watch-settled", value: value ?? null }));
        }
        setTimeout(() => {
          log.push({ event: "forced", what: "watch on the next task" });
          Promise.resolve(window.watchProjectRevision()).then((value) => log.push({ event: "watch-settled", value: value ?? null }));
        }, 0);
      }
      Promise.resolve(pending).then((outcome) => log.push({ event: "refresh-answered", origin,
        committed: !!(outcome && outcome.committed), reason: (outcome && outcome.reason) || "" }), () => {});
      return pending;
    };
    forcedLoad.__race = true;
    window.load = forcedLoad;
    const setSaveState = window.setSaveState;
    window.setSaveState = function (state, label) {
      log.push({ event: "indicator", label: String(label || "") });
      return setSaveState.apply(this, arguments);
    };
    const commit = window.commitPreparedProject;
    window.commitPreparedProject = function (prepared, ticket) {
      const installed = commit.apply(this, arguments);
      if (installed !== false) log.push({ event: "commit", intent: ticket && ticket.intent, revision: (prepared && prepared.revision) || "" });
      return installed;
    };
    return true;
  };
  document.addEventListener("DOMContentLoaded", install);
  window.addEventListener("load", install);
})();
"""


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


# ---------------------------------------------------------------- the sandbox

sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-refresh-race-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_dir = projects_root / "dogfood-sample"
config = json.loads(config_path.read_text(encoding="utf-8"))
config["generation"] = {"fal": {"enabled": True}}
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
project_file = project_dir / "project.json"
project = json.loads(project_file.read_text(encoding="utf-8"))
project["characters"] = list(project.get("characters", [])) + [
    {"id": subject, "name": f"Race Subject {subject[-3:]}", "status": "IN PROGRESS", "workflowStatus": "IN PROGRESS",
     "block": "Night courier, thirties, yellow rain shell.",
     "creationDescription": "A night courier in a yellow rain shell, standing under a sodium street lamp.",
     "approvedFile": "", "candidateFiles": [],
     "continuityStates": [{"id": "state-default", "name": "Street lamp", "isDefault": True,
                           "notes": "Yellow rain shell, wet pavement."}]}
    for subject in SUBJECTS]
project_file.write_text(json.dumps(project, indent=2), encoding="utf-8")
(project_dir / "anchors").mkdir(parents=True, exist_ok=True)

provider_jobs, provider_calls = {}, []
class SyntheticProvider(BaseHTTPRequestHandler):
    def log_message(self, *_args): pass
    def do_GET(self):
        provider_calls.append(self.path)
        kind, key = self.path.strip('/').split('/', 1)
        if kind == 'status' and key in provider_jobs:
            data, mime = json.dumps({'status': 'COMPLETED'}).encode(), 'application/json'
        elif kind == 'result' and key in provider_jobs:
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
         "FAL_KEY": "refresh-race-browser-qa-placeholder-not-a-credential"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

console_errors, page_errors, offsite, upstream_resets = [], [], [], []
submissions, review_calls, advisor_stubs = [], [], []
conflicts, server_revisions = [], []
STUBBED_ADVISOR_ERROR = "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"


def stored_candidates(subject):
    current = json.loads(project_file.read_text(encoding='utf-8'))
    entity = next(row for row in current['characters'] if row['id'] == subject)
    return [row['stored'] for row in entity.get('candidateFiles', [])]


def note_response(response):
    """The server's own order of revisions, and every conflict it answered."""
    path = response.url.split('://', 1)[-1].partition('/')[2]
    if path.split('?')[0] == 'api/project' and response.request.method == 'GET':
        revision = response.headers.get('x-cinebraid-project-revision', '')
        if revision and revision not in server_revisions: server_revisions.append(revision)
    if response.status == 409:
        conflicts.append(f"{response.request.method} /{path}")


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
        page.on("response", note_response)

        def json_body(route):
            try: return json.loads(route.request.post_data or "{}")
            except Exception: return {}

        def guard(route):
            """Providers are fulfilled here. Nothing leaves this machine."""
            request, url = route.request, route.request.url
            if url.split("?")[0].endswith(PAID_ROUTE) and request.method == "POST":
                body = json_body(route)
                subject = str(body.get("entityId") or "")
                assert subject in SUBJECTS and not any(row["entity"] == subject for row in submissions), \
                    f"{subject}: only one authorised submission per reference is expected"
                files = [f"{subject}-{slot}.png" for slot in "ABC"]
                job_id = f"job-{subject}"
                submissions.append({"entity": subject, "outputCount": body.get("outputCount")})
                provider_jobs[job_id] = files
                job = {**body, "id": job_id, "externalId": job_id, "provider": "fal",
                       "status": "IN_QUEUE", "purpose": "entity-reference", "model": "GPT Image 2",
                       "references": [], "outputs": [], "projectSlug": "dogfood-sample",
                       "statusUrl": f"{provider_origin}/status/{job_id}",
                       "responseUrl": f"{provider_origin}/result/{job_id}"}
                # Seed only the simulated accepted job through the existing ledger writer.
                # POST .../refresh is NOT intercepted: the real server collects and ingests.
                subprocess.run(["node", "-e", "const fs=require('fs'),s=require('./src/generation/generation-job-store');"
                                "const x=JSON.parse(fs.readFileSync(0,'utf8'));"
                                "s.writeJobLedgerSync(x.dir,[...s.readJobLedger(x.dir).jobs,x.job]);"],
                               input=json.dumps({"dir": str(project_dir), "job": job}), text=True,
                               cwd=ROOT, check=True, capture_output=True)
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "job": job}))
            if "/api/llm/review-entity-candidate" in url and request.method == "POST":
                body = json_body(route)
                review_calls.append(str(body.get("fileName") or ""))
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "review": STRONG, "inputLabels": [{"image": 1, "fileName": body.get("fileName"), "role": "candidate under review"}]}))
            if "/api/prompt/asset-compile" in url and request.method == "POST" and json_body(route).get("useLLM"):
                advisor_stubs.append(url)
                return route.fulfill(status=503, content_type="application/json",
                                     body=json.dumps({"error": "local prompt advisor unavailable"}))
            if "/api/agents/status" in url:
                try:
                    payload = route.fetch().json()
                except Exception as error:  # noqa: BLE001
                    # Reading upstream through the interception can be reset by the local
                    # server after thousands of short-lived connections in one session.
                    # That is this fixture's plumbing, not the page: let the real answer
                    # through unpatched and count it, rather than failing a run for it.
                    upstream_resets.append(f"{url}: {error}")
                    return route.continue_()
                ready = {"standing": "ready", "ready": True, "label": "ready", "provider": "stub", "model": "browser-qa",
                         "message": "Configured.", "action": ""}
                payload["enabled"] = True
                payload["capabilities"] = {**payload.get("capabilities", {}), "text": ready, "vision": ready,
                                           "verifier": ready, "continuity": ready}
                return route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)

        def open_reference_workspace(subject):
            page.goto(f"{base}/#/character/{subject}", wait_until="domcontentloaded")
            page.wait_for_selector('[data-reference-desk]', timeout=20000)
            open_reference_tools(page)
            page.wait_for_selector(".focused-task-button", timeout=20000)
            page.locator(".focused-task-button", has_text="Primary reference").first.click()
            reachable = ("() => { document.querySelectorAll('#main details').forEach(node => { node.open = true; });"
                         " return [...document.querySelectorAll('button')]"
                         ".some(row => row.textContent.trim() === 'Start Braidy run' && row.offsetParent !== null); }")
            page.wait_for_function(reachable, timeout=20000)
            assert page.evaluate("() => window.load && window.load.__race === true"), \
                "the forcing init script did not install; nothing below would be forced"

        def run_state(subject):
            return page.evaluate("id => (typeof AUTOMATION_RUNS !== 'undefined' ? AUTOMATION_RUNS : [])"
                                 ".filter(run => run.targetId === `characters:${id}`).map(run => ({status: run.status,"
                                 " summary: run.summary, steps: Object.values(run.steps || {}).map(step =>"
                                 " `${step.key}:${step.status}${step.error ? ' ' + step.error : ''}`)}))", subject)

        def start_and_reach_gate(subject, label):
            page.get_by_role("button", name="Start Braidy run", exact=True).first.click()
            page.wait_for_selector(".automation-plan-modal", timeout=15000)
            start = page.get_by_role("button", name="START", exact=True).first
            assert not start.is_disabled(), f"{label}: the plan dialog refused to start"
            start.click()
            try:
                page.wait_for_function(
                    "id => (typeof AUTOMATION_RUNS !== 'undefined' ? AUTOMATION_RUNS : []).some(run =>"
                    " run.targetId === `characters:${id}` && ['awaiting-review','failed','needs-attention'].includes(run.status))",
                    arg=subject, timeout=90000)
            except Exception as error:  # noqa: BLE001 - the timeout is the finding; say what the run was doing
                raise AssertionError(f"{label}: the run never settled. runs={json.dumps(run_state(subject))} "
                                     f"race={json.dumps(page.evaluate('() => window.__RACE_LOG'))}") from error
            runs = run_state(subject)
            assert runs and runs[-1]["status"] == "awaiting-review", \
                f"THE RACE ({label}): the run must reach its human gate with its candidates, not fail: {json.dumps(runs)}"
            assert not any("unavailable" in json.dumps(run) for run in runs), \
                f"THE RACE ({label}): the run reported its candidates unavailable: {json.dumps(runs)}"

        results = []
        for index, ((delay, mode), subject) in enumerate(zip(PLAN, SUBJECTS), start=1):
            label = f"run {index}/{len(PLAN)} {mode} delay={delay}ms {subject}"
            open_reference_workspace(subject)
            page.evaluate("([mode, delay]) => { window.__RACE_CONFIG.mode = mode; window.__RACE_CONFIG.delayMs = delay;"
                          " window.__RACE_LOG.length = 0; }", [mode, delay])
            conflicts_before = len(conflicts)
            start_and_reach_gate(subject, label)
            page.wait_for_function("() => document.getElementById('save-state')?.textContent.includes('Saved')", timeout=20000)
            race = page.evaluate("() => window.__RACE_LOG.slice()")
            forced = [row for row in race if row.get("event") == "forced"]
            requested = [row["origin"] for row in race if row.get("event") == "refresh-requested"]
            assert forced, f"{label}: the collision was not forced: {json.dumps(race)}"
            assert "result" in requested, f"{label}: the result refresh was never requested: {json.dumps(race)}"
            if mode == "watch-then-result":
                assert "watch" in requested and requested.index("watch") < requested.index("result"), \
                    f"{label}: the watch's refresh must start before the result refresh: {json.dumps(race)}"
            in_window = page.evaluate("id => ((P.characters.find(row => row.id === id) || {}).candidateFiles || []).map(row => row.stored)", subject)
            delivered = page.evaluate("id => { const e = P.characters.find(row => row.id === id);"
                                      " return entityMedia('characters', e).filter(row => row.available).map(row => row.name); }", subject)
            on_disk = stored_candidates(subject)
            assert len(on_disk) == 3 and len(set(on_disk)) == 3, f"{label}: storage must hold three candidates once each: {on_disk}"
            assert sorted(in_window) == sorted(on_disk), f"{label}: the open project must hold exactly what storage holds: {in_window} vs {on_disk}"
            assert sorted(delivered) == sorted(on_disk), f"{label}: and all three must be available to review: {delivered}"
            assert len(conflicts) == conflicts_before, f"{label}: no write may be refused as stale: {conflicts[conflicts_before:]}"
            behind = [row for row in race if row.get("event") == "indicator" and "refresh required" in row.get("label", "")]
            assert not behind, f"{label}: the window claimed to be behind while its own refresh was on the way: {json.dumps(race)}"
            commits = [row["revision"] for row in race if row.get("event") == "commit"]
            order = [server_revisions.index(revision) for revision in commits if revision in server_revisions]
            assert order == sorted(order), f"{label}: a refresh commit moved the revision backward: {commits}"
            results.append({"run": index, "mode": mode, "delayMs": delay,
                            "resultRefreshAnswers": [row for row in race if row.get("event") == "refresh-answered"],
                            "refreshRequests": requested, "commits": len(commits),
                            "watch": [row.get("value") for row in race if row.get("event") == "watch-settled"]})
            print(f"  {label}: gate reached, 3/3 candidates delivered once, {len(commits)} commit(s), "
                  f"refreshes requested by {requested}", flush=True)

        # ---- background external revisions still refresh normally -------------
        page.evaluate("() => { window.__RACE_CONFIG.mode = 'none'; window.__RACE_CONFIG.delayMs = 0; }")
        current = json.loads(project_file.read_text(encoding="utf-8"))
        current["meta"]["title"] = "Retitled by another writer"
        project_file.write_text(json.dumps(current, indent=2), encoding="utf-8")
        try:
            page.wait_for_function("() => P && P.meta && P.meta.title === 'Retitled by another writer'", timeout=20000)
        except Exception as error:  # noqa: BLE001
            raise AssertionError("an external change never reached the window through the revision watch") from error
        page.wait_for_function("() => document.getElementById('save-state')?.textContent.includes('Saved')", timeout=10000)
        print("  external writer: the watch converged on a change written straight to the stored project", flush=True)

        assert not page_errors, f"the forced runs raised uncaught errors: {page_errors}"
        product_errors = [line for line in console_errors if line != STUBBED_ADVISOR_ERROR]
        assert not product_errors, f"the forced runs logged console errors: {product_errors}"
        browser.close()

    assert not offsite, f"browser QA attempted to leave this machine: {offsite}"
    assert not any(path.startswith('UNEXPECTED POST') for path in provider_calls), 'collection must not submit provider work'
    assert sum(path.startswith('/image/') for path in provider_calls) == 3 * len(PLAN), \
        'canonical ingestion must download every returned image exactly once'
    assert len(submissions) == len(PLAN), f"{len(submissions)} submissions for {len(PLAN)} runs"
    assert len(review_calls) == 3 * len(PLAN), f"{len(review_calls)} reviews for {len(PLAN)} runs"
    if upstream_resets:
        print(f"Fixture note: {len(upstream_resets)} interception read(s) to the local server were reset and passed "
              f"through unpatched: {upstream_resets[:2]}", flush=True)
    print(f"Project refresh race real-browser proof passed: {len(PLAN)} Braidy runs with the result refresh and the "
          f"revision watch forced to collide ({', '.join(MODES)}; project-read delays {DELAYS} ms) each reached "
          f"its human gate with all three candidates in the open project, imported once, no 409 and no backward "
          f"revision; an external write still converged. {len(submissions)} simulated submissions, "
          f"{len(review_calls)} simulated reviews, every provider call on 127.0.0.1, nothing paid.")
    if os.environ.get("REFRESH_RACE_EVIDENCE"):
        pathlib.Path(os.environ["REFRESH_RACE_EVIDENCE"]).write_text(json.dumps(results, indent=1), encoding="utf-8")
finally:
    provider.shutdown(); provider.server_close()
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
