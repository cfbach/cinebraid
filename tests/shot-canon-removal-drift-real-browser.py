#!/usr/bin/env python3
"""Shot Canon removal drift — real-browser / real-save evidence.

Deliberately small. tests/authority-write-seam-real-browser.py already drives a
Canon-holding shot deletion and a Canon-holding scene deletion through the real
confirmation controls and the real save seam (its A-21). What was never proved in
a browser is the case this slice exists for: a CURRENT receipt whose approved
file was renamed after approval, so no kernel command can withdraw it.

Three scenarios, one disposable server, one page:

  R-01  a Canon-holding shot is deleted through the shipped modal. The receipt is
        withdrawn first, the shot is gone from disk, the save is a real write, and
        a reload opens a document with the shot gone and no current receipt.
  R-02  a drifted receipt refuses deletion. The shot stays, the receipt stays
        current, the refusal is on screen with its remediation, and the project
        still saves — including an unrelated edit made in the same session.
  R-03  a scene containing a drifted shot refuses deletion atomically: the
        sibling's perfectly withdrawable receipt is untouched and no shot is
        removed.

Every approval is written by the shipped kernel inside a Playwright TRUSTED click.
Every deletion is a trusted click on the shipped confirmation button. Every
"did it save" answer comes from the file on disk. No provider is contacted and no
off-loopback request is allowed.
"""

import base64
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Shot Canon removal drift real-browser evidence"
sync_playwright = require_browser(LABEL)

SLUG = "dogfood-sample"
PAID_ROUTE = "/api/generation/fal/jobs"

passed = []
page_errors, offsite, paid_calls = [], [], []


def scenario(scenario_id, assertion):
    assertion()
    passed.append(scenario_id)
    print(f"[SCR browser] {scenario_id} PASS", flush=True)


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def shot(shot_id, scene_id, frame_id):
    return {
        "id": shot_id, "scene": scene_id, "title": shot_id,
        "desc": "A controlled browser test.", "positioning": "Locked frame.",
        "dur": 5, "workflowStatus": "DRAFT", "status": "BUILT",
        "characters": [], "codes": [], "risks": [], "candidateFiles": [
            {"stored": "A.png", "mediaType": "image", "frameId": frame_id},
        ],
        "creationBrief": {},
        "keyframes": [{"id": frame_id, "label": "A", "title": "Opening",
                       "description": "Opening frame.", "generationPackages": []}],
        "clips": [],
    }


def base_project():
    return {
        "meta": {
            "title": "Shot Canon Removal Drift", "format": "Test", "version": "v1",
            "hubVersion": "v6.0.0", "schemaVersion": "6.6",
            "aiPolicy": "project-default", "world": {},
        },
        "qcChecklist": [], "characters": [], "locations": [], "props": [],
        "vehicles": [], "audio": [], "mediaAssets": [], "jobs": [],
        "agentRuns": [], "decisions": [], "sessions": [], "finishJobs": [],
        "scenes": [
            {"id": "SC-CLEAN", "title": "Clean", "whatHappens": "A test beat.",
             "howItFeels": "Exact.", "characters": [], "audio": {}},
            {"id": "SC-DRIFT", "title": "Drift", "whatHappens": "A test beat.",
             "howItFeels": "Exact.", "characters": [], "audio": {}},
            {"id": "SC-MIXED", "title": "Mixed", "whatHappens": "A test beat.",
             "howItFeels": "Exact.", "characters": [], "audio": {}},
        ],
        "shots": [
            shot("SH-CLEAN", "SC-CLEAN", "fr-a"),
            shot("SH-DRIFT", "SC-DRIFT", "fr-a"),
            # SC-MIXED: the removable shot first, the blocking one second — so a
            # per-shot removal would touch the first before discovering the second.
            shot("SH-OK", "SC-MIXED", "fr-a"),
            shot("SH-BAD", "SC-MIXED", "fr-a"),
        ],
    }


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-shot-canon-removal-"))
subprocess.run(
    ["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
    cwd=ROOT, check=True, stdout=subprocess.DEVNULL,
)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_dir = projects_root / SLUG
project_file = project_dir / "project.json"
project_file.write_text(json.dumps(base_project(), indent=2), encoding="utf-8")

pixel = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
for shot_id in ["SH-CLEAN", "SH-DRIFT", "SH-OK", "SH-BAD"]:
    takes_dir = project_dir / "shots" / shot_id / "takes"
    takes_dir.mkdir(parents=True, exist_ok=True)
    (takes_dir / "A.png").write_bytes(pixel)

config = json.loads(config_path.read_text(encoding="utf-8"))
config["activeProject"] = SLUG
config["assistant"] = {"provider": "none", "visionProvider": "none"}
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def disk_project():
    return json.loads(project_file.read_text(encoding="utf-8"))


def receipt_for(target_key, project=None):
    project = project or disk_project()
    rows = [row for row in project.get("productionAuthority", {}).get("receipts", [])
            if row.get("targetKey") == target_key]
    return rows[0] if rows else None


def wait_server(port, process):
    deadline = time.time() + 25
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError("CineBraid server exited during startup")
        try:
            with socket.create_connection(("127.0.0.1", port), .25):
                return
        except OSError:
            time.sleep(.1)
    raise RuntimeError("CineBraid server did not start")


port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={
        **os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
        "CINEBRAID_PROJECTS_ROOT": str(projects_root), "FAL_KEY": "",
        "OPENAI_API_KEY": "", "GOOGLE_API_KEY": "", "ANTHROPIC_API_KEY": "",
    },
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)


def approve_frame(page, shot_id, frame_id, value):
    """One trusted click, one shipped kernel approval. No harness authority."""
    page.evaluate(
        """({shotId, frameId, value}) => {
          document.getElementById('scr-approve')?.remove();
          window.__scrError = null;
          const button = document.createElement('button');
          button.id = 'scr-approve';
          button.textContent = 'APPROVE';
          button.style.cssText = 'position:fixed;left:12px;top:12px;z-index:2147483647';
          button.addEventListener('click', () => {
            try {
              window.CineBraidAuthorityKernel.approveFrameCanon(P, {
                shotId, frameId, value, assetId: '',
                at: new Date().toISOString(), via: 'shot-canon-removal-real-browser',
              });
              dirty();
            } catch (error) {
              window.__scrError = { message: error.message || String(error), code: error.code || '' };
            }
          });
          document.body.appendChild(button);
        }""",
        {"shotId": shot_id, "frameId": frame_id, "value": value},
    )
    page.locator("#scr-approve").click()
    error = page.evaluate("() => window.__scrError")
    assert not error, f"trusted approval failed: {error}"
    page.evaluate("() => document.getElementById('scr-approve')?.remove()")


def drift_on_disk(shot_ids):
    """THE DRIFT, INTRODUCED THE ONLY WAY IT CAN BE.

    The approved still is renamed after it was approved: the edge moves and the
    receipt, which carries no asset identity, cannot follow — repairCanonValue()
    refuses exactly that case, on purpose, so the pointer reads as historic
    rather than being repointed at bytes nobody approved.

    It is written HERE, to the document on disk, rather than through the page,
    and that is the honest construction rather than a shortcut. The Authority
    Write Seam refuses any save that moves an authority edge out from under a
    current receipt, so the running app CANNOT produce this state — which is
    precisely why a drifted document only ever arrives from outside the seam: an
    import, a restore, a hand edit, or a document written by an older build. The
    receipts these shots hold were still written by real trusted clicks above;
    only the rename comes from out here, and the page then opens the document
    exactly as a filmmaker would find it."""
    document = disk_project()
    for row in document["shots"]:
        if row["id"] in shot_ids:
            row["keyframes"][0]["winner"] = "A-RENAMED.png"
    project_file.write_text(json.dumps(document, indent=2), encoding="utf-8")


def await_save(page):
    page.evaluate("async () => { await flushPendingProjectSave(); await SAVE_CHAIN; }")
    page.wait_for_timeout(200)


def open_route(page, base, route):
    page.goto(f"{base}/?scr={time.time_ns()}{route}", wait_until="domcontentloaded")
    page.wait_for_selector("#main", timeout=20000)
    page.wait_for_function(
        "() => typeof P !== 'undefined' && !!P && typeof ACTIVE_PROJECT_SLUG !== 'undefined' && !!ACTIVE_PROJECT_SLUG",
        timeout=20000)
    page.wait_for_timeout(250)


def press_delete(page, opener, confirm_id):
    page.evaluate(f"() => {opener}")
    page.wait_for_selector(f"#{confirm_id}", timeout=10000)
    page.locator(f"#{confirm_id}").click()
    page.wait_for_timeout(400)


try:
    wait_server(port, server)
    base = f"http://127.0.0.1:{port}"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        def guard(route):
            url = route.request.url
            if PAID_ROUTE in url:
                paid_calls.append(url)
                return route.abort()
            if not url.startswith(base) and not url.startswith("data:") and not url.startswith("about:"):
                offsite.append(url)
                return route.abort()
            return route.continue_()

        page.route("**/*", guard)
        open_route(page, base, "#/production")

        # R-01 — a Canon-holding shot deletes: withdrawn, removed, saved, reloaded.
        def r01_clean_deletion():
            open_route(page, base, "#/shot/SH-CLEAN")
            approve_frame(page, "SH-CLEAN", "fr-a", "A.png")
            await_save(page)
            assert receipt_for("shot-frame:SH-CLEAN#fr-a")["status"] == "current"

            press_delete(page, "delShot('SH-CLEAN')", "delete-shot-confirm")
            await_save(page)

            stored = disk_project()
            assert not any(row["id"] == "SH-CLEAN" for row in stored["shots"]), "the shot must be gone from disk"
            row = receipt_for("shot-frame:SH-CLEAN#fr-a", stored)
            assert row["status"] == "revoked", f"receipt must be withdrawn, got {row['status']}"
            assert row["revocationReason"] == "target-removed", row
            assert row["revokedVia"] == "confirmed-target-removal", row
            assert row["revokedBy"] == "human", row
            assert not [r for r in stored["productionAuthority"]["receipts"]
                        if r["status"] == "current" and r.get("shotId") == "SH-CLEAN"], \
                "no current receipt may name the removed shot"

            open_route(page, base, "#/production")
            reloaded = page.evaluate("""() => ({
              present: (P.shots || []).some((row) => row.id === 'SH-CLEAN'),
              current: ((P.productionAuthority || {}).receipts || []).filter((row) => row.status === 'current').length,
            })""")
            assert reloaded["present"] is False, "reload must keep the shot gone"

        scenario("R-01", r01_clean_deletion)

        # R-02 — a drifted receipt refuses deletion, and the project still saves.
        def r02_drift_refuses():
            open_route(page, base, "#/shot/SH-DRIFT")
            approve_frame(page, "SH-DRIFT", "fr-a", "A.png")
            await_save(page)
            assert receipt_for("shot-frame:SH-DRIFT#fr-a")["status"] == "current"

            drift_on_disk({"SH-DRIFT"})
            open_route(page, base, "#/shot/SH-DRIFT")

            drifted = next(row for row in disk_project()["shots"] if row["id"] == "SH-DRIFT")
            assert drifted["keyframes"][0]["winner"] == "A-RENAMED.png", drifted["keyframes"][0]
            assert receipt_for("shot-frame:SH-DRIFT#fr-a")["status"] == "current", \
                "the drifted receipt must still be current on disk"
            assert receipt_for("shot-frame:SH-DRIFT#fr-a")["value"] == "A.png", \
                "the drift is real: the receipt names the old file the edge no longer has"
            assert page.evaluate(
                "() => !CineBraidAuthorityKernel.hasCurrentHumanAuthority(P, "
                "{ kind: 'shot-frame', shotId: 'SH-DRIFT', frameId: 'fr-a' })"
            ), "and the running app agrees it no longer reads as current Canon"

            page.evaluate("() => { P.meta.globalStylePrompt = 'an unrelated edit made in the same session'; dirty(); }")
            press_delete(page, "delShot('SH-DRIFT')", "delete-shot-confirm")
            await_save(page)

            refusal = page.locator('[data-action-refusal="shot-delete:SH-DRIFT"]')
            assert refusal.count() == 1, "the refusal must be on the shot whose deletion was refused"
            text = refusal.inner_text()
            assert "renamed or replaced" in text, text
            assert "Re-approve" in text, text
            assert refusal.get_attribute("data-refusal-code") == "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE"

            stored = disk_project()
            assert any(row["id"] == "SH-DRIFT" for row in stored["shots"]), "the shot must still be there"
            assert receipt_for("shot-frame:SH-DRIFT#fr-a", stored)["status"] == "current", \
                "the receipt must be left exactly as it was"
            assert not [row for row in stored.get("meta", {}).get("deletedTargets", [])
                        if row.get("id") == "SH-DRIFT"], "nothing may be recorded as deleted"
            assert stored["meta"]["globalStylePrompt"] == "an unrelated edit made in the same session", \
                "the project must still be saveable, so the unrelated edit reaches disk"

        scenario("R-02", r02_drift_refuses)

        # R-03 — scene deletion refuses atomically; the sibling is untouched.
        def r03_scene_atomic():
            open_route(page, base, "#/shot/SH-OK")
            approve_frame(page, "SH-OK", "fr-a", "A.png")
            await_save(page)
            open_route(page, base, "#/shot/SH-BAD")
            approve_frame(page, "SH-BAD", "fr-a", "A.png")
            await_save(page)
            drift_on_disk({"SH-BAD"})

            open_route(page, base, "#/scene/SC-MIXED")
            press_delete(page, "delScene('SC-MIXED')", "delete-scene-confirm")
            await_save(page)

            refusal = page.locator('[data-action-refusal="scene-delete:SC-MIXED"]')
            assert refusal.count() == 1, "the refusal must be on the scene whose deletion was refused"
            text = refusal.inner_text()
            assert "SH-BAD" in text, text
            assert "SH-OK" not in text, f"the sibling must not be blamed: {text}"

            stored = disk_project()
            assert any(row["id"] == "SC-MIXED" for row in stored["scenes"]), "the scene must still be there"
            assert {row["id"] for row in stored["shots"]} >= {"SH-OK", "SH-BAD"}, "both shots must still be there"
            assert receipt_for("shot-frame:SH-OK#fr-a", stored)["status"] == "current", \
                "the sibling's perfectly withdrawable receipt must be untouched"
            assert receipt_for("shot-frame:SH-BAD#fr-a", stored)["status"] == "current"
            assert not [row for row in stored.get("meta", {}).get("deletedTargets", [])
                        if row.get("id") in {"SH-OK", "SH-BAD", "SC-MIXED"}], \
                "nothing in the scene may be recorded as deleted"

        scenario("R-03", r03_scene_atomic)

        assert sorted(passed) == ["R-01", "R-02", "R-03"], passed
        assert not page_errors, f"browser raised uncaught errors: {page_errors}"
        assert not paid_calls, f"paid provider route was called: {paid_calls}"
        assert not offsite, f"browser attempted offsite requests: {offsite}"
        print(
            "Shot Canon removal drift real-browser evidence: "
            f"{len(passed)}/3 browser scenarios passed; provider calls: 0.",
            flush=True,
        )
        browser.close()
finally:
    if server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=8)
        except subprocess.TimeoutExpired:
            server.kill()
