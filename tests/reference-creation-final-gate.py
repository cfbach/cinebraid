"""REFERENCE CREATION REVIEW V1 — final human gate: T1, T2 and V1.

Three corrections/verifications, each proved against a REAL server configuration
rather than an injected client state, because what is being checked is how the
product resolves configuration:

  T1  the generation dialog describes the request it is about to send, in the
      tense of a request.
  T2  a vision capability nobody turned on reports no provider failure; a vision
      model that was named and did not answer keeps every word of its diagnostic.
  V1  "Create with Braidy" resolves the configured OpenAI-compatible assistant
      and does not depend on Ollama — which is stopped and unnamed throughout.

Runs against a disposable projects root and a disposable config. No provider call
is made: the OpenAI-compatible stub serves only GET /v1/models, so any attempt to
generate or refine would be visible in its request log as a 404.
"""

import json
import os
import sys
import time
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from browser_runtime import require_browser, launch_chromium  # noqa: E402

BASE = os.environ.get("CINEBRAID_QA_BASE", "http://127.0.0.1:8791")
OUT = os.environ.get("CINEBRAID_QA_OUT", r"C:\CineBraid\QA-Reviews\ReferenceCreationReviewV1")
CONFIG = os.environ["CINEBRAID_QA_CONFIG"]
REX = "CHAR-REX-VANDAR"
VIEWPORTS = [("1920x1080", 1920, 1080), ("1280x800", 1280, 800)]

findings = []
shots = []


def note(ok, name, detail=""):
    findings.append({"ok": bool(ok), "name": name, "detail": detail})
    print(("  PASS  " if ok else "  FAIL  ") + name + ((" :: " + detail) if detail else ""))


SCROLL = """(sel) => { const el = document.querySelector(sel); if (!el) return false;
  const stuck = [...document.querySelectorAll('body *')].filter(n => {
    const cs = getComputedStyle(n);
    if (cs.position !== 'sticky' && cs.position !== 'fixed') return false;
    const r = n.getBoundingClientRect();
    return r.top <= 140 && r.bottom > 40 && r.height > 8 && r.height < 260 && r.width > 300; });
  const pad = stuck.reduce((a, n) => Math.max(a, n.getBoundingClientRect().bottom), 0) + 14;
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - pad) });
  return true; }"""


def shot(page, tag, size, focus=None):
    os.makedirs(OUT, exist_ok=True)
    if focus:
        for _ in range(2):
            page.evaluate(SCROLL, focus)
            page.wait_for_timeout(250)
    path = os.path.join(OUT, f"final__{tag}__{size}.png")
    page.screenshot(path=path)
    shots.append(path)
    return path


def write_vision(setting, expect_ready=False):
    """Rewrite only the vision selection in the disposable config and wait until the
    SERVER reports the new state. Everything else — the OpenAI-compatible assistant,
    the stopped Ollama — is left exactly as it is, so each pass differs in one fact.

    The wait matters: provider inventories are cached for ten seconds, so a status
    read immediately after the write can still describe the previous configuration.
    Asserting on that would be measuring the cache rather than the product."""
    with open(CONFIG, encoding="utf-8") as fh:
        cfg = json.load(fh)
    cfg["assistant"]["visionProvider"] = setting["visionProvider"]
    cfg["ollamaVisionModel"] = setting.get("ollamaVisionModel", "")
    with open(CONFIG, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)
    want_provider = setting["visionProvider"]
    want_model = setting.get("ollamaVisionModel", "")
    for _ in range(30):
        vision = (agent_status().get("capabilities") or {}).get("vision") or {}
        if (str(vision.get("provider") or "") == want_provider
                and str(vision.get("model") or "") == want_model
                and bool(vision.get("ready")) == expect_ready):
            return vision
        time.sleep(1)
    raise AssertionError(f"server never reported vision as {setting}: {vision}")


def agent_status():
    with urllib.request.urlopen(f"{BASE}/api/agents/status", timeout=15) as r:
        return json.load(r)


def open_review(page):
    page.goto(f"{BASE}/#/character/{REX}", wait_until="networkidle")
    page.wait_for_timeout(600)
    # The page fetches capability status on load; the review must be opened against the
    # answer, not against whatever was cached before the configuration changed.
    page.evaluate("async () => { if (typeof refreshAgentStatus === 'function') await refreshAgentStatus(true); }")
    page.wait_for_timeout(600)
    page.evaluate(
        "() => openEntityCandidateReview('characters','%s','%s_FAL_CANDIDATE_1.png','state-default')"
        % (REX, REX))
    page.wait_for_timeout(700)
    return page.evaluate("() => { const m=document.getElementById('modal'); return m ? m.textContent : ''; }")


def run(page, size):
    print(f"\n===== {size} =====")

    # ---------------------------------------------------------------- V1 -----
    status = agent_status()
    text = (status.get("capabilities") or {}).get("text") or {}
    note(text.get("ready") is True, f"[{size}] V1 Braidy's text capability is ready", json.dumps(text))
    note(text.get("provider") == "custom",
         f"[{size}] V1 and resolves the configured OpenAI-compatible provider", str(text.get("provider")))
    note(text.get("model") == "qwen3.8-27b-fp8",
         f"[{size}] V1 with the model that server actually serves", str(text.get("model")))
    local = status.get("localModels") or {}
    note(local.get("ok") is False,
         f"[{size}] V1 while Ollama is stopped throughout, so readiness cannot have come from it",
         json.dumps(local))

    page.goto(f"{BASE}/#/character/{REX}", wait_until="networkidle")
    page.wait_for_timeout(1000)
    braidy = page.evaluate(
        "() => { const b=[...document.querySelectorAll('.reference-create-path.path-braidy button')][0];"
        " return b ? { label: b.textContent.trim(), disabled: b.disabled, title: b.getAttribute('title') || '' } : null; }")
    note(braidy is not None, f"[{size}] V1 the Create with Braidy action is present")
    if braidy:
        note(braidy["disabled"] is False,
             f"[{size}] V1 and is enabled under the OpenAI-compatible configuration", json.dumps(braidy))
        note("Ollama" not in (braidy["title"] or ""),
             f"[{size}] V1 with no Ollama requirement attached to it", braidy["title"][:80])
    section = page.evaluate(
        "() => { const s=document.querySelector('section.reference-create-section'); return s ? s.textContent : ''; }")
    note("Ollama" not in section,
         f"[{size}] V1 and the Create Reference section names no provider it does not use")
    shot(page, "v1-create-with-braidy-openai-compatible", size, "section.reference-create-section")

    # ---------------------------------------------------------------- T1 -----
    page.evaluate(
        """() => { try { localStorage.setItem('cinebraid-generation-view','simple'); } catch(e) {}
          openFalEntityGenerationModal('characters','%s'); }""" % REX)
    page.wait_for_timeout(900)
    modal = page.evaluate("() => { const m=document.getElementById('modal'); return m ? m.textContent : ''; }")
    note("candidates returned" not in modal,
         f"[{size}] T1 the unsubmitted request no longer claims candidates have returned")
    note("3candidates" in modal.replace(" ", "") or "3 candidates" in modal,
         f"[{size}] T1 and states the number it will request")
    note("Every returned file is an unapproved character candidate" in modal,
         f"[{size}] T1 while the sentence describing what will come back is untouched")
    note("START GENERATION" in modal.upper(),
         f"[{size}] T1 nothing about the generation action changed")
    shot(page, "t1-generation-request-tense", size, ".modal-box")
    page.evaluate("() => { if (typeof closeModal === 'function') closeModal(); }")
    page.wait_for_timeout(300)

    # ---------------------------------------------------------- T2 (off) -----
    write_vision({"visionProvider": "none"})
    review = open_review(page)
    note("Braidy visual review unavailable — Vision is off." in review,
         f"[{size}] T2 Vision explicitly off states the disabled truth")
    note("No image is sent for reading." in review,
         f"[{size}] T2 in the Assistant panel's own words for that state")
    note("Your own review and approval are unaffected." in review,
         f"[{size}] T2 with the human decision declared untouched")
    note("Configure Vision" in review, f"[{size}] T2 and the way to turn it on")
    for leak in ["Ollama is not reachable", "Start Ollama", "Expected model", "not configured"]:
        note(leak not in review, f"[{size}] T2 no dormant-provider diagnostic leaks: {leak}")
    shot(page, "t2-vision-off", size)
    page.evaluate("() => { if (typeof closeModal === 'function') closeModal(); }")
    page.wait_for_timeout(300)

    # -------------------------------------------------- T2 (named, broken) ---
    # A vision model IS named here and its provider is stopped. That is a fault, not a
    # preference, and the diagnostic is the thing the filmmaker needs.
    write_vision({"visionProvider": "ollama", "ollamaVisionModel": "llava:13b"})
    review = open_review(page)
    note("Ollama is not reachable" in review,
         f"[{size}] T2 a named vision model that did not answer keeps its provider diagnostic")
    note("llava:13b" in review,
         f"[{size}] T2 including the model that was expected")
    note("Vision is off" not in review,
         f"[{size}] T2 and is not described as switched off")
    note("Configure Vision" in review,
         f"[{size}] T2 the route into Vision settings is offered in both unavailable states")
    note("Your own review and approval are unaffected." in review,
         f"[{size}] T2 and the human decision is declared untouched in both")
    shot(page, "t2-vision-named-but-unreachable", size)
    page.evaluate("() => { if (typeof closeModal === 'function') closeModal(); }")
    page.wait_for_timeout(300)

    # Leave the configuration as the V1 shape for the next viewport pass.
    write_vision({"visionProvider": "none"})


def main():
    sync_playwright = require_browser("reference-creation final gate")
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        for size, w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            page = ctx.new_page()
            run(page, size)
            ctx.close()
        browser.close()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "final-gate-measurements.json"), "w", encoding="utf-8") as fh:
        json.dump({"findings": findings, "screenshots": shots}, fh, indent=2)
    failed = [f for f in findings if not f["ok"]]
    print(f"\n{len(findings) - len(failed)} passed, {len(failed)} failed. {len(shots)} screenshots -> {OUT}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
