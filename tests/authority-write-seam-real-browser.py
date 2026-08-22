#!/usr/bin/env python3
"""O8 Authority Write Seam acceptance in the repository's real Chromium.

The 13 primary browser scenarios and two secondary executions retain their O8
IDs. The suite uses a disposable CineBraid server, blocks every off-loopback and
paid-provider request, and relies on Playwright's trusted clicks for every human
authority act.
"""

import base64
import hashlib
import json
import os
import pathlib
import shutil
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

LABEL = "Authority Write Seam O8 real-browser acceptance"
sync_playwright = require_browser(LABEL)

SLUG = "dogfood-sample"
SHOT = "SH-01"
FRAME = "fr-a"
CLIP = "clip-a"
PAID_ROUTE = "/api/generation/fal/jobs"

primary_passed = []
secondary_passed = []
page_errors, offsite, paid_calls = [], [], []


def primary(scenario_id, assertion):
    assertion()
    primary_passed.append(scenario_id)
    print(f"[O8 browser] {scenario_id} PASS", flush=True)


def secondary(scenario_id, assertion):
    assertion()
    secondary_passed.append(scenario_id)
    print(f"[O8 browser secondary] {scenario_id} PASS", flush=True)


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def base_project():
    return {
        "meta": {
            "title": "O8 Browser", "format": "Test", "version": "v1",
            "hubVersion": "v6.0.0", "schemaVersion": "6.6",
            "aiPolicy": "project-default", "world": {},
        },
        "qcChecklist": [], "characters": [], "locations": [], "props": [],
        "vehicles": [], "audio": [], "mediaAssets": [], "jobs": [],
        "agentRuns": [], "decisions": [], "sessions": [], "finishJobs": [],
        "scenes": [{
            "id": "SC-01", "title": "Scene", "whatHappens": "A test beat.",
            "howItFeels": "Exact.", "characters": [], "audio": {},
        }],
        "shots": [{
            "id": SHOT, "scene": "SC-01", "title": "Shot",
            "desc": "A controlled browser test.", "positioning": "Locked frame.",
            "dur": 5, "workflowStatus": "DRAFT", "status": "BUILT",
            "characters": [], "codes": [], "risks": [], "candidateFiles": [
                {"stored": "A.png", "mediaType": "image", "frameId": FRAME},
                {"stored": "B.png", "mediaType": "image", "frameId": FRAME},
                {"stored": "C.png", "mediaType": "image", "frameId": "fr-b"},
            ],
            "creationBrief": {},
            "keyframes": [
                {"id": FRAME, "label": "A", "title": "Opening", "description": "Opening frame.", "generationPackages": []},
                {"id": "fr-b", "label": "B", "title": "Ending", "description": "Ending frame.", "generationPackages": []},
            ],
            "clips": [{
                "id": CLIP, "suffix": "A", "label": "A", "title": "Move",
                "kind": "i2v", "fromFrame": FRAME, "dur": 5,
                "motionPrompt": "A controlled move.", "generationPackages": [],
            }],
        }],
    }


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-o8-browser-"))
subprocess.run(
    ["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
    cwd=ROOT, check=True, stdout=subprocess.DEVNULL,
)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_dir = projects_root / SLUG
project_file = project_dir / "project.json"
project_file.write_text(json.dumps(base_project(), indent=2), encoding="utf-8")

# One valid image is enough for the shipped guided-frame lookup to resolve all
# three fixture names. The kernel never reads these bytes; the real reset UI does.
pixel = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
takes_dir = project_dir / "shots" / SHOT / "takes"
takes_dir.mkdir(parents=True, exist_ok=True)
for name in ["A.png", "B.png", "C.png"]:
    (takes_dir / name).write_bytes(pixel)

config = json.loads(config_path.read_text(encoding="utf-8"))
config["activeProject"] = SLUG
config["assistant"] = {"provider": "none", "visionProvider": "none"}
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def disk_project():
    return json.loads(project_file.read_text(encoding="utf-8"))


def current_rows(project=None):
    project = project or disk_project()
    return [row for row in project.get("productionAuthority", {}).get("receipts", []) if row.get("status") == "current"]


def current_for(target_key, project=None):
    return next((row for row in current_rows(project) if row.get("targetKey") == target_key), None)


def http_json(base, pathname, method="GET", body=None, headers=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        base + pathname, data=data, method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw or "{}"), dict(response.headers)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        return error.code, json.loads(raw or "{}"), dict(error.headers)


def external_ordinary_edit(base, key, value):
    status, project, headers = http_json(base, f"/api/projects/{SLUG}/project")
    assert status == 200, project
    revision = headers.get("X-CineBraid-Project-Revision") or headers.get("Etag")
    project.setdefault("meta", {})[key] = value
    status, result, _ = http_json(
        base, f"/api/projects/{SLUG}/project", "PUT", project, {"If-Match": revision}
    )
    assert status == 200, result
    return result["revision"]


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


def install_action(page, kind, payload):
    page.evaluate(
        """({kind, payload}) => {
          document.getElementById('o8-authority-action')?.remove();
          window.__o8ActionError = null;
          const button = document.createElement('button');
          button.id = 'o8-authority-action';
          button.textContent = 'O8 ACTION';
          button.style.cssText = 'position:fixed;left:12px;top:12px;z-index:2147483647';
          button.addEventListener('click', () => {
            try {
              const K = window.CineBraidAuthorityKernel;
              const at = new Date().toISOString();
              if (kind === 'approve-frame' || kind === 'approve-frame-batch') {
                K.approveFrameCanon(P, { shotId: payload.shotId || 'SH-01', frameId: payload.frameId || 'fr-a',
                  value: payload.value, assetId: payload.assetId || '', at, via: 'o8-real-browser' });
                if (kind === 'approve-frame-batch') P.meta.o8RetainedBatch = payload.batch;
              } else if (kind === 'approve-motion') {
                K.approveMotionCanon(P, { shotId: payload.shotId || 'SH-01', unitKey: payload.unitKey || 'clip-a',
                  value: payload.value, assetId: payload.assetId || '', at, via: 'o8-real-browser' });
              } else if (kind === 'replace-frame-invalidate') {
                const shot = P.shots.find((row) => row.id === (payload.shotId || 'SH-01'));
                K.approveFrameCanon(P, { shotId: shot.id, frameId: payload.frameId || 'fr-a',
                  value: payload.value, assetId: payload.assetId || '', at, via: 'o8-real-browser' });
                guidedInvalidateMotionAfterFrameChange(shot, payload.previous, payload.value);
              } else if (kind === 'approve-entity') {
                K.approveEntityStateCanon(P, { list: payload.list, entityId: payload.entityId,
                  stateId: payload.stateId, value: payload.value, assetId: payload.assetId || '',
                  at, via: 'o8-real-browser' });
              } else {
                throw new Error('unknown O8 browser operation ' + kind);
              }
              dirty();
            } catch (error) {
              window.__o8ActionError = { message: error.message || String(error), code: error.code || '' };
            }
          });
          document.body.appendChild(button);
        }""",
        {"kind": kind, "payload": payload},
    )


def click_action(page, kind, payload):
    install_action(page, kind, payload)
    page.locator("#o8-authority-action").click()
    error = page.evaluate("() => window.__o8ActionError")
    assert not error, f"trusted O8 action failed: {error}"


def await_save(page):
    page.evaluate("async () => { await flushPendingProjectSave(); await SAVE_CHAIN; }")
    page.wait_for_timeout(150)


def reload_app(page, base, route="#/production"):
    page.goto(f"{base}/?o8_reload={time.time_ns()}{route}", wait_until="domcontentloaded")
    page.wait_for_selector("#main", timeout=20000)
    page.wait_for_function("() => typeof P !== 'undefined' && !!P && typeof ACTIVE_PROJECT_SLUG !== 'undefined' && !!ACTIVE_PROJECT_SLUG", timeout=20000)
    page.wait_for_timeout(250)


try:
    wait_server(port, server)
    base = f"http://127.0.0.1:{port}"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        def guard(route):
            url = route.request.url
            if PAID_ROUTE in url and route.request.method == "POST":
                paid_calls.append(f"{route.request.method} {url}")
                return route.abort("failed")
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if url.startswith("https://fonts."):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)
        reload_app(page, base)
        assert not page_errors, f"initial app load raised uncaught errors: {page_errors}"

        # C-01 secondary negative control MUST run before the first trusted revoke.
        def c01_negative():
            result = page.evaluate("""() => {
              try {
                CineBraidAuthorityKernel.approveFrameCanon(P, { shotId:'SH-01', frameId:'fr-a',
                  value:'A.png', assetId:'', at:new Date().toISOString(), via:'page-script' });
                return { refused:false };
              } catch (error) { return { refused:true, code:error.code || '' }; }
            }""")
            assert result == {"refused": True, "code": "MANUAL_ACTION_REQUIRED"}, result

        secondary("C-01", c01_negative)

        # Instrument the first response so B-08 observes assignment order without
        # changing the server's durable document.
        old_revision = page.evaluate("() => PROJECT_REVISION")
        page.evaluate("""() => {
          window.__o8OriginalFetch = window.fetch;
          window.__o8InstallRevision = '';
          window.__o8TransitionResponse = null;
          window.__o8RawTransitionResponse = null;
          let held = P.productionAuthority;
          Object.defineProperty(P, 'productionAuthority', {
            configurable: true,
            enumerable: true,
            get() { return held; },
            set(value) {
              held = value;
              window.__o8HeldAuthority = value;
              if (value && value.__o8ServerAccepted) window.__o8InstallRevision = PROJECT_REVISION;
            },
          });
          window.fetch = async (...args) => {
            const response = await window.__o8OriginalFetch(...args);
            if (String(args[0] || '').includes('/canon-transition')) {
              const data = await response.clone().json();
              window.__o8RawTransitionResponse = structuredClone(data);
              if (response.ok) {
                data.project.productionAuthority.__o8ServerAccepted = true;
                window.__o8TransitionResponse = structuredClone(data);
                return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
              }
            }
            return response;
          };
        }""")
        click_action(page, "approve-frame", {"value": "A.png"})
        await_save(page)

        first_save_state = page.evaluate("""() => ({
          captured: !!window.__o8TransitionResponse,
          revision: PROJECT_REVISION,
          refused: AUTHORITY_SAVE_REFUSED,
          conflict: PROJECT_CONFLICT,
          receipts: (P.productionAuthority?.receipts || []).length,
          saveState: document.getElementById('save-state')?.textContent || '',
          response: window.__o8RawTransitionResponse,
        })""")
        first_save_state["durableReceipts"] = len(disk_project().get("productionAuthority", {}).get("receipts", []))
        assert first_save_state["captured"], f"first Canon transition response was not captured: {first_save_state}"
        response_project = page.evaluate("""() => {
          const response = structuredClone(window.__o8TransitionResponse.project);
          delete response.productionAuthority.__o8ServerAccepted;
          return response;
        }""")

        def b08_order():
            observed = page.evaluate("""() => {
              const installRevision = window.__o8InstallRevision;
              const finalRevision = PROJECT_REVISION;
              const held = window.__o8HeldAuthority;
              if (held) delete held.__o8ServerAccepted;
              if (SAVED_PROJECT_BASELINE?.productionAuthority)
                delete SAVED_PROJECT_BASELINE.productionAuthority.__o8ServerAccepted;
              delete P.productionAuthority;
              if (held) P.productionAuthority = held;
              window.fetch = window.__o8OriginalFetch;
              return { installRevision, finalRevision };
            }""")
            assert observed["installRevision"] == old_revision, observed
            assert observed["finalRevision"] != old_revision, observed
            assert current_for("shot-frame:SH-01#fr-a"), "server did not durably accept the receipt"
            assert "__o8ServerAccepted" not in disk_project().get("productionAuthority", {}), \
                "the response-only observation marker reached disk"

        primary("B-08", b08_order)

        def g01_durable():
            row = current_for("shot-frame:SH-01#fr-a")
            assert row and row["value"] == "A.png", row
            assert disk_project()["shots"][0]["keyframes"][0]["winner"] == "A.png"

        primary("G-01", g01_durable)
        reload_app(page, base)

        def b02_reload():
            loaded = page.evaluate("() => structuredClone(P)")
            assert loaded.get("productionAuthority") == response_project.get("productionAuthority")
            assert loaded["shots"][0]["keyframes"][0]["winner"] == response_project["shots"][0]["keyframes"][0]["winner"]

        primary("B-02", b02_reload)

        # First human revoke: negative control above already ran. Use the shipped
        # Creation Studio reset and its real confirmation button.
        page.evaluate("() => resetGuidedFrameApproval('SH-01', 'fr-a')")
        page.wait_for_selector("#modal-confirm-action", timeout=10000)
        page.locator("#modal-confirm-action").click()
        await_save(page)

        def g02_revoke_reload():
            row = next(row for row in disk_project()["productionAuthority"]["receipts"] if row["targetKey"] == "shot-frame:SH-01#fr-a")
            assert row["status"] == "revoked" and row["revocationReason"] == "withdrawn", row
            assert not disk_project()["shots"][0]["keyframes"][0].get("winner")
            reload_app(page, base)
            assert page.evaluate("() => hasCurrentHumanAuthority(P, {kind:'shot-frame',shotId:'SH-01',frameId:'fr-a'})") is False

        primary("G-02", g02_revoke_reload)

        # The revocation transition wrote a pre-image backup containing current
        # authority. Restoring it now is a resurrection preview.
        backup_dir = project_dir / "backups"
        resurrection_backup = ""
        for candidate in sorted(backup_dir.glob("project-*.json")):
            try:
                if current_for("shot-frame:SH-01#fr-a", json.loads(candidate.read_text(encoding="utf-8"))):
                    resurrection_backup = candidate.name
                    break
            except Exception:
                pass
        assert resurrection_backup, "no approved pre-image backup was available for restore disclosure"
        page.evaluate("(name) => restoreProjectBackup(name)", resurrection_backup)
        page.wait_for_selector("#modal-confirm-action", timeout=10000)

        def f02_disclosure():
            text = page.locator("#modal").inner_text()
            assert "structurally trusted" in text, text
            assert "shot-frame:SH-01#fr-a" in text, text
            assert "non-Canon" in text and "current" in text, text

        primary("F-02", f02_disclosure)
        page.locator("#modal-confirm-action").click()
        page.wait_for_function("() => document.querySelector('#modal h3')?.textContent.includes('Confirm Canon resurrection')", timeout=10000)

        def f03_second_confirm():
            text = page.locator("#modal").inner_text()
            assert "resurrect previously non-current production authority" in text, text
            assert "RESURRECT & RESTORE" in text, text

        primary("F-03", f03_second_confirm)
        page.locator("#modal .cancel").click()

        # D-08: damage is recovered to zero current receipts; only another real
        # click can re-establish authority.
        damaged = disk_project()
        damaged["shots"][0]["keyframes"][0]["winner"] = "RECOVER.png"
        damaged.setdefault("productionAuthority", {"version": 1, "receipts": []})["receipts"].append(
            {"id": "malformed-browser-row", "status": "current"}
        )
        project_file.write_text(json.dumps(damaged, indent=2), encoding="utf-8")
        status, recovered, _ = http_json(base, f"/api/projects/{SLUG}/authority/recover", "POST", {"mode": "QUARANTINE"})
        assert status == 200, recovered
        reload_app(page, base)

        def d08_reapproval():
            assert not current_rows(), "recovery must leave zero current receipts"
            refused = page.evaluate("""() => {
              try { CineBraidAuthorityKernel.approveFrameCanon(P, {shotId:'SH-01',frameId:'fr-a',value:'RECOVER.png',assetId:'',at:new Date().toISOString()}); return ''; }
              catch (error) { return error.code || ''; }
            }""")
            assert refused == "MANUAL_ACTION_REQUIRED", refused
            click_action(page, "approve-frame", {"value": "RECOVER.png"})
            await_save(page)
            durable = current_for("shot-frame:SH-01#fr-a")
            if not durable:
                state = page.evaluate("""() => ({
                  conflict:PROJECT_CONFLICT, refused:AUTHORITY_SAVE_REFUSED,
                  revision:PROJECT_REVISION, receipts:(P.productionAuthority?.receipts || []),
                  saveState:document.getElementById('save-state')?.textContent || '',
                  modal:document.getElementById('modal')?.innerText || '',
                })""")
                raise AssertionError(f"explicit reapproval did not persist: client={state} disk={disk_project().get('productionAuthority')}")

        primary("D-08", d08_reapproval)

        # Establish motion, then use the shipped dependent-invalidation owner as
        # part of a real frame replacement click.
        click_action(page, "approve-motion", {"value": "MOTION-A.mp4"})
        await_save(page)
        click_action(page, "replace-frame-invalidate", {"value": "B.png", "previous": "RECOVER.png"})
        await_save(page)

        def g03_invalidation_reload():
            project = disk_project()
            motion = next(row for row in project["productionAuthority"]["receipts"] if row["targetKey"] == "shot-motion:SH-01#clip-a")
            assert motion["status"] == "revoked" and motion["revokedBy"] == "system", motion
            assert not project["shots"][0]["clips"][0].get("videoWinner")
            reload_app(page, base)
            assert page.evaluate("() => hasCurrentHumanAuthority(P,{kind:'shot-motion',shotId:'SH-01',unitKey:'clip-a'})") is False

        primary("G-03", g03_invalidation_reload)

        def g04_reapprove():
            click_action(page, "approve-motion", {"value": "MOTION-B.mp4"})
            await_save(page)
            reload_app(page, base)
            row = current_for("shot-motion:SH-01#clip-a")
            assert row and row["value"] == "MOTION-B.mp4", row

        primary("G-04", g04_reapprove)

        def g05_ordinary_after_approval():
            before_ids = sorted(row["id"] for row in current_rows())
            page.evaluate("() => { P.meta.o8OrdinaryEdit = 'survives'; dirty(); }")
            await_save(page)
            assert disk_project()["meta"]["o8OrdinaryEdit"] == "survives"
            assert sorted(row["id"] for row in current_rows()) == before_ids
            assert page.evaluate("() => ({conflict:PROJECT_CONFLICT, refused:AUTHORITY_SAVE_REFUSED})") == {"conflict": False, "refused": False}

        primary("G-05", g05_ordinary_after_approval)

        def g06_stale_surface_recovery():
            external_ordinary_edit(base, "o8ExternalConflict", "stored")
            click_action(page, "approve-frame", {"frameId": "fr-b", "value": "C.png"})
            await_save(page)
            page.wait_for_function("() => PROJECT_CONFLICT === true && !!document.querySelector('#modal')", timeout=10000)
            text = page.locator("#modal").inner_text()
            assert "changed while this view was open" in text and "RELOAD PROJECT" in text, text
            assert not current_for("shot-frame:SH-01#fr-b"), "the stale authority act reached disk"
            page.locator("#modal .approve-btn").click()
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_function("() => typeof P !== 'undefined' && !!P && PROJECT_CONFLICT === false", timeout=20000)
            assert page.evaluate("() => P.meta.o8ExternalConflict") == "stored"

        primary("G-06", g06_stale_surface_recovery)

        rejected = {"used": False}
        pattern = "**/api/projects/*/canon-transition"

        def reject_once(route):
            if not rejected["used"]:
                rejected["used"] = True
                return route.fulfill(
                    status=422, content_type="application/json",
                    body=json.dumps({
                        "ok": False, "code": "CANON_TRANSITION_REQUIRED",
                        "error": "O8 browser injected one truthful authority refusal.",
                        "targets": [{"targetKey": "shot-frame:SH-01#fr-b", "value": "", "assetId": ""}],
                    }),
                )
            return route.continue_()

        page.route(pattern, reject_once)

        def g07_rebase_retry():
            click_action(page, "approve-frame-batch", {"frameId": "fr-b", "value": "C.png", "batch": "retained-through-422"})
            await_save(page)
            page.wait_for_timeout(350)
            refusal_state = page.evaluate("""() => ({
              refused:AUTHORITY_SAVE_REFUSED, conflict:PROJECT_CONFLICT,
              saveState:document.getElementById('save-state')?.textContent || '',
              modal:document.getElementById('modal')?.innerText || '',
              batch:P.meta.o8RetainedBatch || '',
            })""")
            refusal_state["hookUsed"] = rejected["used"]
            refusal_state["diskBatch"] = disk_project().get("meta", {}).get("o8RetainedBatch", "")
            assert refusal_state["refused"] is True, f"422 did not latch refusal: {refusal_state}"
            assert page.evaluate("() => P.meta.o8RetainedBatch") == "retained-through-422"
            text = page.locator("#modal").inner_text()
            assert "THE EDIT BATCH IS STILL IN THIS TAB" in text and "REBASE & RETRY" in text, text
            page.unroute(pattern, reject_once)
            page.locator("#modal .approve-btn").click()
            page.wait_for_function("() => AUTHORITY_SAVE_REFUSED === false && !document.querySelector('#modal:not(.hidden)')", timeout=15000)
            await_save(page)
            project = disk_project()
            assert project["meta"]["o8RetainedBatch"] == "retained-through-422"
            assert current_for("shot-frame:SH-01#fr-b", project), "the retried authority act did not persist"

        primary("G-07", g07_rebase_retry)

        def g08_normalizer_fixed_point():
            page.evaluate("""() => {
              P.characters.push({
                id:'CHAR-01', name:'Character', approvedFile:'', continuityStates:[
                  {id:'state-default',name:'Default',isDefault:true,approvedFile:''},
                  {id:'state-alt',name:'Alternate',isDefault:false,approvedFile:''},
                ], coverageSlots:[], expressionSlots:[],
                candidateFiles:[{stored:'CHAR.png',assetId:'asset-char',decision:'unreviewed'}],
              });
              dirty();
            }""")
            await_save(page)
            click_action(page, "approve-entity", {
                "list": "characters", "entityId": "CHAR-01", "stateId": "state-default",
                "value": "CHAR.png", "assetId": "asset-char",
            })
            await_save(page)
            page.evaluate("""() => {
              const entity = P.characters.find(row => row.id === 'CHAR-01');
              entity.continuityStates.reverse();
              dirty();
            }""")
            await_save(page)
            assert disk_project()["characters"][0]["continuityStates"][0]["id"] == "state-alt"
            receipt_before = current_for("entity-state:characters:CHAR-01#state-default")
            assert receipt_before, "default state approval was not durable"
            reload_app(page, base)
            loaded = page.evaluate("""() => {
              const entity=P.characters.find(row=>row.id==='CHAR-01');
              return { first:entity.continuityStates[0].id, file:entity.approvedFile,
                assetId:entity.approvedAssetId, transition:authorityWriteTransition(SAVED_PROJECT_BASELINE,P).requiresTransition };
            }""")
            assert loaded == {"first": "state-alt", "file": "CHAR.png", "assetId": "asset-char", "transition": False}, loaded
            page.evaluate("() => { P.meta.o8NormalizerSave='fixed-point'; dirty(); }")
            await_save(page)
            receipt_after = current_for("entity-state:characters:CHAR-01#state-default")
            assert receipt_after and receipt_after["id"] == receipt_before["id"]
            assert disk_project()["characters"][0]["approvedFile"] == "CHAR.png"
            assert disk_project()["characters"][0]["approvedAssetId"] == "asset-char"

        primary("G-08", g08_normalizer_fixed_point)

        # Secondary A-21: drive both shipped deletion confirmation surfaces from
        # current Canon and prove the normal-save target-removal disposition.
        def a21_delete_surfaces():
            page.evaluate("""() => {
              for (const [sceneId, shotId] of [['SC-X','SH-X'],['SC-Y','SH-Y']]) {
                P.scenes.push({id:sceneId,title:sceneId,whatHappens:'Delete test',howItFeels:'Exact',characters:[],audio:{}});
                P.shots.push({id:shotId,scene:sceneId,title:shotId,desc:'Delete test',positioning:'Locked',dur:1,
                  workflowStatus:'DRAFT',status:'BUILT',characters:[],codes:[],risks:[],candidateFiles:[],creationBrief:{},
                  keyframes:[{id:'fr-a',label:'A',title:'A',description:'A',generationPackages:[]}],clips:[]});
              }
              dirty();
            }""")
            await_save(page)
            click_action(page, "approve-frame", {"shotId": "SH-X", "frameId": "fr-a", "value": "X.png"})
            await_save(page)
            click_action(page, "approve-frame", {"shotId": "SH-Y", "frameId": "fr-a", "value": "Y.png"})
            await_save(page)

            page.evaluate("() => delShot('SH-X')")
            page.wait_for_selector("#delete-shot-confirm", timeout=10000)
            page.locator("#delete-shot-confirm").click()
            await_save(page)
            project = disk_project()
            assert not any(row["id"] == "SH-X" for row in project["shots"])
            xrow = next(row for row in project["productionAuthority"]["receipts"] if row["targetKey"] == "shot-frame:SH-X#fr-a")
            assert xrow["status"] == "revoked" and xrow["revocationReason"] == "target-removed"

            page.evaluate("() => delScene('SC-Y')")
            page.wait_for_selector("#delete-scene-confirm", timeout=10000)
            page.locator("#delete-scene-confirm").click()
            await_save(page)
            project = disk_project()
            assert not any(row["id"] == "SC-Y" for row in project["scenes"])
            assert not any(row["id"] == "SH-Y" for row in project["shots"])
            yrow = next(row for row in project["productionAuthority"]["receipts"] if row["targetKey"] == "shot-frame:SH-Y#fr-a")
            assert yrow["status"] == "revoked" and yrow["revocationReason"] == "target-removed"

        secondary("A-21", a21_delete_surfaces)

        expected_primary = sorted([
            "B-02", "B-08", "D-08", "F-02", "F-03",
            "G-01", "G-02", "G-03", "G-04", "G-05", "G-06", "G-07", "G-08",
        ])
        expected_secondary = ["A-21", "C-01"]
        assert sorted(primary_passed) == expected_primary, (primary_passed, expected_primary)
        assert sorted(secondary_passed) == expected_secondary, (secondary_passed, expected_secondary)
        assert not page_errors, f"browser raised uncaught errors: {page_errors}"
        assert not paid_calls, f"paid provider route was called: {paid_calls}"
        assert not offsite, f"browser attempted offsite requests: {offsite}"
        print(
            "Authority Write Seam O8 real-browser acceptance: "
            f"{len(primary_passed)}/13 unique browser scenarios passed; "
            f"{len(secondary_passed)}/2 secondary browser executions passed; provider calls: 0.",
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
    shutil.rmtree(sandbox, ignore_errors=True)
