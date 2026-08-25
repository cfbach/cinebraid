"""CineBraid — Public Alpha UX Slice 4, the on-screen half, in a real browser.

The Node suite (tests/launch-language-convergence.js) proves what the shot workspace
RENDERS into a fake document. This one proves what a filmmaker actually reads and
presses in Chromium, driving the shipped controls with real clicks.

They are different questions. The two guarantees that matter most in this slice cannot
be answered by a Node harness at all:

    1. WHAT THE WORD LOOKS LIKE. Several of these labels are uppercased by CSS, so the
       rendered casing and the DOM casing differ and only one of them is the product's
       own word. Every label here is read with textContent, never from a screenshot.

    2. WHAT HAPPENS IN PLACE. The L2 defect is a TRANSITION: a shot that was promoting
       motion goes on promoting it after the filmmaker marks it final. Proving that is
       fixed means finalising the shot with a real click and watching the promotion
       disappear from the same page, without a reload — which is exactly what a
       re-render bug would break and a fake document cannot see.

THE FIXTURE IS THE NODE SUITE'S OWN. It is written by calling `writeBrowserFixture()`
out of tests/launch-language-convergence.js rather than being restated here, so the two
halves cannot drift into testing different projects and both report green.

    LANG-A  approved still, nobody has finalised it
    LANG-B  the same shape, already marked final
    LANG-C  a shot declared r2v with its motion still to produce
    LANG-D  a returned candidate nobody has approved

WHAT IT ASSERTS, and every one is about the rendered DOM or a real click:

    A. Finish & Delivery offers "Mark shot final" first and "Send to finishing" second,
       and no control on it is named with a bare generic verb.
    B. Send to finishing opens a dialog that says it does not finalise the shot, and
       closing it leaves the shot un-delivered — the optional pass is optional.
    C. Marking the shot final IN PLACE removes the motion promotion from the same page
       with no reload, and the panel stops offering a second finalisation.
    D. A shot that was already delivered when the page loaded promotes no motion either.
    E. A shot declared r2v names reference-to-video as its method and carries Slice 1's
       own word on the button, never "Image-to-video" and never "CREATE MOTION".
    F. The approval dialog asks the filmmaker no filename question, and carries the
       derived name the way it carries the approval target.

Waits are on the REQUESTED THING — the attribute or element that proves the render
happened — never on a fixed sleep, which reads a stale DOM on a slow machine and looks
like a product bug.

NO PROJECT DATA IS TOUCHED: the server runs against a disposable config and projects
root. NO PROVIDER OR PAID CALL IS MADE.
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

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from browser_runtime import require_browser, launch_chromium

LABEL = "Launch language convergence"
sync_playwright = require_browser(LABEL)

APPROVED = "LANG-A"
DELIVERED = "LANG-B"
REFERENCE = "LANG-C"
CANDIDATE = "LANG-D"


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
            "require('./tests/launch-language-convergence.js').writeBrowserFixture(process.argv[1])",
            str(project_dir),
        ],
        cwd=str(ROOT), check=True, stdout=subprocess.DEVNULL,
    )


temp = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-language-browser-"))
projects_root = temp / "projects"
project_dir = projects_root / "language-project"
project_dir.mkdir(parents=True)
build_fixture(project_dir)
config_path = temp / "config.json"
config_path.write_text(
    json.dumps({"activeProject": "language-project", "providers": {}, "agents": {}}),
    encoding="utf-8",
)

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"],
    cwd=str(ROOT),
    env={
        **os.environ,
        "PORT": str(port),
        "CINEBRAID_CONFIG_PATH": str(config_path),
        "CINEBRAID_PROJECTS_ROOT": str(projects_root),
    },
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
checks = 0
findings = []


def check(condition, message):
    global checks
    checks += 1
    assert condition, message


def open_shot(page, base, shot_id):
    """A full load rather than a hash hop: a hash change does not reload, and a suite
    that assumes it does reads the previous shot's DOM and calls it this shot's."""
    page.goto(f"{base}/#/shot/{shot_id}", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_selector(".bounded-shot-workspace", timeout=30000)
    page.wait_for_function(
        "id => (document.querySelector('.bounded-shot-workspace .crumb') || {}).textContent?.includes(id)",
        arg=shot_id, timeout=30000,
    )


def select_stage(page, stage_id, ready_selector):
    """Through the shipped stage bar, with a real click, waiting for the workspace the
    stage declares rather than for a duration."""
    button = page.locator(f'.focused-task-button[data-stage-id="{stage_id}"]').first
    button.click()
    page.wait_for_selector(f'[data-selected-task="{stage_id}"]', timeout=15000)
    page.wait_for_selector(ready_selector, timeout=15000)


def open_finish_panel(page):
    """The panel is a <details> that remembers whether it was open. Force it open so the
    assertion is about what it SAYS, not about what somebody last left folded."""
    select_stage(page, "deliver", 'details[data-guided-panel="finish"]')
    page.evaluate("""() => {
        const panel = document.querySelector('details[data-guided-panel="finish"]');
        if (panel) panel.open = true;
    }""")
    page.wait_for_selector('details[data-guided-panel="finish"][open]', timeout=15000)


def finish_controls(page):
    """Labels in DOM order, read with textContent: several of these are uppercased by
    CSS, and the rendered casing is not the product's own word."""
    return page.evaluate("""() => {
        const panel = document.querySelector('details[data-guided-panel="finish"]');
        if (!panel) return null;
        return {
            labels: [...panel.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean),
            decisionLabels: [...panel.querySelectorAll('button')]
                .map((b) => (b.textContent || '').trim())
                .filter((t) => /final|finish/i.test(t)),
            calls: [...panel.querySelectorAll('button')].map((b) => b.getAttribute('onclick') || ''),
            text: (panel.textContent || '').replace(/\\s+/g, ' ').trim(),
        };
    }""")


def frames_promotion(page):
    select_stage(page, "frames", ".shot-frames-workspace")
    return page.evaluate("""() => {
        const workspace = document.querySelector('.shot-frames-workspace');
        const cta = document.querySelector('.frames-to-motion-cta');
        return {
            hasCta: !!cta,
            ctaText: cta ? (cta.textContent || '').replace(/\\s+/g, ' ').trim() : '',
            ctaButton: cta ? ((cta.querySelector('button') || {}).textContent || '').trim() : '',
            workspaceText: workspace ? (workspace.textContent || '').replace(/\\s+/g, ' ').trim() : '',
        };
    }""")


def delivery_truth(page, shot_id):
    """Asked of the one owner, in the page's own realm. `P` is a lexical script global
    and is deliberately not read off `window`, where it does not exist."""
    return page.evaluate(
        "id => { const shot = P.shots.find((row) => row.id === id);"
        " return { final: shotDeliveryAuthority(P, shot).final,"
        " receipt: !!currentHumanAuthority(P, { kind: 'shot-delivery', shotId: id }),"
        " action: (shotReadinessFor(shot) || {}).nextAction?.code || '' }; }",
        shot_id,
    )


try:
    wait_for(port)
    base = f"http://127.0.0.1:{port}"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1440, "height": 950})

        # ---- A. TWO DECISIONS, TWO NAMES, PRIMARY FIRST ----------------------
        open_shot(page, base, APPROVED)
        before = delivery_truth(page, APPROVED)
        check(before["final"] is False and before["receipt"] is False,
              f"A: precondition — {APPROVED} is not delivered, got {before}")
        check(before["action"] == "mark-shot-final",
              f"A: precondition — readiness hands off to the finalisation decision, got {before['action']}")

        open_finish_panel(page)
        controls = finish_controls(page)
        check(controls is not None, "A: Finish & Delivery rendered")
        check(controls["decisionLabels"] == ["Mark shot final", "Send to finishing"],
              f"A: the finalisation decision must come first and the optional pass second, got {controls['decisionLabels']}")
        for banned in ("Finish", "Finalize", "Finalise", "Complete", "Done"):
            check(banned not in controls["labels"],
                  f'A: no control in Finish & Delivery may be labelled exactly "{banned}", got {controls["labels"]}')
        check("Finishing is optional" in controls["text"],
              f"A: the panel must say finishing is optional, got: {controls['text'][:200]}")
        findings.append("A: Finish & Delivery offered Mark shot final then Send to finishing, with no bare generic verb")

        # ---- B. SENDING TO FINISHING FINALISES NOTHING -----------------------
        page.locator('details[data-guided-panel="finish"] button', has_text="Send to finishing").first.click()
        page.wait_for_selector("#modal .modal-box", timeout=15000)
        dialog = page.evaluate("() => (document.querySelector('#modal .modal-box').textContent || '').replace(/\\s+/g, ' ').trim()")
        check("Send to finishing" in dialog,
              f"B: the dialog carries the same name as the control that opened it, got: {dialog[:200]}")
        check("does not mark the shot final" in dialog.lower(),
              f"B: and says what it does not do, got: {dialog[:200]}")
        after_dialog = delivery_truth(page, APPROVED)
        check(after_dialog["final"] is False and after_dialog["receipt"] is False,
              f"B: opening the finishing dialog delivers nothing, got {after_dialog}")
        page.locator("#modal .modal-box button", has_text="Cancel").first.click()
        page.wait_for_function("() => document.getElementById('modal').classList.contains('hidden')", timeout=15000)
        findings.append("B: Send to finishing opened a dialog that names itself, says it does not finalise, and wrote no delivery")

        # ---- C. MARKING FINAL REMOVES THE MOTION PROMOTION, IN PLACE ---------
        promotion_before = frames_promotion(page)
        check(promotion_before["hasCta"] is True,
              "C: precondition — an approved, unfinalised shot does promote the motion handoff")
        check("CREATE MOTION" not in promotion_before["workspaceText"],
              f"C: and it no longer uses the retired third spelling, got {promotion_before['ctaButton']!r}")

        # A marker that only survives if the page never reloaded. The defect this proves
        # fixed is a re-render defect, so a reload would answer a different question.
        page.evaluate("() => { window.__langMarker = 'in-place'; }")
        open_finish_panel(page)
        page.locator('details[data-guided-panel="finish"] button', has_text="Mark shot final").first.click()
        page.wait_for_function("id => shotDeliveryAuthority(P, P.shots.find((row) => row.id === id)).final === true",
                               arg=APPROVED, timeout=15000)
        check(page.evaluate("() => window.__langMarker") == "in-place",
              "C: the finalisation happened in place — the page must not have reloaded")

        after_final = delivery_truth(page, APPROVED)
        check(after_final["final"] is True and after_final["receipt"] is True,
              f"C: Mark shot final wrote the delivery receipt, got {after_final}")
        check(after_final["action"] == "nothing-outstanding",
              f"C: and readiness reports nothing outstanding, got {after_final['action']}")

        open_finish_panel(page)
        after_controls = finish_controls(page)
        check(after_controls["decisionLabels"] == ["Send to finishing"],
              f"C: a final shot is offered no second finalisation, got {after_controls['decisionLabels']}")
        check("Marked final" in after_controls["text"],
              f"C: and shows the decision that was taken, got: {after_controls['text'][:200]}")

        promotion_after = frames_promotion(page)
        check(promotion_after["hasCta"] is False,
              f"C: a shot just marked final promotes no motion, got {promotion_after['ctaText'][:160]!r}")
        for promotion in ("CREATE MOTION", "Create motion", "PRODUCE THE MOTION", "OPEN MOTION"):
            check(promotion not in promotion_after["workspaceText"],
                  f'C: and never renders "{promotion}" in Frames')
        findings.append("C: marking the shot final in one click removed the motion promotion from the same page, with no reload")

        # ---- D. A SHOT THAT LOADED DELIVERED PROMOTES NOTHING EITHER ---------
        open_shot(page, base, DELIVERED)
        delivered = delivery_truth(page, DELIVERED)
        check(delivered["final"] is True, f"D: precondition — {DELIVERED} loaded already delivered, got {delivered}")
        loaded_promotion = frames_promotion(page)
        check(loaded_promotion["hasCta"] is False,
              f"D: a delivered shot promotes no motion on first paint either, got {loaded_promotion['ctaText'][:160]!r}")
        open_finish_panel(page)
        delivered_controls = finish_controls(page)
        check(delivered_controls["decisionLabels"] == ["Send to finishing"],
              f"D: and is offered only the optional pass, got {delivered_controls['decisionLabels']}")
        findings.append("D: a shot delivered before the page loaded promotes no motion and is offered no second finalisation")

        # ---- E. R2V IS NAMED AS WHAT IT IS ----------------------------------
        open_shot(page, base, REFERENCE)
        reference_truth = delivery_truth(page, REFERENCE)
        check(reference_truth["action"] == "produce-motion",
              f"E: precondition — readiness asks {REFERENCE} for motion, got {reference_truth['action']}")
        slice1_word = page.evaluate(
            "id => readinessActionWords(shotReadinessFor(P.shots.find((row) => row.id === id)).nextAction)",
            REFERENCE,
        )
        reference_promotion = frames_promotion(page)
        check(reference_promotion["hasCta"] is True, "E: outstanding required motion is still promoted")
        check(reference_promotion["ctaButton"] == f"{slice1_word.upper()} →",
              f"E: the button carries Slice 1's own word for the action, expected {slice1_word.upper()!r}, got {reference_promotion['ctaButton']!r}")
        check("Animate using references" in reference_promotion["ctaText"],
              f"E: and the handoff names reference-to-video as the method, got {reference_promotion['ctaText'][:200]!r}")
        for wrong in ("Image-to-video", "Animate between frames", "Animate from first frame", "CREATE MOTION"):
            check(wrong not in reference_promotion["workspaceText"],
                  f'E: a reference-to-video shot is never described as "{wrong}"')
        findings.append(f"E: the r2v shot named its own method and carried Slice 1's word {slice1_word!r} on the button")

        # ---- F. THE APPROVAL DIALOG ASKS NO FILENAME QUESTION ---------------
        open_shot(page, base, CANDIDATE)
        opened = page.evaluate("""() => {
            const control = [...document.querySelectorAll('button[onclick]')]
                .find((b) => /approveGuidedStill\\(|approveGuidedFrame\\(|approveTake\\(/.test(b.getAttribute('onclick') || ''));
            if (!control) return '';
            control.scrollIntoView();
            return control.getAttribute('onclick');
        }""")
        check(bool(opened), "F: the workspace offers an approval control for the returned candidate")
        page.locator("button[onclick*='approveGuidedStill('], button[onclick*='approveGuidedFrame('], button[onclick*='approveTake(']").first.click()
        page.wait_for_selector("#modal .modal-box", timeout=15000)
        approval = page.evaluate("""() => {
            const box = document.querySelector('#modal .modal-box');
            const name = box.querySelector('#approve-name');
            return {
                text: (box.textContent || '').replace(/\\s+/g, ' ').trim(),
                labels: [...box.querySelectorAll('label')].map((l) => (l.textContent || '').trim()),
                nameType: name ? (name.getAttribute('type') || '') : '',
                nameValue: name ? name.value : '',
                nameVisible: name ? !!(name.offsetWidth || name.offsetHeight || name.getClientRects().length) : false,
            };
        }""")
        check("canonical filename" not in approval["text"].lower(),
              f"F: the approval dialog asks no filename question, got: {approval['text'][:220]}")
        check(not any("filename" in label.lower() for label in approval["labels"]),
              f"F: and no label offers one, got {approval['labels']}")
        check(approval["nameType"] == "hidden",
              f"F: the derived name is carried the way the approval target is, got type={approval['nameType']!r}")
        check(approval["nameVisible"] is False, "F: and it is not something a filmmaker can see or type into")
        check(approval["nameValue"].endswith(".png") and CANDIDATE in approval["nameValue"],
              f"F: the carried value is the deterministic one, got {approval['nameValue']!r}")
        findings.append("F: the approval dialog asked no filename question and carried the derived name in a hidden field")

        browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except Exception:
        server.kill()
    shutil.rmtree(temp, ignore_errors=True)

for line in findings:
    print("  " + line)
print(f"Launch language convergence real-browser audit passed {checks} assertions in Chromium.")
print("No project data touched, no provider or paid call made.")
