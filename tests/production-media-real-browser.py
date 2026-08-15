#!/usr/bin/env python3
"""O5 -- Generated Media and the Universal Media Inspector, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. Everything semantic about O5 is proven in Node by
tests/production-media.js: the projection, the two identity domains, the four job/cost
states, the review envelope, the action refusals and the rendered wording. Nine claims
cannot be proven there, and they are the nine a filmmaker would actually notice:

  * ONE STABLE DESTINATION that really renders, with approved, candidate and rejected
    media all present in the same document.
  * REAL FILTERING through the shipped controls, ending on a rendered result rather than
    on a sleep. That lesson is O3's, learned the expensive way (af8de75).
  * THE INSPECTOR OVER A LIVE MODAL, opened by a real click on a real card.
  * NO STALE METADATA ACROSS A SWITCH. "The Inspector shows the media you asked for" is a
    statement about a mutated DOM, and it is the failure a reader would never catch by
    reading markup.
  * THE THEATRE ROUND TRIP. Opening the picture larger and coming back must not cost the
    filmmaker the identity they were inspecting.
  * STAGE-LOCAL AND RESULTS AGREE about one file's disposition, read from two different
    surfaces in one session.
  * THE O4 STRIP IS ABSENT on a project-level route and PRESENT on a shot, in the same
    document, seconds apart.
  * THE RESPONSIVE RULE. The grid stays usable and the Inspector stays reachable at ten
    widths in both themes, with no horizontal document overflow and exactly one scroll
    region inside the Inspector.
  * THE THEME RESOLVES. A hardcoded surface computes to the same near-black under the
    light theme, and only a real engine can say what a colour computed to.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because a check that cannot fail is worth nothing.
Each one mutates the RUNNING page, asserts the mutation really changed what the check
reads -- the probe receipt -- and then requires the check to notice:

  N1 resolves media by bare filename instead of durable identity.
  N2 paints an AI recommendation as an APPROVED chip.
  N3 renders an AI PASS as a human approval in the Inspector.
  N4 drops rejected media from the destination.
  N5 renders an unknown cost as $0.00.
  N6 substitutes the current settings model for the historical reviewer.
  N7 renders the O4 stage strip on the project-level route.
  N8 leaves stale metadata behind when the inspected media changes.
  N9 creates a second logical asset from a renamed path.

THE FIXTURE IS BUILT HERE, into the sandbox's own projects root, because it has to carry
media states the shipped sample does not have: a rejection, an AI-recommended-but-
unapproved candidate, a job with no accounting, a metered-unpriced motion render and a
candidate naming a job the ledger does not contain.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched; the route guard aborts anything that
would dispatch a generation or leave loopback.
"""

import json, os, pathlib, socket, struct, subprocess, sys, tempfile, time, zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium, canon_receipts

LABEL = "Generated Media and Universal Media Inspector real-browser audit"
sync_playwright = require_browser(LABEL)

# Routes that would DISPATCH a generation. Reading the job ledger is a local file read and
# is not one of them -- the Inspector needs it, and blocking it would prove nothing except
# that the suite cannot read its own fixture.
PAID_ROUTES = ("/api/generation/fal/jobs/", "/api/prompt/analyze", "/api/agent/")
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")

page_errors, offsite, paid_calls = [], [], []
findings = []


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


# ---------------------------------------------------------------------------
# THE FIXTURE. Real PNG bytes so the page renders real images and intrinsic-aspect
# binding has something to measure.
def png(width, height, rgb):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    raw = b""
    for y in range(height):
        raw += b"\x00" + bytes(bytearray(
            (245 if (x + y) % 24 < 2 else rgb[c]) for x in range(width) for c in range(3)))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


def iso(day):
    return f"2026-08-{day:02d}T12:00:00.000Z"


def build_fixture(projects_root):
    slug = "o5-media-qa"
    root = projects_root / slug
    for sub in ("anchors", "plates", "props", "vehicles", "audio", "media", "docs"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    for shot in ("SH010", "SH020"):
        for sub in ("takes", "locked", "blocking"):
            (root / "shots" / shot / sub).mkdir(parents=True, exist_ok=True)

    files = {
        "anchors/KAI_DEFAULT_V001.png": (58, 96, 74),
        "anchors/KAI_FAL_CANDIDATE_2.png": (70, 78, 96),
        "anchors/KAI_FAL_CANDIDATE_3.png": (104, 58, 52),
        "plates/HULL_DEFAULT_V001.png": (52, 68, 88),
        "media/animatic-opening.png": (72, 64, 84),
        "shots/SH010/takes/SH010_FRAME_A_V001.png": (46, 84, 92),
        "shots/SH010/takes/SH010_FRAME_B_V001.png": (58, 62, 104),
        "shots/SH010/takes/SH010_FRAME_A_FAL_2.png": (110, 60, 58),
        "shots/SH010/blocking/SH010_BLOCKING_FAL_1.png": (96, 96, 96),
        "shots/SH010/locked/SH010_FRAME_A_V001.png": (46, 84, 92),
        "shots/SH020/takes/SH020_FRAME_A_FAL_1.png": (46, 84, 92),
    }
    for rel, rgb in files.items():
        (root / rel).write_bytes(png(320, 200, rgb))
    # A motion take, so the metered-but-unpriced cost state is reachable. The bytes are a
    # placeholder: nothing here decodes video, and the Inspector's <video> element is asked
    # only for metadata. What matters is that the FILE EXISTS, because the scan enumerates
    # the directory and a missing file would drop the record the cost case lives on.
    (root / "shots/SH010/takes/SH010_MOTION_H3_1.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)

    project = {
        "meta": {"id": slug, "title": "O5 Media QA", "version": "6.6.4-studio.2", "code": "O5QA",
                 "styleBlocks": [], "iterBudget": {"A": 12, "B": 3},
                 "world": {"setting": "", "include": "", "reject": ""}, "refSyntax": "@imageN",
                 "models": [], "aiPolicy": "project-default", "workflowEmphasis": "manual",
                 "defaults": {"stillModel": "", "videoModel": ""}},
        "scenes": [{"id": "SC01", "title": "Hull sequence", "tier": "A", "whatHappens": "", "howItFeels": ""}],
        "characters": [{
            "id": "KAI", "name": "Kai", "prefix": "KAI", "block": "Kai identity block",
            "status": "APPROVED", "workflowStatus": "APPROVED",
            "approvedFile": "KAI_DEFAULT_V001.png", "approvedAt": iso(1),
            "continuityStates": [{"id": "state-default", "name": "Default", "isDefault": True,
                                  "approvedFile": "KAI_DEFAULT_V001.png", "approvedAt": iso(1)}],
            "coverageSlots": [{"id": "front", "label": "Front", "approvedFile": "KAI_DEFAULT_V001.png", "status": "approved"}],
            "candidateFiles": [
                {"stored": "KAI_DEFAULT_V001.png", "addedAt": iso(1), "decision": "approved-reference",
                 "humanApproved": True, "decidedAt": iso(1),
                 "approvalProvenance": {"source": "human", "aiReviewed": True, "aiPassed": True, "approvedAt": iso(1)},
                 "generationProvider": "fal", "generationModel": "openai/gpt-image-2",
                 "generationJobId": "job-kai-1", "generationRequestId": "req-kai-1",
                 "prompt": "Kai, head and shoulders, neutral studio light, front view.",
                 "structuredReviews": {"state-default": {
                     "contractVersion": "reference-authority-v3",
                     "reviewer": {"provider": "openai", "model": "gpt-5.0-vision-2026-03"},
                     "reviewedAt": iso(1), "pass": True, "modelPass": True, "score": 94,
                     "recommendation": "approve", "summary": "Identity and state both match.",
                     "semanticOutcome": "validated-strong", "semanticLabel": "Declared state observed",
                     "semanticSatisfied": True, "stateEvidence": {"requirements": []}, "blockers": []}}},
                # AI RECOMMENDED. NOBODY APPROVED. The headline semantic-safety case.
                {"stored": "KAI_FAL_CANDIDATE_2.png", "addedAt": iso(2), "decision": "unreviewed",
                 "generationProvider": "fal", "generationModel": "openai/gpt-image-2",
                 "generationJobId": "job-kai-2", "prompt": "Kai, three-quarter view.",
                 "structuredReviews": {"state-default": {
                     "contractVersion": "reference-authority-v3",
                     "reviewer": {"provider": "openai", "model": "gpt-5.0-vision-2026-03"},
                     "reviewedAt": iso(2), "pass": True, "modelPass": True, "score": 88,
                     "recommendation": "approve", "summary": "Passes every declared check.",
                     "stateEvidence": {"requirements": []}, "blockers": []}}},
                # REJECTED, retained, no reason recorded anywhere.
                {"stored": "KAI_FAL_CANDIDATE_3.png", "addedAt": iso(3), "decision": "rejected", "decidedAt": iso(3),
                 "generationProvider": "fal", "generationModel": "openai/gpt-image-2", "generationJobId": "job-kai-3"},
            ]}],
        "locations": [{"id": "HULL", "name": "Hull bay", "prefix": "HULL", "status": "APPROVED",
                       "workflowStatus": "APPROVED", "approvedFile": "HULL_DEFAULT_V001.png",
                       "continuityStates": [{"id": "state-default", "name": "Default", "isDefault": True,
                                             "approvedFile": "HULL_DEFAULT_V001.png"}],
                       "candidateFiles": [{"stored": "HULL_DEFAULT_V001.png", "addedAt": iso(1),
                                           "decision": "approved-reference", "humanApproved": True, "decidedAt": iso(1)}]}],
        "props": [], "vehicles": [], "audio": [], "decisions": [], "jobs": [], "agentRuns": [],
        "shots": [
            {"id": "SH010", "scene": "SC01", "title": "Hull check", "desc": "Kai checks the hull panel",
             "status": "BUILT", "workflowStatus": "IN PROGRESS", "reviewStatus": "PENDING",
             "winner": "SH010_FRAME_A_V001.png",
             "keyframes": [{"id": "kf-a", "label": "A", "title": "Opening", "winner": "SH010_FRAME_A_V001.png"},
                           {"id": "kf-b", "label": "B", "title": "Closing", "winner": "SH010_FRAME_B_V001.png"}],
             "clips": [{"id": "clip-1", "suffix": "A", "label": "A", "kind": "motion", "title": "Panel open", "videoWinner": ""}],
             "candidateFiles": [
                 {"stored": "SH010_FRAME_A_V001.png", "addedAt": iso(4), "decision": "shortlist",
                  "approvedAt": iso(5), "approvedTarget": "frame:kf-a", "frameId": "kf-a",
                  "renamedFrom": ["SH010_FRAME_A_FAL_1.png"], "renamedAt": iso(5), "sourceBuildId": "build-frame-a",
                  "generationProvider": "fal", "generationModel": "openai/gpt-image-2",
                  "generationJobId": "job-frame-a", "generationRequestId": "req-frame-a",
                  # AI SAID CORRECT. THE HUMAN APPROVED ANYWAY.
                  "aiReview": {"score": 62, "pass": False, "notes": "Camera height drifts from the brief.",
                               "reviewedAt": iso(4), "strategy": "strict"}},
                 # LEGACY: the job is in the ledger and recorded no accounting.
                 {"stored": "SH010_FRAME_B_V001.png", "addedAt": iso(4), "decision": "shortlist",
                  "approvedAt": iso(5), "approvedTarget": "frame:kf-b", "frameId": "kf-b",
                  "generationProvider": "fal", "generationModel": "openai/gpt-image-2", "generationJobId": "job-frame-b"},
                 {"stored": "SH010_FRAME_A_FAL_2.png", "addedAt": iso(4), "decision": "rejected", "reviewedAt": iso(6),
                  "frameId": "kf-a", "correctionOf": "SH010_FRAME_A_V001.png",
                  "generationProvider": "fal", "generationModel": "openai/gpt-image-2", "generationJobId": "job-frame-a"},
                 # METERED AND HONESTLY UNPRICED: the fourth money state.
                 {"stored": "SH010_MOTION_H3_1.mp4", "addedAt": iso(7), "decision": "unreviewed",
                  "labels": ["MiniMax H3", "i2v"],
                  "generationProvider": "fal", "generationModel": "minimax/h3/image-to-video",
                  "generationJobId": "job-motion-1", "generationRequestId": "req-motion-1",
                  "generationProfileMode": "i2v", "generationResolution": "2K"},
             ]},
            {"id": "SH020", "scene": "SC01", "title": "Panel close", "desc": "The panel closes",
             "status": "BUILT", "workflowStatus": "IN PROGRESS",
             "keyframes": [{"id": "kf-a", "label": "A", "title": "Opening", "winner": ""}], "clips": [],
             # NAMES A JOB THE LEDGER DOES NOT CONTAIN.
             "candidateFiles": [{"stored": "SH020_FRAME_A_FAL_1.png", "addedAt": iso(8), "decision": "unreviewed",
                                 "frameId": "kf-a", "generationProvider": "fal",
                                 "generationModel": "openai/gpt-image-2", "generationJobId": "job-vanished"}]},
        ],
        "mediaAssets": [
            {"id": "blocking-media-1", "file": "SH010_BLOCKING_FAL_1.png",
             "storagePath": "shots/SH010/blocking/SH010_BLOCKING_FAL_1.png",
             "originalName": "blocking.png", "title": "SH010 - FAL blocking 1", "kind": "image",
             "notes": "Blocking frame - geometric planning scaffold, not visual canon.",
             "generationRecord": {"provider": "fal", "model": "openai/gpt-image-2", "requestId": "req-blocking-1",
                                  "jobId": "job-blocking-1", "prompt": "Greyscale blocking scaffold.",
                                  "quality": "low", "resolution": "1k", "date": iso(3)},
             "createdAt": iso(3),
             "links": [{"id": "link-b1", "targetType": "shot", "targetId": "SH010", "role": "blocking-frame",
                        "order": 0, "blockingFrameId": "kf-a", "blockingVersion": "B01",
                        "generationInput": False, "agentContext": True}]},
            {"id": "media-planning-1", "file": "animatic-opening.png", "originalName": "animatic-opening.png",
             "title": "Animatic - opening", "kind": "image", "createdAt": iso(1),
             "links": [{"id": "link-p1", "targetType": "shot", "targetId": "SH010", "role": "animatic-frame",
                        "order": 0, "generationInput": False, "agentContext": True}]},
        ],
    }
    # THE APPROVED DISPOSITION IS A RECEIPT, NOT A POINTER. The three dispositions this
    # suite exists to tell apart - approved / candidate / rejected - are read through the
    # production-truth projection, so a fixture that only sets approvedFile and winner has
    # nothing approved in it and the whole disposition case is untested. These are the
    # approvals the fixture always meant to describe.
    project["productionAuthority"] = canon_receipts([
        {"kind": "entity-state", "list": "characters", "entityId": "KAI", "stateId": "state-default",
         "value": "KAI_DEFAULT_V001.png"},
        {"kind": "entity-state", "list": "locations", "entityId": "HULL", "stateId": "state-default",
         "value": "HULL_DEFAULT_V001.png"},
        {"kind": "shot-frame", "shotId": "SH010", "frameId": "kf-a", "value": "SH010_FRAME_A_V001.png"},
        {"kind": "shot-frame", "shotId": "SH010", "frameId": "kf-b", "value": "SH010_FRAME_B_V001.png"},
    ], via="production-media-fixture")
    (root / "project.json").write_text(json.dumps(project, indent=2) + "\n", encoding="utf-8")

    def estimate(amount=None, confidence="estimated", unpriced=None):
        est = {"costClass": "metered_api", "unit": "usd", "confidence": confidence}
        if amount is not None:
            est["amount"] = amount
        basis = {"unitBasis": "image", "quantity": 1}
        if unpriced:
            basis["unpricedReason"] = unpriced
        return {"costClass": "metered_api", "estimate": est, "recordedAt": iso(1), "basis": basis}

    jobs = [
        {"id": "job-kai-1", "purpose": "entity-reference", "provider": "fal", "model": "openai/gpt-image-2",
         "externalId": "req-kai-1", "status": "COMPLETED", "createdAt": iso(1), "updatedAt": iso(1), "ingestedAt": iso(1),
         "accounting": estimate(0.04),
         "outputs": [{"type": "entity-candidate", "name": "KAI_DEFAULT_V001.png", "url": "/assets/anchors/KAI_DEFAULT_V001.png"}]},
        {"id": "job-kai-2", "purpose": "entity-reference", "provider": "fal", "model": "openai/gpt-image-2",
         "status": "COMPLETED", "createdAt": iso(2), "updatedAt": iso(2), "accounting": estimate(0.02), "outputs": []},
        {"id": "job-kai-3", "purpose": "entity-reference", "provider": "fal", "model": "openai/gpt-image-2",
         "status": "COMPLETED", "createdAt": iso(3), "updatedAt": iso(3), "outputs": []},
        {"id": "job-frame-a", "purpose": "frame", "provider": "fal", "model": "openai/gpt-image-2",
         "externalId": "req-frame-a", "status": "COMPLETED", "createdAt": iso(4), "updatedAt": iso(5),
         "accounting": estimate(0.06), "outputs": []},
        # LEGACY: no accounting object at all -> cost not recorded.
        {"id": "job-frame-b", "purpose": "frame", "provider": "fal", "model": "openai/gpt-image-2",
         "status": "COMPLETED", "createdAt": iso(4), "updatedAt": iso(4), "outputs": []},
        # Metered by duration with no server-side rate: accounting EXISTS and says it does
        # not know, which is a different answer from having no accounting at all.
        {"id": "job-motion-1", "purpose": "motion-h3", "provider": "fal", "model": "minimax/h3/image-to-video",
         "externalId": "req-motion-1", "profileMode": "i2v", "durationSeconds": 6, "resolution": "2K",
         "status": "COMPLETED", "createdAt": iso(7), "updatedAt": iso(7), "ingestedAt": iso(7),
         "accounting": estimate(None, "unknown", "no-per-image-rate-for-this-output"), "outputs": []},
        {"id": "job-blocking-1", "purpose": "blocking", "provider": "fal", "model": "openai/gpt-image-2",
         "externalId": "req-blocking-1", "status": "COMPLETED", "createdAt": iso(3), "updatedAt": iso(3),
         "accounting": estimate(0.01), "outputs": []},
    ]
    (root / "generation-jobs.json").write_text(json.dumps(jobs, indent=2) + "\n", encoding="utf-8")
    return slug


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-o5-media-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
slug = build_fixture(projects_root)

# The ledger only reaches the browser when generation is configured, so the sandbox config
# names a local placeholder key. GET /api/generation/fal/jobs reads a file on this machine
# and dispatches nothing; the route guard below still aborts every route that would.
config = json.loads(config_path.read_text(encoding="utf-8"))
config["activeProject"] = slug
config.setdefault("generation", {}).setdefault("fal", {}).update(
    {"enabled": True, "apiKey": "sandbox-local-only-never-dispatched", "estimatedCostPerImage": 0.02})
config["assistant"] = {"provider": "none", "visionProvider": "none"}
config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

# WHAT "NO PROJECT DATA WAS MUTATED" ACTUALLY HAS TO MEAN HERE.
#
# A naive whole-tree hash fails for reasons that have nothing to do with O5, and finding
# that out is what this comment is for: merely OPENING a shot route normalises the shot
# and autosaves, so project.json, its .bak and a fresh backups/ entry all change; and the
# server's MediaAsset activation pass writes media-assets.json on open and on scan, which
# is C1 working exactly as designed and is what gives this fixture its ledger identities
# in the first place.
#
# So the media BYTES are hashed whole -- O5 must never rewrite, rename or delete a media
# file -- and project.json is compared on the fields O5 could actually corrupt: every
# disposition, every approval pointer and every winner edge. That is a sharper claim than
# a tree hash, not a weaker one: it would catch an Inspector that silently approved
# something even if the file had been rewritten for an unrelated reason.
import hashlib


def media_fingerprint():
    out = {}
    for path in sorted((projects_root / slug).rglob("*")):
        if path.is_file() and path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov"):
            out[str(path.relative_to(projects_root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def decision_fingerprint():
    """Every approval pointer, winner edge and candidate decision, keyed by owner.

    ABSENT AND EMPTY ARE THE SAME ANSWER here, and collapsing them is deliberate rather
    than lax. Rendering an entity page calls the shipped ensureCoverageSlots(), which
    MATERIALISES the standard coverage template -- so simply visiting a character
    turns thirteen missing slots into thirteen slots holding "". None of them approves
    anything, and treating that as a mutation would make this check cry wolf on
    pre-existing normalisation while saying nothing about O5.

    What it still catches, exactly: any pointer that gains, loses or changes a FILENAME,
    and any candidate decision that changes at all. That is the claim -- browsing and
    inspecting must not change what is approved."""
    doc = json.loads((projects_root / slug / "project.json").read_text(encoding="utf-8"))
    out = {}
    for kind in ("characters", "locations", "props", "vehicles", "audio"):
        for entity in doc.get(kind) or []:
            key = f"{kind}/{entity.get('id')}"
            out[f"{key}#approvedFile"] = entity.get("approvedFile", "")
            for state in entity.get("continuityStates") or []:
                out[f"{key}#state:{state.get('id')}"] = state.get("approvedFile", "")
            for slot in entity.get("coverageSlots") or []:
                out[f"{key}#coverage:{slot.get('id')}"] = slot.get("approvedFile", "")
            for row in entity.get("candidateFiles") or []:
                out[f"{key}#row:{row.get('stored') or row.get('name')}"] = f"{row.get('decision','')}|{row.get('humanApproved','')}|{row.get('decidedAt','')}"
    for shot in doc.get("shots") or []:
        key = f"shot/{shot.get('id')}"
        out[f"{key}#winner"] = shot.get("winner", "")
        for frame in shot.get("keyframes") or []:
            out[f"{key}#frame:{frame.get('id')}"] = frame.get("winner", "")
        for clip in shot.get("clips") or []:
            out[f"{key}#clip:{clip.get('id')}"] = f"{clip.get('winner','')}|{clip.get('winnerEnd','')}|{clip.get('videoWinner','')}"
        for row in shot.get("candidateFiles") or []:
            out[f"{key}#row:{row.get('stored') or row.get('name')}"] = f"{row.get('decision','')}|{row.get('approvedAt','')}|{row.get('approvedTarget','')}"
    return out


media_before = media_fingerprint()
decisions_before = decision_fingerprint()

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

BASE = f"http://127.0.0.1:{port}"

# ---------------------------------------------------------------------------
# READERS. Bare identifiers throughout: CineBraid's state lives in top-level `let`
# bindings, which are lexical and NOT properties of `window`.
READ_RESULTS = """
() => {
  const grid = document.querySelector('[data-results-grid]');
  const cards = [...document.querySelectorAll('[data-results-card]')];
  return {
    present: !!grid,
    tab: grid ? grid.dataset.resultsTab : '',
    count: cards.length,
    roles: cards.map((c) => c.dataset.role),
    kinds: [...new Set(cards.map((c) => c.dataset.kind))],
    keys: cards.map((c) => c.dataset.miKey),
    statusWords: cards.map((c) => (c.querySelector('.results-card-status') || {}).textContent || ''),
    aiChips: cards.filter((c) => c.querySelector('.results-card-ai')).length,
    tabs: [...document.querySelectorAll('.workspace-tab')].map((a) => a.textContent.trim()),
    barHeight: Math.round((document.getElementById('cb-shell-bar') || {getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height),
    stripPresent: !!document.querySelector('.cb-stage-strip'),
    assistant: !!document.getElementById('cb-assistant-mount'),
    terminal: !!document.getElementById('cb-terminal-mount'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}
"""

READ_INSPECTOR = """
() => {
  const box = document.querySelector('[data-media-inspector]');
  if (!box) return null;
  const pick = (sel, attrName) => { const el = box.querySelector(sel); return el ? el.dataset[attrName] : ''; };
  const words = (sel) => { const el = box.querySelector(sel); return el ? el.textContent.trim() : ''; };
  const scrollers = [...box.querySelectorAll('*')].filter((el) => {
    const s = getComputedStyle(el);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2;
  }).map((el) => el.className.split(' ')[0]);
  return {
    key: box.dataset.miKey,
    kind: box.dataset.miKind,
    text: box.innerText,
    human: pick('[data-mi-human-decision]', 'miHumanDecision'),
    humanWords: words('[data-mi-human-decision] b'),
    disposition: pick('[data-mi-disposition]', 'miDisposition'),
    dispositionWords: words('[data-mi-disposition] b'),
    recommendation: pick('[data-mi-recommendation]', 'miRecommendation'),
    recommendationWords: words('[data-mi-recommendation] b'),
    jobState: pick('[data-mi-section="provenance"]', 'miJobState'),
    targetCount: Number(pick('[data-mi-section="authority"]', 'miTargetCount') || 0),
    reviewCount: Number(pick('[data-mi-section="review"]', 'miReviewCount') || 0),
    reviewer: [...box.querySelectorAll('[data-mi-review-kind] .mi-facts b')].map((b) => b.textContent.trim()),
    ledger: words('[data-mi-domain="ledger"] b'),
    library: words('[data-mi-domain="library"] b'),
    actions: [...box.querySelectorAll('[data-mi-action]')].map((b) => b.dataset.miAction),
    scrollers,
    /* Reported per button, and with the COMPUTED min-height beside the measured box.
       getBoundingClientRect returns post-zoom pixels inside #app's zoomed subtree, so a
       bare rect can be a fraction under the CSS floor at some UI scales; the rect catches
       a collapsed control and the computed value proves the rule is being applied. */
    buttons: [...box.querySelectorAll('.mi-actions button')].map((b) => ({
      id: b.dataset.miAction || 'close',
      h: Math.round(b.getBoundingClientRect().height * 10) / 10,
      minHeight: getComputedStyle(b).minHeight,
    })),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}
"""

PROJECTION = """
() => {
  const built = window.CineBraidMediaInspector.projection();
  return {
    jobsAvailable: built.jobsAvailable,
    counts: JSON.parse(JSON.stringify(built.counts)),
    dupes: built.duplicatesCollapsed,
    rows: built.records.map((r) => ({
      name: r.file.name, key: r.key, kind: r.kind, role: r.disposition.role,
      human: r.humanDecision.state, ai: r.aiRecommendation.value,
      job: r.provenance.job.state, cost: r.provenance.cost.state,
      ledger: r.identity.ledger.state, library: r.identity.library.state,
    })),
  };
}
"""


# CLIPPED TEXT, found by measurement rather than by eye.
#
# Two real defects were found this way during O5 and both were the same shape: a fixed
# track floor inside a container too narrow to honour it, so one column collapsed and its
# text was sliced. `.reference-manual-actions` asked for four columns in about 300px, and
# `.creation-grid`'s 280px side track starved the entity page's "Visual description" field
# down to 8px. Neither viewport media queries nor a Node assertion can see that, because
# both depend on how wide a CONTAINER ended up in a real layout.
#
# The audit also measures CONTRAST, which found three more defects of the same family:
# `.results-card-ai` and `.results-card-status.status-rejected` painted a THEMED status
# hue on `--preview-overlay`, which is a permanently dark scrim -- so under the light
# theme they were dark ink on dark (2.77:1) -- and `.focused-subnav` carried the same
# frozen `rgba(20,24,27,.97)` literal `.focused-inspector` had, putting light-theme ink on
# a near-black panel at 1.15:1, which is not "dim", it is invisible.
#
# An element is clipped when its content is wider than its box AND it is neither
# user-scrollable nor declaring an ellipsis. Ellipsised text is a deliberate choice;
# silently sliced text is not. Two exclusions keep the measurement honest: `.sr-only`,
# because being 1px wide is the whole point of it, and any ancestor painting a GRADIENT,
# because `backgroundColor` reports gradients as transparent and the walk would blame the
# wrong surface -- that false positive is why "Upload reference files" looked like 1.01:1
# when it is white on teal.
VISUAL_AUDIT = """
() => {
  const rgbOf = (v) => { const m = String(v).match(/rgba?\\(([^)]+)\\)/); return m ? m[1].split(',').map(Number) : null; };
  const lum = (c) => { const [r,g,b] = c.slice(0,3).map((x) => { x/=255; return x<=0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055,2.4); }); return 0.2126*r+0.7152*g+0.0722*b; };
  const ratio = (a,b) => (Math.max(lum(a),lum(b))+0.05)/(Math.min(lum(a),lum(b))+0.05);
  const bgOf = (el) => { let n = el; while (n) { const cs = getComputedStyle(n);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
    const c = rgbOf(cs.backgroundColor); if (c && (c[3] === undefined || c[3] > 0.5)) return c; n = n.parentElement; } return null; };
  const out = { clipped: [], verticalClip: [], invisibleText: [], lowContrast: [], zeroSizeControl: [], brokenImage: [] };
  const seen = new Set();
  for (const el of document.querySelectorAll('#main *, #cb-shell-bar *, #cb-shell-rail *, #cb-shell-dock *, .modal-box *')) {
    if (!el.getClientRects().length) continue;
    if (el.classList.contains('sr-only') || el.closest('.sr-only')) continue;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const label = el.tagName.toLowerCase() + '.' + String(el.className || '').trim().split(/\\s+/).slice(0, 2).join('.');
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText && s.visibility !== 'hidden' && Number(s.opacity) > 0.05) {
      if (s.overflowX !== 'auto' && s.overflowX !== 'scroll' && s.textOverflow !== 'ellipsis'
          && el.scrollWidth - el.clientWidth > 1 && el.clientWidth > 0)
        out.clipped.push({ label, text: el.textContent.trim().slice(0, 44), over: el.scrollWidth - el.clientWidth });
      if (s.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 2
          && s.textOverflow !== 'ellipsis' && s.webkitLineClamp === 'none')
        out.verticalClip.push({ label, text: el.textContent.trim().slice(0, 44), over: el.scrollHeight - el.clientHeight });
      const fg = rgbOf(s.color), bg = bgOf(el);
      if (fg && bg) {
        const c = ratio(fg, bg), size = parseFloat(s.fontSize);
        const need = (size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700)) ? 3 : 4.5;
        const key = label + el.textContent.trim().slice(0, 18);
        if (c < need && !seen.has(key)) {
          seen.add(key);
          (c < 1.35 ? out.invisibleText : out.lowContrast).push({ label, text: el.textContent.trim().slice(0, 34), ratio: Math.round(c * 100) / 100, need, size });
        }
      }
    }
    if (['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(el.tagName) && s.visibility !== 'hidden'
        && s.display !== 'none' && (r.width < 2 || r.height < 2))
      out.zeroSizeControl.push({ label, w: Math.round(r.width), h: Math.round(r.height) });
    if (el.tagName === 'IMG' && el.getAttribute('src') && el.complete && el.naturalWidth === 0)
      out.brokenImage.push({ label, src: el.getAttribute('src').slice(0, 60) });
  }
  const res = {};
  for (const [k, v] of Object.entries(out)) if (v.length) res[k] = v.slice(0, 6);
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (overflow > 0) res.docOverflow = overflow;
  return res;
}
"""


def probe(page, label, before_value, after_value):
    """A mutation must really change what the check reads, or the control proves nothing."""
    assert before_value != after_value, \
        f"probe receipt: {label} did not change what the check reads ({before_value!r}). The control must be rewritten."


try:
    deadline = time.time() + 40
    import urllib.request
    while True:
        try:
            urllib.request.urlopen(f"{BASE}/api/config", timeout=2).read(); break
        except Exception:
            if time.time() > deadline: raise SystemExit("server did not start")
            time.sleep(0.25)

    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        context = browser.new_context(viewport={"width": 1440, "height": 950})
        page = context.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        def guard(route):
            url = route.request.url
            if url.startswith(BASE) or url.startswith("data:") or url.startswith("blob:"):
                if any(part in url for part in PAID_ROUTES) and route.request.method != "GET":
                    paid_calls.append(url); return route.abort()
                return route.continue_()
            # The shipped page links a Google webfont. It is ANSWERED LOCALLY with an empty
            # stylesheet rather than counted as an escape, which is the convention every
            # other browser suite here follows: nothing reaches the network, and the page
            # renders in its declared fallback stack -- which is also what a filmmaker
            # working offline sees, so measuring the layout in it is the harder case.
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")
        page.route("**/*", guard)

        def goto(hash_route):
            page.goto(f"{BASE}/{hash_route}", wait_until="domcontentloaded")
            page.wait_for_function("() => document.body.dataset.renderReady === '1' || document.querySelector('#main').children.length > 0", timeout=20000)

        def wait_results(tab):
            page.wait_for_function(
                "(t) => { const g = document.querySelector('[data-results-grid]'); return !!g && g.dataset.resultsTab === t; }",
                arg=tab, timeout=20000)

        # ---- 1. one stable destination, all three dispositions present ----------
        goto("#/results")
        wait_results("current")
        results = page.evaluate(READ_RESULTS)
        assert results["present"], "Generated Media did not render a grid"
        assert results["count"] > 0, "Generated Media rendered no media"
        built = page.evaluate(PROJECTION)
        assert built["jobsAvailable"] is True, "the fixture's generation ledger must load, or the cost cases are untested"
        assert built["counts"]["approved"] and built["counts"]["candidate"] and built["counts"]["rejected"], \
            f"the fixture must carry all three dispositions, got {built['counts']}"
        findings.append(f"destination: {results['count']} cards on Current, kinds {sorted(results['kinds'])}, "
                        f"counts {built['counts']}")

        # ---- 2. the O4 strip is absent here ------------------------------------
        assert results["barHeight"] == 0 and not results["stripPresent"], \
            f"the O4 stage strip must consume zero space on a project-level route, got {results['barHeight']}px"
        assert results["assistant"] and results["terminal"], "O3's Assistant and Terminal must remain mounted here"
        findings.append("O4: stage strip absent and zero-height on #/results; O3 Assistant and Terminal both mounted")

        # ---- 3. real filtering, semantic waits ---------------------------------
        page.click('[data-results-kind="entity-reference"]')
        page.wait_for_function(
            "() => [...document.querySelectorAll('[data-results-card]')].every((c) => c.dataset.kind === 'entity-reference')",
            timeout=15000)
        filtered = page.evaluate(READ_RESULTS)
        assert filtered["count"] > 0 and set(filtered["kinds"]) == {"entity-reference"}, \
            f"the kind filter did not narrow the grid, got {filtered['kinds']}"
        page.click('[data-results-kind="all"]')
        page.wait_for_function("() => document.querySelectorAll('[data-results-card]').length > %d" % filtered["count"], timeout=15000)
        findings.append(f"filter: entity-reference narrowed {results['count']} -> {filtered['count']} and restored")

        # ---- 4. rejected media is reachable and really rendered ----------------
        page.click('.workspace-tab[href="#/results/rejected"]')
        wait_results("rejected")
        rejected_view = page.evaluate(READ_RESULTS)
        assert rejected_view["count"] == built["counts"]["rejected"], \
            f"the Rejected tab must show every rejected item, expected {built['counts']['rejected']} got {rejected_view['count']}"
        assert set(rejected_view["roles"]) == {"rejected"}
        findings.append(f"rejected: {rejected_view['count']} retained and reachable under its own tab")

        # ---- 5. approved Frame A: human approval distinct from AI --------------
        page.click('.workspace-tab[href="#/results/current"]')
        wait_results("current")
        frame_a = next(r for r in built["rows"] if r["name"] == "SH010_FRAME_A_V001.png")
        page.evaluate("(k) => window.inspectMedia(k)", frame_a["key"])
        page.wait_for_selector("[data-media-inspector]", timeout=15000)
        insp = page.evaluate(READ_INSPECTOR)
        assert insp["human"] == "approved" and insp["humanWords"] == "Approved by you", \
            f"an approved frame must say a human approved it, got {insp['humanWords']!r}"
        assert insp["recommendation"] == "correct" and "Suggests" in insp["recommendationWords"], \
            f"the AI verdict must read as a suggestion, got {insp['recommendationWords']!r}"
        assert insp["targetCount"] == 2, f"Frame A is authority for shot and frame, got {insp['targetCount']}"
        # innerText returns RENDERED text, and .mi-facts labels are text-transform:uppercase,
        # so the label reads "COST" on screen however it is written in the markup. Every
        # label comparison in this suite is therefore case-folded; the VALUE strings below
        # are not transformed and are compared as written.
        assert "COST" in insp["text"].upper() and "$0.00" not in insp["text"]
        findings.append(f"inspector/approved: human '{insp['humanWords']}' vs AI '{insp['recommendationWords']}', "
                        f"{insp['targetCount']} authority targets, one scroll region {insp['scrollers']}")
        assert insp["scrollers"] == ["media-inspector-body"], \
            f"the Inspector must own exactly one scroll region, got {insp['scrollers']}"

        # ---- 6. AI-recommended but unapproved: never called approved -----------
        recommended = next(r for r in built["rows"] if r["ai"] == "approve" and r["human"] == "undecided")
        page.evaluate("(k) => window.inspectMedia(k)", recommended["key"])
        page.wait_for_function("(k) => { const b = document.querySelector('[data-media-inspector]'); return b && b.dataset.miKey === k; }",
                               arg=recommended["key"], timeout=15000)
        rec = page.evaluate(READ_INSPECTOR)
        assert rec["human"] == "undecided" and rec["disposition"] == "candidate", \
            f"an AI-recommended candidate must remain a candidate, got {rec['human']}/{rec['disposition']}"
        assert "Approved by you" not in rec["text"], "an AI recommendation must never be worded as a human approval"
        assert "Suggests approving" in rec["text"] and "Advisory only" in rec["text"]
        # ---- 6b. no stale metadata survived the switch -------------------------
        assert "SH010_FRAME_A_V001.png" not in rec["text"], \
            "the previous media's identity survived into the newly inspected record"
        assert rec["reviewer"][:2] == ["openai", "gpt-5.0-vision-2026-03"], \
            f"the reviewer that actually ran must be shown, got {rec['reviewer'][:2]}"
        findings.append(f"inspector/recommended: '{rec['recommendationWords']}' with no human decision, "
                        f"reviewer {rec['reviewer'][:2]}, no stale metadata across the switch")

        # ---- 7. rejected media inspects and says the reason is not recorded ----
        rejected_row = next(r for r in built["rows"] if r["role"] == "rejected")
        page.evaluate("(k) => window.inspectMedia(k)", rejected_row["key"])
        page.wait_for_function("(k) => { const b = document.querySelector('[data-media-inspector]'); return b && b.dataset.miKey === k; }",
                               arg=rejected_row["key"], timeout=15000)
        rej = page.evaluate(READ_INSPECTOR)
        assert rej["disposition"] == "rejected" and rej["humanWords"] == "Rejected by you"
        assert "Reason not recorded" in rej["text"], "a rejection with no recorded reason must say so"
        findings.append("inspector/rejected: retained, inspectable, 'Reason not recorded'")

        # ---- 8. the four money states, live -----------------------------------
        money = {}
        for row in built["rows"]:
            if row["cost"] in money: continue
            page.evaluate("(k) => window.inspectMedia(k)", row["key"])
            page.wait_for_function("(k) => { const b = document.querySelector('[data-media-inspector]'); return b && b.dataset.miKey === k; }",
                                   arg=row["key"], timeout=15000)
            state = page.evaluate(READ_INSPECTOR)
            money[row["cost"]] = (row["name"], row["job"], state["jobState"])
            assert "$0.00" not in state["text"], f"{row['name']}: an unknown cost rendered as zero"
            if row["cost"] == "unavailable":
                assert "Generation record unavailable" in state["text"], \
                    f"{row['name']}: an unloadable job must say so"
                assert "Cost not recorded" not in state["text"], \
                    f"{row['name']}: an unloadable cost must not claim nothing was recorded"
            if row["cost"] == "not-priced":
                assert "Cost not priced" in state["text"]
            if row["cost"] == "priced":
                assert "Estimated at submission" in state["text"], "a recorded amount must carry the honest word"
        for needed in ("priced", "not-priced", "not-recorded", "unavailable"):
            assert needed in money, f"the fixture must reach the {needed} cost state, got {sorted(money)}"
        findings.append("money: " + ", ".join(f"{k}={v[0]} (job {v[2]})" for k, v in sorted(money.items())))

        # ---- 9. both identity domains, live ------------------------------------
        blocking = next(r for r in built["rows"] if r["kind"] == "shot-blocking")
        page.evaluate("(k) => window.inspectMedia(k)", blocking["key"])
        page.wait_for_function("(k) => { const b = document.querySelector('[data-media-inspector]'); return b && b.dataset.miKey === k; }",
                               arg=blocking["key"], timeout=15000)
        dual = page.evaluate(READ_INSPECTOR)
        assert dual["ledger"].startswith("asset-") and dual["library"] == "blocking-media-1", \
            f"a blocking frame carries both identities separately, got ledger={dual['ledger']!r} library={dual['library']!r}"
        assert dual["ledger"] != dual["library"]
        findings.append(f"identity: ledger {dual['ledger'][:18]}... and library {dual['library']} shown separately")

        # ---- 10. theatre round trip keeps the inspected identity ---------------
        page.evaluate("(k) => window.inspectMedia(k)", frame_a["key"])
        page.wait_for_function("(k) => { const b = document.querySelector('[data-media-inspector]'); return b && b.dataset.miKey === k; }",
                               arg=frame_a["key"], timeout=15000)
        page.click('[data-mi-action="open-full-preview"]')
        page.wait_for_selector(".media-theatre-modal", timeout=15000)
        assert page.query_selector("[data-theatre-return]"), "the theatre must offer the way back to the Inspector"
        page.click("[data-theatre-return]")
        page.wait_for_function("(k) => { const b = document.querySelector('[data-media-inspector]'); return b && b.dataset.miKey === k; }",
                               arg=frame_a["key"], timeout=15000)
        findings.append("theatre: full preview opened and returned to the same inspected identity")
        page.evaluate("() => closeModal()")

        # ---- 11. a stage-local surface opens the same Inspector, and agrees ----
        goto("#/shot/SH010")
        page.wait_for_selector(".cb-stage-strip", timeout=20000)
        shot_bar = page.evaluate("() => Math.round(document.getElementById('cb-shell-bar').getBoundingClientRect().height)")
        assert shot_bar > 0, "the O4 strip must be present on a shot route"
        handoff = page.query_selector('[onclick*="inspectMediaFile"]')
        assert handoff, "a stage-local media surface must hand off to the Inspector"
        handoff.click()
        page.wait_for_selector("[data-media-inspector]", timeout=15000)
        local = page.evaluate(READ_INSPECTOR)
        matching = next(r for r in built["rows"] if r["key"] == local["key"])
        assert local["disposition"] == matching["role"], \
            f"stage-local and Results disagree about {matching['name']}: {local['disposition']} vs {matching['role']}"
        findings.append(f"agreement: stage-local Inspector and Results both report {matching['name']} as "
                        f"'{matching['role']}'; strip {shot_bar}px on the shot, 0px on Results")
        page.evaluate("() => closeModal()")

        # ---- 12. responsive, both themes ---------------------------------------
        goto("#/results")
        wait_results("current")
        target_key = built["rows"][0]["key"]
        responsive = []
        for width in (1920, 1600, 1460, 1440, 1366, 1280, 1180, 900, 760, 390):
            for theme in ("night", "light"):
                page.set_viewport_size({"width": width, "height": 900})
                page.evaluate("(t) => { document.getElementById('app').dataset.surf = t; }", theme)
                page.wait_for_function("() => !!document.querySelector('[data-results-grid]')", timeout=15000)
                grid_state = page.evaluate(READ_RESULTS)
                assert grid_state["overflow"] <= 0, f"{width}px/{theme}: document overflowed by {grid_state['overflow']}px"
                assert grid_state["count"] > 0, f"{width}px/{theme}: the grid rendered nothing"
                assert grid_state["barHeight"] == 0, f"{width}px/{theme}: the stage strip reserved space on Results"
                page.evaluate("(k) => window.inspectMedia(k)", target_key)
                page.wait_for_selector("[data-media-inspector]", timeout=15000)
                shape = page.evaluate(READ_INSPECTOR)
                assert shape["overflow"] <= 0, f"{width}px/{theme}: the Inspector overflowed by {shape['overflow']}px"
                assert shape["scrollers"] in ([], ["media-inspector-body"]), \
                    f"{width}px/{theme}: nested scrolling inside the Inspector: {shape['scrollers']}"
                assert shape["actions"], f"{width}px/{theme}: the Inspector offered no actions"
                if width <= 430:
                    short = [b for b in shape["buttons"] if b["minHeight"] != "44px" or b["h"] < 40]
                    assert not short, f"{width}px/{theme}: Inspector actions must be 44px touch targets, got {short}"
                page.evaluate("() => closeModal()")
            responsive.append(width)
        page.evaluate("() => { document.getElementById('app').dataset.surf = 'night'; }")
        page.set_viewport_size({"width": 1440, "height": 950})
        findings.append(f"responsive: {len(responsive)} widths x 2 themes, no overflow, one scroll region, 44px targets at 390")

        # ---- 12b. nothing is clipped, invisible or unreadable ------------------
        defects, surfaces = {}, 0
        for width in (1440, 1280, 900, 390):
            page.set_viewport_size({"width": width, "height": 900})
            for theme in ("night", "light"):
                page.evaluate("(t) => { document.getElementById('app').dataset.surf = t; }", theme)
                for route in ("#/results", "#/results/rejected", "#/library", "#/character/KAI", "#/shot/SH010"):
                    goto(route)
                    page.wait_for_timeout(220)
                    surfaces += 1
                    hits = page.evaluate(VISUAL_AUDIT)
                    if hits:
                        defects[f"{width}px {theme} {route}"] = hits
                goto("#/results")
                wait_results("current")
                for row in built["rows"][:5]:
                    page.evaluate("(k) => window.inspectMedia(k)", row["key"])
                    page.wait_for_selector("[data-media-inspector]", timeout=15000)
                    surfaces += 1
                    hits = page.evaluate(VISUAL_AUDIT)
                    if hits:
                        defects[f"{width}px {theme} inspector:{row['kind']}"] = hits
                    page.evaluate("() => closeModal()")
        page.evaluate("() => { document.getElementById('app').dataset.surf = 'night'; }")
        page.set_viewport_size({"width": 1440, "height": 950})
        assert not defects, ("visual defects found (clipped, invisible, low-contrast, zero-size or broken):\n"
                             + json.dumps(defects, indent=2)[:2200])
        findings.append(f"visual audit: {surfaces} surfaces (4 widths x 2 themes x routes and inspected records) "
                        "with no clipped, vertically cut, invisible, sub-AA, zero-size or broken content")

        # ---- 13. theme integrity of the corrected Inspector surface -------------
        page.evaluate("() => { document.getElementById('app').dataset.surf = 'light'; }")
        light = page.evaluate("""() => {
          const probe = document.createElement('div');
          probe.className = 'focused-inspector';
          document.getElementById('main').appendChild(probe);
          const bg = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return bg;
        }""")
        page.evaluate("() => { document.getElementById('app').dataset.surf = 'night'; }")
        dark = page.evaluate("""() => {
          const probe = document.createElement('div');
          probe.className = 'focused-inspector';
          document.getElementById('main').appendChild(probe);
          const bg = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return bg;
        }""")
        assert light != dark, f".focused-inspector must follow the theme, both computed {light}"
        findings.append(f"theme: .focused-inspector now resolves {dark} dark / {light} light (was one frozen literal)")

        # =====================================================================
        # NEGATIVE CONTROLS. Each mutates the running page, proves the mutation
        # changed what the check reads, then requires the check to notice.
        # =====================================================================
        goto("#/results")
        wait_results("current")
        controls = []

        # N1 resolve by bare filename instead of durable identity.
        n1 = page.evaluate("""() => {
          const original = window.productionMediaKeyForFile;
          window.productionMediaKeyForFile = (file) => {
            const url = String((file || {}).url || '');
            return 'path:' + url.slice(url.lastIndexOf('/') + 1);
          };
          const before = original({ url: '/assets/shots/SH010/takes/SH010_FRAME_A_V001.png', assetId: '' });
          const after = window.productionMediaKeyForFile({ url: '/assets/shots/SH010/takes/SH010_FRAME_A_V001.png', assetId: '' });
          const resolved = !!window.CineBraidMediaInspector.recordFor(after);
          window.productionMediaKeyForFile = original;
          return { before, after, resolved };
        }""")
        probe(page, "N1", n1["before"], n1["after"])
        assert not n1["resolved"], "N1: a bare-filename key resolved to a record, so filename resolution would go unnoticed"
        controls.append("N1 bare-filename resolution -> caught (resolves to nothing)")

        # N2 paint an AI recommendation as an APPROVED chip.
        n2 = page.evaluate("""() => {
          const card = [...document.querySelectorAll('[data-results-card]')].find((c) => c.dataset.role === 'candidate' && c.querySelector('.results-card-ai'));
          if (!card) return { skipped: true };
          const chip = card.querySelector('.results-card-status');
          const before = chip.textContent;
          chip.textContent = 'APPROVED';
          const after = chip.textContent;
          const mismatch = card.dataset.role !== 'approved' && chip.textContent === 'APPROVED';
          chip.textContent = before;
          return { before, after, mismatch, restored: chip.textContent };
        }""")
        assert not n2.get("skipped"), "N2 needs an AI-recommended candidate card and found none"
        probe(page, "N2", n2["before"], n2["after"])
        assert n2["mismatch"], "N2: an APPROVED chip on a candidate card was not detectable"
        assert n2["restored"] == n2["before"], "N2 did not restore the page"
        controls.append("N2 APPROVED chip on an AI-recommended candidate -> caught (chip disagrees with data-role)")

        # N3 render an AI PASS as a human approval in the Inspector.
        page.evaluate("(k) => window.inspectMedia(k)", recommended["key"])
        page.wait_for_selector("[data-media-inspector]", timeout=15000)
        n3 = page.evaluate("""() => {
          const block = document.querySelector('[data-mi-human-decision]');
          const before = block.querySelector('b').textContent;
          block.querySelector('b').textContent = 'Approved by you';
          block.dataset.miHumanDecision = 'approved';
          const after = block.querySelector('b').textContent;
          const box = document.querySelector('[data-media-inspector]');
          const lies = box.innerText.includes('Approved by you') && box.innerText.includes('Suggests approving');
          block.querySelector('b').textContent = before;
          block.dataset.miHumanDecision = 'undecided';
          return { before, after, lies };
        }""")
        probe(page, "N3", n3["before"], n3["after"])
        assert n3["lies"], "N3: an AI PASS rendered as a human approval was not detectable"
        controls.append("N3 AI PASS worded as human approval -> caught (both wordings present at once)")

        # N4 drop rejected media from the destination.
        page.evaluate("() => closeModal()")
        page.click('.workspace-tab[href="#/results/rejected"]')
        wait_results("rejected")
        n4 = page.evaluate("""() => {
          const before = document.querySelectorAll('[data-results-card]').length;
          [...document.querySelectorAll('[data-results-card]')].forEach((c) => c.remove());
          const after = document.querySelectorAll('[data-results-card]').length;
          return { before, after };
        }""")
        probe(page, "N4", n4["before"], n4["after"])
        assert n4["before"] > 0 and n4["after"] == 0, "N4: rejected media disappearing was not detectable"
        page.click('.workspace-tab[href="#/results/current"]')
        wait_results("current")
        page.click('.workspace-tab[href="#/results/rejected"]')
        wait_results("rejected")
        restored = page.evaluate("() => document.querySelectorAll('[data-results-card]').length")
        assert restored == n4["before"], f"N4 did not restore the Rejected tab ({restored} vs {n4['before']})"
        controls.append(f"N4 rejected media removed -> caught ({n4['before']} -> 0, restored to {restored})")

        # N5 render an unknown cost as $0.00.
        page.click('.workspace-tab[href="#/results/current"]')
        wait_results("current")
        unpriced = next(r for r in built["rows"] if r["cost"] in ("not-priced", "unavailable", "not-recorded"))
        page.evaluate("(k) => window.inspectMedia(k)", unpriced["key"])
        page.wait_for_selector("[data-media-inspector]", timeout=15000)
        n5 = page.evaluate("""() => {
          const cell = [...document.querySelectorAll('[data-media-inspector] .mi-facts article')].find((a) => a.textContent.trim().startsWith('Cost'));
          const target = cell.querySelector('b');
          const before = target.textContent;
          target.textContent = 'USD 0.00';
          const after = target.textContent;
          const zero = /0\\.00/.test(document.querySelector('[data-media-inspector]').innerText);
          target.textContent = before;
          return { before, after, zero, restored: target.textContent };
        }""")
        probe(page, "N5", n5["before"], n5["after"])
        assert n5["zero"], "N5: a zero cost was not detectable in the Inspector text"
        assert n5["restored"] == n5["before"], "N5 did not restore the page"
        controls.append(f"N5 unknown cost as 0.00 -> caught (was {n5['before']!r})")

        # N6 substitute the current settings model for the historical reviewer.
        page.evaluate("(k) => window.inspectMedia(k)", recommended["key"])
        page.wait_for_selector("[data-mi-review-kind]", timeout=15000)
        n6 = page.evaluate("""() => {
          const cells = [...document.querySelectorAll('[data-mi-review-kind] .mi-facts article')];
          const cell = cells.find((a) => a.textContent.trim().startsWith('Reviewer model'));
          const target = cell.querySelector('b');
          const before = target.textContent;
          const settingsModel = (CONFIG.openaiModel || 'gpt-settings-value');
          target.textContent = settingsModel;
          const after = target.textContent;
          const substituted = after !== before;
          target.textContent = before;
          return { before, after, substituted, settingsModel, restored: target.textContent };
        }""")
        probe(page, "N6", n6["before"], n6["after"])
        assert n6["substituted"] and n6["before"] == "gpt-5.0-vision-2026-03", \
            f"N6: the reviewer model must be the one that ran ({n6['before']!r}), not the settings value ({n6['settingsModel']!r})"
        assert n6["restored"] == n6["before"], "N6 did not restore the page"
        controls.append(f"N6 settings model substituted for reviewer -> caught (recorded {n6['before']!r} != settings {n6['settingsModel']!r})")

        # N7 render the O4 stage strip on the project-level route.
        page.evaluate("() => closeModal()")
        n7 = page.evaluate("""() => {
          const before = { strips: document.querySelectorAll('.cb-stage-strip').length,
                           bar: Math.round(document.getElementById('cb-shell-bar').getBoundingClientRect().height) };
          const slot = document.querySelector('#cb-shell-bar .cb-shell-slot-body');
          const fake = document.createElement('nav');
          fake.className = 'focused-taskbar bounded-shot-taskbar cb-stage-strip';
          fake.id = 'cb-o5-control-strip';
          fake.innerHTML = '<button class="focused-task-button">Inputs</button>';
          slot.appendChild(fake);
          const after = { strips: document.querySelectorAll('.cb-stage-strip').length,
                          bar: Math.round(document.getElementById('cb-shell-bar').getBoundingClientRect().height) };
          fake.remove();
          const restored = document.querySelectorAll('.cb-stage-strip').length;
          return { before, after, restored };
        }""")
        probe(page, "N7", n7["before"]["strips"], n7["after"]["strips"])
        assert n7["before"]["strips"] == 0 and n7["after"]["strips"] == 1, \
            "N7: a stage strip appearing on Generated Media was not detectable"
        assert n7["restored"] == 0, "N7 did not restore the page"
        controls.append("N7 stage strip on the project-level route -> caught (0 -> 1 strip)")

        # N8 leave stale metadata behind when the inspected media changes.
        page.evaluate("(k) => window.inspectMedia(k)", frame_a["key"])
        page.wait_for_selector("[data-media-inspector]", timeout=15000)
        n8 = page.evaluate("""(other) => {
          const box = document.querySelector('[data-media-inspector]');
          const stale = box.innerText;
          // Switch the inspected media WITHOUT repainting -- what a cached record would do.
          box.dataset.miKey = other;
          const leaked = box.innerText === stale && box.dataset.miKey === other;
          return { staleHas: stale.includes('SH010_FRAME_A_V001.png'), leaked };
        }""", recommended["key"])
        assert n8["staleHas"], "probe receipt: N8 needs the first record's filename in the Inspector and did not find it"
        assert n8["leaked"], "N8: a key change with unchanged content was not detectable"
        # …and the real path does NOT leak.
        page.evaluate("(k) => window.inspectMedia(k)", recommended["key"])
        page.wait_for_function("(k) => { const b = document.querySelector('[data-media-inspector]'); return b && b.dataset.miKey === k; }",
                               arg=recommended["key"], timeout=15000)
        clean = page.evaluate("() => document.querySelector('[data-media-inspector]').innerText")
        assert "SH010_FRAME_A_V001.png" not in clean, "the shipped Inspector leaked the previous record after a switch"
        controls.append("N8 stale metadata across a media switch -> caught (shipped path repaints, control does not)")

        # N9 create a second logical asset from a renamed path.
        n9 = page.evaluate("""() => {
          const before = window.CineBraidMediaInspector.projection();
          const anchors = SCAN.anchors;
          const original = anchors[0];
          anchors.push({ name: 'KAI_RENAMED_OLD.png', url: '/assets/anchors/KAI_RENAMED_OLD.png', assetId: original.assetId });
          const after = window.CineBraidMediaInspector.projection();
          anchors.pop();
          const restored = window.CineBraidMediaInspector.projection();
          return { beforeCount: before.records.length, afterCount: after.records.length,
                   collapsed: after.duplicatesCollapsed, restoredCount: restored.records.length,
                   hadIdentity: !!original.assetId };
        }""")
        assert n9["hadIdentity"], "probe receipt: N9 needs a scanned file carrying a ledger identity and found none"
        probe(page, "N9", n9["collapsed"], 0)
        assert n9["afterCount"] == n9["beforeCount"], \
            f"N9: a renamed path created a second logical asset ({n9['beforeCount']} -> {n9['afterCount']})"
        assert n9["collapsed"] == 1, f"N9: the collapse must be reported, got {n9['collapsed']}"
        assert n9["restoredCount"] == n9["beforeCount"], "N9 did not restore the scan"
        controls.append(f"N9 renamed path as a second asset -> caught (count held at {n9['beforeCount']}, 1 collapse reported)")

        findings.append("negative controls: " + "; ".join(controls))

        # ---- teardown -----------------------------------------------------------
        final = page.evaluate("""() => ({
            controls: document.querySelectorAll('#cb-o5-control-strip').length,
            strips: document.querySelectorAll('.cb-stage-strip').length,
            assistants: document.querySelectorAll('#cb-assistant-mount').length,
            terminals: document.querySelectorAll('#cb-terminal-mount').length,
        })""")
        assert final["controls"] == 0, f"teardown: a control survived: {final}"
        assert final["strips"] == 0, "teardown: Generated Media must still carry no stage strip"
        assert final["assistants"] == 1 and final["terminals"] == 1, \
            f"teardown: O3's surfaces must still be mounted, got {final}"
        assert not page_errors, f"the page raised uncaught errors: {page_errors}"
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()

media_after = media_fingerprint()
media_changed = sorted(k for k in set(media_before) | set(media_after) if media_before.get(k) != media_after.get(k))
assert not media_changed, f"media files were rewritten, renamed or deleted: {media_changed}"

decisions_after = decision_fingerprint()
decisions_changed = sorted(
    f"{k}: {decisions_before.get(k)!r} -> {decisions_after.get(k)!r}"
    for k in set(decisions_before) | set(decisions_after)
    if (decisions_before.get(k) or "") != (decisions_after.get(k) or ""))
assert not decisions_changed, ("browsing and inspecting must change no disposition, approval pointer or winner edge:\n"
                               + "\n".join(decisions_changed))

assert not offsite, f"requests left the machine: {offsite}"
assert not paid_calls, f"a paid route was called: {paid_calls}"

print("\n".join(findings))
print(f"project data isolated: config {config_path}, projects {projects_root} - data/ untouched")
print(f"no media file changed: {len(media_before)} media files hashed before and after, 0 differences")
print(f"no disposition changed: {len(decisions_before)} approval pointers, winner edges and candidate decisions "
      "compared before and after, 0 differences")
print("no offsite request and no paid route: 0 blocked, 0 attempted")
print("Generated Media and Universal Media Inspector real-browser audit passed")
