"""Shared real-browser runtime resolution for CineBraid's Playwright suites.

Three separate facts combined to make every real-browser suite contribute zero
coverage while reporting success:

  1. Python Playwright was never installed, and nothing in the repository
     installed it, so `from playwright.sync_api import sync_playwright` always
     raised.

  2. Every suite then probed for a browser with
     `shutil.which("chromium") or shutil.which("chromium-browser") or
      shutil.which("google-chrome")`.
     Those are Linux package names. None of them exists on a stock Windows
     install, where Chrome ships as `chrome.exe` under Program Files and is not
     on PATH. So the project's own Windows CI and the founder's Windows
     workstation would have skipped even after Playwright was installed - the
     second cause was hidden behind the first.

  3. Both misses printed a sentence and exited 0. A skip was therefore
     indistinguishable from a pass to npm, to `tests/run-full-check.js`, and to
     anyone reading a green check.

This module fixes all three in one place so the nine suites stay short:

  * `require_browser(label)` returns `sync_playwright`, or ends the process with
    a message. Under CINEBRAID_BROWSER_REQUIRED it ends with exit 1 and setup
    instructions instead of exit 0, so the browser gate cannot go green on a
    missing runtime.

  * `launch_chromium(pw, ...)` resolves a browser across platforms instead of
    trusting three Linux binary names, and prints a one-line receipt naming the
    Chromium build it actually started. `tests/run-browser-gate.js` requires
    that receipt from every suite, which is what makes "did browser assertions
    really run?" a question with a mechanical answer rather than a hopeful one.

  * `disposable_workspace(label)` gives a suite its own writable projects root
    and config file, outside the repository, seeded from the tracked sample. See
    its own docstring for why a browser suite may no longer inherit whatever
    projects root the application happens to default to.
"""

import atexit
import hashlib
import json
import os
import pathlib
import platform
import shutil
import sys
import tempfile

REQUIRED_ENV = "CINEBRAID_BROWSER_REQUIRED"
EXECUTABLE_ENV = "CINEBRAID_BROWSER_EXECUTABLE"

# Printed by launch_chromium and asserted by tests/run-browser-gate.js. Changing
# this string means changing the gate that reads it.
RECEIPT_PREFIX = "[browser-runtime]"

SETUP_HINT = (
    "Run `npm run setup:browser-tests` to create the project-managed Python "
    "environment and download Chromium, then re-run this check. "
    "See docs/qa/BROWSER_TESTS.md."
)


# ---------------------------------------------------------------------------
# A DISPOSABLE WORKSPACE FOR A REAL-BROWSER SUITE
#
# WHAT WENT WRONG, so the next person does not undo it. These suites used to
# start the server with nothing but a port:
#
#     env = dict(os.environ, PORT=str(port))
#     subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env)
#
# and relied on the application's DEFAULT projects root being `<install>/projects`,
# which meant the server opened the tracked `projects/cinebraid-sample` and the
# interface came up on a real project. Nothing said so; it was inherited.
#
# PROJECT_STORAGE_SEPARATION_V1 moved that default off the install, so on a fresh
# clone the server resolved an empty external folder, `/api/project` answered 404
# and the app rendered its first-run screen. Three suites then failed looking for
# a workspace that was never going to be there, and the failure named a missing
# selector rather than a missing project — which is a long way from the cause.
#
# The dependency was always wrong, and the default change only revealed it. A test
# does not get to inherit where a user's work lives:
#
#   * a suite that follows the default follows it to a REAL production root on a
#     machine that has one configured, which is the founder's workstation;
#   * a suite that writes into the checkout's own `projects/` leaves stray projects
#     for the next run, which is what scripts/qa-sandbox.js exists because of;
#   * and a suite whose fixture arrives by inheritance breaks whenever an unrelated
#     product decision moves the thing it was inheriting.
#
# So a suite states its workspace instead. This hands it one, and it is the only
# way to get one: the root is always a directory THIS function created under the
# system temp area, so no caller can point it at a production root by passing a
# path, because there is no path to pass.
#
# CINEBRAID_TEST_MODE is set as a second line of defence. The server refuses to
# start when a run that declares itself a test resolves a projects root inside the
# application directory, so a future edit that somehow reintroduces the checkout's
# own root fails loudly at startup rather than quietly writing there.
#
# THE SAMPLE IS COPIED, NEVER LINKED, and its runtime artefacts are left behind:
# a per-install asset ledger belongs to the install that minted it, and the tracked
# sample must be byte-identical after the gate. tests/run-browser-gate.js census
# checks exactly that.

# Runtime files CineBraid writes inside a project. The same set
# scripts/qa-sandbox.js and tests/helpers/disposable-root.js leave behind.
RUNTIME_ARTIFACTS = frozenset({
    "backups",
    "generation-jobs.json",
    "agent-index.json",
    "test-feedback.json",
    "embeddings.json",
    "media-assets.json",
})

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
_BUNDLED_SAMPLE = _REPO_ROOT / "projects" / "cinebraid-sample"
SAMPLE_SLUG = "cinebraid-sample"


def _is_runtime_artifact(name):
    return name in RUNTIME_ARTIFACTS or name.lower().endswith(".bak")


class DisposableWorkspace:
    """A writable projects root and config path a suite owns outright."""

    def __init__(self, home):
        self.home = pathlib.Path(home)
        self.projects_root = self.home / "projects"
        self.config_path = self.home / "config.json"

    def env(self, port, **extra):
        """The environment for `subprocess.Popen(["node", "server.js"], ...)`.

        Every provider key is blanked, so a suite that forgets to stub a call
        gets a refusal rather than a real request.
        """
        values = dict(
            os.environ,
            PORT=str(port),
            CINEBRAID_PROJECTS_ROOT=str(self.projects_root),
            CINEBRAID_CONFIG_PATH=str(self.config_path),
            CINEBRAID_TEST_MODE="1",
            FAL_KEY="",
            OPENAI_API_KEY="",
            GOOGLE_API_KEY="",
            ANTHROPIC_API_KEY="",
        )
        values.update({key: str(value) for key, value in extra.items()})
        return values

    def cleanup(self):
        shutil.rmtree(self.home, ignore_errors=True)


def disposable_workspace(label, sample=True, active_project=""):
    """Create one. `label` only names the directory, so a leftover is traceable.

    Cleanup is bounded and deterministic: call `.cleanup()` in the suite's own
    `finally`, and an atexit backstop removes it if the suite dies first.
    """
    slug = "".join(character if character.isalnum() else "-" for character in str(label))[:40]
    home = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-browser-%s-" % slug))

    # Proving it rather than trusting tempfile: a workspace inside the checkout is
    # the failure this exists to prevent, and it is one bad TMPDIR away.
    try:
        home.resolve().relative_to(_REPO_ROOT)
    except ValueError:
        pass
    else:
        shutil.rmtree(home, ignore_errors=True)
        raise RuntimeError(
            "A browser-test workspace may not live inside the repository (%s). "
            "Check TMPDIR/TEMP." % home
        )

    workspace = DisposableWorkspace(home)
    workspace.projects_root.mkdir(parents=True, exist_ok=True)

    if sample:
        shutil.copytree(
            _BUNDLED_SAMPLE,
            workspace.projects_root / SAMPLE_SLUG,
            ignore=lambda directory, names: [name for name in names if _is_runtime_artifact(name)],
        )

    workspace.config_path.write_text(
        json.dumps(
            {
                "assistant": {"provider": "none", "visionProvider": "none"},
                "agents": {"enabled": False},
                "generation": {"fal": {"enabled": False}},
                "workspace": {"projectRoot": "", "mediaRoot": "", "outputRoot": "", "backupRoot": ""},
                "activeProject": active_project,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    atexit.register(workspace.cleanup)
    return workspace


def browser_required():
    """True when a missing browser runtime must fail rather than skip."""
    return os.environ.get(REQUIRED_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def _end(label, reason):
    """Skip quietly, or fail loudly when the caller asked for a real browser.

    The exit code is the whole point. `npm run check` tolerates an absent
    runtime so a first clone still verifies everything portable; the browser and
    release gates set CINEBRAID_BROWSER_REQUIRED and get a hard failure instead
    of a sentence nobody reads.
    """
    if browser_required():
        print(f"{label} FAILED: {reason} {SETUP_HINT}", file=sys.stderr)
        raise SystemExit(1)
    print(f"{label} skipped: {reason}")
    raise SystemExit(0)


def require_browser(label):
    """Return sync_playwright, or end the process with a skip / setup failure."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        _end(label, "Python Playwright is not installed.")
    return sync_playwright


def _windows_chrome_paths():
    program_files = [
        os.environ.get("PROGRAMFILES", r"C:\Program Files"),
        os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
        os.environ.get("LOCALAPPDATA", ""),
    ]
    relative = [
        r"Google\Chrome\Application\chrome.exe",
        r"Google\Chrome Beta\Application\chrome.exe",
        r"Chromium\Application\chrome.exe",
        r"Microsoft\Edge\Application\msedge.exe",
    ]
    return [os.path.join(root, tail) for root in program_files if root for tail in relative]


def _darwin_chrome_paths():
    return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]


def _path_lookups():
    """The original Linux names, kept - they were right for Linux, just not alone."""
    names = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"]
    return [found for found in (shutil.which(name) for name in names) if found]


def _candidate_executables():
    system = platform.system()
    if system == "Windows":
        candidates = _windows_chrome_paths()
    elif system == "Darwin":
        candidates = _darwin_chrome_paths()
    else:
        candidates = []
    candidates.extend(_path_lookups())
    seen = set()
    ordered = []
    for candidate in candidates:
        if candidate and candidate not in seen and os.path.exists(candidate):
            seen.add(candidate)
            ordered.append(candidate)
    return ordered


def _launch_attempts():
    """Ordered (source, launch-kwargs) pairs, most reproducible first.

    Playwright's own Chromium comes first deliberately: it is pinned to the
    installed Playwright version, so a layout assertion means the same thing on
    the founder's workstation as it does in CI. A system Chrome that updates
    itself underneath the suite is the fallback, not the default.
    """
    override = os.environ.get(EXECUTABLE_ENV, "").strip()
    if override:
        return [(f"{EXECUTABLE_ENV} override", {"executable_path": override})]
    attempts = [("bundled playwright chromium", {})]
    attempts.append(("system chrome channel", {"channel": "chrome"}))
    attempts.extend((f"installed browser at {path}", {"executable_path": path})
                    for path in _candidate_executables())
    return attempts


def launch_chromium(pw, label="", headless=True, args=None, **extra):
    """Launch Chromium however this machine can, and say which build started.

    Raises the last failure when nothing launches. Callers that want a skip
    rather than a traceback should have gone through `require_browser` first and
    can wrap this in `browser_unavailable`.
    """
    launch_args = list(args) if args is not None else ["--no-sandbox", "--disable-dev-shm-usage"]
    failures = []
    for source, kwargs in _launch_attempts():
        try:
            browser = pw.chromium.launch(headless=headless, args=launch_args, **kwargs, **extra)
        except Exception as error:  # noqa: BLE001 - the next candidate is the recovery
            failures.append(f"{source}: {type(error).__name__}: {str(error).splitlines()[0][:160]}")
            continue
        name = label or os.path.basename(sys.argv[0]) or "browser suite"
        print(f"{RECEIPT_PREFIX} {name}: launched Chromium {browser.version} ({source})", flush=True)
        return browser
    detail = "; ".join(failures) if failures else "no Chromium candidate was found"
    raise RuntimeError(f"no usable Chromium could be launched. Tried - {detail}. {SETUP_HINT}")


def browser_unavailable(label, error):
    """Turn a launch failure into the same skip/fail decision as a missing import."""
    _end(label, f"no usable Chromium was available ({error}).")


# WHY A SAME-ORIGIN SERVER'S HEADERS NEED EXPOSING HERE.
#
# These suites build the page with page.set_content() plus a <base href>, so the
# document's origin is opaque and every /api call is a cross-origin fetch. In
# production CineBraid is same-origin and the client simply reads ETag off the
# response; cross-origin, only the CORS-safelisted headers reach JS, so ETag and
# X-CineBraid-Project-Revision are invisible no matter what the stub sends and
# PROJECT_REVISION stays empty. Exposing them restores what a same-origin read
# already has. It grants the page nothing the real server would not: the values
# are identical, and the seam still checks them.
PROJECT_HEADER_EXPOSURE = {
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "ETag, X-CineBraid-Project-Revision, X-CineBraid-Project-Slug",
}


def project_revision(body):
    """The revision the shipped server publishes for exactly these bytes.

    server.js's projectRevisionFor() is a quoted sha256 of the stored file, used
    as an ETag. Mirrored here so a stubbed project answers the way the real one
    does, including after a fixture mutates it.
    """
    payload = body if isinstance(body, bytes) else str(body).encode("utf-8")
    return '"%s"' % hashlib.sha256(payload).hexdigest()


def project_response(document, slug):
    """Body and headers for a stubbed GET /api/project.

    THE DEFECT THIS EXISTS TO STOP. A stub that answers with the document and a
    slug describes a response the server never sends. server.js publishes the
    stored revision as BOTH `ETag` and `X-CineBraid-Project-Revision`, and
    public/app.js reads one of them into PROJECT_REVISION; without it the view
    cannot name the revision it is showing, so the Authority Write Seam
    correctly refuses the first save and puts up a blocking modal. Every later
    click in the suite is then intercepted by that modal, and the suite reports
    a missing control instead of a fixture that never told the page what it was
    looking at.

    The seam is not weakened and the refusal is not suppressed: this supplies
    the precondition the refusal exists to check, which is what the real server
    supplies too.

    Returns (body, headers) ready for Playwright's route.fulfill().
    """
    body = json.dumps(document)
    revision = project_revision(body)
    return body, dict(PROJECT_HEADER_EXPOSURE, **{
        "content-type": "application/json",
        "x-cinebraid-project-slug": slug,
        "etag": revision,
        "x-cinebraid-project-revision": revision,
    })


def project_save(document, slug, request):
    """Answer a stubbed slug-scoped project save the way the shipped seam does.

    Supplying a revision on the GET is only half of it. Once the page can name
    the document it read, it really does write: public/app.js sends the edit to
    `/api/projects/<slug>/project`, or to `/canon-transition` when the delta
    carries Canon, with the revision echoed in `If-Match`. A stub that answers
    only `/api/project` leaves those to be forwarded to a real server that has
    never heard of this fixture's slug, so a save that should succeed comes back
    as somebody else's 404.

    So this mirrors the seam rather than bypassing it: no If-Match is 428, a
    stale one is 409, and an exact one commits and publishes the NEW revision --
    the same three answers persistProjectSuccessor() gives. Nothing is
    hand-stamped and no refusal is suppressed; a fixture that writes badly still
    gets refused, which is what keeps this a stub of the seam and not a hole in
    it.

    `document` is the suite's own mutable fixture and is updated in place on
    success, so the next GET and the next If-Match describe what the page really
    wrote and a second save is possible.

    Returns (status, body, headers) for Playwright's route.fulfill().
    """
    def answer(status, payload, revision=""):
        headers = dict(PROJECT_HEADER_EXPOSURE, **{"content-type": "application/json"})
        if revision:
            headers["etag"] = revision
            headers["x-cinebraid-project-revision"] = revision
        return status, json.dumps(payload), headers

    current = project_revision(json.dumps(document))
    if_match = str(request.headers.get("if-match") or "").strip()
    if not if_match:
        return answer(428, {
            "error": "This save did not identify the project revision it read.",
            "code": "PROJECT_REVISION_REQUIRED", "revision": current,
        })
    if if_match != current:
        return answer(409, {
            "error": "The project changed while this view was open.",
            "code": "PROJECT_REVISION_CONFLICT", "revision": current,
        })
    try:
        payload = json.loads(request.post_data or "{}")
    except ValueError:
        return answer(422, {"error": "The submitted project could not be read."})
    transition = isinstance(payload, dict) and "successor" in payload and "transition" in payload
    successor = payload["successor"] if transition else payload
    if not isinstance(successor, dict):
        return answer(422, {"error": "The submitted project was not a document."})
    document.clear()
    document.update(successor)
    revision = project_revision(json.dumps(document))
    body = {"ok": True, "slug": slug, "backup": None, "revision": revision}
    if transition:
        body["project"] = successor
    return answer(200, body, revision)


CANON_COMMAND_FOR_KIND = {
    "shot-frame": "approve-shot-frame",
    "shot-motion": "approve-shot-motion",
    "shot-delivery": "approve-shot-delivery",
    "entity-state": "approve-entity-state",
}


def _canon_target_key(entry):
    kind = entry["kind"]
    if kind == "shot-frame":
        return "shot-frame:%s#%s" % (entry["shotId"], entry["frameId"])
    if kind == "shot-motion":
        return "shot-motion:%s#%s" % (entry["shotId"], entry.get("unitKey", ""))
    if kind == "shot-delivery":
        return "shot-delivery:%s" % entry["shotId"]
    return "entity-state:%s:%s#%s" % (entry["list"], entry["entityId"], entry["stateId"])


def canon_receipts(entries, via="browser-fixture"):
    """Build a productionAuthority ledger for a browser fixture.

    A winner or an approvedFile is a POINTER. Canon is a current human receipt
    that matches that pointer, and the shipped readers - guidedFrameApproved,
    entityStateTruth, entityProductionTruth - answer from the ledger, not from
    the pointer. A fixture that only sets pointers is a HISTORIC project: the
    images are shown, nothing is authority, and every readiness gate correctly
    refuses. Suites that need approved work must say so here.

    Each entry: {kind, value, assetId?} plus the target fields for its kind -
    shotId/frameId, shotId/unitKey, shotId, or list/entityId/stateId.
    """
    receipts = []
    for index, entry in enumerate(entries, start=1):
        receipts.append({
            "id": "authority-%06d" % index, "sequence": index, "actor": "human",
            "act": "explicit-approval", "command": CANON_COMMAND_FOR_KIND[entry["kind"]],
            "kind": entry["kind"], "targetKey": _canon_target_key(entry),
            "shotId": entry.get("shotId", ""), "frameId": entry.get("frameId", ""),
            "unitKey": entry.get("unitKey", ""), "list": entry.get("list", ""),
            "entityId": entry.get("entityId", ""), "stateId": entry.get("stateId", ""),
            "slotId": "", "value": entry["value"], "assetId": entry.get("assetId", ""),
            "at": entry.get("at", "2026-08-15T00:00:00.000Z"), "status": "current",
            "supersededBy": "", "supersededAt": "", "revokedAt": "", "revocationReason": "",
            "note": "", "provenance": {"manualAction": "gesture-fixture-%d" % index,
                                       "via": via, "gesture": "click"},
        })
    return {"version": 1, "receipts": receipts}
