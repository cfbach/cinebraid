/* CINEBRAID v5.8.0 — bounded local agent workflows.
   Agents propose findings; users explicitly apply any production-record changes. */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { latestPromptBuild } = require("../../public/shared-build-history");

const PLAYBOOK_FILE = path.join(path.resolve(__dirname, "../.."), "PROMPT_PLAYBOOK_v1.md");
const PLAYBOOK = fs.existsSync(PLAYBOOK_FILE)
  ? fs.readFileSync(PLAYBOOK_FILE, "utf8")
  : "";
const IMG_EXT = /\.(png|jpe?g|webp)$/i;

function text(v) {
  return String(v == null ? "" : v)
    .replace(/\s+/g, " ")
    .trim();
}
function unique(xs) {
  return [...new Set((xs || []).filter(Boolean))];
}
function safeJson(raw) {
  const clean = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch {}
  const a = clean.indexOf("{"),
    b = clean.lastIndexOf("}");
  if (a >= 0 && b > a)
    try {
      return JSON.parse(clean.slice(a, b + 1));
    } catch {}
  return null;
}
function playbookExcerpt(sectionNames) {
  if (!PLAYBOOK) return "";
  const wanted = (sectionNames || []).map((x) => String(x).toLowerCase());
  const lines = PLAYBOOK.split(/\r?\n/),
    out = [];
  let active = false;
  for (const line of lines) {
    const top = /^#\s+(.+)/.exec(line);
    if (top) {
      active = wanted.some((x) => top[1].toLowerCase().includes(x));
      if (active) out.push(line);
      continue;
    }
    // Subheadings belong to the currently selected top-level tool section.
    if (active) out.push(line);
  }
  return out.join("\n").slice(0, 18000);
}
function playbookFor(profileId, method) {
  const id = String(profileId || "").toLowerCase(),
    sections = ["UNIVERSAL RULES"];
  if (id.includes("gpt-image-2"))
    sections.push(
      id.includes("edit") ? "GPT IMAGE 2 — EDIT" : "GPT IMAGE 2 — GENERATION",
    );
  if (id.includes("wan-2.7")) sections.push("WAN 2.7");
  if (id.includes("seedance-2")) {
    sections.push("SEEDANCE 2 — GENERAL");
    if (method === "flf" || id.includes("/flf"))
      sections.push("SEEDANCE 2 — FLF");
    else if (
      method === "r2v" ||
      id.includes("omni") ||
      id.includes("reference")
    )
      sections.push("SEEDANCE 2 — OMNI");
    else sections.push("SEEDANCE 2 — i2v");
  }
  sections.push("CROSS-TOOL");
  return playbookExcerpt(sections).slice(0, 14000);
}

function projectCorpus(P, projectDir) {
  const docs = [];
  const add = (type, id, title, body, meta = {}) => {
    body = text(body);
    if (body) docs.push({ type, id, title, text: body, meta });
  };
  add(
    "project",
    "project",
    P.meta?.title || "Project",
    [
      P.meta?.format,
      P.meta?.world?.setting,
      P.meta?.world?.include,
      P.meta?.world?.reject,
      (P.meta?.styleBlocks || []).map((x) => x.name + ": " + x.text).join("\n"),
    ].join("\n"),
  );
  for (const sc of P.scenes || [])
    add(
      "scene",
      sc.id,
      `${sc.id} — ${sc.title}`,
      [sc.whatHappens, sc.howItFeels, sc.stage, sc.audio?.notes].join("\n"),
      { scene: sc.id },
    );
  for (const s of P.shots || []) {
    const frames = (s.keyframes || [])
      .map(
        (f) =>
          `Frame ${f.label}: ${f.title || ""}; ${f.description || ""}; approved=${f.winner || "no"}`,
      )
      .join("\n");
    const motion = (s.clips || [])
      .map(
        (c) =>
          `Motion ${c.label || c.suffix}: ${c.title || ""}; method=${c.kind}; ${c.motionPrompt || c.note || ""}; ${c.fromFrame || ""}->${c.toFrame || ""}`,
      )
      .join("\n");
    add(
      "shot",
      s.id,
      `${s.id} — ${s.title}`,
      [
        s.desc,
        s.positioning,
        s.safe,
        s.notes,
        (s.risks || []).join("; "),
        frames,
        motion,
      ].join("\n"),
      { scene: s.scene, shot: s.id },
    );
  }
  for (const asset of P.mediaAssets || [])
    add(
      "media",
      asset.id,
      asset.title || asset.originalName || asset.file || asset.id,
      [
        asset.notes,
        asset.provenance,
        (asset.links || [])
          .map(
            (link) =>
              `${link.targetType}:${link.targetId}; role=${link.role || "planning-reference"}; beat=${link.beat || ""}; timecode=${link.timecode || ""}; context=${link.agentContext !== false}; generationInput=${!!link.generationInput}; notes=${link.notes || ""}; visualAnalysis=${link.visualAnalysis || ""}`,
          )
          .join("\n"),
      ].join("\n"),
      { file: asset.file || "" },
    );
  for (const [list, type] of [
    ["characters", "character"],
    ["locations", "location"],
    ["props", "prop"],
  ])
    for (const x of P[list] || []) {
      add(
        type,
        x.id,
        `${x.id} — ${x.name}`,
        [
          x.role,
          x.block,
          x.driftNotes,
          x.notes,
          (x.continuityStates || [])
            .map((s) => `${s.name}: ${s.notes || ""} ${s.appliesTo || ""}`)
            .join("\n"),
        ].join("\n"),
        { entity: x.id },
      );
    }
  for (const d of P.decisions || [])
    add(
      "decision",
      d.id || String(d.date),
      d.title || "Decision",
      [d.detail, d.appliesTo].join("\n"),
    );
  for (const s of P.sessions || [])
    add(
      "session",
      String(s.n),
      `Session ${s.n}`,
      [s.summary, (s.carryForward || []).join("; ")].join("\n"),
    );
  const dir = path.join(projectDir, "docs");
  if (fs.existsSync(dir))
    for (const name of fs
      .readdirSync(dir)
      .filter((x) => x.endsWith(".md"))
      .slice(0, 40)) {
      const raw = fs.readFileSync(path.join(dir, name), "utf8");
      const chunks = raw.match(/[\s\S]{1,5000}(?:\n\n|$)/g) || [raw];
      chunks.slice(0, 20).forEach((chunk, i) =>
        add("source", `${name}:${i + 1}`, `${name} · ${i + 1}`, chunk, {
          file: name,
        }),
      );
    }
  return docs.slice(0, 700);
}

function projectSourceFingerprint(P, projectDir) {
  const hash = crypto.createHash("sha256");
  const project = { ...(P || {}) };
  delete project.agentRuns;
  delete project.jobs;
  hash.update(JSON.stringify(project));
  const docsDir = path.join(projectDir, "docs");
  if (fs.existsSync(docsDir)) {
    const names = fs
      .readdirSync(docsDir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .slice(0, 40);
    for (const name of names) {
      hash.update("\nFILE:" + name + "\n");
      hash.update(
        fs.readFileSync(path.join(docsDir, name), "utf8").slice(0, 100000),
      );
    }
  }
  return hash.digest("hex");
}

function cosine(a, b) {
  let d = 0,
    aa = 0,
    bb = 0;
  const n = Math.min(a?.length || 0, b?.length || 0);
  for (let i = 0; i < n; i++) {
    d += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? d / Math.sqrt(aa * bb) : 0;
}
async function buildIndex({ P, projectDir, embedFn, embeddingModel, update }) {
  const docs = projectCorpus(P, projectDir);
  const vectors = [];
  const batch = 12;
  update(10, `Preparing ${docs.length} project records`);
  for (let i = 0; i < docs.length; i += batch) {
    const part = docs.slice(i, i + batch);
    const embs = await embedFn(
      part.map((x) => x.text),
      embeddingModel || undefined,
    );
    for (let j = 0; j < part.length; j++)
      vectors.push({ ...part[j], vector: embs[j] || [] });
    update(
      10 + Math.round(82 * Math.min(1, (i + part.length) / docs.length)),
      `Indexed ${Math.min(i + part.length, docs.length)} of ${docs.length}`,
    );
  }
  const out = {
    version: 2,
    createdAt: new Date().toISOString(),
    embeddingModel: embeddingModel || "",
    sourceFingerprint: projectSourceFingerprint(P, projectDir),
    count: vectors.length,
    items: vectors,
  };
  fs.writeFileSync(
    path.join(projectDir, "agent-index.json"),
    JSON.stringify(out),
  );
  return {
    summary: `Indexed ${vectors.length} project records for semantic retrieval.`,
    metrics: {
      records: vectors.length,
      model: embeddingModel || "configured embedding model",
    },
    proposals: [],
  };
}
async function retrieve({
  projectDir,
  embedFn,
  query,
  embeddingModel,
  limit = 12,
}) {
  const file = path.join(projectDir, "agent-index.json");
  if (!fs.existsSync(file)) return [];
  const idx = JSON.parse(fs.readFileSync(file, "utf8"));
  const [q] = await embedFn(
    [query],
    embeddingModel || idx.embeddingModel || undefined,
  );
  return (idx.items || [])
    .map((x) => ({ ...x, score: cosine(q, x.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ vector, ...x }) => x);
}
function deterministicHealth(P, scan) {
  const proposals = [];
  for (const s of P.shots || []) {
    const frames = (s.keyframes || []).filter((f) => f.required !== false);
    const missing = frames.filter((f) => !f.winner);
    if (missing.length)
      proposals.push({
        severity: "medium",
        type: "missing-frame",
        shotId: s.id,
        title: `${s.id} needs ${missing.map((f) => "Frame " + f.label).join(", ")}`,
        reason: "Required approved frame is missing.",
      });
    for (const c of s.clips || []) {
      if (["post", "reuse", "plan"].includes(c.kind)) continue;
      if (!(c.motionPrompt || c.note || "").trim())
        proposals.push({
          severity: "medium",
          type: "missing-motion",
          shotId: s.id,
          segmentId: c.id,
          title: `${s.id} Motion ${c.label || c.suffix} needs direction`,
          reason: "No canonical motion direction is recorded.",
        });
      if (c.kind === "flf") {
        const a = (s.keyframes || []).find((f) => f.id === c.fromFrame),
          b = (s.keyframes || []).find((f) => f.id === c.toFrame);
        if (!a?.winner || !b?.winner)
          proposals.push({
            severity: "high",
            type: "blocked-flf",
            shotId: s.id,
            segmentId: c.id,
            title: `${s.id} Motion ${c.label || c.suffix} is blocked`,
            reason: "FLF requires approved first and last frames.",
          });
      }
    }
    const takes = scan?.shots?.[s.id]?.takes || [];
    if (takes.length > 18)
      proposals.push({
        severity: "low",
        type: "review-load",
        shotId: s.id,
        title: `${s.id} has ${takes.length} candidates`,
        reason: "Use batched triage rather than one large visual review.",
      });
  }
  return proposals;
}

function stageGuideReferences(P, shot) {
  const ids = new Set([...(shot.characters || []), ...(shot.codes || [])]);
  const out = [];
  for (const [list, type] of [
    ["characters", "character"],
    ["locations", "location"],
    ["props", "prop"],
    ["audio", "audio"],
  ])
    for (const x of P[list] || [])
      if (ids.has(x.id))
        out.push({
          id: x.id,
          type,
          name: x.name || x.id,
          approved:
            x.workflowStatus === "APPROVED" || x.status === "APPROVED",
          notes: x.block || x.notes || "",
          continuityStates: x.continuityStates || [],
        });
  return out;
}
function stageGuideMedia(P, shot) {
  return (P.mediaAssets || [])
    .flatMap((asset) =>
      (asset.links || [])
        .filter(
          (link) =>
            link.targetType === "shot" &&
            String(link.targetId) === String(shot.id) &&
            link.agentContext !== false &&
            link.role !== "do-not-use",
        )
        .map((link) => ({
          id: asset.id,
          title: asset.title || asset.originalName || asset.file || asset.id,
          file: asset.file || "",
          kind: asset.kind || "image",
          role: link.role || "planning-reference",
          beat: link.beat || "",
          timecode: link.timecode || "",
          notes: link.notes || asset.notes || "",
          visualAnalysis: link.visualAnalysis || "",
          analyzedAt: link.analyzedAt || "",
          generationInput: !!link.generationInput,
          order: Number(link.order) || 0,
        })),
    )
    .sort((a, b) => a.order - b.order);
}
function shotStageGuideGaps(P, shot, stage) {
  const refs = stageGuideReferences(P, shot),
    media = stageGuideMedia(P, shot),
    frames = (shot.keyframes || []).filter((x) => x.required !== false),
    motion = shot.clips || [],
    generative = motion.filter((x) => !["plan", "post", "reuse"].includes(x.kind)),
    gaps = [];
  if (stage === "plan") {
    if (text(shot.desc).length < 12) gaps.push("Write the visible shot action.");
    if (text(shot.positioning).length < 8)
      gaps.push("Define framing, blocking, camera, or contact points.");
  } else if (stage === "references") {
    if (!refs.length && !media.length)
      gaps.push("Link canon records or add animatic / planning media for this shot.");
    const unapproved = refs.filter((x) => !x.approved);
    if (unapproved.length)
      gaps.push(`Approve or replace ${unapproved.map((x) => x.id).join(", ")}.`);
  } else if (stage === "frames") {
    if (!frames.length) gaps.push("Add at least one required keyframe.");
    for (const f of frames) {
      if (text(f.description).length < 8)
        gaps.push(`Describe Frame ${f.label || "?"}.`);
      if (!f.winner) gaps.push(`Approve Frame ${f.label || "?"}.`);
    }
  } else if (stage === "motion") {
    if (!motion.length) gaps.push("Add at least one motion unit.");
    for (const c of motion) {
      if (!["post", "reuse"].includes(c.kind) && text(c.motionPrompt || c.note).length < 8)
        gaps.push(`Write direction for Motion ${c.label || c.suffix || "?"}.`);
      const first = frames.find((f) => f.id === c.fromFrame),
        last = frames.find((f) => f.id === c.toFrame);
      if (c.kind === "i2v" && !first?.winner)
        gaps.push(`Motion ${c.label || c.suffix || "?"} needs an approved start frame.`);
      if (c.kind === "flf" && (!first?.winner || !last?.winner))
        gaps.push(`Motion ${c.label || c.suffix || "?"} needs approved first and last frames.`);
    }
  } else if (stage === "packages") {
    for (const f of frames)
      if (!f.winner && !(f.generationPackages || []).length)
        gaps.push(`Build a frame package for Frame ${f.label || "?"}.`);
    for (const c of generative)
      if (!c.videoWinner && !(c.generationPackages || []).length)
        gaps.push(`Build a motion package for Motion ${c.label || c.suffix || "?"}.`);
  } else if (stage === "review") {
    const frameReady = !frames.length || frames.every((f) => !!f.winner),
      motionReady = !generative.length || generative.every((c) => !!c.videoWinner);
    if (!(frameReady && motionReady && (frames.length || generative.length || shot.winner)))
      gaps.push("Approve the required frame and motion outputs.");
  } else if (stage === "finish") {
    const jobs = (P.finishJobs || []).filter((job) => job.scope === "shot" && job.shotId === shot.id);
    if (!jobs.length) gaps.push("Mark this stage not needed or add an approved image to the finishing queue.");
    for (const job of jobs) {
      if (["ready", "in-progress"].includes(job.status)) gaps.push(`${job.type || "Finishing"} for ${job.sourceFile || job.id} is not complete.`);
      if (job.status === "result-received" && !job.resultFile) gaps.push(`${job.type || "Finishing"} needs an imported result file for QC.`);
      if (job.status === "qc-approved" && !job.promotedAt) gaps.push(`${job.type || "Finishing"} passed QC but has not been promoted or closed.`);
    }
  }
  return unique(gaps);
}
function normalizeStageDraft(P, shot, stage, draft) {
  draft = draft && typeof draft === "object" ? draft : {};
  const changes = [],
    push = (path, value, reason = "") => {
      if (value == null || value === "") return;
      changes.push({ path, value, reason: text(reason) });
    };
  if (stage === "plan") {
    push("shot.desc", text(draft.desc), "Clarify the visible action.");
    push(
      "shot.positioning",
      text(draft.positioning),
      "Clarify framing, blocking, camera, and contact points.",
    );
  }
  if (stage === "references") {
    const validCharacters = new Set((P.characters || []).map((x) => x.id)),
      validCodes = new Set(
        [...(P.locations || []), ...(P.props || []), ...(P.audio || [])].map(
          (x) => x.id,
        ),
      );
    const characters = unique(
      (Array.isArray(draft.characters) ? draft.characters : []).filter((x) =>
        validCharacters.has(x),
      ),
    );
    const codes = unique(
      (Array.isArray(draft.codes) ? draft.codes : []).filter((x) =>
        validCodes.has(x),
      ),
    );
    if (characters.length)
      push("shot.characters", characters, "Link existing character records named by the shot context.");
    if (codes.length)
      push("shot.codes", codes, "Link existing location, prop, or audio records named by the shot context.");
  }
  if (stage === "frames") {
    for (const item of Array.isArray(draft.frames) ? draft.frames : []) {
      const frame = (shot.keyframes || []).find(
        (x) => x.id === item.id || x.label === item.label,
      );
      if (!frame) continue;
      push(`frame:${frame.id}.title`, text(item.title), "Clarify the frame's production purpose.");
      push(
        `frame:${frame.id}.description`,
        text(item.description),
        "Describe the visible composition without inventing new story action.",
      );
      push(`frame:${frame.id}.notes`, text(item.notes), "Add bounded continuity or execution notes.");
    }
  }
  if (stage === "motion") {
    const methods = new Set(["i2v", "flf", "r2v", "plan", "post", "reuse"]);
    for (const item of Array.isArray(draft.motion) ? draft.motion : []) {
      const unit = (shot.clips || []).find(
        (x) => x.id === item.id || x.label === item.label || x.suffix === item.suffix,
      );
      if (!unit) continue;
      push(`segment:${unit.id}.title`, text(item.title), "Clarify the unit's purpose.");
      push(
        `segment:${unit.id}.motionPrompt`,
        text(item.motionPrompt || item.direction),
        "Turn the canonical plan into one executable motion direction.",
      );
      push(`segment:${unit.id}.vo`, text(item.vo), "Carry relevant dialogue or performance direction.");
      if (methods.has(item.kind)) push(`segment:${unit.id}.kind`, item.kind, "Use the method that matches the approved inputs.");
      if (Number(item.dur) > 0)
        push(`segment:${unit.id}.dur`, Math.min(120, Number(item.dur)), "Fit the action to the planned shot duration.");
    }
  }
  return changes.slice(0, 20);
}
function stageWritableTargets(shot, stage) {
  const out = [];
  if (stage === "plan") {
    if (text(shot.desc).length < 12) out.push("shot.desc");
    if (text(shot.positioning).length < 8) out.push("shot.positioning");
  } else if (stage === "frames") {
    for (const frame of (shot.keyframes || []).filter((x) => x.required !== false)) {
      if (!text(frame.title)) out.push(`frame:${frame.id}.title`);
      if (text(frame.description).length < 8) out.push(`frame:${frame.id}.description`);
    }
  } else if (stage === "motion") {
    for (const unit of shot.clips || []) {
      if (!text(unit.title)) out.push(`segment:${unit.id}.title`);
      if (!["post", "reuse"].includes(unit.kind) && text(unit.motionPrompt || unit.note).length < 8)
        out.push(`segment:${unit.id}.motionPrompt`);
    }
  }
  return out;
}
function approvedFrameVisionInputs(projectDir, scan, shot) {
  const available = new Map(
    (scan?.shots?.[shot.id]?.takes || []).map((x) => [String(x.name), x]),
  );
  return (shot.keyframes || [])
    .filter((frame) => frame.winner && available.has(String(frame.winner)))
    .slice(0, 4)
    .map((frame) => ({
      id: frame.id,
      label: frame.label,
      title: frame.title || "",
      file: frame.winner,
      path: path.join(projectDir, "shots", shot.id, "takes", frame.winner),
    }))
    .filter((x) => fs.existsSync(x.path));
}
async function analyzeStageFrames({ projectDir, scan, shot, visionFn, config, update }) {
  const inputs = approvedFrameVisionInputs(projectDir, scan, shot);
  if (!visionFn || !inputs.length) return { frames: [], warning: "" };
  try {
    update(32, `Inspecting ${inputs.length} approved frame${inputs.length === 1 ? "" : "s"}`);
    const system = [
      "You are the visual shot-planning assistant inside CineBraid.",
      'Return ONLY JSON {"frames":[{"id":"","description":"","notes":""}]}.',
      "Describe only visible composition, subject action/pose, camera framing, screen direction, important objects and continuity details.",
      "Write a complete production description, not advice and not a caption such as 'man standing'.",
      "Do not invent story action outside the supplied shot context.",
    ].join("\n");
    const user = [
      `SHOT: ${shot.id} — ${shot.title || ""}`,
      `SHOT ACTION: ${shot.desc || ""}`,
      `FRAMING / BLOCKING: ${shot.positioning || ""}`,
      "IMAGE ORDER:",
      ...inputs.map((x, i) => `${i + 1}. id=${x.id}; Frame ${x.label}; title=${x.title || "untitled"}; file=${x.file}`),
    ].join("\n");
    const raw = await visionFn(
      system,
      user,
      inputs.map((x) => fs.readFileSync(x.path).toString("base64")),
      2600,
      undefined,
      config.models?.vision || undefined,
    );
    const parsed = safeJson(raw) || {};
    const rows = Array.isArray(parsed.frames) ? parsed.frames : [];
    return {
      frames: rows
        .map((row, i) => ({
          id: text(row.id) || inputs[i]?.id || "",
          label: inputs[i]?.label || "",
          title: text(row.title),
          description: text(row.description),
          notes: text(row.notes),
        }))
        .filter((x) => x.id && x.description),
      warning: "",
    };
  } catch (e) {
    return { frames: [], warning: `Approved-frame vision was unavailable: ${text(e.message || e)}` };
  }
}
function normalizeQualityAssessment(value, gaps, changes) {
  value = value && typeof value === "object" ? value : {};
  const score = Math.max(0, Math.min(100, Number(value.score) || (gaps.length ? 55 : changes.length ? 72 : 88)));
  const verdict = ["ready", "improve", "blocked"].includes(value.verdict)
    ? value.verdict
    : gaps.length
      ? changes.length
        ? "improve"
        : "blocked"
      : changes.length
        ? "improve"
        : "ready";
  return {
    verdict,
    score,
    rationale: text(value.rationale) || (verdict === "ready" ? "The stage contains the required production information and no material improvement was identified." : verdict === "improve" ? "The proposed field changes materially improve production clarity." : "Required information is still missing and no safe field draft was produced."),
    strengths: unique(Array.isArray(value.strengths) ? value.strengths.map(text) : []).slice(0, 5),
    risks: unique(Array.isArray(value.risks) ? value.risks.map(text) : []).slice(0, 5),
  };
}
async function runShotStageGuide({ P, scan, projectDir, scope, llmFn, visionFn, config, update }) {
  const shot = (P.shots || []).find((x) => x.id === scope.shotId);
  if (!shot) throw new Error("Shot not found");
  const stage = String(scope.stage || "plan");
  if (!["plan", "references", "frames", "motion", "packages", "review", "finish"].includes(stage))
    throw new Error("Unknown shot stage");
  const scene = (P.scenes || []).find((x) => x.id === shot.scene) || {},
    references = stageGuideReferences(P, shot),
    media = stageGuideMedia(P, shot),
    gaps = shotStageGuideGaps(P, shot, stage),
    intent = String(scope.intent || (gaps.length ? "fill-gaps" : "quality-review")),
    writableTargets = stageWritableTargets(shot, stage);
  update(20, `Reading ${shot.id} ${stage} context`);
  const visualDraft = stage === "frames"
    ? await analyzeStageFrames({ projectDir, scan, shot, visionFn, config, update })
    : { frames: [], warning: "" };
  const context = {
    project: P.meta?.title || "",
    scene: {
      id: scene.id,
      title: scene.title,
      beat: scene.whatHappens,
      feeling: scene.howItFeels,
    },
    shot: {
      id: shot.id,
      title: shot.title,
      desc: shot.desc,
      positioning: shot.positioning,
      safe: shot.safe,
      notes: shot.notes,
      risks: shot.risks || [],
      characters: shot.characters || [],
      codes: shot.codes || [],
      continuityStateSelections: shot.continuityStateSelections || {},
      keyframes: (shot.keyframes || []).map((f) => ({
        id: f.id,
        label: f.label,
        title: f.title,
        description: f.description,
        notes: f.notes,
        approved: !!f.winner,
      })),
      motion: (shot.clips || []).map((c) => ({
        id: c.id,
        label: c.label,
        title: c.title,
        kind: c.kind,
        dur: c.dur,
        fromFrame: c.fromFrame,
        toFrame: c.toFrame,
        motionPrompt: c.motionPrompt || c.note || "",
        vo: c.vo || "",
        packages: (c.generationPackages || []).length,
        approved: !!c.videoWinner,
      })),
    },
    references,
    planningMedia: media,
    approvedFrameObservations: visualDraft.frames,
    request: { intent, writableTargets },
    gaps,
  };
  const system = [
    "You are the scoped Shot Guide inside CineBraid's Production Coordinator.",
    'Return ONLY JSON {"summary":"","assessment":{"verdict":"ready|improve|blocked","score":0,"strengths":[""],"risks":[""],"rationale":""},"draft":{"desc":"","positioning":"","characters":[],"codes":[],"frames":[{"id":"","title":"","description":"","notes":""}],"motion":[{"id":"","title":"","kind":"i2v|flf|r2v|plan|post|reuse","dur":0,"motionPrompt":"","vo":""}]},"notes":[""]}.',
    `Work only on the requested ${stage} stage in ${intent} mode.`,
    "Use existing records and IDs only. Never invent characters, locations, props, dialogue, or story beats.",
    "Planning media metadata is context only. Approved-frame observations may be used as visual evidence when supplied.",
    "Return complete field values, not instructions such as 'Describe Frame A', 'add more detail', or 'complete manually'.",
    "When writableTargets are supplied, draft a safe value for every target that can be completed from the provided context.",
    "For frames, write what the frame visibly shows, its composition and production purpose; do not merely repeat the frame title.",
    "For quality-review mode, propose changes only when they are materially clearer or more production-usable than the existing text. It is acceptable to return no changes with a specific ready verdict.",
    "Preserve useful existing text. Keep canonical planning separate from model-specific adapter wording.",
    "For packages, review or finish, give a concise assessment and actionable notes but never fabricate a result, approval or completed external task.",
  ].join("\n");
  let parsed = {},
    plannerError = "";
  try {
    update(48, "Preparing bounded stage suggestions");
    const raw = await llmFn(
      "prompt",
      system,
      JSON.stringify(context),
      4200,
      undefined,
      config.models?.coordinator || undefined,
    );
    parsed = safeJson(raw) || {};
  } catch (e) {
    plannerError = text(e.message || e);
  }
  parsed.draft = parsed.draft && typeof parsed.draft === "object" ? parsed.draft : {};
  if (stage === "frames" && visualDraft.frames.length) {
    const existing = Array.isArray(parsed.draft.frames) ? parsed.draft.frames : [];
    const merged = new Map(existing.map((x) => [text(x.id || x.label), x]));
    for (const row of visualDraft.frames) {
      const prior = merged.get(row.id) || {};
      merged.set(row.id, {
        ...row,
        ...prior,
        description: text(prior.description) || row.description,
        notes: text(prior.notes) || row.notes,
      });
    }
    parsed.draft.frames = [...merged.values()];
  }
  let changes = normalizeStageDraft(P, shot, stage, parsed.draft);
  if (!plannerError && !changes.length && writableTargets.length) {
    try {
      update(70, "Repairing incomplete field draft");
      const repairSystem = [
        "You repair an incomplete CineBraid shot-stage draft.",
        'Return ONLY JSON {"draft":{"desc":"","positioning":"","characters":[],"codes":[],"frames":[{"id":"","title":"","description":"","notes":""}],"motion":[{"id":"","title":"","kind":"i2v|flf|r2v|plan|post|reuse","dur":0,"motionPrompt":"","vo":""}]}}.',
        "Fill the listed writableTargets with complete production-ready values from the supplied context.",
        "Do not return advice, placeholders, questions, or instructions to the user.",
        "Use existing IDs only and do not invent story content.",
      ].join("\n");
      const repairedRaw = await llmFn(
        "prompt",
        repairSystem,
        JSON.stringify({ context, priorResponse: parsed, writableTargets }),
        3200,
        undefined,
        config.models?.coordinator || undefined,
      );
      const repaired = safeJson(repairedRaw) || {};
      if (repaired.draft) parsed.draft = repaired.draft;
      changes = normalizeStageDraft(P, shot, stage, parsed.draft);
    } catch (e) {
      plannerError = text(e.message || e);
    }
  }
  const assessment = normalizeQualityAssessment(parsed.assessment, gaps, changes),
    unresolved = gaps.filter((gap) => {
      if (changes.length && /Describe Frame|Write the visible shot action|Define framing|Write direction/i.test(gap)) return false;
      return true;
    }),
    notes = unique([
      ...(Array.isArray(parsed.notes) ? parsed.notes.map(text) : []),
      ...(visualDraft.warning ? [visualDraft.warning] : []),
      ...unresolved,
    ]).slice(0, 10),
    proposals = changes.length || (!gaps.length && assessment.verdict === "ready")
      ? []
      : [{
          severity: assessment.verdict === "blocked" ? "medium" : "low",
          type: "shot-stage",
          shotId: shot.id,
          title: `${stage[0].toUpperCase() + stage.slice(1)} needs human input`,
          reason: notes.join(" ") || assessment.rationale,
          suggestedAction: "Open the stage and supply the missing production decision that could not be inferred safely.",
        }];
  if (plannerError)
    proposals.unshift({
      severity: "low",
      type: "agent-availability",
      shotId: shot.id,
      title: "AI stage drafting was unavailable",
      reason: plannerError,
      suggestedAction: "The deterministic stage gaps are still shown below.",
    });
  update(92, "Preparing the shot-stage draft");
  return {
    summary:
      text(parsed.summary) ||
      (changes.length
        ? `Prepared ${changes.length} concrete field change${changes.length === 1 ? "" : "s"} for ${shot.id} ${stage}.`
        : assessment.verdict === "ready"
          ? `${shot.id} ${stage} is production-ready; no material field change was proposed.`
          : `Reviewed ${shot.id} ${stage}; ${gaps.length} item${gaps.length === 1 ? "" : "s"} still require attention.`),
    metrics: {
      shot: shot.id,
      stage,
      gaps: gaps.length,
      changes: changes.length,
      quality: assessment.score,
      mode: plannerError ? "AI unavailable" : intent === "quality-review" ? "quality review" : "field drafting",
    },
    proposals: proposals.slice(0, 3),
    qualityAssessment: assessment,
    stageDraft: {
      stage,
      shotId: shot.id,
      changes,
      notes,
      writableTargets,
      visualEvidenceUsed: visualDraft.frames.length,
    },
  };
}
async function runCoordinator({
  P,
  scan,
  projectDir,
  llmFn,
  visionFn,
  embedFn,
  config,
  scope = {},
  update,
}) {
  if (scope.shotId && scope.stage)
    return runShotStageGuide({ P, scan, projectDir, scope, llmFn, visionFn, config, update });
  const base = deterministicHealth(P, scan);
  update(20, "Reading project health and recent decisions");
  let retrieved = [];
  try {
    retrieved = await retrieve({
      projectDir,
      embedFn,
      query:
        "current blockers priorities continuity risks and next production actions",
      embeddingModel: config.models?.embedding,
      limit: 14,
    });
  } catch {}
  update(42, "Asking the production coordinator");
  const compact = {
    project: P.meta?.title,
    scenes: (P.scenes || []).map((x) => ({
      id: x.id,
      title: x.title,
      beat: x.whatHappens,
    })),
    shots: (P.shots || []).map((s) => ({
      id: s.id,
      scene: s.scene,
      title: s.title,
      status: s.workflowStatus || s.status,
      frames: (s.keyframes || []).map((f) => ({
        label: f.label,
        approved: !!f.winner,
      })),
      motion: (s.clips || []).map((c) => ({
        label: c.label,
        method: c.kind,
        hasDirection: !!text(c.motionPrompt || c.note),
        packages: (c.generationPackages || []).length,
        approved: !!c.videoWinner,
      })),
    })),
    rulesBased: base.slice(0, 40),
    retrieved: retrieved.map((x) => ({
      title: x.title,
      text: x.text.slice(0, 800),
    })),
  };
  const system = [
    "You are CineBraid's bounded Production Coordinator.",
    'Return ONLY JSON: {"summary":"","priorities":[{"severity":"high|medium|low","shotId":"","segmentId":"","title":"","reason":"","suggestedAction":""}],"questions":[]}.',
    "Use supplied records only.",
    "Do not modify data, invent completion, or recommend generation providers.",
    "Prefer concrete next production actions.",
    "Maximum 10 priorities.",
  ].join("\n");
  let parsed = {},
    plannerError = "";
  try {
    const raw = await llmFn(
      "prompt",
      system,
      JSON.stringify(compact),
      3500,
      undefined,
      config.models?.coordinator || undefined,
    );
    parsed = safeJson(raw) || {};
  } catch (e) {
    plannerError = text(e.message || e);
  }
  update(90, "Verifying recommendations");
  const priorities = Array.isArray(parsed.priorities)
    ? parsed.priorities.slice(0, 10)
    : base.slice(0, 10);
  if (plannerError)
    priorities.unshift({
      severity: "low",
      type: "agent-availability",
      title: "AI prioritization was unavailable",
      reason: plannerError,
      suggestedAction:
        "The rules-based project-health findings are still shown below.",
    });
  return {
    summary:
      text(parsed.summary) ||
      (plannerError
        ? `Prepared a rules-based work plan from ${base.length} structural findings.`
        : `Found ${base.length} structural issues and prepared a prioritized work plan.`),
    metrics: {
      structuralIssues: base.length,
      retrieved: retrieved.length,
      mode: plannerError ? "rules-based fallback" : "AI + rules",
    },
    proposals: priorities.slice(0, 10),
    questions: Array.isArray(parsed.questions)
      ? parsed.questions.slice(0, 5)
      : [],
  };
}
function approvedImageEntries(P, projectDir, scope) {
  const shots = (P.shots || [])
    .filter((s) => !scope?.sceneId || s.scene === scope.sceneId)
    .filter((s) => !scope?.shotId || s.id === scope.shotId);
  const out = [];
  for (const s of shots)
    for (const f of s.keyframes || []) {
      if (!f.winner) continue;
      const file = path.join(
        projectDir,
        "shots",
        s.id,
        "takes",
        path.basename(f.winner),
      );
      if (fs.existsSync(file) && IMG_EXT.test(file))
        out.push({
          shotId: s.id,
          sceneId: s.scene,
          label: `${s.id} Frame ${f.label}`,
          file,
          description: f.description || "",
        });
    }
  return out.slice(0, 24);
}
async function runContinuity({
  P,
  projectDir,
  visionFn,
  llmFn,
  config,
  scope,
  update,
}) {
  const images = approvedImageEntries(P, projectDir, scope);
  const observations = [];
  const batch = 4;
  if (!images.length)
    return {
      summary:
        "No approved frame images were available for the selected continuity scan.",
      metrics: { frames: 0 },
      proposals: [
        {
          severity: "low",
          type: "missing-approved-frames",
          title: "Continuity scan needs approved frames",
          reason:
            "Approve at least one keyframe before running visual continuity.",
        },
      ],
    };
  for (let i = 0; i < images.length; i += batch) {
    const part = images.slice(i, i + batch);
    update(
      8 + Math.round(55 * (i / images.length)),
      `Inspecting approved frames ${i + 1}–${i + part.length}`,
    );
    const prompt = `FRAME ORDER:\n${part.map((x, j) => `${j + 1} = ${x.label}`).join("\n")}\n\nInspect visible continuity only. Return concise JSON {"frames":[{"n":1,"facts":[""],"possibleIssues":[""]}]}. Check side-specific anatomy in FRAME terms, wardrobe/prop state, location geometry, contact points, text, and unwanted human/anatomy drift. Do not compare unobservable details.`;
    const raw = await visionFn(
      "You are a conservative film continuity inspector. Report observations, not guesses.",
      prompt,
      part.map((x) => fs.readFileSync(x.file).toString("base64")),
      2200,
      undefined,
      config.models?.vision || undefined,
    );
    observations.push({ frames: part.map((x) => x.label), raw });
  }
  update(70, "Comparing observations with project canon");
  const canon = {
    characters: (P.characters || []).map((x) => ({
      id: x.id,
      name: x.name,
      identity: x.block,
      drift: x.driftNotes,
      states: x.continuityStates || [],
    })),
    locations: (P.locations || []).map((x) => ({
      id: x.id,
      name: x.name,
      notes: x.notes,
      states: x.continuityStates || [],
    })),
    props: (P.props || []).map((x) => ({
      id: x.id,
      name: x.name,
      notes: x.notes,
      states: x.continuityStates || [],
    })),
    assignments: (P.shots || []).map((s) => ({
      shotId: s.id,
      scene: s.scene,
      states: s.continuityStateSelections || {},
    })),
  };
  const system = `You are CineBraid's continuity verifier. Return ONLY JSON {"summary":"","issues":[{"severity":"high|medium|low","shotId":"","title":"","reason":"","suggestedAction":""}]}. Separate confirmed visual conflicts from possibilities. Never claim an issue when the relevant detail is not visible. Maximum 12 issues.`;
  const raw = await llmFn(
    "critic",
    system,
    JSON.stringify({ canon, observations }),
    4200,
    undefined,
    config.models?.verifier || config.models?.coordinator || undefined,
  );
  const parsed = safeJson(raw) || {};
  return {
    summary:
      text(parsed.summary) ||
      `Inspected ${images.length} approved frames in small batches.`,
    metrics: {
      frames: images.length,
      batches: Math.ceil(images.length / batch),
    },
    proposals: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 12) : [],
  };
}
function playbookChecks({
  profileId,
  prompt,
  method,
  hasFirst,
  hasLast,
  referenceCount,
  payload = {},
}) {
  const p = text(prompt),
    id = String(profileId || "").toLowerCase(),
    issues = [];
  const add = (severity, title, reason, action) =>
    issues.push({
      severity,
      type: "prompt-quality",
      title,
      reason,
      suggestedAction: action,
    });
  if (!p)
    add(
      "high",
      "No compiled prompt is available",
      "Prompt Guardian needs a saved generation package for this motion unit.",
      "Build and save a model prompt, then run Prompt Guardian again.",
    );
  if (!id)
    add(
      "high",
      "Prompt target is missing",
      "Tool-specific checks cannot be applied without the saved target profile.",
      "Rebuild the package with an explicit prompt target.",
    );
  if (method === "i2v" && !hasFirst)
    add(
      "high",
      "I2V start frame is not approved",
      "The prompt may be concise, but the model still needs one approved visual starting point.",
      "Approve the selected opening frame before generation.",
    );
  if (method === "i2v" && referenceCount > 1)
    add(
      "high",
      "I2V has extra visual inputs",
      "A production start frame should normally carry identity and location. Extra approved library images can fight it.",
      "Use only the approved start frame unless this is explicitly reference-led.",
    );
  if (method === "flf" && (!hasFirst || !hasLast))
    add(
      "high",
      "FLF endpoints are incomplete",
      "First-to-last-frame motion requires two real approved endpoint frames.",
      "Approve both endpoint frames or switch this unit to I2V.",
    );
  if (
    /reference contract|reference map|preserve\n|avoid\n/i.test(prompt) &&
    method === "i2v"
  )
    add(
      "high",
      "I2V prompt is carrying package boilerplate",
      "The starting image already contains appearance and environment.",
      "Keep only visible action, intentional camera motion, and needed audio.",
    );
  if (id.includes("seedance")) {
    if (/\bflicker\b/i.test(p))
      add(
        "medium",
        "Seedance may turn “flicker” into a strobe",
        "The playbook found that explicit flicker language often creates hard flashing.",
        "Use “holds a steady even glow” and give motion to smoke, rain, dust, or CRT content instead.",
      );
    if (
      (p.match(/\b(?:still|motionless|no movement|static)\b/gi) || []).length >
      3
    )
      add(
        "medium",
        "Seedance prompt may freeze the whole image",
        "Too many stillness constraints suppress desired ambient life.",
        "Scope stillness to the body and positively name one action plus ambient motion.",
      );
  }
  if (id.includes("wan-2.7")) {
    if (!text(payload.negativePrompt))
      add(
        "medium",
        "Wan negative field is missing from the saved package",
        "Wan camera suppression, warping controls, and text protection belong in the real negative field rather than the positive prompt.",
        "Rebuild this package with the current Wan adapter so its negative field and recommended settings are saved.",
      );
    if (!payload.recommendedSettings)
      add(
        "low",
        "Wan settings guidance is missing",
        "Motion strength, resolution, and Enhance state can materially change a restrained shot.",
        "Rebuild the package and use the saved recommended settings.",
      );
    if (/text|document|memo|letter|page/i.test(p))
      add(
        "low",
        "Wan text-critical settings matter",
        "Text stability depends on settings as much as prose.",
        "Use 1080p, low motion strength, a real negative field, and do not Enhance.",
      );
  }
  if (id.includes("gpt-image-2") && id.includes("edit")) {
    if (!/keep everything identical/i.test(p))
      add(
        "high",
        "GPT Image edit lacks a hard preservation clause",
        "Edits tend to rebuild the whole frame unless unchanged content is pinned.",
        "Start with “Keep everything identical, only change …”.",
      );
    if (!/do not mirror/i.test(p))
      add(
        "medium",
        "GPT Image edit may mirror the frame",
        "Mirroring can silently flip geography and side-specific anatomy.",
        "Add “Do NOT mirror the image.”",
      );
  }
  if (p.split(/\s+/).filter(Boolean).length > 110 && method === "i2v")
    add(
      "medium",
      "Motion prompt is too long for I2V",
      "Long prompts encourage extra movement and visual reinterpretation.",
      "Reduce to one to three short sentences.",
    );
  return issues;
}
function guardianAudit({
  profileId,
  prompt,
  method,
  hasFirst,
  hasLast,
  referenceCount,
  payload = {},
}) {
  const p = text(prompt),
    id = String(profileId || "").toLowerCase(),
    words = p.split(/\s+/).filter(Boolean).length,
    checks = [],
    add = (status, label, detail) => checks.push({ status, label, detail });
  add(
    p ? "pass" : "warn",
    "Compiled prompt",
    p ? `${words} words are available for review.` : "No saved compiled prompt was found.",
  );
  add(
    id ? "pass" : "warn",
    "Prompt target",
    id || "No model profile is attached to this package.",
  );
  if (method === "i2v")
    add(
      hasFirst && referenceCount <= 1 ? "pass" : "warn",
      "I2V input contract",
      hasFirst
        ? `${referenceCount} saved visual input${referenceCount === 1 ? "" : "s"}; one approved start frame is expected.`
        : "The selected start frame is not approved.",
    );
  else if (method === "flf")
    add(
      hasFirst && hasLast && referenceCount <= 2 ? "pass" : "warn",
      "FLF endpoint contract",
      `${hasFirst ? "First frame approved" : "First frame missing"}; ${hasLast ? "last frame approved" : "last frame missing"}.`,
    );
  else
    add(
      "info",
      "Reference-led method",
      `${referenceCount} saved visual input${referenceCount === 1 ? "" : "s"}.`,
    );
  if (method === "i2v")
    add(
      words > 0 && words <= 110 ? "pass" : "warn",
      "I2V prompt length",
      words ? `${words} words; the playbook ceiling is 110.` : "No words to evaluate.",
    );
  const cameraClear = /\bcamera\b|locked|static|pan|tilt|dolly|zoom|handheld/i.test(p);
  add(
    cameraClear ? "pass" : "info",
    "Camera instruction",
    cameraClear
      ? "Camera behavior is stated explicitly."
      : "No camera move is stated; the start-frame composition will carry the shot.",
  );
  if (id.includes("seedance"))
    add(
      !/\bflicker\b/i.test(p) &&
        (p.match(/\b(?:still|motionless|no movement|static)\b/gi) || []).length <= 3
        ? "pass"
        : "warn",
      "Seedance motion balance",
      "Checks positive action language, strobe-prone wording, and over-freezing.",
    );
  if (id.includes("wan-2.7")) {
    add(
      text(payload.negativePrompt) ? "pass" : "warn",
      "Wan negative field",
      text(payload.negativePrompt)
        ? "A separate negative field is saved with the package."
        : "No separate Wan negative field is attached.",
    );
    add(
      payload.recommendedSettings ? "pass" : "warn",
      "Wan generation settings",
      payload.recommendedSettings
        ? "Resolution, motion strength, and Enhance guidance are attached."
        : "No target settings are attached.",
    );
  } else if (id.includes("ltx-2.3"))
    add(
      /\b(?:across|over|then|while|throughout|starting|opening)\b/i.test(p)
        ? "pass"
        : "info",
      "LTX chronology",
      "Checks that the prompt reads as a continuous timed shot rather than disconnected tags.",
    );
  else if (id.includes("happy-horse"))
    add(
      "info",
      "Native audio scope",
      /native audio|dialogue:|sound:|ambience:/i.test(p)
        ? "Native audio direction is included."
        : "No native audio was requested in this package.",
    );
  return checks;
}
function guardianQuality({ prompt, shot, motion }) {
  const p = text(prompt),
    words = p.split(/\s+/).filter(Boolean).length,
    camera = /\bcamera\b|locked|static|pan|tilt|dolly|zoom|handheld|push(?:es)? in|pull(?:s)? back/i.test(p),
    spatial = /\b(?:toward|away|closer|into|onto|against|across|through|behind|beside|left|right|foreground|background|contact|touch|grip|press|hold|reveal|opens?|closes?)\b/i.test(p),
    action = /\b(?:moves?|turns?|steps?|walks?|runs?|looks?|raises?|lowers?|leans?|drifts?|rotates?|blinks?|breathes?|speaks?|checks?|reads?|reaches?|pulls?|pushes?|places?|lifts?|reveals?)\b/i.test(p),
    source = text([shot?.desc, shot?.positioning, motion?.motionPrompt || motion?.note].filter(Boolean).join(" ")),
    sourceWords = source.split(/\s+/).filter(Boolean).length,
    weak = !p || !action || (words < 18 && sourceWords > words + 8) || (words < 14 && !camera) || (!spatial && /contact|blocking|foreground|background|toward|away|closer/i.test(source));
  return { words, camera, spatial, action, sourceWords, weak };
}
function cleanGuardianReplacement(value) {
  const out = text(value);
  if (!out) return "";
  if (/^(?:rewrite|revise|add|use|prompt should|change the prompt|skeleton\b)/i.test(out))
    return "";
  return out;
}
function guardianTextOverlap(a, b) {
  const tokens = (value) =>
    new Set(
      text(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((x) => x.length > 3),
    ),
    left = tokens(a),
    right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / Math.min(left.size, right.size);
}
function guardianReplacement(profileId, shot, motion, currentPrompt) {
  const id = String(profileId || "").toLowerCase(),
    action = text(motion?.motionPrompt || motion?.note || currentPrompt || shot?.desc),
    composition = text(shot?.positioning),
    shotAction = text(shot?.desc),
    duration = Math.max(1, Number(motion?.dur) || 5),
    parts = unique([action, composition, shotAction]).filter(Boolean),
    concise = parts
      .filter((part, index, all) =>
        all.slice(0, index).every((prior) => guardianTextOverlap(prior, part) < 0.65),
      )
      .slice(0, 3)
      .join(" ");
  if (!concise) return text(currentPrompt);
  if (id.includes("wan-2.7"))
    return [
      `SUBJECT MOTION: ${action || shotAction}`,
      `ENVIRONMENT MOTION: ${shotAction && shotAction !== action ? shotAction : "Keep background motion restrained to what is already visible."}`,
      `CAMERA: ${composition || "Keep the camera locked to the approved starting composition."}`,
    ].join("\n");
  if (id.includes("ltx-2.3"))
    return `Across the ${duration}-second shot, ${concise}`;
  if (id.includes("kling"))
    return `Using the supplied starting image as the exact visual source, ${concise} Keep all other movement restrained.`;
  if (id.includes("happy-horse"))
    return `Visible motion only: ${action || shotAction}\nCamera: ${composition || "locked to the supplied starting frame"}\nBackground: ${shotAction && shotAction !== action ? shotAction : "only natural ambient movement already implied by the shot"}`;
  return unique([action || shotAction, composition, shotAction && shotAction !== action ? shotAction : ""]).filter(Boolean).slice(0, 3).join(" ");
}
function guardianForcedReplacement(profileId, shot, motion, currentPrompt) {
  const candidate = guardianReplacement(profileId, shot, motion, currentPrompt),
    current = text(currentPrompt),
    id = String(profileId || "").toLowerCase(),
    positioning = text(shot?.positioning) || "Keep the approved starting composition stable",
    duration = Math.max(1, Number(motion?.dur) || 5);
  if (candidate && candidate !== current) return candidate;
  if (id.includes("wan-2.7"))
    return [
      `SUBJECT MOTION: ${current}`,
      "ENVIRONMENT MOTION: Preserve the existing environment with only restrained natural ambient movement.",
      `CAMERA: ${positioning}.`,
    ].join("\n");
  if (id.includes("ltx-2.3"))
    return `Across the ${duration}-second shot, ${current} ${positioning}. The movement develops continuously without adding new action.`;
  if (id.includes("kling"))
    return `Using the supplied starting image as the exact visual source, ${current} ${positioning}. Keep all unrelated movement restrained.`;
  if (id.includes("happy-horse"))
    return `Visible motion only: ${current}\nCamera: ${positioning}\nBackground: restrained natural ambient movement only`;
  return `${current} ${positioning}. Keep the action controlled and continuous, with only restrained ambient movement already supported by the frame.`.trim();
}
async function runPromptGuardian({ P, scope, llmFn, config, update }) {
  const s = (P.shots || []).find((x) => x.id === scope.shotId);
  if (!s) throw new Error("Shot not found");
  const requestedSegment = String(scope.segmentId || "");
  const c = requestedSegment
    ? (s.clips || []).find(
        (x) => String(x.id || x.suffix || "") === requestedSegment,
      )
    : (s.clips || [])[0];
  if (!c) throw new Error("Motion unit not found");
  update(15, "Loading the saved generation package");
  const pack = latestPromptBuild(P, c.generationPackages || []) || {};
  const prompt = scope.prompt || pack.prompt || c.motionPrompt || c.note || "";
  let profileId =
    scope.profileId ||
    pack.profileId ||
    pack.profile ||
    P.meta?.promptDefaults?.videoProfile ||
    "";
  if (c.kind === "flf" && profileId.includes("/i2v"))
    profileId = profileId.replace("/i2v", "/flf");
  if (c.kind === "r2v" && profileId.includes("/i2v"))
    profileId = profileId.replace("/i2v", "/r2v");
  const first = (s.keyframes || []).find((f) => f.id === c.fromFrame),
    last = (s.keyframes || []).find((f) => f.id === c.toFrame),
    payload = pack.providerPayload || pack.payload || {},
    refs = payload.references || pack.references || [],
    forceImprove = !!scope.forceImprove,
    quality = guardianQuality({ prompt, shot: s, motion: c });
  const checkArgs = {
    profileId,
    prompt,
    method: c.kind,
    hasFirst: !!first?.winner,
    hasLast: !!last?.winner,
    referenceCount: refs.length,
    payload,
  };
  const checks = playbookChecks(checkArgs);
  if (quality.weak)
    checks.push({
      severity: "medium",
      type: "prompt-quality",
      title: "Prompt is technically valid but under-specified",
      reason:
        "The package passes basic format checks, but it does not carry enough of the shot's action, spatial logic, or camera intent to be reliably useful.",
      suggestedAction:
        "Use the production-ready replacement below, then rebuild or recheck the package.",
    });
  const audit = guardianAudit(checkArgs);
  audit.push({
    status: quality.weak ? "warn" : "pass",
    label: "Production usefulness",
    detail: quality.weak
      ? "The prompt is too thin or generic relative to the available shot context."
      : "The prompt contains enough action and spatial/camera intent to be directly usable.",
  });
  update(35, "Applying field-tested tool and usefulness rules");
  const system = [
    "You are CineBraid's Prompt Guardian.",
    'Return ONLY JSON {"summary":"","verdict":"keep|improve","qualityScore":0,"issues":[{"severity":"high|medium|low","title":"","reason":"","suggestedAction":""}],"strengths":[""],"recommendedMethod":"i2v|flf|r2v|post|keep","replacementPrompt":"","changeSummary":[""]}.',
    "Judge both technical validity and production usefulness.",
    "A concise prompt is not automatically good. It must be directly executable: a clear subject, one visible action, spatial/contact logic, camera behavior, and ambient/timing detail when supported by canon.",
    "If the current prompt is vague, generic, merely states an outcome, or ignores useful supplied shot context, verdict must be improve.",
    forceImprove
      ? "The user explicitly requested a stronger alternative. Verdict must be improve and replacementPrompt must be meaningfully more executable than the current prompt."
      : "Do not force a rewrite when the current prompt is already production-ready.",
    "replacementPrompt must be the finished model-target prompt itself. Never return meta-instructions such as 'rewrite', 'add', 'use Skeleton', or advice about what the user should type.",
    "Use only supplied canon. Do not invent story action, anatomy, props, dialogue, or visual style.",
    "Do not write reference contracts for I2V. Recommend post or a split when the requested beat is structurally unreliable.",
  ].join("\n");
  let parsed = {},
    verifierError = "";
  if (text(prompt)) {
    try {
      const raw = await llmFn(
        "critic",
        system,
        `PLAYBOOK:\n${playbookFor(profileId, c.kind)}\n\nSHOT:${JSON.stringify({ id: s.id, title: s.title, description: s.desc, positioning: s.positioning, safe: s.safe, risks: s.risks })}\nMOTION:${JSON.stringify(c)}\nPROFILE:${profileId}\nCURRENT PROMPT:${prompt}\nPROVIDER PAYLOAD:${JSON.stringify(payload)}\nDETERMINISTIC CHECKS:${JSON.stringify(checks)}\nQUALITY SIGNALS:${JSON.stringify({ ...quality, forceImprove })}`,
        4200,
        undefined,
        config.models?.verifier || config.models?.coordinator || undefined,
      );
      parsed = safeJson(raw) || {};
    } catch (e) {
      verifierError = text(e.message || e);
    }
  } else verifierError = "No saved compiled prompt was available for AI verification.";
  const normalizedAI = (Array.isArray(parsed.issues) ? parsed.issues : []).map(
    (x) => ({
      severity: ["high", "medium", "low"].includes(x?.severity)
        ? x.severity
        : "low",
      type: "prompt-quality",
      shotId: s.id,
      segmentId: c.id || c.suffix || "",
      title: text(x?.title) || "Prompt Guardian finding",
      reason: text(x?.reason),
      suggestedAction: text(x?.suggestedAction),
    }),
  );
  const deterministic = checks.map((x) => ({
    ...x,
    shotId: s.id,
    segmentId: c.id || c.suffix || "",
  }));
  const combined = [...deterministic, ...normalizedAI],
    seen = new Set(),
    issues = combined.filter((x) => {
      const key = text(x.title).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (verifierError)
    issues.push({
      severity: "low",
      type: "agent-availability",
      shotId: s.id,
      segmentId: c.id || c.suffix || "",
      title: "Deeper AI verification was unavailable",
      reason: verifierError,
      suggestedAction:
        "The deterministic playbook and usefulness audit above is still complete and usable.",
    });
  const actionable = issues.filter((x) => x.type !== "agent-availability"),
    aiVerdict = ["keep", "improve"].includes(parsed.verdict)
      ? parsed.verdict
      : "",
    verdict = forceImprove || quality.weak || actionable.some((x) => x.severity !== "low")
      ? "improve"
      : aiVerdict || (actionable.length ? "improve" : "keep"),
    fallback = forceImprove
      ? guardianForcedReplacement(profileId, s, c, prompt)
      : guardianReplacement(profileId, s, c, prompt);
  let proposedPrompt =
    verdict === "improve" ? cleanGuardianReplacement(parsed.replacementPrompt) : "";
  if (!proposedPrompt || proposedPrompt === text(prompt)) proposedPrompt = fallback;
  if (verdict === "keep") proposedPrompt = "";
  const passCount = audit.filter((x) => x.status === "pass").length,
    warningCount = audit.filter((x) => x.status === "warn").length,
    rawQualityScore = Math.max(
      0,
      Math.min(
        100,
        Number(parsed.qualityScore) ||
          100 - warningCount * 16 - actionable.filter((x) => x.severity === "high").length * 20,
      ),
    ),
    qualityScore = quality.weak ? Math.min(59, rawQualityScore) : rawQualityScore;
  update(90, "Preparing the visible audit and replacement");
  return {
    summary:
      text(parsed.summary) ||
      (verdict === "improve"
        ? `Prompt Guardian recommends replacing the current ${profileId || "motion"} prompt before generation.`
        : `Prompt Guardian passed ${passCount} checks for Motion ${c.label || c.suffix}; the current prompt is ready to keep.`),
    metrics: {
      profile: profileId || "unspecified",
      method: c.kind,
      words: text(prompt).split(/\s+/).filter(Boolean).length,
      quality: qualityScore,
      passed: passCount,
      warnings: warningCount,
      mode: verifierError ? "rules-only" : "AI + rules",
    },
    checks: audit,
    strengths: unique([
      ...(Array.isArray(parsed.strengths) ? parsed.strengths.map(text) : []),
      ...audit.filter((x) => x.status === "pass").map((x) => x.label),
    ]),
    proposals: issues.slice(0, 12),
    verdict,
    recommendedMethod:
      ["i2v", "flf", "r2v", "post", "keep"].includes(parsed.recommendedMethod)
        ? parsed.recommendedMethod
        : verdict === "keep"
          ? "keep"
          : c.kind,
    proposedPrompt,
    compactDirection: proposedPrompt,
    changeSummary: unique(
      Array.isArray(parsed.changeSummary)
        ? parsed.changeSummary.map(text)
        : verdict === "improve"
          ? ["Carry more of the approved shot action and spatial/camera intent into the target prompt."]
          : [],
    ).slice(0, 6),
    reviewedPrompt: text(prompt),
    providerPayload: payload,
    target: {
      shotId: s.id,
      segmentId: c.id || c.suffix || "",
      packageId: pack.id || "",
      profileId,
    },
  };
}

async function runCandidateTriage({ reviewFn, scope, update }) {
  update(15, "Loading candidate images");
  let result;
  try {
    result = await reviewFn(scope.shotId);
  } catch (e) {
    if (/no candidate images/i.test(String(e.message || e)))
      return {
        summary: "No candidate images are available for this shot yet.",
        metrics: { reviewed: 0 },
        proposals: [
          {
            severity: "low",
            type: "missing-candidates",
            shotId: scope.shotId,
            title: "Candidate review needs images",
            reason: "The selected shot has no candidate images on disk.",
            suggestedAction:
              "Add or generate candidate images, then run Candidate Reviewer again.",
          },
        ],
      };
    throw e;
  }
  update(92, "Ranking finalists");
  const r = result.review || {};
  return {
    summary: r.rationale || "Candidate triage complete.",
    metrics: result.strategy || {},
    proposals: (r.ranking || []).slice(0, 3).map((n, i) => ({
      severity: "low",
      type: "candidate-ranking",
      shotId: scope.shotId,
      title: `Rank ${i + 1}: ${result.files?.[n - 1] || "Candidate " + n}`,
      reason: (r.reviews || []).find((x) => x.n === n)?.notes || "",
      suggestedAction:
        i === 0 ? "Review as the leading candidate." : "Keep as an alternate.",
    })),
    review: result,
  };
}
function runSystemCheck({ projectDir, config }) {
  const node = process.version,
    npm = spawnSync("npm", ["--version"], { encoding: "utf8", timeout: 2500 }),
    ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", timeout: 2500 });
  const data = path.join(projectDir, "project.json"),
    stat = fs.statSync(data),
    free = spawnSync("df", ["-h", projectDir], {
      encoding: "utf8",
      timeout: 2500,
    });
  const proposals = [];
  if (!ff.stdout)
    proposals.push({
      severity: "medium",
      type: "system",
      title: "FFmpeg not detected",
      reason: "Media inspection and proxy utilities may be unavailable.",
      suggestedAction: "Install ffmpeg through the Spark package manager.",
    });
  if (stat.size > 20 * 1024 * 1024)
    proposals.push({
      severity: "low",
      type: "system",
      title: "Project record is unusually large",
      reason: "Very large project.json files can slow saves.",
      suggestedAction:
        "Archive old package histories or split source logs into documents.",
    });
  return {
    summary:
      "Checked the CineBraid runtime, project record, and media utility availability.",
    metrics: {
      node,
      npm: text(npm.stdout),
      ffmpeg: text((ff.stdout || "").split("\n")[0]),
      projectBytes: stat.size,
      disk: (free.stdout || "").trim(),
    },
    proposals,
  };
}

async function runSystemAssistant({ projectDir, config, llmFn, update }) {
  update(20, "Checking the local CineBraid runtime");
  const base = runSystemCheck({ projectDir, config });
  if (!config.models?.coder) return base;
  update(55, "Asking the configured technical model");
  const system = `You are CineBraid's bounded technical assistant. Return ONLY JSON {"summary":"","issues":[{"severity":"high|medium|low","title":"","reason":"","suggestedAction":""}]}. Diagnose only from the supplied local checks. Do not propose destructive commands, package upgrades, network exposure, or provider integrations unless directly required. Prefer reversible steps.`;
  const raw = await llmFn(
    "critic",
    system,
    JSON.stringify(base),
    2500,
    undefined,
    config.models.coder,
  );
  const parsed = safeJson(raw) || {};
  return {
    ...base,
    summary: text(parsed.summary) || base.summary,
    proposals: [
      ...base.proposals,
      ...(Array.isArray(parsed.issues) ? parsed.issues : []),
    ].slice(0, 10),
  };
}

module.exports = {
  PLAYBOOK,
  playbookFor,
  projectCorpus,
  projectSourceFingerprint,
  buildIndex,
  retrieve,
  deterministicHealth,
  runCoordinator,
  runShotStageGuide,
  shotStageGuideGaps,
  runContinuity,
  runPromptGuardian,
  runCandidateTriage,
  runSystemCheck,
  runSystemAssistant,
  playbookChecks,
};
