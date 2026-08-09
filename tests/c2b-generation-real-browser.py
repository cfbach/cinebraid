#!/usr/bin/env python3
"""C2b capability-aware generation, driven in a real Chromium.

C2b's own defect is the reason this file exists. Two shared scripts each declared
`const EXPORTS`; every Node suite passed, because each file is individually valid
and no Node suite loads them together. In a browser the second script threw a
SyntaxError and the application rendered blank. Nothing that runs outside a
browser could have caught it, so the capability-aware dialog needs assertions from
inside one.

What it establishes, in the order a filmmaker meets it:

  A  the shot workspace loads with no uncaught error and no console error
  B  the real Create blocking frame button opens the dialog
  C  the dialog states the task, the approved references, the options, the
     compiled prompt and the size / quality / count controls
  D  the normal view is a short list, not the whole 32-model catalogue
  E  an option CineBraid cannot act on cannot be pressed
  F  and says why, before the paid button rather than after it
  G  a Runware catalogue entry is never actionable
  H  watchlist and deprecated models never reach the normal list
  I  the advanced view adds technical detail without changing the normal list
  J  Animate shot still resolves MiniMax H3 as the executable option
  K  changing an output setting re-compiles rather than leaving stale facts
  L  the shipped scripts still share one global scope cleanly

NOTHING HERE IS PAID. The dialog compiles through /api/generation/fal/image/plan
and /api/generation/options, both of which are local computation. The suite fails
if any request leaves the loopback host or if /api/generation/fal/jobs - the only
route that spends money - is ever called. FAL_KEY is set to a string that is not a
credential, purely so the client-side "is fal configured" gate opens.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped sample
are never touched, and the directory is removed at the end.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL = "C2b capability-aware generation real-browser audit"
sync_playwright = require_browser(LABEL)

SHOT = "SAMPLE-03"
PAID_ROUTE = "/api/generation/fal/jobs"
# The catalogue is deliberately much larger than any one screen should show.
CATALOGUE_SIZE = len(json.loads((ROOT / "data" / "model-definitions.json").read_text(encoding="utf-8"))["models"])
NORMAL_LIST_CEILING = 12
HIDDEN_STATUSES = {"watchlist", "deprecated", "not-recommended"}


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


# ---------------------------------------------------------------- the sandbox

sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-c2b-"))
subprocess.run([sys.executable and "node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"

# fal on, so the one dispatchable image option resolves as available rather than
# as "switched off in Settings" - which is a different screen from the one under test.
config = json.loads(config_path.read_text(encoding="utf-8"))
config["generation"] = {"fal": {"enabled": True, "blockingOutputs": 2, "blockingQuality": "low"}}
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "FAL_KEY": "q1-browser-qa-placeholder-not-a-credential"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

console_errors = []
page_errors = []
offsite = []
paid_calls = []
fonts_requested = []
failed_requests = []
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")

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
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        # A bare "Failed to load resource" says nothing about which resource, so the
        # URL is recorded alongside it - a failing same-origin API call and a blocked
        # third-party font are different findings and must not read alike.
        page.on("requestfailed", lambda request: failed_requests.append(
            f"{request.method} {request.url} ({(request.failure or '')})"))

        def guard(route):
            """No request leaves this machine, and the paid route is never called."""
            url = route.request.url
            # POST submits and is charged for. GET is the local job-history read the
            # workspace does on load whenever fal is configured, and blocking it would
            # manufacture a console error that looks like a product defect.
            if PAID_ROUTE in url and route.request.method == "POST":
                paid_calls.append(f"{route.request.method} {url}")
                return route.abort("failed")
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                # index.html links Google Fonts. Served empty rather than aborted:
                # aborting is also a block, but it logs a console error the suite
                # would then have to forgive, and a rule with an exception is a
                # weaker rule than one without. The request is recorded so the
                # external dependency stays visible rather than being smoothed away.
                fonts_requested.append(url)
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)

        # ---- A. the shot workspace loads --------------------------------
        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=15000)
        page.wait_for_timeout(1500)
        assert not page_errors, f"A: the shot workspace raised uncaught errors: {page_errors}"
        assert not console_errors, \
            f"A: the shot workspace logged console errors: {console_errors}; failed requests: {failed_requests}"

        # ---- L. one global scope ----------------------------------------
        # The duplicate-`const EXPORTS` failure mode, stated as its symptom: a
        # script that throws at parse time never defines anything, so the
        # functions the later files register are simply absent and #main is bare.
        # Checked with `typeof name`, not `window[name]`. A top-level `const` in a
        # classic script creates a global LEXICAL binding rather than a window
        # property - which is the very reason two scripts declaring the same one is a
        # redeclaration error. Reading window would miss both the binding and the bug.
        missing = page.evaluate("""() => ['route','shotById','falGenerationReady','openFalGenerationModal',
            'openFalFrameGenerationModal','renderGenerationOptions','resolveGenerationOptions','openFalH3MotionModal']
            .filter(name => { try { return eval(`typeof ${name}`) !== 'function'; } catch { return true; } })""")
        assert not missing, f"L: shipped scripts did not all evaluate; missing globals {missing}"
        assert len(page.locator("#main").inner_text()) > 400, "L: the workspace rendered almost nothing"

        # ---- B. the real button opens the dialog ------------------------
        page.locator(".focused-task-button", has_text="Look & blocking").first.click()
        page.wait_for_timeout(500)
        page.evaluate("() => document.querySelectorAll('#main details').forEach(node => { node.open = true; })")
        page.wait_for_timeout(300)
        generate = page.get_by_role("button", name="GENERATE", exact=True)
        assert generate.count() == 1, f"B: expected one Create blocking frame button, found {generate.count()}"
        generate.first.click()
        page.wait_for_selector(".h3-generation-modal", timeout=20000)
        page.wait_for_selector(".gen-option", timeout=20000)
        page.wait_for_timeout(400)

        # ---- C. the dialog states what it is going to do ----------------
        assert page.locator(".h3-generation-head h3").inner_text().strip().startswith("Create blocking frame"), \
            "C: the dialog does not name the task"
        lead = page.locator(".h3-generation-head p").inner_text()
        assert "composition" in lead and "staging" in lead, f"C: the task description is missing: {lead!r}"
        assert page.locator("#fal-frame-references").inner_text().strip(), "C: no approved-reference panel"
        compiled = page.locator("#fal-frame-prompt-editor").input_value()
        assert len(compiled) > 80, f"C: the compiled prompt is too short to be real ({len(compiled)} characters)"
        for control in ("fal-frame-size", "fal-frame-quality", "fal-frame-count"):
            assert page.locator(f"#{control}").count() == 1, f"C: the {control} control is missing"
        assert page.locator("#fal-frame-facts").inner_text().strip(), "C: the request summary is empty"

        # ---- the option list, read once and asked several questions -----
        def option_rows():
            return page.evaluate("""() => [...document.querySelectorAll('#fal-frame-options .gen-option')].map(node => ({
              cls: node.className,
              name: (node.querySelector('.gen-option-name b') || {}).textContent || '',
              where: (node.querySelector('.gen-option-where') || {}).textContent || '',
              state: (node.querySelector('.gen-option-state') || {}).textContent || '',
              note: ((node.querySelector('.gen-option-note') || {}).textContent || '').trim(),
              button: ((node.querySelector('button') || {}).textContent || '').trim(),
              disabled: !!(node.querySelector('button') || {}).disabled,
              ready: node.classList.contains('is-ready'),
            }))""")

        rows = option_rows()
        resolved = page.evaluate("() => window._falFrameRequest.options")
        normal_ids = set(resolved["normal"])
        by_id = {option["optionId"]: option for option in resolved["options"]}

        # ---- D. a short list, not the catalogue -------------------------
        assert len(rows) == len(normal_ids), f"D: {len(rows)} rows rendered for {len(normal_ids)} normal options"
        assert len(rows) <= NORMAL_LIST_CEILING, \
            f"D: the normal view showed {len(rows)} models; a blocking dialog must not become a catalogue dump"
        assert len(rows) < len(resolved["options"]), "D: the normal view is not narrowing anything"
        assert CATALOGUE_SIZE >= 25, "D: this assertion assumes a large catalogue; it has shrunk unexpectedly"

        # ---- E / F. unavailable is unpressable, and says why ------------
        for row in rows:
            if row["ready"]:
                continue
            assert row["disabled"], f"E: {row['name']} is not available but its button is live ({row['button']!r})"
            assert row["button"] != "Use this", f"E: {row['name']} offers 'Use this' while unavailable"
            assert len(row["note"]) > 15, f"F: {row['name']} is unavailable with no readable reason ({row['note']!r})"
            assert row["state"], f"F: {row['name']} shows no availability label"
        actionable = [row for row in rows if row["ready"]]
        assert actionable, "the dialog resolved no usable model at all; the rest of C2b cannot be judged"
        assert all(row["disabled"] is False or row["button"] == "Selected" for row in actionable), \
            "an available option must be selectable"

        # ---- G. Runware is catalogue-only -------------------------------
        runware = [option for option in resolved["options"] if option.get("surfaceId") == "runware"]
        assert runware, "G: no Runware option resolved, so this assertion would prove nothing"
        for option in runware:
            assert not option["actionable"], f"G: Runware option {option['optionId']} is actionable"
        runware_rows = [row for row in rows if "runware" in row["where"].lower()]
        for row in runware_rows:
            assert row["disabled"], f"G: Runware row {row['name']} is pressable"

        # ---- H. watchlist and deprecated stay out of the normal list ----
        hidden = [option for option in resolved["options"]
                  if str(option.get("detail", {}).get("catalogueStatus", "")) in HIDDEN_STATUSES]
        assert hidden, "H: no watchlist or deprecated model resolved, so this assertion would prove nothing"
        leaked = [option["optionId"] for option in hidden if option["optionId"] in normal_ids]
        assert not leaked, f"H: watchlist/deprecated models reached the normal list: {leaked}"

        # ---- I. the advanced view adds detail, changes nothing ----------
        advanced = page.locator(".gen-options-advanced")
        assert advanced.count() == 1, "I: the technical detail disclosure is missing"
        assert not advanced.first.evaluate("node => node.open"), "I: technical detail must start collapsed"
        advanced.first.evaluate("node => { node.open = true; }")
        page.wait_for_timeout(200)
        advanced_count = page.locator(".gen-options-advanced li").count()
        assert advanced_count == len(resolved["options"]), \
            f"I: advanced listed {advanced_count} of {len(resolved['options'])} combinations"
        advanced_text = advanced.first.inner_text()
        for fragment in ("gpt-image-2/standard", "fal-queue", "no adapter"):
            assert fragment in advanced_text, f"I: technical detail omits {fragment!r}"
        assert option_rows() == rows, "I: opening technical detail changed the normal list"

        # ---- K. an output change re-compiles ----------------------------
        before_facts = page.locator("#fal-frame-facts").inner_text()
        sizes = page.evaluate("() => [...document.querySelectorAll('#fal-frame-size option')].map(o => o.value)")
        other = next((value for value in sizes if value != page.locator("#fal-frame-size").input_value()), "")
        assert other, "K: only one size is offered, so a change cannot be tested"
        page.locator("#fal-frame-size").select_option(other)
        try:
            page.wait_for_function("size => document.getElementById('fal-frame-facts').innerText.includes(size)",
                                   arg=other, timeout=15000)
        except Exception as error:  # noqa: BLE001 - a timeout here IS the finding
            raise AssertionError(
                f"K: choosing size {other} never reached the request summary, which still reads "
                f"{page.locator('#fal-frame-facts').inner_text()!r}. The dialog is stating the previous "
                f"request as though it were this one.") from error
        after_facts = page.locator("#fal-frame-facts").inner_text()
        assert after_facts != before_facts, "K: the request summary did not follow the size change"
        assert other in after_facts, f"K: the summary does not state the chosen size {other}"
        assert page.locator("#fal-frame-options .gen-option").count() == len(rows), \
            "K: the option list did not survive the re-compile"

        # The paid button is reachable and correctly enabled - and not pressed.
        submit = page.locator("#fal-frame-submit")
        assert submit.count() == 1 and submit.inner_text().strip() == "GENERATE", "the paid button is missing"
        page.locator(".h3-generation-head .cancel").click()
        page.wait_for_timeout(300)

        # ---- J. Animate shot still resolves H3 --------------------------
        animate = page.evaluate("""async () => {
          const response = await fetch('/api/generation/options', {method:'POST',
            headers:{'Content-Type':'application/json'}, body: JSON.stringify({task:'animate-shot', references:[]})});
          return response.json();
        }""")
        h3 = [option for option in animate["options"] if str(option["modelId"]).startswith("minimax-h3/")]
        assert h3, "J: Animate shot resolved no MiniMax H3 option"
        dispatchable = [option for option in h3 if option["actionable"]]
        assert dispatchable, f"J: no H3 option is actionable; H3 is the only video family CineBraid can dispatch"
        assert all(str(option["modelId"]).startswith("minimax-h3/") for option in animate["options"] if option["actionable"]), \
            "J: a non-H3 video model claims to be actionable, which no adapter supports"

        # ---- A again, after everything ----------------------------------
        assert not page_errors, f"the C2b flow raised uncaught errors: {page_errors}"
        assert not console_errors, f"the C2b flow logged console errors: {console_errors}"
        browser.close()

    assert not offsite, f"browser QA attempted to leave this machine: {offsite}"
    assert not paid_calls, f"browser QA reached the paid generation route: {paid_calls}"

    print(
        f"C2b capability-aware generation real-browser audit passed: the workspace and dialog loaded with no console "
        f"or uncaught error, the real Create blocking frame button compiled a {len(compiled)}-character prompt, the "
        f"normal view showed {len(rows)} of {len(resolved['options'])} resolved combinations from a {CATALOGUE_SIZE}-model "
        f"catalogue with {len(actionable)} usable, every unavailable row was disabled and explained, "
        f"{len(runware)} Runware entries stayed catalogue-only, {len(hidden)} watchlist/deprecated models stayed out of "
        f"the normal list, technical detail listed all {advanced_count} combinations without changing it, a size "
        f"change re-compiled the request, Animate shot still resolved H3 as the only executable video option, and no "
        f"request left the loopback host or reached the paid route.")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
