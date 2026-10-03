/* Generic current-candidate authoring. The existing compiler owns prompt wording;
 * the authority kernel owns approvals; MediaAssetService owns media identity. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Authority = require("../../public/shared-authority-kernel");
const History = require("../../public/shared-build-history");
const Media = require("../media/media-asset-service");
const Prompt = require("./prompt-engine");
const { planReferences } = require("./generation-compiler");
const Mask = require("../media/image-mask");
const ROLES = ["identity", "outfit", "location", "prop", "reference-sheet", "detail"];
const text = (v) => String(v == null ? "" : v).trim();
const clone = (v) => JSON.parse(JSON.stringify(v));
function stable(v) { return JSON.stringify(sort(v)); }
function sort(v) { return Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, sort(v[k])])) : v; }
const fingerprint = (v) => Mask.digest(Buffer.from(stable(v)));
function refuse(message, code = "REPAIR_INPUT_INVALID") { const e = new Error(message); e.code = code; e.status = 409; throw e; }
function assets(owner) {
  if (!owner || !Media.resolvePhysicalProjectDir(path.dirname(owner.dir), owner.slug).ok) refuse("Repair project identity is unavailable.");
  return Media.readAssets(path.dirname(owner.dir), owner.slug).assets || [];
}
function assetBytes(owner, assetId, expectedHash) {
  const found = assets(owner).filter(a => a.assetId === assetId && !a.storage?.missing);
  if (found.length !== 1) refuse("The exact selected media identity is unavailable.");
  const asset = found[0], relative = text(asset.storage?.path);
  if (asset.mediaType !== "image") refuse("Repair inputs must be exact image assets.");
  const root = fs.realpathSync(owner.dir), filename = path.resolve(root, relative);
  const inside = path.relative(root, fs.realpathSync(filename));
  if (!inside || path.isAbsolute(inside) || inside.split(/[\\/]/).includes("..")) refuse("Selected media is outside this project.");
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > 25 * 1024 * 1024) refuse("Selected image exceeds the repair byte limit.");
  const bytes = fs.readFileSync(filename), hash = Mask.digest(bytes);
  if (asset.contentHash !== "sha256:" + hash || (expectedHash && expectedHash !== hash))
    refuse("Selected media bytes changed or their identity is not verified. Refresh the media record before Build.");
  return { assetId, contentHash: hash, path: relative, url: "/assets/" + relative.split("/").map(encodeURIComponent).join("/"), bytes };
}
function target(project, body) {
  const shot = (project.shots || []).find(s => s.id === text(body.shotId));
  const frame = shot?.keyframes?.find(f => f.id === text(body.frameId));
  const row = shot?.candidateFiles?.find(r => text(r.stored || r.name) === text(body.sourceCandidate));
  if (!shot || !frame || !row || row.frameId !== frame.id || row.mediaType === "video")
    refuse("Choose an existing image candidate on this exact shot and frame.");
  return { shot, frame, row };
}
function candidateBase(project, owner, body) {
  const selected = target(project, body), name = text(selected.row.stored || selected.row.name);
  const matches = assets(owner).filter(a => a.assetId === text(body.baseAssetId) &&
    [`shots/${selected.shot.id}/takes/${name}`, `shots/${selected.shot.id}/locked/${name}`].includes(a.storage?.path));
  if (matches.length !== 1 || (selected.row.assetId && selected.row.assetId !== matches[0].assetId)) refuse("Edit base does not belong to the selected candidate.");
  return { ...selected, base: assetBytes(owner, matches[0].assetId, text(body.baseHash)) };
}
function appearance(project, owner, selected) {
  if (!ROLES.includes(text(selected.role))) refuse("Choose an appearance role; base, guide and mask are separate controls.");
  if (!/^[a-f0-9]{64}$/.test(text(selected.contentHash))) refuse("Appearance selection needs an exact verified hash.");
  const wanted = { kind: "entity-state", list: text(selected.list), entityId: text(selected.entityId), stateId: text(selected.stateId) };
  const receipt = Authority.currentHumanAuthority(project, wanted);
  if (!receipt || !receipt.assetId || receipt.id !== text(selected.approvalReceiptId) || receipt.assetId !== text(selected.assetId))
    refuse("This appearance selection no longer has the exact current human receipt.", "REPAIR_APPROVAL_CHANGED");
  const entity = project[wanted.list]?.find(e => e.id === wanted.entityId);
  const state = entity?.continuityStates?.find(s => s.id === wanted.stateId);
  const file = assetBytes(owner, receipt.assetId, text(selected.contentHash));
  if (path.basename(file.path) !== receipt.value) refuse("Appearance receipt and selected filename disagree.");
  return { key: `${wanted.list}:${wanted.entityId}:${wanted.stateId}`, ...file, bytes: undefined,
    role: text(selected.role), mediaType: "image", entityId: entity.id, entityName: entity.name,
    entityType: wanted.list, stateId: wanted.stateId, stateName: state?.name || "Default",
    approvalTarget: wanted, approvalReceiptId: receipt.id, authority: "current-human-receipt",
    label: `${entity.name} / ${state?.name || "Default"}`,
    instruction: text(selected.instruction) || "Appearance only. Preserve this exact design; do not inherit framing, pose, background or rendering.",
  };
}
function inventory(project, owner, body) {
  const { shot, frame, row } = target(project, body);
  const known = assets(owner);
  const name = text(row.stored || row.name);
  const base = known.find(a => [`shots/${shot.id}/takes/${name}`, `shots/${shot.id}/locked/${name}`].includes(a.storage?.path));
  if (!base?.assetId || !/^sha256:[a-f0-9]{64}$/.test(base.contentHash || "")) refuse("Candidate identity needs a verified media record before repair.");
  const appearances = [];
  for (const list of ["characters", "locations", "props", "vehicles"])
    for (const entity of project[list] || []) for (const state of entity.continuityStates || []) {
      const receipt = Authority.currentHumanAuthority(project, { kind: "entity-state", list, entityId: entity.id, stateId: state.id });
      const a = receipt && known.find(a => a.assetId === receipt.assetId && !a.storage?.missing && a.hashState === "hashed");
      if (!a || !/^sha256:[a-f0-9]{64}$/.test(a.contentHash || "")) continue;
      appearances.push({ list, entityId: entity.id, stateId: state.id, assetId: a.assetId,
        approvalReceiptId: receipt.id, contentHash: a.contentHash.slice(7),
        label: `${entity.name} / ${state.name || "Default"}`, role: list === "characters" ? "identity" : list === "locations" ? "location" : "prop",
        url: "/assets/" + a.storage.path.split("/").map(encodeURIComponent).join("/") });
    }
  return { projectSlug: owner.slug, shotId: shot.id, frameId: frame.id, sourceCandidate: name,
    base: { assetId: base.assetId, contentHash: base.contentHash.slice(7), url: "/assets/" + base.storage.path.split("/").map(encodeURIComponent).join("/"), label: name, authority: "candidate-not-approval" },
    appearances, roles: ROLES };
}
function fileInput(input) {
  const value = text(input?.base64);
  if (!value || value.length > Math.ceil(Mask.MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) refuse("Import a bounded PNG technical input.");
  const bytes = Buffer.from(value, "base64"); Mask.decode(bytes); return bytes;
}
function packageDigest(build) { return fingerprint({ spec: build.spec, references: build.references,
  repair: { ...build.repair, packageDigest: undefined }, frameId: build.frameId, sourceCandidate: build.sourceCandidate, parentBuildId: build.parentBuildId }); }
function prepare(project, owner, body) {
  if (text(body.projectSlug) !== owner.slug || !/^[a-f0-9]{64}$/.test(text(body.baseHash))) refuse("Repair requires its exact project and base hash.");
  const { shot, frame, row, base } = candidateBase(project, owner, body);
  const change = text(body.change), preserve = text(body.preserve);
  if (!change || change.length > 12000 || preserve.length > 12000 || text(body.avoid).length > 12000) refuse("Describe the bounded correction and preservation constraints.");
  const selected = Array.isArray(body.appearances) ? body.appearances : [];
  if (selected.length > 14) refuse("Too many appearance inputs for this repair.");
  const refs = [{ key: `candidate:${shot.id}:${frame.id}:${base.assetId}`, ...base, bytes: undefined,
    role: "base", mediaType: "image", label: `${row.stored || row.name} — candidate edit canvas, not approval authority`, authority: "candidate-not-approval",
    instruction: "Edit canvas and blocking only. Preserve its camera, composition and unchanged background. Selection does not approve it." },
    ...selected.map(s => appearance(project, owner, s))];
  if (new Set(refs.map(r => r.key)).size !== refs.length) refuse("Do not select the same appearance state twice.");
  const dimensions = Mask.decode(base.bytes, 25 * 1024 * 1024);
  const id = `repair-${crypto.randomBytes(12).toString("hex")}`, files = [];
  function durable(bytes, role, name, extra = {}) {
    const hash = Mask.digest(bytes), relative = `media/${id}-${role}-${hash}.png`;
    files.push({ path: relative, bytes });
    return { key: `${id}:${role}`, role, mediaType: "image", label: text(name) || role,
      path: relative, url: "/assets/" + relative, contentHash: hash, technicalInputId: `technical-${hash}`,
      authority: "technical-non-authority", ...extra };
  }
  if (body.guide) refs.push(durable(fileInput(body.guide), "composition", body.guide.name,
    { instruction: text(body.guide.instruction) || "Technical geometry/contact guide only. No design, proportions, appearance, camera, background or approval authority." }));
  let mask = null;
  if (body.mask) {
    const bytes = fileInput(body.mask);
    const normalized = Mask.normalizeMask(bytes, text(body.mask.sourceConvention), { ...dimensions, assetId: base.assetId, contentHash: base.contentHash });
    const original = durable(bytes, "mask-source", body.mask.name);
    mask = { ...normalized.meaning, sourcePath: original.path, sourceTechnicalInputId: original.technicalInputId };
    refs.push(durable(normalized.providerBytes, "mask", "Repair mask — white editable / black preserved", {
      mask, baseAssetId: base.assetId, baseHash: base.contentHash,
      instruction: "Technical edit extent only; binds to exact Image 1. No appearance or approval authority." }));
  }
  const ids = new Set(refs.map(r => r.entityId).filter(Boolean));
  const context = Prompt.buildContext(project, shot.id, "", { frameId: frame.id });
  /* Repair changes the target package, not Canon. Whole-shot narrative and stale
     camera controls are retained by the Canon witness, not reasserted as edit direction. */
  context.references = (context.references || []).filter(r => ids.has(r.id));
  context.promptEntities = (context.promptEntities || []).filter(r => ids.has(r.id));
  context.scene.beat = ""; context.shot.description = change; context.shot.positioning = "";
  const spec = Prompt.defaultSpec(context, "edit", mask ? "inpaint" : "edit", refs, null);
  spec.actions = [{ action: change }]; spec.initialState.subject = change;
  spec.initialState.environment = ""; spec.initialState.staging = "";
  spec.camera = {}; spec.stagingLines = []; spec.performance = {};
  spec.mustPreserve = preserve.split(/\n+/).map(text).filter(Boolean);
  spec.mustAvoid = text(body.avoid).split(/\n+/).map(text).filter(Boolean);
  // This explicitly authored repair is not a request to replay the whole shot.
  // Keep broader notes inspectable in the durable package/Canon witness while
  // appearance authority comes from the selected current states, never the canvas.
  spec.intentScope = { kind: "candidate-repair", excludedContext: {
    identityCanon: spec.identityCanon || [], driftRestatements: spec.driftRestatements || [],
    productionRisks: spec.productionRisks || [],
  }, reason: "Whole-shot identity prose, drift notes and production risks are retained as context, not dispatched as this bounded repair's directions. Current selected appearances and Change/Preserve/Exclude own this edit; inspect these fields before review." };
  spec.identityCanon = refs.filter(r => r.authority === "current-human-receipt").map(r => `${r.label}: ${r.instruction}`);
  spec.driftRestatements = []; spec.productionRisks = [];
  const build = { id, packageId: `${shot.id}-${frame.label || "A"}-REPAIR-${id.slice(-6)}`,
    kind: "candidate-correction", frameId: frame.id, frameLabel: frame.label || "A",
    sourceCandidate: row.stored || row.name, parentBuildId: text(row.sourceBuildId || row.sourcePackageId),
    profileId: "gpt-image-2/edit", profileName: "GPT Image 2 — candidate repair",
    spec, references: refs, date: new Date().toISOString(), immutableAt: new Date().toISOString(),
    repair: { version: "native-candidate-repair-v1", projectSlug: owner.slug, shotId: shot.id, frameId: frame.id,
      baseAssetId: base.assetId, baseHash: base.contentHash, change, preserve, avoid: text(body.avoid), mask },
  };
  build.repair.canonContext = History.packageCanonContextInputs(project, shot, build);
  build.repair.packageDigest = packageDigest(build);
  return { build, files };
}
function verify(project, owner, build) {
  if (!build?.repair || build.repair.version !== "native-candidate-repair-v1") refuse("Rebuild this historical correction with the current native repair path.", "REPAIR_BUILD_REQUIRED");
  if (build.repair.projectSlug !== owner.slug || packageDigest(build) !== build.repair.packageDigest) refuse("Repair package content or owning project changed.", "REPAIR_PACKAGE_CHANGED");
  const { shot, base } = candidateBase(project, owner, { shotId: build.repair.shotId, frameId: build.frameId, sourceCandidate: build.sourceCandidate, baseAssetId: build.repair.baseAssetId, baseHash: build.repair.baseHash });
  if (build.repair.frameId !== build.frameId || !Array.isArray(build.references) || build.references.length > 17)
    refuse("Repair target or reference manifest is invalid.");
  const bases = build.references.filter(r => r.role === "base"), guides = build.references.filter(r => r.role === "composition"), masks = build.references.filter(r => r.role === "mask");
  if (bases.length !== 1 || bases[0].assetId !== base.assetId || bases[0].contentHash !== base.contentHash || bases[0].authority !== "candidate-not-approval" ||
      guides.length > 1 || masks.length !== (build.repair.mask ? 1 : 0) || new Set(build.references.map(r => r.key)).size !== build.references.length)
    refuse("Repair needs one exact candidate canvas, at most one technical guide, and its separately bound mask.");
  if (stable(History.packageCanonContextInputs(project, shot, build)) !== stable(build.repair.canonContext)) refuse("Production intent changed since this repair was built. Build a fresh package.", "REPAIR_CANON_CHANGED");
  for (const r of build.references) {
    if (!r.assetId || !/^[a-f0-9]{64}$/.test(r.contentHash || "")) refuse("Durable repair input has no exact indexed byte identity.");
    const bytes = assetBytes(owner, r.assetId, r.contentHash);
    if (r.path !== bytes.path || r.url !== bytes.url) refuse("Repair input identity, path and canonical URL disagree.");
    if (ROLES.includes(r.role)) {
      const t = r.approvalTarget;
      if (r.authority !== "current-human-receipt" || t?.kind !== "entity-state" || t.list !== r.entityType || t.entityId !== r.entityId || t.stateId !== r.stateId || !r.approvalReceiptId || r.technicalInputId)
        refuse("Appearance inputs require their exact current entity/state receipt.");
      appearance(project, owner, { ...r, ...t });
    } else if (["composition", "mask"].includes(r.role)) {
      if (r.authority !== "technical-non-authority" || r.approvalTarget || r.approvalReceiptId || r.entityId || r.technicalInputId !== `technical-${r.contentHash}`)
        refuse("Technical inputs cannot carry appearance or approval authority.");
      Mask.decode(containedTechnical(owner, r.path));
    } else if (r.role !== "base" || r.approvalTarget || r.approvalReceiptId || r.entityId || r.technicalInputId)
      refuse("Repair input class is invalid.");
  }
  if (build.repair.mask) {
    const m = build.repair.mask, bytes = containedTechnical(owner, m.sourcePath);
    const provider = masks[0], dimensions = Mask.decode(base.bytes, 25 * 1024 * 1024);
    if (provider.contentHash !== m.providerHash || provider.baseAssetId !== base.assetId || provider.baseHash !== base.contentHash ||
        stable(provider.mask) !== stable(m) || m.baseAssetId !== base.assetId || m.baseHash !== base.contentHash ||
        m.width !== dimensions.width || m.height !== dimensions.height || m.sourceTechnicalInputId !== `technical-${m.sourceHash}`)
      refuse("Mask binding must name the exact candidate canvas and validated conversion.");
    const source = assetBytes(owner, m.sourceAssetId, m.sourceHash);
    if (source.path !== m.sourcePath) refuse("Original mask identity and durable path disagree.");
    if (Mask.digest(bytes) !== m.sourceHash) refuse("Original technical mask bytes changed.");
    const current = Mask.normalizeMask(bytes, m.sourceConvention, { width: m.width, height: m.height, assetId: build.repair.baseAssetId, contentHash: build.repair.baseHash });
    if (current.meaning.providerHash !== m.providerHash) refuse("Provider mask conversion changed.");
  }
  return clone(build.repair);
}
function containedTechnical(owner, relative) {
  if (!/^media\/repair-[a-f0-9]+-[a-z-]+-[a-f0-9]{64}\.png$/.test(relative || "")) refuse("Technical dependency path is invalid.");
  const file = path.resolve(owner.dir, relative), real = fs.realpathSync(file), root = fs.realpathSync(owner.dir);
  const rel = path.relative(root, real);
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) refuse("Technical dependency escaped its project.");
  return fs.readFileSync(real);
}
async function persistTechnical(owner, prepared) {
  fs.mkdirSync(path.join(owner.dir, "media"), { recursive: true });
  for (const f of prepared.files) fs.writeFileSync(path.join(owner.dir, f.path), f.bytes, { flag: "wx" });
  for (const f of prepared.files) {
    const identity = await Media.prepareAssetIdentity({ projectsRoot: path.dirname(owner.dir), slug: owner.slug, path: f.path });
    if (identity.status !== "ready") refuse(`Technical input identity could not be committed (${identity.reason || identity.status}).`);
    await Media.verifyNow({ projectsRoot: path.dirname(owner.dir), slug: owner.slug, paths: [f.path] });
    const asset = assets(owner).find(a => a.assetId === identity.assetId);
    if (asset?.contentHash !== "sha256:" + Mask.digest(f.bytes)) refuse("Technical input durability could not be verified.");
    const ref = prepared.build.references.find(r => r.path === f.path);
    if (ref) ref.assetId = identity.assetId;
    if (prepared.build.repair.mask?.sourcePath === f.path) prepared.build.repair.mask.sourceAssetId = identity.assetId;
  }
  prepared.build.repair.packageDigest = packageDigest(prepared.build);
}
function register(project, build) {
  const { shot, frame, row } = target(project, { shotId: build.repair.shotId, frameId: build.frameId, sourceCandidate: build.sourceCandidate });
  const id = History.registerPromptBuild(project, build);
  frame.generationPackages = [...(frame.generationPackages || []), History.promptBuildRef(id, { kind: "candidate-correction" })];
  row.correctionBuildIds = [...(row.correctionBuildIds || []), id]; row.currentCorrectionBuildId = id;
  return id;
}
module.exports = { ROLES, fingerprint, inventory, prepare, persistTechnical, verify, register, packageDigest, containedTechnical, planReferences };
