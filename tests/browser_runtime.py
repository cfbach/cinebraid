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
"""

import os
import platform
import shutil
import sys

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
