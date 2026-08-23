#!/usr/bin/env python3
"""F-3 and F-4 read off a real Chromium, against a real CineBraid server.

WHY A BROWSER IS NEEDED AT ALL. tests/post-authority-save-truth.js proves the
branching in Node against the real public/app.js: which surface each typed code
reaches, that nothing goes on the wire without a revision, and that no refusal
retries. Three claims cannot be proven there, and they are the three a filmmaker
would actually experience:

  * WHAT THE DIALOG SAYS, as rendered text in a real document rather than as an
    innerHTML string in a fake element - including that the words "authority",
    "approval" and "REBASE" are absent from a validation failure.
  * THAT THE REAL SERVER AGREES. The stale-revision path here is a genuine 409
    produced by the Authority Write Seam because another writer really moved the
    document, not a status the test chose.
  * THAT NOTHING REACHED DISK. Every refusal claim is checked against the actual
    project.json the server owns.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in
a temporary directory reached through CINEBRAID_CONFIG_PATH and
CINEBRAID_PROJECTS_ROOT, so data/ and the shipped sample are never touched; the
route guard aborts the paid route and anything off-loopback.

THE TWO INJECTED REFUSALS ARE INJECTED, and say so. A 422 CANON_TRANSITION_REQUIRED
and a 422 PROJECT_VALIDATION_FAILED are fulfilled by the route guard, one at a
time, because the point of F-3 is which typed code the browser is answering -
not which server condition produced it. Every OTHER refusal in this suite is real.
"""

import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Post-authority save truth real-browser audit"
sync_playwright = require_browser(LABEL)

SLUG = "dogfood-sample"
PAID_ROUTE = "/api/generation/fal/jobs"

page_errors, offsite, paid_calls = [], [], []
findings = []

CANON_REFUSAL = {
    "ok": False,
    "code": "CANON_TRANSITION_REQUIRED",
    "error": "This ordinary save would change production authority. Use the explicit Canon transition protocol.",
    "targets": [{"targetKey": "shot-frame:SAMPLE-01#fr-a", "value": "A.png", "assetId": ""}],
}
VALIDATION_REFUSAL = {
    "ok": False,
    "code": "PROJECT_VALIDATION_FAILED",
    "error": "Project validation failed.",
    "issues": ["shots[0].dur must be a positive number"],
}


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-save-truth-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_file = projects_root / SLUG / "project.json"

config = json.loads(config_path.read_text(encoding="utf-8"))
config["activeProject"] = SLUG
config["assistant"] = {"provider": "none", "visionProvider": "none"}
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "OPENAI_API_KEY": "", "GOOGLE_API_KEY": "", "ANTHROPIC_API_KEY": ""},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def disk_project():
    return json.loads(project_file.read_text(encoding="utf-8"))


def disk_probe():
    return disk_project().get("meta", {}).get("saveTruthProbe", "")


def http(base, pathname, method="GET", body=None, headers=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(f"{base}{pathname}", data=data, method=method,
                                     headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read().decode("utf-8") or "{}"), dict(response.headers)
    except urllib.error.HTTPError as error:  # noqa: PERF203 - the refusal body is the point
        return error.code, json.loads(error.read().decode("utf-8") or "{}"), dict(error.headers)


try:
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), .25):
                break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError("CineBraid server did not start")

    base = f"http://127.0.0.1:{port}"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        context = browser.new_context(viewport={"width": 1600, "height": 1000})

        # Every project write the browser makes, as it goes past. `ifMatch` is
        # recorded as sent - None when the header was absent - because F-4 is
        # precisely about which of those two a revisionless view produces.
        writes = []
        inject = {"next": None}

        def guard(route):
            request = route.request
            url = request.url
            if PAID_ROUTE in url and request.method == "POST":
                paid_calls.append(f"{request.method} {url}")
                return route.abort("failed")
            if url.startswith(base):
                project_write = request.method in ("PUT", "POST") and (
                    url.endswith(f"/projects/{SLUG}/project") or url.endswith(f"/projects/{SLUG}/canon-transition"))
                if project_write:
                    writes.append({"method": request.method, "url": url,
                                   "ifMatch": request.headers.get("if-match")})
                    pending = inject["next"]
                    if pending is not None:
                        inject["next"] = None
                        return route.fulfill(status=pending["status"], content_type="application/json",
                                             body=json.dumps(pending["body"]))
                return route.continue_()
            if url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if url.startswith("https://fonts."):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{request.method} {url}")
            return route.abort("failed")

        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        def open_app():
            page.goto(f"{base}/?save_truth={time.time_ns()}#/production", wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=20000)
            page.wait_for_function(
                "() => typeof P !== 'undefined' && !!P && typeof ACTIVE_PROJECT_SLUG !== 'undefined' && !!ACTIVE_PROJECT_SLUG",
                timeout=20000)
            page.wait_for_timeout(200)
            # Drain anything load() left pending, so every count below starts from
            # a settled view rather than from a debounce that has not fired yet.
            page.evaluate("async () => { await flushPendingProjectSave(); await SAVE_CHAIN; }")
            page.wait_for_timeout(150)

        def edit_and_flush(marker):
            page.evaluate("(value) => { P.meta.saveTruthProbe = value; dirty(); }", marker)
            page.evaluate("async () => { await flushPendingProjectSave(); await SAVE_CHAIN; }")
            page.wait_for_timeout(200)

        def state():
            return page.evaluate("""() => {
              const modal = document.getElementById('modal');
              const shown = modal && !modal.classList.contains('hidden');
              return {
                modal: shown ? modal.innerText : '',
                modalHtml: shown ? modal.innerHTML : '',
                saveState: (document.getElementById('save-state') || {}).innerText || '',
                conflict: PROJECT_CONFLICT,
                authorityRefused: AUTHORITY_SAVE_REFUSED,
                blocked: SAVE_BLOCKED,
                probe: P.meta.saveTruthProbe || '',
              };
            }""")

        open_app()
        assert not page_errors, f"the workspace raised uncaught errors: {page_errors}"

        # ---- 6. an ordinary save is exactly the act it always was -----------------------
        before = len(writes)
        edit_and_flush("ordinary-save")
        ordinary = state()
        made = writes[before:]
        assert len(made) == 1, f"6. one edit must make one project write, got {made}"
        assert made[0]["ifMatch"], "6. an ordinary save must still identify the revision it read"
        assert made[0]["ifMatch"] != "*", "6. and it is an exact revision, never the wildcard"
        assert disk_probe() == "ordinary-save", f"6. the save must have reached disk, disk holds {disk_probe()!r}"
        assert ordinary["modal"] == "", "6. a successful save shows the filmmaker nothing"
        assert (ordinary["conflict"], ordinary["authorityRefused"], ordinary["blocked"]) == (False, False, False), \
            f"6. a successful save latches nothing: {ordinary}"
        findings.append("6. an ordinary save sends one write carrying the exact revision, reaches disk, and shows no dialog")

        # ---- 1. a genuine authority refusal keeps the authority surface -----------------
        inject["next"] = {"status": 422, "body": CANON_REFUSAL}
        edit_and_flush("authority-refusal")
        authority = state()
        assert authority["authorityRefused"] is True, f"1. CANON_TRANSITION_REQUIRED must latch the authority refusal: {authority}"
        assert "Production authority was not changed" in authority["modal"], authority["modal"]
        assert "REBASE & RETRY" in authority["modal"], authority["modal"]
        assert "shot-frame:SAMPLE-01#fr-a" in authority["modal"], "1. the protected target is still named"
        assert authority["probe"] == "authority-refusal", "1. the refused edit batch is still in this tab"
        assert disk_probe() == "ordinary-save", f"1. nothing may have reached disk, disk holds {disk_probe()!r}"
        findings.append("1. an injected CANON_TRANSITION_REQUIRED still reaches the authority-refusal dialog and its rebase action")

        open_app()

        # ---- 2 + 3. a validation failure is a validation failure ------------------------
        inject["next"] = {"status": 422, "body": VALIDATION_REFUSAL}
        edit_and_flush("validation-refusal")
        validation = state()
        spoken = f"{validation['modal']}\n{validation['saveState']}"
        assert validation["authorityRefused"] is False, \
            f"2. THE FINDING: a validation failure must not latch the authority refusal: {validation}"
        assert "authority" not in spoken.lower(), \
            f"2. THE FINDING: nothing shown may claim authority was involved:\n{spoken}"
        assert "approval" not in spoken.lower(), f"2. nor that an approval was refused:\n{spoken}"
        assert "rebase" not in spoken.lower() and "rebaseAuthoritySave" not in validation["modalHtml"], \
            f"3. THE FINDING: rebasing resends the same document, so it cannot resolve a validation failure and must not be offered:\n{spoken}"
        assert "changed while this view was open" not in spoken, \
            f"2. and it is not presented as somebody else's edit either:\n{spoken}"
        assert "did not pass validation" in validation["modal"].lower(), f"2. it must say what happened:\n{spoken}"
        assert "shots[0].dur must be a positive number" in validation["modal"], \
            f"2. and repeat the server's own issue, which is the only actionable part:\n{spoken}"
        assert validation["probe"] == "validation-refusal", "2. the unsaved work is still in this tab"
        assert disk_probe() == "ordinary-save", f"2. nothing may have reached disk, disk holds {disk_probe()!r}"
        findings.append("2. an injected PROJECT_VALIDATION_FAILED is reported as validation and never as authority or approval")
        findings.append("3. and is offered no rebase action, because rebasing cannot resolve it")

        # ---- 7. the refusal pauses saving; it does not retry ----------------------------
        before = len(writes)
        edit_and_flush("after-validation-refusal")
        assert len(writes) == before, \
            f"7. a refusal must pause saving, not retry it - {len(writes) - before} further write(s) were sent"
        assert page.evaluate("() => P.meta.saveTruthProbe") == "after-validation-refusal", \
            "7. and the filmmaker's later edit is still in this tab"
        assert disk_probe() == "ordinary-save", "7. and still nothing durable was written"
        findings.append("7. after the refusal an edit plus an explicit flush sends nothing further and writes nothing durable")

        open_app()

        # ---- 4. no revision means no request, and never a wildcard ----------------------
        before = len(writes)
        page.evaluate("() => { PROJECT_REVISION = ''; }")
        edit_and_flush("revisionless")
        missing = state()
        assert len(writes) == before, \
            f"4. THE FINDING: a view with no revision must put NOTHING on the wire, it sent {writes[before:]}"
        assert missing["conflict"] is False, \
            f"4. THE FINDING: this is a local save precondition, not a manufactured project conflict: {missing}"
        assert missing["authorityRefused"] is False, "4. and nothing about it is an authority refusal"
        assert missing["blocked"] is True, "4. the view stops saving rather than making a write it cannot make safe"
        assert "changed while this view was open" not in missing["modal"], \
            f"4. and it must not tell the filmmaker somebody else edited their project:\n{missing['modal']}"
        assert "cannot save safely" in missing["modal"].lower() or "project revision" in missing["modal"].lower(), \
            f"4. it must name the actual problem:\n{missing['modal']}"
        assert disk_probe() == "ordinary-save", "4. and nothing durable was written"
        findings.append("4. a view with no revision sends nothing at all - no request, and therefore never If-Match \"*\"")

        open_app()

        # ---- 5. a GENUINE stale revision still follows the conflict path ----------------
        # Another writer really moves the document, through the same seam, while
        # this view is open. The 409 below is the server's, not the test's.
        status, current, headers = http(base, f"/api/projects/{SLUG}/project")
        assert status == 200, current
        revision = headers.get("X-CineBraid-Project-Revision") or headers.get("ETag")
        assert revision, "the server must report the stored revision"
        current["meta"]["saveTruthProbe"] = "written-by-another-writer"
        status, replied, _ = http(base, f"/api/projects/{SLUG}/project", "PUT", current, {"If-Match": revision})
        assert status == 200, replied
        assert disk_probe() == "written-by-another-writer"

        before = len(writes)
        edit_and_flush("written-by-a-view-that-fell-behind")
        stale = state()
        made = writes[before:]
        assert len(made) == 1, f"5. the stale save is attempted exactly once, got {made}"
        assert made[0]["ifMatch"] and made[0]["ifMatch"] != "*", \
            f"5. it must carry the exact revision this view read, so the server's check fires: {made}"
        assert stale["conflict"] is True, f"5. a genuine 409 still latches the conflict: {stale}"
        assert "changed while this view was open" in stale["modal"], stale["modal"]
        assert "RELOAD PROJECT" in stale["modal"], stale["modal"]
        assert disk_probe() == "written-by-another-writer", \
            f"5. the stale view must not have overwritten the newer document, disk holds {disk_probe()!r}"
        findings.append("5. a real Authority Write Seam 409 still latches the conflict, keeps the reload path, and does not overwrite the newer document")

        # ---- the whole session ----------------------------------------------------------
        wildcards = [row for row in writes if row["ifMatch"] == "*"]
        assert not wildcards, f'If-Match "*" was put on the wire: {wildcards}'
        assert all(row["ifMatch"] for row in writes), f"a project write went out with no revision at all: {writes}"
        findings.append(f"session. {len(writes)} project writes observed, every one carrying an exact revision and none the wildcard")

        assert not page_errors, f"the page raised uncaught errors: {page_errors}"
        browser.close()
finally:
    if server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=10)
        except Exception:  # noqa: BLE001 - teardown must not mask a finding
            server.kill()

assert not offsite, f"requests left the machine: {offsite}"
assert not paid_calls, f"a paid route was called: {paid_calls}"

print("\n".join(findings))
print(f"project data isolated: config {config_path}, projects {projects_root} — data/ untouched")
print("no offsite request and no paid route: 0 blocked, 0 attempted")
print("post-authority save truth real-browser audit passed")
