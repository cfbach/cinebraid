"""Reference automation provider routing — the Last Seat blocker, reproduced and checked.

Drives the running app against a DISPOSABLE projects root and a DISPOSABLE config
shaped exactly like the dogfood: Braidy is an OpenAI-compatible server, Ollama is
not answering, and Vision resolves to Ollama with no model.

The OpenAI-compatible endpoint here is a local stub on a port of this harness's own
choosing. The filmmaker's real vLLM tunnel is never contacted.

No generation is started and no model call is made: the stub serves only
GET /v1/models, so anything else would show in its request log.
"""

import json
import os
import sys
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from browser_runtime import require_browser, launch_chromium  # noqa: E402

BASE = os.environ.get("CINEBRAID_QA_BASE", "http://127.0.0.1:8793")
OUT = os.environ.get("CINEBRAID_QA_OUT", r"C:\CineBraid\QA-Reviews\ReferenceAutomationProviderRouting")
CHAIR = "PROP-FOLDING-CHAIR"
VIEWPORTS = [("1920x1080", 1920, 1080), ("1280x800", 1280, 800)]

findings = []
shots = []


def note(ok, name, detail=""):
    findings.append({"ok": bool(ok), "name": name, "detail": detail})
    print(("  PASS  " if ok else "  FAIL  ") + name + ((" :: " + detail) if detail else ""))


def shot(page, tag, size):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{tag}__{size}.png")
    page.screenshot(path=path)
    shots.append(path)
    return path


def agent_status():
    with urllib.request.urlopen(f"{BASE}/api/agents/status", timeout=15) as r:
        return json.load(r)


def open_plan(page):
    page.goto(f"{BASE}/#/prop/{CHAIR}", wait_until="networkidle")
    page.wait_for_timeout(900)
    page.evaluate("async () => { if (typeof refreshAgentStatus === 'function') await refreshAgentStatus(true); }")
    page.wait_for_timeout(500)
    page.evaluate("() => openAssetAutomationModal('props','%s')" % CHAIR)
    page.wait_for_timeout(800)
    return page.evaluate(
        """() => { const m = document.getElementById('modal'); if (!m) return null;
          const start = [...m.querySelectorAll('button')].find(b => /^START/.test(b.textContent.trim()));
          return { text: m.textContent, start: start ? { label: start.textContent.trim(), disabled: start.disabled } : null,
                   errors: [...m.querySelectorAll('.guided-prompt-error')].map(e => e.textContent),
                   warns: [...m.querySelectorAll('.prompt-check.warn')].map(e => e.textContent),
                   oks: [...m.querySelectorAll('.prompt-check.ok')].map(e => e.textContent) }; }"""
    )


def run(page, size):
    print(f"\n===== {size} =====")

    caps = (agent_status().get("capabilities") or {})
    text, vision = caps.get("text") or {}, caps.get("vision") or {}
    note(text.get("ready") is True and text.get("provider") == "custom",
         f"[{size}] the dogfood shape is reproduced: Braidy text is an OpenAI-compatible server",
         json.dumps({k: text.get(k) for k in ("ready", "provider", "model")}))
    note(vision.get("ready") is False and vision.get("provider") == "ollama",
         f"[{size}] and Vision resolves to an Ollama that is not answering",
         json.dumps({k: vision.get(k) for k in ("ready", "provider", "model", "message")}))

    plan = open_plan(page)
    note(plan is not None, f"[{size}] the Braidy run plan opens")
    if not plan:
        return

    # THE BLOCKER: this refused to start, naming Ollama, while Braidy was working.
    note(plan["start"] is not None, f"[{size}] the plan offers a START control")
    if plan["start"]:
        note(plan["start"]["disabled"] is False,
             f"[{size}] BLOCKER FIXED — the run can start with Braidy configured and Ollama absent",
             json.dumps(plan["start"]))
    note(not plan["errors"],
         f"[{size}] nothing is reported as a blocking error", json.dumps(plan["errors"])[:200])
    note("Cannot start yet" not in plan["text"],
         f"[{size}] the 'Cannot start yet' refusal is gone")

    # Vision is still off, and the plan says so truthfully rather than silently.
    note(any("Vision is off" in w for w in plan["warns"]),
         f"[{size}] Vision being off is stated as a warning, not a blocker", json.dumps(plan["warns"])[:260])
    note(any("without an AI check" in w for w in plan["warns"]),
         f"[{size}] and the consequence is named: candidates return for human review")
    # Vision is OFF here (provider selected, no model named), so it carries no provider
    # diagnostic — the same rule Candidate Review already applies.
    note("Ollama is not reachable" not in " ".join(plan["warns"]),
         f"[{size}] a capability nobody turned on reports no provider failure",
         json.dumps(plan["warns"])[:200])
    note("Start Ollama" not in plan["text"] and "Expected model" not in plan["text"],
         f"[{size}] and the plan gives no instruction to start a provider it does not need")

    # And it can never again read as a statement about the working assistant.
    braidy_claim = "Braidy's text assistant is unavailable"
    note(braidy_claim not in plan["text"],
         f"[{size}] Braidy's text assistant is not described as unavailable when it is working")

    shot(page, "plan-braidy-run-openai-compatible", size)
    page.evaluate("() => { if (typeof closeModal === 'function') closeModal(); }")
    page.wait_for_timeout(300)


def main():
    sync_playwright = require_browser("reference automation provider routing")
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        for size, w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            page = ctx.new_page()
            run(page, size)
            ctx.close()
        browser.close()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "measurements.json"), "w", encoding="utf-8") as fh:
        json.dump({"findings": findings, "screenshots": shots}, fh, indent=2)
    failed = [f for f in findings if not f["ok"]]
    print(f"\n{len(findings) - len(failed)} passed, {len(failed)} failed. {len(shots)} screenshots -> {OUT}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
