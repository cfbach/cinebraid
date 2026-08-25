"""CineBraid — Public Alpha UX Slice 3, the on-screen half, in a real browser.

The Node suite (tests/returned-media-ownership.js) proves what the projection ANSWERS
and what the shot workspace RENDERS into a fake document. This one proves what a
filmmaker actually gets in Chromium, driving the shipped controls with real clicks.

They are different questions. Every guarantee here rests on script load order, on lexical
browser globals that are not on `window`, and on a re-render happening after a click —
three things a Node harness cannot see and all three of which have broken this product
before.

THE FIXTURE IS THE NODE SUITE'S OWN. It is written by calling `writeBrowserFixture()` out
of tests/returned-media-ownership.js rather than being restated here, so the two halves
cannot drift into testing different projects and both report green.

    SH-A   one returned candidate, and a reference nobody has confirmed
           — the shot that used to open asking to confirm the reference
    SH-B   a candidate and the targeted repair of it
           — the two peers that used to arrive with no relationship between them

WHAT IT ASSERTS, and every one is about the rendered DOM or a real click:

    A. SH-A opens with the returned candidate owning the primary card, its media on
       screen, and the reference confirmation present-but-secondary with a working
       control. This is the audit's first reproduction, from the filmmaker's side.
    B. SH-B opens on the REPAIR, declares itself a repair, and carries the take it
       repaired as Before — with that take's own image, comparable without leaving
       the page.
    C. Deciding the returned result through the shipped control advances the queue
       truthfully: SH-A's card hands back to readiness, and Production's count drops.

Text is read with textContent, never from a screenshot: several of these headings are
uppercased by CSS, so the rendered casing and the DOM casing differ and only one of them
is the product's own words.

Waits are on the REQUESTED THING — the attribute that proves the render happened — never
on a fixed sleep, which reads a stale DOM on a slow machine and looks like a product bug.

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

LABEL = "Returned media ownership"
sync_playwright = require_browser(LABEL)

SHOT_A = "SH-A"
SHOT_B = "SH-B"
CANDIDATE_A = "SH-A_FRAME_A_FAL_1.png"
PARENT_B = "SH-B_FRAME_A_FAL_1.png"
REPAIR_B = "SH-B_FRAME_A_CORRECTION_FAL_1.png"


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
            "require('./tests/returned-media-ownership.js').writeBrowserFixture(process.argv[1])",
            str(project_dir),
        ],
        cwd=str(ROOT), check=True, stdout=subprocess.DEVNULL,
    )


temp = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-returned-browser-"))
projects_root = temp / "projects"
project_dir = projects_root / "returned-project"
project_dir.mkdir(parents=True)
build_fixture(project_dir)
config_path = temp / "config.json"
config_path.write_text(
    json.dumps({"activeProject": "returned-project", "providers": {}, "agents": {}}),
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
    """Full load rather than a hash hop: a hash change does not reload, and a suite that
    assumes it does reads the previous shot's DOM and calls it this shot's."""
    page.goto(f"{base}/#/shot/{shot_id}", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_selector(".guided-next-action", timeout=30000)
    page.wait_for_function(
        "id => (document.querySelector('.bounded-shot-workspace .crumb') || {}).textContent?.includes(id)",
        arg=shot_id, timeout=30000,
    )


def card_state(page):
    return page.evaluate("""() => {
        const card = document.querySelector('.guided-next-action');
        if (!card) return null;
        const primary = card.querySelector('.shot-primary-action');
        return {
            returnedReview: card.dataset.returnedReview === '1',
            key: card.dataset.returnedReviewKey || '',
            file: card.dataset.returnedReviewFile || '',
            owner: card.dataset.returnedReviewOwner || '',
            unit: card.dataset.returnedReviewUnit || '',
            waiting: card.dataset.returnedReviewWaiting || '',
            repair: card.dataset.returnedReviewRepair === '1',
            readiness: card.dataset.shotReadiness || '',
            headline: (card.querySelector('h2') || {}).textContent || '',
            body: (card.querySelector('p') || {}).textContent || '',
            primaryLabel: primary ? primary.textContent.trim() : '',
            primaryCount: document.querySelectorAll('.shot-primary-action').length,
            actions: [...card.querySelectorAll('[data-returned-review-action]')]
                .map((b) => ({ id: b.dataset.returnedReviewAction, label: b.textContent.trim() })),
            heroSrc: (card.querySelector('.guided-lifecycle-preview img') || {}).getAttribute?.('src') || '',
            heroCall: (card.querySelector('.guided-lifecycle-preview [onclick]') || {}).getAttribute?.('onclick') || '',
            // The readiness code lives on the secondary block itself, not on the card:
            // it describes that block. Read it from the element it is on.
            secondary: (card.querySelector('.returned-review-secondary') || {}).dataset?.returnedReviewSecondary || '',
            secondaryText: (card.querySelector('.returned-review-secondary') || {}).textContent || '',
            secondaryControl: (card.querySelector('.returned-review-secondary .chip') || {}).getAttribute?.('onclick') || '',
            compares: [...card.querySelectorAll('[data-returned-review-compare]')].map((el) => ({
                kicker: el.dataset.returnedReviewCompare,
                text: el.textContent,
                src: (el.querySelector('img') || {}).getAttribute?.('src') || '',
            })),
        };
    }""")


try:
    wait_for(port)
    base = f"http://127.0.0.1:{port}"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()

        # ---- PRECONDITION: the module actually loaded in a real browser -----------
        # Script order and lexical globals are exactly what Node cannot check. A
        # projection that silently failed to load would report nothing waiting, which
        # looks identical to a project with nothing waiting.
        page.goto(f"{base}/#/production", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector(".production-next", timeout=30000)
        loaded = page.evaluate("""() => ({
            projection: typeof returnedReviewProjection,
            pending: typeof pendingReturnedReview,
            context: typeof candidateReviewContext,
            browserCall: typeof returnedReviewProjectionForBrowser,
        })""")
        for name, kind in loaded.items():
            check(kind == "function", f"precondition: {name} must be a function in the browser, was {kind!r}")

        # ---- A. RETURNED CANDIDATE + OUTSTANDING REFERENCE CONFIRMATION ----------
        production = page.evaluate("""() => {
            const next = projectNextProductionAction();
            const projection = returnedReviewProjectionForBrowser();
            return {
                label: next.actionLabel, href: next.href, shotId: next.shotId, reviewKey: next.reviewKey,
                awaiting: projection.counts.awaiting,
                queue: projection.queue.map((row) => row.shotId + ':' + row.candidate.name),
                readiness: (shotReadinessFor(shotById('SH-A')) || {}).nextAction?.code || '',
            };
        }""")
        check(production["awaiting"] == 3, f"precondition: three returned candidates are waiting, saw {production['awaiting']}")
        check(production["readiness"] == "confirm-existing-reference",
              f"precondition: SH-A's readiness is the reference confirmation, was {production['readiness']!r}")
        check(production["label"] == "REVIEW RETURNED RESULT",
              f"A. Production's primary action must be to review the returned result, read {production['label']!r}")
        check(production["shotId"] == SHOT_A and production["href"] == f"#/shot/{SHOT_A}",
              f"A. and it must route to the owning shot: {production}")

        open_shot(page, base, SHOT_A)
        card = card_state(page)
        check(card is not None, "A. the shot workspace must render a primary card")
        check(card["returnedReview"], f"A. the returned candidate must own the card, it read {card['headline']!r}")
        check(card["file"] == CANDIDATE_A, f"A. and must be the exact returned candidate, was {card['file']!r}")
        check(card["key"] == production["reviewKey"],
              f"A. the card must resolve the same candidate Production named: {card['key']!r} vs {production['reviewKey']!r}")
        check(card["owner"] == "shot-frame" and card["unit"] == "frame-a",
              f"A. named with its owning unit: {card}")
        check("came back and needs your decision" in card["body"],
              f"A. the card must say what the filmmaker is looking at, read {card['body']!r}")
        check(CANDIDATE_A in card["heroSrc"],
              f"A. the returned image itself must be on the card, src was {card['heroSrc']!r}")
        check("inspectMediaFile" in card["heroCall"],
              f"A. and it must hand off to the Inspector rather than only enlarging: {card['heroCall']!r}")
        check(card["primaryCount"] == 1, f"A. exactly one primary action, saw {card['primaryCount']}")
        check([a["id"] for a in card["actions"]] == ["approve", "revise", "reject"],
              f"A. the candidate's own decisions must be on the card: {card['actions']}")

        # NOT ERASED. The reference confirmation is demoted, keeps its canonical words,
        # and keeps a control that performs it.
        check(card["secondary"] == "confirm-existing-reference",
              f"A. the reference confirmation must remain as secondary context, was {card['secondary']!r}")
        check("Confirm existing reference" in card["secondaryText"],
              f"A. in its canonical words, read {card['secondaryText']!r}")
        check("KAI-ANCHOR.png" in card["secondaryText"],
              f"A. with its canonical explanation, read {card['secondaryText']!r}")
        check("openShotReadinessAction" in card["secondaryControl"],
              f"A. and a working control, so nothing became unreachable: {card['secondaryControl']!r}")
        check("Confirm existing reference" not in card["headline"],
              f"A. but it must not be the headline, which read {card['headline']!r}")
        findings.append(
            f"A. {SHOT_A} opened on {card['file']} with {card['primaryCount']} primary action "
            f"({card['primaryLabel']!r}) and the reference confirmation demoted to secondary")

        # ---- B. THE TARGETED REPAIR CARRIES ITS PARENT ---------------------------
        open_shot(page, base, SHOT_B)
        repair = card_state(page)
        check(repair["returnedReview"], f"B. the repair must own the card, it read {repair['headline']!r}")
        check(repair["file"] == REPAIR_B, f"B. and the REPAIR must lead, not the take it repaired: {repair['file']!r}")
        check(repair["repair"], "B. the card must declare that it is looking at a repair")
        check(f"a repair of {PARENT_B}" in repair["body"],
              f"B. and must say what it repaired, read {repair['body']!r}")
        before = [c for c in repair["compares"] if c["kicker"] == "before"]
        check(len(before) == 1, f"B. the take being repaired must be on the card as Before: {repair['compares']}")
        check(PARENT_B in before[0]["text"], f"B. named: {before[0]['text']!r}")
        check(PARENT_B in before[0]["src"],
              f"B. with its own image, comparable without leaving the page: {before[0]['src']!r}")
        check("Composition" in before[0]["text"],
              f"B. alongside what the repair was asked to fix: {before[0]['text']!r}")
        check(REPAIR_B in repair["heroSrc"], f"B. while the repaired result is the hero: {repair['heroSrc']!r}")
        findings.append(
            f"B. {SHOT_B} opened on the repair {repair['file']} with {PARENT_B} shown as Before "
            f"and the recorded correction intent beside it")

        # ---- C. DECIDING ADVANCES THE QUEUE TRUTHFULLY ---------------------------
        # Through the shipped control, with a real click, and the wait is on the state
        # that proves the re-render happened rather than on a timer.
        open_shot(page, base, SHOT_A)
        page.click('[data-returned-review-action="reject"]')
        page.wait_for_function(
            "() => !document.querySelector('.guided-next-action[data-returned-review=\"1\"]')",
            timeout=30000,
        )
        after = card_state(page)
        check(not after["returnedReview"], "C. once decided, the returned review releases the workspace")
        check("Confirm existing reference" in after["headline"],
              f"C. and the shot's real next action takes the card: {after['headline']!r}")
        check(after["primaryCount"] == 1, f"C. still exactly one primary action, saw {after['primaryCount']}")
        state = page.evaluate("""() => {
            const projection = returnedReviewProjectionForBrowser();
            const shot = P.shots.find((row) => row.id === 'SH-A');
            const row = (shot.candidateFiles || []).find((item) => (item.stored || item.name) === 'SH-A_FRAME_A_FAL_1.png');
            return {
                awaiting: projection.counts.awaiting,
                queue: projection.queue.map((r) => r.shotId + ':' + r.candidate.name),
                rows: (shot.candidateFiles || []).length,
                decision: row ? row.decision : '(row gone)',
                returned: returnedResultsAwaitingReview().reduce((sum, r) => sum + (r.shot ? r.count : 0), 0),
                next: projectNextProductionAction(),
            };
        }""")
        check(state["decision"] == "rejected", f"C. the decision was written to the exact candidate: {state['decision']!r}")
        check(state["rows"] == 1, f"C. and the candidate stays in history rather than being deleted: {state['rows']}")
        check(state["awaiting"] == 2, f"C. the queue drops by exactly one, to {state['awaiting']}")
        check(state["returned"] == state["awaiting"],
              f"C. and Returned Results agrees, because it reads the same array: {state['returned']} vs {state['awaiting']}")
        check(all(not row.startswith("SH-A:") for row in state["queue"]),
              f"C. the decided candidate does not come back round: {state['queue']}")
        check(state["next"]["shotId"] == SHOT_B,
              f"C. and Production moves on to the next legitimate review: {state['next']['shotId']!r}")
        findings.append(
            f"C. rejecting through the shipped control left the row in history as {state['decision']!r}, "
            f"dropped the queue to {state['awaiting']} and moved Production on to {state['next']['shotId']}")

        context.close()
        browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
    shutil.rmtree(temp, ignore_errors=True)

for line in findings:
    print(line)
print(f"returned-media-ownership-real-browser: {checks} browser assertions passed")
