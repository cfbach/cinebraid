#!/usr/bin/env python3
"""The LAN passcode controls, driven by a real Chromium.

tests/lan-passcode-settings.js reads the markup and the contract. This drives the
product: it opens Settings in a browser, clicks through to Access & security, types
an editor passcode into the real control, presses the real save button, and then
proves with live HTTP that the passcode it typed is the one the server now demands.

That distinction is the whole point of this file. The defect being guarded was not a
wrong value anywhere - it was that the two inputs `savePass()` reads were never
rendered by any Settings subsection, so CineBraid warned LAN users to set an editor
passcode and gave them nowhere to set one. Only a browser can show that the controls
are reachable by clicking, that they are password boxes which start empty, that the
save button is wired to something, and that a stored passcode is never handed back.

Four things are checked in order, each against a real server:

  1. an open install - the controls exist, are empty, and report "Not set";
  2. saving - the typed passcode is stored, the boxes are cleared, and the login
     contract changes to match (wrong refused, editor admitted, viewer read-only);
  3. signed in - Settings is reachable again through the real /login.html form, the
     stored passcodes appear nowhere in the page, and changing one takes effect;
  4. clearing - blank plus the explicit TURN AUTH OFF choice re-opens the install,
     and blank plus KEEP UNCHANGED changes nothing.

No project data is touched: the server runs against a disposable config and projects
root. No passcode is printed - the summary reports what happened, never the values.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from browser_runtime import require_browser, launch_chromium
LABEL = "LAN passcode Settings real-browser audit"
sync_playwright = require_browser(LABEL)

# Never printed, and never asserted against page text - only ever typed in and sent.
EDITOR_PASS = "editor-browser-passcode-5151"
VIEWER_PASS = "viewer-browser-passcode-5252"
ROTATED_PASS = "rotated-browser-passcode-5353"


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-passcode-"))
projects_root = sandbox / "projects"
projects_root.mkdir()
shutil.copytree(ROOT / "projects" / "cinebraid-sample", projects_root / "passcode-sample",
                ignore=shutil.ignore_patterns("backups", "*.bak", "generation-jobs.json", "agent-index.json"))
config_path = sandbox / "config.json"
config_path.write_text(json.dumps({
    "activeProject": "passcode-sample",
    "assistant": {"provider": "none", "visionProvider": "none"},
    "generation": {"fal": {"enabled": False}},
}, indent=2), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

checks = 0
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
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        crashes = []
        console_errors = []
        page.on("pageerror", lambda error: crashes.append(f"uncaught: {error}"))
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

        def open_access_panel():
            """Reach the passcode controls the way a person does: click the tab.

            The reload is not decoration. `#/settings` differs from whatever is
            already loaded only by its fragment, so goto() alone would be an in-page
            hash change and the panel under test could be a stale render from before
            the previous save."""
            page.goto(f"{base}/#/settings", wait_until="domcontentloaded")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("nav.settings-nav-shell", timeout=15000)
            # Which subsection is open is remembered per browser, so on the second
            # visit Access & security is already showing and #cfg-epass resolves
            # against the render that is about to be replaced. Landing on another
            # subsection first makes the panel under test the product of the click
            # that was waited on, which is also how a person moves through Settings.
            page.locator("nav.settings-nav-shell button", has_text="Appearance").first.click()
            page.wait_for_selector("#cfg-theme-accent", timeout=15000)
            tab = page.locator("nav.settings-nav-shell button", has_text="Access & security").first
            assert tab.count(), "Settings offers no Access & security section to click"
            tab.click()
            page.wait_for_selector("#cfg-epass", timeout=15000)
            page.wait_for_timeout(250)

        def probe():
            """A request context with its own cookie jar, so a login probe here never
            changes the role the page under test is holding."""
            return pw.request.new_context(base_url=base)

        def login(passcode):
            api = probe()
            try:
                response = api.post("/api/login", data={"pass": passcode})
                body = response.json() if response.status == 200 else {}
                return response.status, body.get("role", "")
            finally:
                api.dispose()

        def anonymous(pathname):
            api = probe()
            try:
                return api.get(pathname).status
            finally:
                api.dispose()

        def expect_note(fragment, act):
            """Run a real click and wait for the panel to say what happened.

            On a timeout the panel's own words are the diagnosis, so they are read
            back into the failure rather than leaving a bare 'element never appeared'.
            """
            act()
            try:
                page.wait_for_function(
                    "expected => ((document.getElementById('pass-note')||{}).textContent||'').includes(expected)",
                    arg=fragment, timeout=15000)
            except Exception:
                note = page.locator("#pass-note").inner_text()
                state = page.locator("#settings-panel-state").inner_text()
                modal = page.locator("#modal").inner_text()[:200]
                raise AssertionError(
                    f"the passcode panel never reported {fragment!r} - it said {note!r} "
                    f"with panel state {state!r} and modal {modal!r}; console errors: {console_errors[-5:]}")
            return page.locator("#pass-note").inner_text()

        # ---- 1. an open install exposes the controls, empty ----------------
        open_access_panel()
        for selector in ("#cfg-epass", "#cfg-vpass"):
            control = page.locator(selector)
            assert control.count(), f"the Access & security panel is missing {selector}"
            assert control.get_attribute("type") == "password", f"{selector} must be a password input"
            assert control.input_value() == "", f"{selector} must not be pre-filled from the stored passcode"
            label = page.locator(f"label[for='{selector[1:]}']")
            assert label.count(), f"{selector} must carry a real label"
            checks += 1
        assert page.locator("#cfg-epass-state").inner_text().strip() == "Not set"
        assert page.locator("#cfg-vpass-state").inner_text().strip() == "Not set"
        save = page.locator("button:has-text('Save passcodes')")
        assert save.count() == 1, "there must be exactly one passcode save control"
        assert anonymous("/api/projects") == 200, "an install with no passcode must start open"
        checks += 1

        # ---- 2. saving a passcode through the real control -----------------
        page.fill("#cfg-epass", EDITOR_PASS)
        page.fill("#cfg-vpass", VIEWER_PASS)
        note = expect_note("Saved", save.click)
        assert "login.html" in note, f"turning authentication on must say where to sign in, got: {note}"
        assert page.locator("#cfg-epass").input_value() == "", "a stored passcode must not be left in the box"
        assert page.locator("#cfg-vpass").input_value() == ""
        assert page.locator("#cfg-epass-state").inner_text().strip() == "Set"
        assert page.locator("#cfg-vpass-state").inner_text().strip() == "Set"
        for secret in (EDITOR_PASS, VIEWER_PASS):
            assert secret not in page.content(), "a saved passcode must not remain anywhere in the page"
        checks += 1

        # The server now demands exactly what was typed, and nothing else.
        assert anonymous("/api/projects") == 401, "a protected request must be refused once a passcode is set"
        assert login("not-the-passcode")[0] == 401, "a wrong passcode must be refused"
        assert login(EDITOR_PASS) == (200, "editor"), "the typed editor passcode must admit an editor"
        assert login(VIEWER_PASS) == (200, "viewer"), "the typed viewer passcode must admit a viewer"
        checks += 1

        # A viewer session stays read-only; the existing role contract is untouched.
        viewer_api = probe()
        try:
            viewer_api.post("/api/login", data={"pass": VIEWER_PASS})
            assert viewer_api.get("/api/bible").status == 200, "a viewer must still read the Project Bible"
            assert viewer_api.get("/api/projects").status == 403, "a viewer must not reach the editor API"
        finally:
            viewer_api.dispose()
        checks += 1

        # ---- 3. signing in through the shipped form, and changing a passcode ----
        # A reload, not a goto: the browser is already sitting on #/settings, so only
        # a fresh document request can show that the server now demands a sign-in.
        page.reload(wait_until="domcontentloaded")
        # reload() already followed the redirect, so the landing URL is the evidence.
        assert "/login.html" in page.url, (
            f"a passcode-protected install must send an unauthenticated browser to the sign-in page, got {page.url}")
        page.wait_for_selector("#pass", timeout=15000)
        page.fill("#pass", EDITOR_PASS)
        page.click("button:has-text('ENTER CINEBRAID')")
        page.wait_for_function("() => !location.pathname.endsWith('login.html')", timeout=15000)
        checks += 1

        open_access_panel()
        assert page.locator("#cfg-epass-state").inner_text().strip() == "Set"
        assert page.locator("#cfg-epass").input_value() == "", "the panel must never repopulate a stored passcode"
        content = page.content()
        for secret in (EDITOR_PASS, VIEWER_PASS):
            assert secret not in content, "a signed-in Settings page must still not contain the stored passcodes"
        checks += 1

        page.fill("#cfg-epass", ROTATED_PASS)
        expect_note("Saved", page.locator("button:has-text('Save passcodes')").click)
        assert login(EDITOR_PASS)[0] == 401, "the previous passcode must stop working after a change"
        assert login(ROTATED_PASS) == (200, "editor"), "the changed passcode must be the one that works"
        assert login(VIEWER_PASS) == (200, "viewer"), "changing the editor passcode must not disturb the viewer one"
        checks += 1

        # ---- 4. blank means a choice, never a silent clear ------------------
        open_access_panel()
        page.locator("button:has-text('Save passcodes')").click()
        page.wait_for_selector("#modal:has-text('Editor passcode is blank')", timeout=15000)
        expect_note("Nothing changed", lambda: page.click("button:has-text('KEEP UNCHANGED')"))
        assert login(ROTATED_PASS) == (200, "editor"), "KEEP UNCHANGED must leave the stored passcode alone"
        assert anonymous("/api/projects") == 401, "and must leave authentication on"
        checks += 1

        page.locator("button:has-text('Save passcodes')").click()
        page.wait_for_selector("#modal:has-text('Editor passcode is blank')", timeout=15000)
        expect_note("no longer asks", lambda: page.click("button:has-text('TURN AUTH OFF')"))
        assert page.locator("#cfg-epass-state").inner_text().strip() == "Not set"
        assert anonymous("/api/projects") == 200, "an explicit TURN AUTH OFF must re-open the install"
        checks += 1

        assert not crashes, f"the passcode panel raised uncaught errors: {crashes}"
        fatal = [line for line in console_errors if "TypeError" in line or "is not a function" in line]
        assert not fatal, f"the passcode panel logged fatal console errors: {fatal}"
        browser.close()

    print(f"LAN passcode Settings real-browser audit passed: {checks} checks - the Access & security section was "
          "reached by clicking, both passcode controls rendered as empty password inputs, saving through the real "
          "button stored the typed editor and viewer passcodes and cleared the boxes, an unauthenticated request "
          "was then refused while a wrong passcode was rejected and the right one admitted an editor and a "
          "read-only viewer, signing in through /login.html reached Settings again with neither stored passcode "
          "present in the page, a changed passcode retired the old one, and a blank box cleared nothing without "
          "the explicit choice to switch authentication off.")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
