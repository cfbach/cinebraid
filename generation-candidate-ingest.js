/* The one writer of a returned candidate.
 *
 * A generation backend's job ends the moment it holds bytes and knows which shot asked
 * for them. What happens next — where the file lands, what the row says, and what the
 * shot's review state becomes — is CineBraid's, is identical for every backend, and is
 * written here exactly once.
 *
 * WHY EXTRACTED. fal-generation.js's ingest() has been the only code in the product
 * that can turn a provider's result into something a director reviews. It is also
 * unreachable: a closure inside registerFalGeneration(), branching on fal's own purpose
 * strings and stamping the literal "fal" into every row. A second backend had two
 * options — reach into it, or write a second one — and the second option is how a
 * product acquires two candidate archives that agree until the day they do not.
 *
 * So the row and the bytes move here, and fal calls it. There is still exactly one
 * writer; it simply now has two callers. Nothing about fal's behaviour changes: the
 * provider word and the filename stem are parameters whose fal values are the strings
 * that were hard-coded, and tests/fal-generation.js is the proof.
 *
 * ------------------------------------------------------------------------------
 * THE CONTRACT, AND WHY EACH HALF OF IT MATTERS
 *
 * CALLED INSIDE A COMMIT TURN, SYNCHRONOUSLY. The caller has already downloaded every
 * byte and has already opened generation-commit.js's project turn. This function does
 * not await, because the indivisibility of that turn is what stops two collections from
 * choosing the same filename and what stops one from dropping the other's row.
 *
 * THE SHOT IS RE-FOUND BY THE CALLER INSIDE THE TURN, not passed from before the
 * downloads. A shot that was deleted while a render ran must not receive a candidate.
 *
 * IT NEVER DECIDES ANYTHING ABOUT THE RESULT. Whether a picture is good, whether it is
 * canon, whether it should be approved — none of that is here. A returned candidate is
 * `decision: "unreviewed"`, always, and the shot is moved to PENDING review. The
 * existing review path takes it from there, which is the point: the filmmaker's
 * Returned Result surface must not be able to tell which backend produced what it is
 * looking at.
 */

const fs = require("fs");
const path = require("path");

/* Substring tests rather than an exact mime match, because a provider that answers
   `image/png; charset=binary` still writes a .png and a provider that answers nothing
   useful still has to write something openable.

   The jpeg/webp/else-png rule is fal's, unchanged, so every mime fal's still-image path
   actually produces maps exactly where it did before. The four extra rows below are
   additions, not edits: they only decide cases fal's image ingest never receives, where
   the previous answer would have been to write an mp4 into a file called .png. */
function extensionFor(mime) {
  const value = String(mime || "").toLowerCase();
  if (value.includes("jpeg") || value.includes("jpg")) return ".jpg";
  if (value.includes("webp")) return ".webp";
  if (value.includes("gif")) return ".gif";
  if (value.includes("mp4")) return ".mp4";
  if (value.includes("webm")) return ".webm";
  return ".png";
}

function nowIso() {
  return new Date().toISOString();
}

/* ---------------------------------------------------------------------------
   The candidate row.

   Every field here is one an existing CineBraid surface already reads:
   public/shared-production-media.js's provenanceOf() resolves provider, model, job and
   request id from exactly these names, in this precedence, and it has never branched on
   which provider wrote them. That is why a ComfyUI result appears in the Returned
   Result and Candidate Review surfaces without either of them learning a new word. */
function candidateRow({ storedName, originalName, job, provider, packageLabel }) {
  return {
    stored: storedName,
    original: originalName,
    addedAt: nowIso(),
    /* A returned result is a proposal. Nothing that arrives from a backend is approved
       by arriving, and there is no parameter here that could make it so. */
    decision: "unreviewed",
    notes: "",
    labels: [],
    frameId: job.frameId || "",
    sourceBuildId: job.sourceBuildId || "",
    sourcePackageId: job.sourceBuildId || job.packageId || "",
    sourcePackageLabel: job.packageId || packageLabel,
    generationProvider: provider,
    generationModel: job.model,
    generationJobId: job.id,
    generationRequestId: job.externalId,
    automationRunId: job.automationRunId || "",
    automationStepKey: job.automationStepKey || "",
    generationQuality: job.quality,
    generationResolution: job.resolution,
  };
}

/* ---------------------------------------------------------------------------
   writeShotCandidates — bytes to disk, rows onto the shot.

   `downloads` are `{buffer, mime, originalName}` records the caller already has in
   memory. This function does no network and no downloading: a backend that could reach
   the network from inside a commit turn would be a backend that can hold the project
   document open across a provider's latency, which is the defect generation-commit.js
   exists to prevent.

   Returns the `outputs` array a job row records, so the caller stamps delivery from
   what was actually written rather than from what it intended to write. */
function writeShotCandidates({ ownerDir, project, shot, downloads, job, provider, fileStem, packageLabel, correction = false, ordinal = 1 }) {
  if (!ownerDir) throw new Error("A candidate must be written into a named project directory.");
  if (!shot || !shot.id) throw new Error("Shot no longer exists.");
  if (!String(provider || "").trim()) throw new Error("A candidate must record which backend produced it.");
  const stem = String(fileStem || "").trim().replace(/[^A-Za-z0-9]+/g, "") || "GEN";

  const dir = path.join(ownerDir, "shots", shot.id, "takes");
  fs.mkdirSync(dir, { recursive: true });
  shot.candidateFiles = Array.isArray(shot.candidateFiles) ? shot.candidateFiles : [];
  project.mediaAssets = Array.isArray(project.mediaAssets) ? project.mediaAssets : [];

  const frameLabel = job.frameLabel || "A";
  const outputs = [];
  for (let index = 0; index < downloads.length; index++) {
    const downloaded = downloads[index];
    const ext = extensionFor(downloaded.mime);
    /* `ordinal` is where this call's first result sits in the WHOLE delivery, not in
       this array. A caller that hands over one download at a time — fal does, because
       its loop owns the order its outputs arrive in — would otherwise name every file
       "_1" and let nextFile() invent the numbering from collisions. */
    const position = ordinal + index;
    const requested = correction
      ? `${shot.id}_FRAME_${frameLabel}_CORRECTION_${stem}_${position}${ext}`
      : `${shot.id}_FRAME_${frameLabel}_${stem}_${position}${ext}`;
    const name = nextFile(dir, safeName(requested, `${shot.id}_${stem}${ext}`));
    fs.writeFileSync(path.join(dir, name), downloaded.buffer);

    const candidate = candidateRow({
      storedName: name,
      originalName: downloaded.originalName,
      job,
      provider,
      packageLabel: packageLabel || `${provider} generation`,
    });
    if (correction) {
      candidate.correctionOf = job.sourceCandidate || "";
      candidate.correctionBuildId = job.sourceBuildId || "";
      candidate.correctionParentBuildId = job.parentBuildId || "";
      candidate.correctionParentPackageId = job.parentPackageId || "";
      candidate.correctionGuideAssetId = job.guideAssetId || "";
      candidate.correctionReferenceCount = Array.isArray(job.references) ? job.references.length : 0;
      candidate.correctionGeneratedAt = nowIso();
      const source = shot.candidateFiles.find((item) => (item.stored || item.name) === job.sourceCandidate);
      if (source) {
        source.correctionResultNames = Array.isArray(source.correctionResultNames) ? source.correctionResultNames : [];
        source.correctionJobIds = Array.isArray(source.correctionJobIds) ? source.correctionJobIds : [];
        if (!source.correctionResultNames.includes(name)) source.correctionResultNames.push(name);
        if (!source.correctionJobIds.includes(job.id)) source.correctionJobIds.push(job.id);
      }
    }
    shot.candidateFiles.push(candidate);
    outputs.push({
      type: "candidate",
      name,
      url: `/assets/shots/${shot.id}/takes/${name}`,
      frameId: job.frameId || "",
      correctionOf: job.sourceCandidate || "",
    });
  }
  return outputs;
}

/* The shot's own state after a delivery. Separate from the row writer because it is a
   statement about the SHOT rather than about the media: work arrived, so the shot is in
   progress, something is built, and a person owes it a look. */
function markShotAwaitingReview(shot) {
  shot.workflowStatus = "IN PROGRESS";
  shot.status = "BUILT";
  shot.reviewStatus = "PENDING";
  return shot;
}

/* ---------------------------------------------------------------------------
   Filename discipline, moved with the rows it names.

   safeName strips anything that is not a plain filename character; nextFile resolves a
   collision by suffixing rather than by overwriting. Both run inside the caller's
   commit turn, which is what makes the collision check meaningful — outside it, two
   collections can each observe "free" and then both write.

   Both are fal-generation.js's implementations, moved VERBATIM rather than rewritten.
   A filename is durable identity — it is what the candidate row stores, what
   /assets/ serves and what shared-media-disposition.js repairs on rename — so "a
   cleaner equivalent" is a behaviour change to every project that already exists. */
function safeName(value, fallback) {
  const clean = path.basename(String(value || fallback)).replace(/[^\w.\-]+/g, "_");
  return clean || fallback;
}

function nextFile(dir, requested) {
  const ext = path.extname(requested) || ".png";
  const stem = path.basename(requested, ext) || "output";
  let name = `${stem}${ext}`, i = 1;
  while (fs.existsSync(path.join(dir, name))) name = `${stem}_${++i}${ext}`;
  return name;
}

module.exports = {
  candidateRow,
  extensionFor,
  markShotAwaitingReview,
  nextFile,
  safeName,
  writeShotCandidates,
};
