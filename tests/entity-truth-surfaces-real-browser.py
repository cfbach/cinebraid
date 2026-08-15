#!/usr/bin/env python3
"""Entity truth surfaces at #/prop/PROP-PARCEL, read off a real Chromium.

WHY A REAL BROWSER, WHEN THE NODE SUITE ALREADY ASSERTS THESE STRINGS.

The Node harness renders through a FakeElement tree. It can prove the markup a
function returns; it cannot prove the markup a person is looking at. Everything
this suite reads is a *composed* surface — the variant hub is a modal painted by
one function, the hero and readout by another, the validation workspace by a
third, the row badge by a fourth — and the defect Codex found was precisely that
these four disagreed with each other about the same state. Disagreement between
independently-painted regions is exactly what a per-function test cannot see.

WHAT IS UNDER TEST. One prop, PROP-PARCEL, with a default state (Closed) holding
PROP-PARCEL-CLOSED.png and a derived state (Opened) holding PROP-PARCEL-OPEN.png.
The project is loaded twice against the same server and the same page:

  * HISTORIC — both pointers present, no receipt behind either. This is the shape
    of every project made before receipts existed, and the shape after a
    revocation. Nothing on either surface may call it approved.
  * CANON — the same two pointers, with a current human receipt behind each.

The surfaces asserted, in both passes: the variant hub's tone and label, the
selected-state hero's alt text and theatre caption, the head action, the approved
readout's label and hint, the validation workspace's heading, its blocked reason,
its button's disabled state, and the authority row's badge and accessibility
label.

IT CARRIES A SOURCE MUTATION CONTROL. public/entities.js is rewritten in flight —
the readout's standing test is replaced with the raw-pointer test it used to be —
and the suite proves the false "Canon image" label comes straight back on a state
with no receipt. That is the shipped file, mutated, executing in the real page.
Nothing on disk is touched.

NOTHING HERE IS PAID. Every provider route is intercepted; the paid route asserts
it was never called.
"""

import copy, json, os, pathlib, re, socket, subprocess, sys, time, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Entity truth surfaces real-browser audit"
sync_playwright = require_browser(LABEL)

SLUG = "entity-truth-audit"
PROP = "PROP-PARCEL"
PARENT_FILE = "PROP-PARCEL-CLOSED.png"
STATE_FILE = "PROP-PARCEL-OPEN.png"
PAID_ROUTE = "/api/generation/fal/jobs"

failures, paid_calls, page_errors = [], [], []


def check(condition, message):
    if not condition:
        failures.append(message)


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def wait_server(port, timeout=25):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.3): return
        except OSError: time.sleep(.12)
    raise RuntimeError("CineBraid server did not start")


def receipt(sequence, state_id, value, asset_id):
    return {
        "id": "authority-%06d" % sequence, "sequence": sequence, "actor": "human",
        "act": "explicit-approval", "command": "approve-entity-state", "kind": "entity-state",
        "targetKey": "entity-state:props:%s#%s" % (PROP, state_id),
        "shotId": "", "frameId": "", "unitKey": "", "list": "props", "entityId": PROP,
        "stateId": state_id, "slotId": "", "value": value, "assetId": asset_id,
        "at": "2026-08-14T00:00:00.000Z", "status": "current", "supersededBy": "",
        "supersededAt": "", "revokedAt": "", "revocationReason": "", "note": "",
        "provenance": {"manualAction": "gesture-%d" % sequence, "via": "browser-fixture", "gesture": "click"},
    }


BASE = json.loads((ROOT / "projects" / "cinebraid-sample" / "project.json").read_text(encoding="utf-8"))


def build_project(canon):
    """The same project twice. The ONLY difference is the receipt ledger."""
    project = copy.deepcopy(BASE)
    prop = next(item for item in project["props"] if item["id"] == PROP)
    prop["approvedFile"] = PARENT_FILE
    prop["approvedAssetId"] = "asset-closed"
    for state in prop["continuityStates"]:
        if state.get("isDefault"):
            state["approvedFile"] = PARENT_FILE
            state["approvedAssetId"] = "asset-closed"
            state["notes"] = "Sealed blue parcel with pale straps."
        else:
            state["approvedFile"] = STATE_FILE
            state["approvedAssetId"] = "asset-open"
            state["parentStateId"] = "state-closed"
            state["generationMode"] = "derive"
            state["notes"] = "Flaps open; the blue box and pale straps remain the same object."
    project["productionAuthority"] = {
        "version": 1,
        "receipts": [receipt(1, "state-closed", PARENT_FILE, "asset-closed"),
                     receipt(2, "state-open", STATE_FILE, "asset-open")] if canon else [],
    }
    return project


SVG = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E"
       "%3Crect width='32' height='32' fill='%232a3038'/%3E%3C/svg%3E")
SCAN = {
    "anchors": [], "plates": [], "vehicles": [], "audio": [], "media": [], "shots": {},
    "props": [{"name": PARENT_FILE, "url": SVG, "assetId": "asset-closed"},
              {"name": STATE_FILE, "url": SVG, "assetId": "asset-open"}],
}
CAPABILITY = {"ready": True, "label": "Mock assistant", "provider": "ollama", "model": "mock", "message": "Ready", "action": ""}

STORAGE = {
    "cinebraid-focused:%s:entity-task:props:%s" % (SLUG, PROP): "states",
    "cinebraid-bounded:%s:selected:entity-coverage-view:props:%s" % (SLUG, PROP): "states",
    "cinebraid-bounded:%s:selected:continuity-state:props:%s" % (SLUG, PROP): "state-open",
    "cinebraid-section:%s:entity:props:%s:continuity-states" % (SLUG, PROP): "1",
}

state = {"project": build_project(False), "mutate_entities": False}

port = free_port()
server = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=dict(os.environ, PORT=str(port)),
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    wait_server(port)
    upstream = "http://127.0.0.1:%d" % port
    base = "http://cinebraid.test"

    def proxy(route):
        request = route.request
        suffix = request.url[len(base):] if request.url.startswith(base) else "/"
        path = suffix.split("?")[0]
        if path.startswith(PAID_ROUTE):
            paid_calls.append(suffix)
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"jobs": []})); return
        if path == "/api/project" and request.method == "GET":
            route.fulfill(status=200, headers={"content-type": "application/json", "x-cinebraid-project-slug": SLUG},
                          body=json.dumps(state["project"])); return
        if path == "/api/project":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True})); return
        if path == "/api/scan":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(SCAN)); return
        if path == "/api/config":
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"generation": {"fal": {"enabled": False}}, "assistant": {"provider": "ollama"}})); return
        if path == "/api/agents/status":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(
                {"enabled": True, "capabilities": {name: CAPABILITY for name in
                 ("text", "vision", "verifier", "embedding", "technical")}, "runs": [], "agents": [], "index": {}})); return
        if path == "/api/system/health":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(
                {"assistant": {"provider": "ollama", "configured": True, "label": "Mock"},
                 "ollama": {"ok": True, "models": ["mock"], "plannerReady": True, "visionReady": True, "embeddingReady": True},
                 "ffmpeg": {"ok": True}})); return
        if path == "/api/automation/runs":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"runs": []})); return
        if path == "/entities.js":
            """THE SOURCE MUTATION POINT. entities.js is always served from disk
               with no-store, so the renderer can never answer this from its own
               memory cache and the mutated build is genuinely what runs."""
            source = (ROOT / "public" / "entities.js").read_text(encoding="utf-8")
            if state["mutate_entities"]:
                before = source
                source = source.replace(
                    '<span>${selectedIsCanon ? "Canon image" : selectedApprovedFile ? "Historic image · not approved" : "Canon image"}</span>',
                    '<span>Approved image</span>')
                if source == before:
                    failures.append("MUTATION CONTROL could not find the readout it was supposed to break")
            route.fulfill(status=200, headers={"content-type": "application/javascript; charset=utf-8",
                                               "cache-control": "no-store"}, body=source); return
        route.fulfill(response=route.fetch(url=upstream + suffix))

    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        page.set_default_timeout(9000)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.route("**/*", proxy)
        page.add_init_script("window.__CB_SEED = %s;" % json.dumps(STORAGE)
                             + "try { for (const [k, v] of Object.entries(window.__CB_SEED)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); } catch {}")

        loads = {"n": 0}

        def load(wait=".continuity-state-card-focused"):
            """A UNIQUE DOCUMENT URL EVERY TIME. Navigating to a URL that differs
               only in its hash is a same-document navigation — the page would
               not reload and the second project would never be fetched."""
            loads["n"] += 1
            page.goto("%s/?pass=%d#/prop/%s" % (base, loads["n"], PROP), wait_until="domcontentloaded")
            page.wait_for_function("() => document.querySelector(%s)" % json.dumps(wait))
            page.wait_for_timeout(150)

        def surfaces():
            """Everything a person can see about the Opened state, in one read."""
            main = page.evaluate("() => document.getElementById('main').innerHTML")
            hub = page.evaluate("""() => {
              openContinuityStateVariantHub('props', %s);
              const node = document.querySelector('.modal, #modal, [data-modal]');
              return node ? node.innerHTML : '';
            }""" % json.dumps(PROP))
            page.evaluate("() => { const c = window.closeModal || window.dismissModal; if (typeof c === 'function') c(); }")
            disabled = page.evaluate(
                "() => { const b = document.querySelector('.state-parent-validation button.approve-btn');"
                " return b ? !!b.disabled : null; }")
            """The media-theatre caption travels through encodeURIComponent, so
               the readable copy only exists once the attribute is decoded."""
            return {"main": main, "hub": hub, "validate_disabled": disabled,
                    "text": urllib.parse.unquote(main)}

        def with_task(task):
            page.evaluate("(t) => { try { localStorage.setItem(%s, t); } catch {} }" % json.dumps(
                "cinebraid-focused:%s:entity-task:props:%s" % (SLUG, PROP)), task)

        # ------------------------------------------------------------------
        # PASS 1 — HISTORIC. Two real pointers, no receipt behind either.
        state["project"] = build_project(False)
        load()
        historic = surfaces()

        check("Historic image for Opened, not approved" in historic["main"],
              "HISTORIC hero: the image's alt text still claims approval")
        check("Approved canon image" not in historic["main"],
              "HISTORIC hero: something on the page calls an unapproved image approved canon")
        check("Opened historic image · " + STATE_FILE in historic["text"],
              "HISTORIC hero: the theatre caption does not name the image as historic")
        check("Historic image · not approved" in historic["main"],
              "HISTORIC readout: the label does not report the standing")
        check("Previously selected. Approve it to make it canon." in historic["main"],
              "HISTORIC readout: no route from historic to canon is offered")
        check("OPEN STATE WORKFLOW" in historic["main"],
              "HISTORIC head action: it offered EDIT / REGENERATE or GENERATE FROM an unapproved parent")
        check("Approve both sides before validating" in historic["main"],
              "HISTORIC validation: the heading still frames the pair as approved")
        check("Validate the approved state against its parent" not in historic["main"],
              "HISTORIC validation: the approved framing survived")
        check(re.search(r"Neither Closed nor this state has been approved as canon", historic["main"]),
              "HISTORIC validation: the blocked reason does not name what is missing")
        check(historic["validate_disabled"] is True,
              "HISTORIC validation: the VALIDATE button was offered on two unapproved images")
        check("HISTORIC · NOT APPROVED" in historic["hub"],
              "HISTORIC hub: the variant is not labelled historic")
        check("APPROVED VARIANT" not in historic["hub"] and "CANON VARIANT" not in historic["hub"],
              "HISTORIC hub: the variant is badged as approved")
        check("PARENT NOT APPROVED" in historic["hub"] or "not approved as canon" in historic["hub"],
              "HISTORIC hub: readiness does not report that the parent is unapproved")
        check("READY TO DERIVE" not in historic["hub"],
              "HISTORIC hub: it says the state is ready to derive from an unapproved parent")

        with_task("approved")
        load(".entity-authority-summary, #main")
        historic_row = page.evaluate("() => document.getElementById('main').innerHTML")
        check("<em>HISTORIC</em>" in historic_row, "HISTORIC row: no HISTORIC badge")
        check("<em>APPROVED</em>" not in historic_row, "HISTORIC row: it badges the pointer APPROVED")
        check(re.search(r"Preview the historic .*? which has not been approved", historic_row),
              "HISTORIC row: the accessibility label does not say the image is unapproved")

        # ------------------------------------------------------------------
        # PASS 2 — CANON. The same two pointers, each with a current receipt.
        with_task("states")
        state["project"] = build_project(True)
        load()
        canon = surfaces()

        check("Approved canon image for Opened" in canon["main"],
              "CANON hero: an approved image is not described as approved")
        check("Historic image for Opened" not in canon["main"],
              "CANON hero: an approved image is described as historic")
        check("Opened canon image · " + STATE_FILE in canon["text"],
              "CANON hero: the theatre caption does not name the image as canon")
        check(">Canon image<" in canon["main"], "CANON readout: the label does not say Canon image")
        check("Approved by you as this state’s production truth." in canon["main"],
              "CANON readout: the hint does not attribute the approval to the creator")
        check("EDIT / REGENERATE" in canon["main"], "CANON head action: approved work cannot be edited")
        check("Validate the approved state against its parent" in canon["main"],
              "CANON validation: two approved images are still refused")
        check("Approve both sides before validating" not in canon["main"],
              "CANON validation: it still asks for approvals that exist")
        check(canon["validate_disabled"] is False,
              "CANON validation: the VALIDATE button is disabled on two approved images")
        check("CANON VARIANT" in canon["hub"], "CANON hub: the variant is not labelled canon")
        check("HISTORIC · NOT APPROVED" not in canon["hub"], "CANON hub: an approved variant is labelled historic")

        with_task("approved")
        load(".entity-authority-summary, #main")
        canon_row = page.evaluate("() => document.getElementById('main').innerHTML")
        check("<em>CANON</em>" in canon_row, "CANON row: no CANON badge")
        check("Historic, not approved" not in canon_row, "CANON row: an approved state carries a historic note")

        # ------------------------------------------------------------------
        # THE MUTATION CONTROL. Break the readout in the shipped file, in flight,
        # and prove the false claim returns on the historic project.
        with_task("states")
        state["project"] = build_project(False)
        state["mutate_entities"] = True
        load()
        broken = page.evaluate("() => document.getElementById('main').innerHTML")
        state["mutate_entities"] = False
        check(">Approved image<" in broken,
              "MUTATION CONTROL: removing the readout's standing test changed nothing — the assertion above proves nothing")
        check("Historic image · not approved" not in broken,
              "MUTATION CONTROL: the repaired label survived a mutation that should have removed it")

        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except subprocess.TimeoutExpired: server.kill()

if paid_calls:
    failures.append("A PAID ROUTE WAS CALLED: %s" % paid_calls)
if page_errors:
    failures.append("Page errors: %s" % page_errors[:3])

if failures:
    print("Entity truth surfaces audit FAILED:")
    for item in failures:
        print("  - %s" % item)
    sys.exit(1)

print("Entity truth surfaces real-browser audit passed: at #/prop/%s the variant hub, the selected-state hero, "
      "the approved readout, the head action, the validation workspace (heading, blocked reason and button state) "
      "and the authority row all report one standing, historic and canon, and a source mutation of the readout "
      "brings the false claim straight back. Paid provider calls: 0." % PROP)
