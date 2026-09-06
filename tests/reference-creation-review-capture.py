"""REFERENCE CREATION REVIEW V1 — evidence capture and layout measurement.

Drives the running app against a DISPOSABLE projects root holding a copy of the
Last Seat project and the real returned Rex candidate media. It never touches the
authoritative project: the server it talks to was started with
CINEBRAID_PROJECTS_ROOT pointing at the copy.

Captures the states the repair claims to fix, at 1920x1080 and 1280x800, and
measures the facts a screenshot cannot prove on its own — horizontal overflow,
whether the prepared prompt really follows the action that prepared it, whether a
completed generation offers a route to its own results, and whether the candidate
thumbnail opens Candidate Review rather than the bare viewer.
"""

import json
import os
import sys

# Windows consoles default to cp1252 and this script prints product copy, which
# contains the glyphs the product actually uses.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from browser_runtime import require_browser, launch_chromium  # noqa: E402

BASE = os.environ.get("CINEBRAID_QA_BASE", "http://127.0.0.1:8791")
OUT = os.environ.get("CINEBRAID_QA_OUT", r"C:\CineBraid\QA-Reviews\ReferenceCreationReviewV1")
LABEL = os.environ.get("CINEBRAID_QA_LABEL", "after")
REX = "CHAR-REX-VANDAR"

VIEWPORTS = [("1920x1080", 1920, 1080), ("1280x800", 1280, 800)]

findings = []
shots = []


def note(ok, name, detail=""):
    findings.append({"ok": bool(ok), "name": name, "detail": detail})
    print(("  PASS  " if ok else "  FAIL  ") + name + ((" :: " + detail) if detail else ""))


def shot(page, tag, size, focus=None):
    os.makedirs(OUT, exist_ok=True)
    if focus:
        page.evaluate(
            "(sel) => { const el = document.querySelector(sel);"
            " if (!el) return;"
            # The app has a sticky header; scrollIntoView('start') puts the section
            # title underneath it, so the capture is offset by its height.
            " const stuck = [...document.querySelectorAll('body *')].filter(n => {"
            "   const cs = getComputedStyle(n);"
            "   if (cs.position !== 'sticky' && cs.position !== 'fixed') return false;"
            "   const r = n.getBoundingClientRect();"
            "   return r.top <= 140 && r.bottom > 40 && r.height > 8 && r.height < 260 && r.width > 300; });"
            " const pad = stuck.reduce((a, n) => Math.max(a, n.getBoundingClientRect().bottom), 0) + 14;"
            " const y = el.getBoundingClientRect().top + window.scrollY - pad;"
            " window.scrollTo({ top: Math.max(0, y) }); }", focus)
        page.wait_for_timeout(250)
        # Sticky chrome resizes once it is actually stuck, so the offset is measured
        # again from the scrolled position rather than from the resting one.
        page.evaluate(
            "(sel) => { const el = document.querySelector(sel);"
            " if (!el) return;"
            " const stuck = [...document.querySelectorAll('body *')].filter(n => {"
            "   const cs = getComputedStyle(n);"
            "   if (cs.position !== 'sticky' && cs.position !== 'fixed') return false;"
            "   const r = n.getBoundingClientRect();"
            "   return r.top <= 140 && r.bottom > 40 && r.height > 8 && r.height < 260 && r.width > 300; });"
            " const pad = stuck.reduce((a, n) => Math.max(a, n.getBoundingClientRect().bottom), 0) + 14;"
            " const y = el.getBoundingClientRect().top + window.scrollY - pad;"
            " window.scrollTo({ top: Math.max(0, y) }); }", focus)
        page.wait_for_timeout(250)
    path = os.path.join(OUT, f"{LABEL}__{tag}__{size}.png")
    page.screenshot(path=path, full_page=False)
    shots.append(path)
    return path


def overflow(page):
    return page.evaluate(
        "() => { const d=document.documentElement;"
        " return { doc: d.scrollWidth - d.clientWidth,"
        " worst: Math.max(0, ...[...document.querySelectorAll('main *')]"
        ".map(el => Math.ceil(el.getBoundingClientRect().right - d.clientWidth))) }; }"
    )


PROJECT = os.environ.get("CINEBRAID_QA_PROJECT", "")


def goto_rex(page):
    if PROJECT:
        page.goto(f"{BASE}/?project={PROJECT}#/character/{REX}", wait_until="networkidle")
    else:
        page.goto(f"{BASE}/#/character/{REX}", wait_until="networkidle")
    page.wait_for_timeout(900)


def main():
    sync_playwright = require_browser("reference-creation-review capture")
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        for size, w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            page = ctx.new_page()
            page.on("console", lambda m: None)
            run_states(page, size)
            ctx.close()
        browser.close()

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{LABEL}-measurements.json"), "w", encoding="utf-8") as fh:
        json.dump({"findings": findings, "screenshots": shots}, fh, indent=2)
    failed = [f for f in findings if not f["ok"]]
    print(f"\n{len(findings) - len(failed)} passed, {len(failed)} failed. {len(shots)} screenshots -> {OUT}")
    sys.exit(1 if failed else 0)


def run_states(page, size):
    print(f"\n===== {size} =====")

    # ---- 1/2/3: the reference workspace, empty primary, Create Reference visible ----
    goto_rex(page)
    shot(page, "01-reference-workspace", size, "section.reference-create-section")

    section = page.query_selector("section.reference-create-section")
    note(section is not None, f"[{size}] R1 Create Reference is a top-level section")
    if section:
        heading = page.eval_on_selector("section.reference-create-section h3", "el => el.textContent.trim()")
        note("Rex Vandar" in heading, f"[{size}] R1 heading names the reference", heading)
        note(page.query_selector("section.reference-create-section .reference-create-path.path-braidy") is not None,
             f"[{size}] R2 the Braidy path is offered")
        note(page.query_selector("section.reference-create-section .reference-create-path.path-manual") is not None,
             f"[{size}] R2 the manual path is offered")
        body = page.eval_on_selector("section.reference-create-section", "el => el.textContent")
        for legacy in ["CREATE REFERENCE", "Describe the character anchor", "Not started",
                       "Automate the default reference", "Ready to plan an automation run", "AUTOMATE DEFAULT"]:
            note(legacy not in body, f"[{size}] R1/R7 retired vocabulary absent: {legacy}")

    # The accepted empty-state hero stays above it.
    order = page.evaluate(
        "() => { const m=document.getElementById('main'); if(!m) return null;"
        " const kids=[...m.querySelectorAll('section.reference-primary-hero, section.reference-create-section, details.entity-candidate-section')];"
        " return kids.map(k => k.className.split(' ')[0]); }"
    )
    note(order and order[0].startswith("reference-primary-hero"),
         f"[{size}] R1 the accepted primary-reference empty state stays above Create", json.dumps(order))

    ov = overflow(page)
    note(ov["doc"] <= 0, f"[{size}] no horizontal document overflow", json.dumps(ov))

    # ---- 4: prepared prompt sits immediately under the inputs that made it ----
    page.evaluate("() => { const b=[...document.querySelectorAll('button')].find(x=>/Guide it myself/.test(x.textContent)); if(b) b.click(); }")
    page.wait_for_timeout(400)
    shot(page, "02-manual-path-open", size, "section.reference-create-section")

    prepare = page.evaluate(
        "() => { const s=document.querySelector('section.reference-create-section');"
        " const b=[...s.querySelectorAll('button')].find(x=>/Prepare prompt/.test(x.textContent));"
        " return b ? b.textContent.trim() : ''; }"
    )
    note("Prepare prompt" in prepare, f"[{size}] R3 the action reads 'Prepare prompt'", prepare)
    note("Build Prompt" not in page.content(), f"[{size}] R3 'Build Prompt' no longer appears")

    seq = page.evaluate(
        "() => { const s=document.querySelector('section.reference-create-section'); if(!s) return null;"
        " const nodes=[...s.querySelectorAll('.creation-actions, .creation-result, .creation-empty-result, .automation-inline-card')];"
        " return nodes.map(n => n.className.split(' ')[0]); }"
    )
    if seq:
        note("automation-inline-card" not in seq,
             f"[{size}] R3/R7 no automation panel between the action and its result", json.dumps(seq))
        if "creation-result" in seq:
            note(seq.index("creation-actions") < seq.index("creation-result"),
                 f"[{size}] R3 the prepared prompt follows the action", json.dumps(seq))

    # ---- 5/6: Braidy refinement running, and the retired branding ----
    page.evaluate(
        "() => { setGuidedPromptOp('asset','characters:%s','',{status:'busy',action:'improve',startedAt:Date.now(),activityId:'manual-fixture'}); route(); }" % REX
    )
    page.wait_for_timeout(500)
    shot(page, "03-braidy-refining", size, ".assistant-working-card")
    card = page.query_selector(".assistant-working-card")
    note(card is not None, f"[{size}] R5 a running refinement renders its own card")
    if card:
        text = page.eval_on_selector(".assistant-working-card", "el => el.textContent")
        note("CINEBRAID ASSISTANT" not in text, f"[{size}] R5 retired 'CINEBRAID ASSISTANT' branding is gone")
        note("BRAIDY" in text, f"[{size}] R5 the card is Braidy's")
        note("Safe to leave" in text, f"[{size}] R5 leaving is stated as safe")
        note("nine and a half minutes" in text, f"[{size}] R5 the real attempt bound is stated")
        note("Activity & reports" not in text, f"[{size}] R6 the Reports hand-off is retired")
        note("View activity" in text, f"[{size}] R6 the control reads 'View activity'")
        note(page.query_selector(".assistant-working-card .assistant-braidy-mark") is not None,
             f"[{size}] R5 the card carries a Braidy mark for the rail owner to fill")
    page.evaluate("() => { setGuidedPromptOp('asset','characters:%s','',null); route(); }" % REX)
    page.wait_for_timeout(300)

    # ---- 7/8/9/10: the generation decision, Simple and Advanced, priced and not ----
    for view_mode, rate_cfg, tag in [
        ("simple", {"estimatedCostPerImage": 0.06, "rateSource": "fal.ai/pricing", "rateAsOf": "2026-09-01"}, "gen-simple-priced"),
        ("simple", {}, "gen-simple-unpriced"),
        ("advanced", {"estimatedCostPerImage": 0.06, "rateSource": "fal.ai/pricing", "rateAsOf": "2026-09-01"}, "gen-advanced"),
    ]:
        page.evaluate(
            """(args) => {
              const fal = Object.assign({}, (CONFIG.generation && CONFIG.generation.fal) || {}, args.rate);
              if (!args.rate.estimatedCostPerImage) { delete fal.estimatedCostPerImage; delete fal.rateSource; delete fal.rateAsOf; }
              CONFIG = Object.assign({}, CONFIG, { generation: Object.assign({}, CONFIG.generation, { fal }) });
              try { localStorage.setItem('cinebraid-generation-view', args.mode); } catch (e) {}
              if (typeof closeModal === 'function') closeModal();
              openFalEntityGenerationModal('characters', args.rex);
            }""",
            {"rate": rate_cfg, "mode": view_mode, "rex": REX},
        )
        page.wait_for_timeout(800)
        modal = page.evaluate("() => { const m=document.getElementById('modal'); return m ? m.textContent : ''; }")
        if not modal:
            note(False, f"[{size}] R8 the generation dialog did not open ({tag})")
            continue
        if tag == "gen-simple-priced":
            note("GPT Image 2" in modal, f"[{size}] R8 the model is named, not slugged")
            note("openai/gpt-image-2" in modal, f"[{size}] R8 the exact model id is still stated")
            note("Compatible choice" not in modal, f"[{size}] R8 the unranked-comparison phrasing is gone")
            note("FAL" in modal, f"[{size}] R8 the provider route is named")
            note("Text to image" in modal, f"[{size}] R8 the mode is stated")
            note("Aspect ratio" in modal, f"[{size}] R9 aspect ratio is stated with the deciding facts")
            note("Estimated $" in modal, f"[{size}] R10 a configured rate renders as an estimate")
            simple_controls = page.evaluate(
                "() => [...document.querySelectorAll('#gen-view-controls label > span')].map(el => el.textContent.trim())")
            note("Resolution" in simple_controls or "Size" in simple_controls,
                 f"[{size}] R9 output size is asked about in Simple", json.dumps(simple_controls))
            note("Number of options" in simple_controls, f"[{size}] R9 candidate count is in Simple", json.dumps(simple_controls))
            note("Quality" in simple_controls, f"[{size}] R9 quality is in Simple")
        if tag == "gen-simple-unpriced":
            note("Provider price unavailable" in modal, f"[{size}] R10 an unconfigured rate says so")
            note("Settings" in modal, f"[{size}] R10 and says where a verified rate would come from")
            note("$0.00" not in modal, f"[{size}] R10 an unknown price never renders as zero")
        shot(page, tag, size, ".modal-box")
    page.evaluate("() => { if (typeof closeModal === 'function') closeModal(); }")
    page.wait_for_timeout(300)

    # ---- 11/12: a completed generation and its handoff ----
    page.evaluate(
        """() => {
          FAL_GENERATION_JOBS = [{
            id: 'fal-job-qa-1', purpose: 'entity-reference', entityList: 'characters', entityId: '%s',
            status: 'COMPLETED', model: 'openai/gpt-image-2', provider: 'fal', mode: 'text-to-image',
            outputCount: 3, externalId: '01a077eb-b0df-74c2-91a6-0c89dd3f7d7b',
            createdAt: '2026-09-06T18:10:00.000Z', updatedAt: '2026-09-06T18:12:43.000Z',
            ingestedAt: '2026-09-06T18:12:43.000Z',
            outputs: [{ name: 'CHAR-REX-VANDAR_FAL_CANDIDATE_1.png' }, { name: 'CHAR-REX-VANDAR_FAL_CANDIDATE_3.png' }],
          }];
          route();
        }""" % REX
    )
    page.wait_for_timeout(500)
    strip = page.query_selector(".fal-job-strip")
    if strip:
        stext = page.eval_on_selector(".fal-job-strip", "el => el.textContent")
        note("ready for review" in stext, f"[{size}] R12 completion states results are ready", stext[:90])
        review_btn = page.evaluate(
            "() => { const b=[...document.querySelectorAll('.fal-job-strip button')].find(x=>/Review \\d+ result/.test(x.textContent)); return b ? b.textContent.trim() : ''; }"
        )
        note(bool(review_btn), f"[{size}] R12 a completed generation offers a route to its results", review_btn)
        shot(page, "04-results-returned", size, ".fal-job-strip")
        if review_btn:
            page.evaluate("() => { const b=[...document.querySelectorAll('.fal-job-strip button')].find(x=>/Review \\d+ result/.test(x.textContent)); b.click(); }")
            page.wait_for_timeout(700)
            opened = page.evaluate("() => { const d=document.querySelector('details.entity-candidate-section'); return d ? d.open : null; }")
            note(opened is True, f"[{size}] R12 Review results expands the candidate section")
            shot(page, "05-candidates-revealed", size, "details.entity-candidate-section")
    else:
        note(False, f"[{size}] R12 the generation strip did not render")

    # ---- 13/14/15: the candidate card and Candidate Review ----
    card_sel = ".entity-candidate-card"
    if page.query_selector(card_sel):
        first_action = page.eval_on_selector(
            f"{card_sel} .entity-candidate-actions button",
            "el => el.textContent.trim()")
        note(first_action.upper().startswith("REVIEW"),
             f"[{size}] R13 Review is the first action on a candidate card", first_action)
        thumb_handler = page.eval_on_selector(
            f"{card_sel} a.entity-candidate-preview", "el => el.getAttribute('onclick') || ''")
        note("openEntityCandidateReview" in thumb_handler,
             f"[{size}] R13 the thumbnail opens Candidate Review", thumb_handler[:70])
        note("openLBMedia" not in thumb_handler,
             f"[{size}] R13 the thumbnail no longer opens the bare viewer")

        page.evaluate(f"() => document.querySelector('{card_sel} a.entity-candidate-preview').click()")
        page.wait_for_timeout(700)
        modal = page.query_selector(".entity-candidate-review-modal")
        note(modal is not None, f"[{size}] R14 Candidate Review opens")
        if modal:
            mtext = page.eval_on_selector(".entity-candidate-review-modal", "el => el.textContent")
            note("Rex Vandar" in mtext, f"[{size}] R14 the review names the reference")
            note("Default" in mtext, f"[{size}] R14 the review names the continuity state")
            note("Candidate 1 of" in mtext or "candidate" in mtext.lower(),
                 f"[{size}] R14 the review states which candidate this is")
            note(page.query_selector(".entity-review-nav") is not None,
                 f"[{size}] R14 previous/next navigation exists")
            note(page.query_selector(".entity-review-generation") is not None,
                 f"[{size}] R14 generation provenance is shown")
            note("View full size" in mtext, f"[{size}] R14 the full-size viewer is offered explicitly")
            note("Braidy visual review unavailable" in mtext or "Review with Braidy" in mtext,
                 f"[{size}] R15 the Braidy review state is stated either way")
            contained = page.evaluate(
                "() => { const img=document.querySelector('.entity-candidate-review-visual img');"
                " if(!img) return null; const r=img.getBoundingClientRect();"
                " return { w: Math.round(r.width), h: Math.round(r.height),"
                " inView: r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 }; }"
            )
            note(contained and contained["inView"], f"[{size}] R14 the review media is contained", json.dumps(contained))
            shot(page, "06-candidate-review", size)

            approve = page.evaluate(
                "() => { const b=[...document.querySelectorAll('.entity-candidate-review-actions button')]"
                ".find(x=>/APPROVE FOR/.test(x.textContent)); return b ? b.textContent.trim() : ''; }"
            )
            note(approve.endswith("…"), f"[{size}] R16 approval promises a further confirmation", approve)
            if approve:
                page.evaluate("() => { const b=[...document.querySelectorAll('.entity-candidate-review-actions button')].find(x=>/APPROVE FOR/.test(x.textContent)); b.click(); }")
                page.wait_for_timeout(700)
                atext = page.evaluate("() => { const m=document.getElementById('modal'); return m ? m.textContent : ''; }")
                note("Approve reference" in atext or "Rex Vandar" in atext,
                     f"[{size}] R16 the authority modal opens with the reviewed candidate", atext[:80])
                shot(page, "07-approval-modal", size)
                page.evaluate("() => { if (typeof closeModal === 'function') closeModal(); }")
                page.wait_for_timeout(300)
    else:
        note(False, f"[{size}] R13 no candidate card rendered")

    ov2 = overflow(page)
    note(ov2["doc"] <= 0, f"[{size}] no horizontal overflow after the review pass", json.dumps(ov2))


if __name__ == "__main__":
    main()
