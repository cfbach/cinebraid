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

    SH-A   two returned candidates, and a reference nobody has confirmed
           — the shot that used to open asking to confirm the reference, and the shot
             a stale link can go stale against
    SH-B   a candidate and the targeted repair of it, both under long generated names
           — the two peers that used to arrive with no relationship between them
    SH-C   a candidate row the project records as undecided whose file was never written
           — the result that used to vanish and let PRODUCE THE FRAME take the card

WHAT IT ASSERTS, and every one is about the rendered DOM or a real click:

    A. SH-A opens with the returned candidate owning the primary card, its media on
       screen, and the reference confirmation present-but-secondary with a working
       control. This is the audit's first reproduction, from the filmmaker's side.
    B. SH-B opens on the REPAIR, declares itself a repair, and carries the take it
       repaired as Before — with that take's own image, comparable without leaving
       the page.
    D. At 1280 the compact Before filename stays readable: nothing clipped, no
       ellipsis, and wrapped to a measure rather than a ribbon. Includes NC-RM17,
       a behavioural control that puts nowrap + ellipsis back through real CSS and
       measures how much of the name it hides.
    E. Production's action carries the candidate it names, in the route, and clicking
       it lands on that exact candidate.
    F. Deciding that candidate stops the claim being honoured IN PLACE — no reload —
       and the stale link explains itself instead of substituting the other pending
       candidate. The decision is written to the exact row and stays in history.
    G. Continuing is an explicit act that claims the next candidate by name.
    H. A recorded result with no bytes renders the integrity state: no candidate
       decision, no generation promoted, and the readiness action still secondary.

Text is read with textContent, never from a screenshot: several of these headings are
uppercased by CSS, so the rendered casing and the DOM casing differ and only one of them
is the product's own words.

Waits are on the REQUESTED THING — the attribute that proves the render happened — never
on a fixed sleep, which reads a stale DOM on a slow machine and looks like a product bug.

NO PROJECT DATA IS TOUCHED: the server runs against a disposable config and projects
root. NO PROVIDER OR PAID CALL IS MADE.
"""

import json
import urllib.parse
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
SHOT_C = "SH-C"
CANDIDATE_A = "SH-A_FRAME_A_FAL_1.png"
CANDIDATE_A2 = "SH-A_FRAME_B_FAL_1.png"
PARENT_B = "SH-B_FRAME_A_GPT_IMAGE_2_HIGH_2048x1152_ROUND_01_FAL_1.png"
REPAIR_B = "SH-B_FRAME_A_CORRECTION_GPT_IMAGE_2_HIGH_2048x1152_ROUND_02_FAL_1.png"
MISSING_C = "SH-C_FRAME_A_FAL_1.png"


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
            stale: card.dataset.returnedReviewStale === '1',
            unavailable: card.dataset.returnedReviewUnavailable === '1',
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
            const keyFor = (name) => (projection.items.find((row) => row.candidate.name === name) || {}).key || '';
            return {
                label: next.actionLabel, href: next.href, shotId: next.shotId, reviewKey: next.reviewKey,
                awaiting: projection.counts.awaiting,
                queue: projection.queue.map((row) => row.shotId + ':' + row.candidate.name),
                readiness: (shotReadinessFor(shotById('SH-A')) || {}).nextAction?.code || '',
                // IDENTITY-FIRST. Against a real server these files carry LEDGER ids, so a
                // hardcoded `path:` key would be asserting the fallback domain rather than
                // the one the projection actually mints. Read what it minted.
                headKey: keyFor('SH-A_FRAME_A_FAL_1.png'),
                secondKey: keyFor('SH-A_FRAME_B_FAL_1.png'),
            };
        }""")
        check(production["awaiting"] == 4, f"precondition: four returned candidates are waiting, saw {production['awaiting']}")
        check(production["readiness"] == "confirm-existing-reference",
              f"precondition: SH-A's readiness is the reference confirmation, was {production['readiness']!r}")
        check(production["label"] == "REVIEW RETURNED RESULT",
              f"A. Production's primary action must be to review the returned result, read {production['label']!r}")
        check(production["shotId"] == SHOT_A, f"A. and it must route to the owning shot: {production}")
        check(production["reviewKey"] == production["headKey"],
              f"A. naming the candidate that owns the review: {production['reviewKey']!r}")
        check(production["href"] == f"#/shot/{SHOT_A}/review/" + urllib.parse.quote(production["headKey"], safe=""),
              f"A. and carrying that identity in the route: {production['href']!r}")

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

        # ---- D. 1280 WIDE: THE BEFORE FILENAME STAYS READABLE ------------------
        # The independent review found the compact Before card carrying nowrap +
        # ellipsis, which at a realistic 1280 turns a generated correction filename into
        # an unusable token in the one place whose entire job is saying WHICH take is
        # being repaired. Measured against real shipped CSS, not against source text.
        page.set_viewport_size({"width": 1280, "height": 900})
        open_shot(page, base, SHOT_B)
        before_metrics = page.evaluate("""() => {
            const el = document.querySelector('[data-returned-review-compare="before"] small');
            if (!el) return null;
            const s = getComputedStyle(el);
            return {
                text: el.textContent,
                whiteSpace: s.whiteSpace,
                textOverflow: s.textOverflow,
                overflowWrap: s.overflowWrap,
                clippedBy: el.scrollWidth - el.clientWidth,
                lines: Math.round(el.getBoundingClientRect().height / parseFloat(s.lineHeight || '14')),
                cardWidth: Math.round(document.querySelector('[data-returned-review-compare="before"]').getBoundingClientRect().width),
                // The card's own geometry, because a filename that wraps inside a 104px
                // column is unclipped and still unreadable.
                bodyWidth: Math.round(document.querySelector('.guided-next-action').children[1].getBoundingClientRect().width),
                chipRight: Math.round(document.querySelector('[data-returned-review-compare="before"]').getBoundingClientRect().right),
                cardRight: Math.round(document.querySelector('.guided-next-action').getBoundingClientRect().right),
                sentenceLines: Math.round(document.querySelector('.guided-next-action p').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('.guided-next-action p')).lineHeight)),
                docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        }""")
        check(before_metrics is not None, "D. the Before card must render at 1280")
        check(before_metrics["text"] == PARENT_B,
              f"D. and must carry the whole filename, read {before_metrics['text']!r}")
        check(before_metrics["clippedBy"] <= 1,
              f"D. with nothing clipped horizontally, over by {before_metrics['clippedBy']}px")
        check(before_metrics["whiteSpace"] != "nowrap",
              f"D. it must not be nowrap, computed {before_metrics['whiteSpace']!r}")
        check(before_metrics["textOverflow"] != "ellipsis",
              f"D. and must not ellipsise, computed {before_metrics['textOverflow']!r}")
        check(before_metrics["overflowWrap"] in ("anywhere", "break-word"),
              f"D. it wraps instead, computed {before_metrics['overflowWrap']!r}")
        check(before_metrics["lines"] >= 2,
              f"D. so a long name genuinely occupies more than one line ({before_metrics['lines']})")
        # AND IT WRAPS TO A READABLE MEASURE, not to a ribbon. `overflow-wrap:anywhere`
        # drops the text column's min-content width to one character, so a chip left to
        # shrink freely collapses and the name wraps eleven times — technically unclipped
        # and just as unreadable as the ellipsis it replaced.
        check(before_metrics["lines"] <= 4,
              f"D. and wraps to a readable measure rather than a ribbon ({before_metrics['lines']} lines)")
        check(before_metrics["bodyWidth"] >= 240,
              f"D. because the card keeps a measure for its text, {before_metrics['bodyWidth']}px")
        check(before_metrics["sentenceLines"] <= 9,
              f"D. so the sentence beside it is not a ribbon either ({before_metrics['sentenceLines']} lines)")
        check(before_metrics["chipRight"] <= before_metrics["cardRight"],
              f"D. and the Before chip stays inside the card ({before_metrics['chipRight']} vs {before_metrics['cardRight']})")
        check(before_metrics["docOverflow"] <= 0,
              f"D. with nothing pushed off the page ({before_metrics['docOverflow']}px)")
        # AND THE CARD IS STILL COMPACT. Wrapping must not have turned the Before chip
        # into a comparison editor.
        check(before_metrics["cardWidth"] <= 400,
              f"D. while the Before card stays compact at {before_metrics['cardWidth']}px")

        # ---- NC-RM17: THE SAME MEASUREMENT, WITH THE CLIPPING PUT BACK ----------
        # A behavioural control against real CSS: apply the rule the review found, prove
        # the filename becomes unreadable, then prove the shipped rule does not.
        clipped = page.evaluate("""() => {
            const el = document.querySelector('[data-returned-review-compare="before"] small');
            const before = el.getAttribute('style') || '';
            el.style.whiteSpace = 'nowrap';
            el.style.textOverflow = 'ellipsis';
            el.style.overflow = 'hidden';
            el.style.overflowWrap = 'normal';
            const over = el.scrollWidth - el.clientWidth;
            const shown = Math.round(el.clientWidth);
            el.setAttribute('style', before);
            const restored = el.scrollWidth - el.clientWidth;
            return { over, shown, restored, full: Math.round(el.scrollWidth) };
        }""")
        check(clipped["over"] > 40,
              f"NC-RM17: nowrap + ellipsis must genuinely clip this filename, over by {clipped['over']}px")
        check(clipped["restored"] <= 1,
              f"NC-RM17: and the shipped rule must not, over by {clipped['restored']}px")
        findings.append(
            f"D. at 1280 the Before filename wraps to {before_metrics['lines']} lines with nothing clipped, "
            f"while nowrap+ellipsis would have hidden {clipped['over']}px of it")
        page.set_viewport_size({"width": 1440, "height": 1000})

        # ---- E. THE PRODUCTION ACTION CARRIES THE CANDIDATE IT NAMES ------------
        page.goto(f"{base}/#/production", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector(".production-next", timeout=30000)
        claim = page.evaluate("""() => {
            const next = projectNextProductionAction();
            return { href: next.href, reviewKey: next.reviewKey, shotId: next.shotId, label: next.actionLabel };
        }""")
        check(claim["reviewKey"] == production["headKey"],
              f"E. Production names the candidate: {claim['reviewKey']!r}")
        check(claim["href"].startswith(f"#/shot/{SHOT_A}/review/"),
              f"E. and the route carries it: {claim['href']!r}")
        check(claim["reviewKey"] == page.evaluate("(h) => routeReviewClaim(h)", claim["href"]),
              "E. the route round-trips the identity it carries")
        # Following the link a filmmaker would actually click.
        page.click('.production-next a.assemble-btn')
        page.wait_for_selector('[data-returned-review="1"]', timeout=30000)
        landed = card_state(page)
        check(landed["key"] == claim["reviewKey"],
              f"E. and clicking it lands on that exact candidate: {landed['key']!r}")
        findings.append(f"E. Production's action carried {CANDIDATE_A} through the route and landed on it")

        # ---- F. THE CLAIM GOES STALE: NO SILENT SUBSTITUTION -------------------
        stale_href = claim["href"]
        page.click('[data-returned-review-action="reject"]')
        # The wait is on the REQUESTED THING — the card naming a different candidate —
        # rather than on a timer, which reads a stale DOM on a slow machine and looks like
        # a product bug. SH-A holds a second pending candidate, so the card does not go
        # away: it advances.
        # The page is standing on the route that CLAIMED A, so the moment A is decided the
        # workspace must stop presenting a review here — in situ, without a reload. That is
        # the substitution window, and this is it closing.
        page.wait_for_selector("[data-returned-review-stale='1']", timeout=30000)
        advanced = card_state(page)
        check(advanced["stale"] and not advanced["returnedReview"],
              f"F. deciding the claimed candidate stops the claim being honoured, in place: {advanced['headline']!r}")
        check(advanced["primaryCount"] == 1, f"F. with exactly one primary action, saw {advanced['primaryCount']}")
        decided = page.evaluate("""() => {
            const projection = returnedReviewProjectionForBrowser();
            const shot = P.shots.find((row) => row.id === 'SH-A');
            const row = (shot.candidateFiles || []).find((item) => (item.stored || item.name) === 'SH-A_FRAME_A_FAL_1.png');
            return {
                awaiting: projection.counts.awaiting,
                rows: (shot.candidateFiles || []).length,
                decision: row ? row.decision : '(row gone)',
                returned: returnedResultsAwaitingReview().reduce((sum, r) => sum + (r.shot ? r.count : 0), 0),
                pending: projection.queue.filter((row) => row.shotId === 'SH-A').map((row) => row.candidate.name),
            };
        }""")
        check(decided["decision"] == "rejected", f"F. the decision was written to the exact candidate: {decided['decision']!r}")
        check(decided["rows"] == 2, f"F. and it stays in history rather than being deleted: {decided['rows']}")
        check(decided["awaiting"] == 3, f"F. the queue drops by exactly one, to {decided['awaiting']}")
        check(decided["returned"] == decided["awaiting"],
              f"F. and Returned Results agrees, because it reads the same array: {decided['returned']} vs {decided['awaiting']}")
        check(decided["pending"] == [CANDIDATE_A2],
              f"F. precondition — the claimed candidate is decided and another is pending: {decided['pending']}")
        # Now open the stale link exactly as a bookmark or a stale tab would.
        page.goto(f"{base}/{stale_href}", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("[data-returned-review-stale='1']", timeout=30000)
        stale = card_state(page)
        check(not stale["returnedReview"], "F. the stale link presents no review")
        check(stale["file"] == "", "F. and claims no candidate of its own")
        check(CANDIDATE_A in stale["body"], f"F. it names the candidate that was asked for: {stale['body']!r}")
        check(CANDIDATE_A2 not in stale["body"], "F. and does not present the other one as though it had been")
        check("already been reviewed" in stale["headline"], f"F. saying what happened: {stale['headline']!r}")
        check(stale["primaryCount"] == 1, f"F. exactly one primary action, saw {stale['primaryCount']}")
        check(not page.query_selector("[data-returned-review-action]"),
              "F. and no candidate decision is offered on a stale card")
        findings.append(f"F. the stale link explained itself and never substituted {CANDIDATE_A2}")

        # ---- G. CONTINUING IS EXPLICIT, AND IT WORKS ---------------------------
        page.click(".shot-primary-action")
        page.wait_for_selector('[data-returned-review="1"]', timeout=30000)
        continued = card_state(page)
        check(continued["file"] == CANDIDATE_A2,
              f"G. continuing reaches the pending candidate: {continued['file']!r}")
        check(page.evaluate("() => routeReviewClaim()") == production["secondKey"],
              "G. through a route that claims it by name, the same way Production's does")
        findings.append(f"G. the explicit continue reached {CANDIDATE_A2} through a route that named it")

        # ---- H. A RECORDED RESULT WITH NO BYTES ---------------------------------
        open_shot(page, base, SHOT_C)
        missing = card_state(page)
        missing_state = page.evaluate("""() => {
            const p = returnedReviewProjectionForBrowser();
            const shot = P.shots.find((row) => row.id === 'SH-C');
            return {
                unavailable: p.counts.unavailable,
                blockers: p.blockers.map((row) => row.candidate.name + ':' + row.unreviewable),
                recorded: (shot.candidateFiles || []).map((row) => (row.stored || row.name) + ':' + row.decision),
                readiness: (shotReadinessFor(shot) || {}).nextAction?.code || '',
                actions: document.querySelectorAll('[data-returned-review-action]').length,
            };
        }""")
        check(missing_state["recorded"] == [f"{MISSING_C}:unreviewed"],
              f"H. the project still records an undecided returned result: {missing_state['recorded']}")
        check(missing_state["readiness"] == "produce-frame",
              f"H. precondition: readiness would have promoted a generation, said {missing_state['readiness']!r}")
        check(missing_state["blockers"] == [f"{MISSING_C}:media-not-available"],
              f"H. it is reported as an integrity condition: {missing_state['blockers']}")
        check(missing["unavailable"], "H. and the shot workspace renders that state")
        check(MISSING_C in missing["body"], f"H. naming the result it cannot show: {missing['body']!r}")
        check("produce" not in missing["primaryLabel"].lower(),
              f"H. its primary action is not a generation: {missing['primaryLabel']!r}")
        check(missing_state["actions"] == 0, "H. and no candidate decision is offered on media nobody can see")
        check(missing["primaryCount"] == 1, f"H. exactly one primary action, saw {missing['primaryCount']}")
        check(missing["secondary"] == missing_state["readiness"],
              f"H. while the readiness action survives as secondary context: {missing['secondary']!r}")
        findings.append(
            f"H. {SHOT_C} rendered the missing-media integrity state with primary {missing['primaryLabel']!r} "
            "rather than a generation")

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
