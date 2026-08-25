"""CineBraid — Public Alpha UX Slice 2, the on-screen half, in a real browser.

The Node suite (tests/bible-canon-export.js) proves what /api/bible ANSWERS. This
one proves what a filmmaker READS. They are different questions: the payload could
be perfectly canon-safe and the page could still print the appendix under an
approved heading, and no Node assertion would see it.

THE FIXTURE IS THE NODE SUITE'S OWN. It is written by calling
`writeRouteFixture()` out of tests/bible-canon-export.js rather than being
restated here, so the two suites cannot drift into testing different projects and
both report green. That fixture is the P0 exactly:

    frame A holds an approved image from R1, produced by prompt P1
    a targeted-repair draft (P2) sits in frame.generationPackages, unexecuted
    a continuity state carries a pointer nobody ever approved

WHAT IT ASSERTS, and every one of them is about the rendered DOM rather than the
payload: the approved prompt is on the page; the repair draft is on the page
NOWHERE; the unapproved pointer is inside the supporting section and inside no
canon section; the heading says CURRENT approved canon; and the two export
controls are one click each and produce the same canon the screen is showing.

Text is read with textContent, never from a screenshot: several of these headings
are uppercased by CSS, so the rendered casing and the DOM casing differ and only
one of them is the product's own words.

NO PROJECT DATA IS TOUCHED: the server runs against a disposable config and
projects root. NO PROVIDER OR PAID CALL IS MADE.
"""

import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from browser_runtime import require_browser, launch_chromium

LABEL = "Bible canon + export"
sync_playwright = require_browser(LABEL)

REPAIR_MARKERS = [
    "Repaint it oxide red",
    "Edit #image1 rather than creating a new composition",
    "CORRECT THE EXISTING FRAME",
]
APPROVED_PROMPT = "Wide hull-camera composition. The worker stands at the open panel"
UNAPPROVED_POINTER = "KAI_REJECTED.png"
CANON_SECTIONS = ["overview", "world", "characters", "locations", "props", "vehicles", "audio", "shots", "review-standard"]


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_for(port):
    for _ in range(300):
        try:
            with socket.create_connection(("127.0.0.1", port), 0.2):
                return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("server never came up")


def build_fixture(project_dir):
    """Written by the Node suite, so both halves test one project."""
    subprocess.run(
        [
            "node", "-e",
            "require('./tests/bible-canon-export.js').writeRouteFixture(process.argv[1])",
            str(project_dir),
        ],
        cwd=str(ROOT), check=True, stdout=subprocess.DEVNULL,
    )


temp = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-bible-browser-"))
projects_root = temp / "projects"
project_dir = projects_root / "canon-project"
project_dir.mkdir(parents=True)
build_fixture(project_dir)
config_path = temp / "config.json"
config_path.write_text(json.dumps({"activeProject": "canon-project", "providers": {}, "agents": {}}), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"],
    cwd=str(ROOT),
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path), "CINEBRAID_PROJECTS_ROOT": str(projects_root)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
checks = 0


def check(condition, message):
    global checks
    checks += 1
    assert condition, message


try:
    wait_for(port)
    base = f"http://127.0.0.1:{port}"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page = context.new_page()
        page.goto(base + "/bible.html", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("#shots .bible-shot", timeout=30000)

        body = page.evaluate("() => document.getElementById('bible').textContent")

        # 1. THE P0, ON THE PAGE. The approved prompt is shown; the unexecuted
        #    repair draft is shown nowhere at all.
        check(APPROVED_PROMPT in body, "the approved prompt must be on the page")
        for marker in REPAIR_MARKERS:
            check(marker not in body, f"the unexecuted repair draft must not be on the page: {marker!r}")

        # 2. The heading says CURRENT, not LATEST. "Latest" is the word that
        #    invited newest-wins in the first place.
        live_row = page.evaluate("() => document.querySelector('.bible-live-row').textContent")
        check("Current approved canon" in live_row, f"the live row must say current approved canon, read {live_row!r}")
        check("Latest" not in live_row, f"the live row must not say latest, read {live_row!r}")

        # 3. The frame's prompt block is headed as APPROVED, and it is the block
        #    that sits beside the approved image.
        frame_text = page.evaluate("() => document.querySelector('#shots .bible-frame-sequence article').textContent")
        check("APPROVED PROMPT" in frame_text, "the frame's prompt must be headed as the approved prompt")
        check(APPROVED_PROMPT in frame_text, "and must be the prompt that produced the approved image")
        check("R1.png" in frame_text, "beside the approved image it produced")

        # 4. A pointer nobody approved is in the supporting section and in no
        #    canon section. This is the separation the whole slice rests on.
        supporting = page.evaluate("() => document.getElementById('supporting').textContent")
        check(UNAPPROVED_POINTER in supporting, "the unapproved state pointer must be kept as supporting material")
        check("Historic — no current approval" in supporting, "and must carry a truthful status label")
        check("None of this is approved canon" in supporting, "the supporting section must say plainly that it is not canon")
        for section in CANON_SECTIONS:
            text = page.evaluate("id => (document.getElementById(id) || {}).textContent || ''", section)
            check(UNAPPROVED_POINTER not in text, f"the unapproved pointer must not appear in the {section} section")
            for marker in REPAIR_MARKERS:
                check(marker not in text, f"the repair draft must not appear in the {section} section")

        # 5. The approved continuity state IS in the canon section, so the
        #    separation is a filter and not a blanket.
        characters = page.evaluate("() => document.getElementById('characters').textContent")
        check("KAI_DEFAULT.png" in characters, "an approved state must still be published as canon")
        check("Work coat" in characters, "with its own name")

        # 6. The supporting section is subordinate: it comes after every canon
        #    section in document order.
        order = page.evaluate(
            "ids => ids.map(id => { const el = document.getElementById(id); return el ? [...document.querySelectorAll('#bible > section, #bible > .bible-overview')].indexOf(el) : -1; })",
            CANON_SECTIONS + ["supporting"],
        )
        check(order[-1] == max(order), f"supporting material must come last in the page, positions were {order}")

        # 7. THE EXPORT, through the control a filmmaker actually presses. One
        #    click, no dialog, no filename to type.
        for preset, expected_name in [
            ("bible-export-canon", "canon-test-project-bible.md"),
            ("bible-export-appendix", "canon-test-project-bible-with-appendix.md"),
        ]:
            with page.expect_download(timeout=30000) as caught:
                page.click("#" + preset)
            download = caught.value
            check(download.suggested_filename == expected_name,
                  f"{preset} must download {expected_name}, offered {download.suggested_filename}")
            target = temp / expected_name
            download.save_as(str(target))
            text = target.read_text(encoding="utf-8")
            check(APPROVED_PROMPT in text, f"{expected_name} must carry the approved prompt")
            for marker in REPAIR_MARKERS:
                check(marker not in text, f"{expected_name} must not carry the repair draft: {marker!r}")
            if preset == "bible-export-canon":
                check(UNAPPROVED_POINTER not in text, "Canon Only must not carry the unapproved pointer")
                canon_bytes = text
            else:
                check(UNAPPROVED_POINTER in text, "Canon + Appendix must carry it, labelled")
                check(text.startswith(canon_bytes), "and must share the canonical body byte for byte")

        # 8. What the screen shows and what the file says are the same canon.
        exported = urllib.request.urlopen(base + "/api/bible/export?preset=canon").read().decode("utf-8")
        check(exported == canon_bytes, "the downloaded file and the export route agree")
        check(("R1.png" in exported) == ("R1.png" in body), "screen and export agree on the approved image")
        browser.close()

    print(f"Bible canon real-browser suite passed {checks} checks: the approved prompt renders, the unexecuted repair "
          "draft renders nowhere, unapproved pointers sit only in a subordinate supporting section with truthful "
          "labels, the heading says current rather than latest, and both export presets download in one click "
          "carrying exactly the canon the screen is showing.")
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
    shutil.rmtree(temp, ignore_errors=True)
