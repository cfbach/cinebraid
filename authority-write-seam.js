"use strict";

/* CINEBRAID — Authority Write Seam V1 (O8).
 *
 * Node-only. Every durable project-document writer is enrolled through the
 * factory below. The caller supplies filesystem mechanics; this module owns
 * classification, the complete resolved-Canon comparison, and typed refusal.
 */

const Authority = require("./public/shared-authority-kernel");

const WRITE_CLASSES = Object.freeze({
  NORMAL_SAVE: "NORMAL_SAVE",
  CANON_TRANSITION: "CANON_TRANSITION",
  UNTRUSTED_IMPORT: "UNTRUSTED_IMPORT",
  RESTORE_SNAPSHOT: "RESTORE_SNAPSHOT",
  RECOVERY: "RECOVERY",
  INTERNAL_NONAUTHORITY_WRITE: "INTERNAL_NONAUTHORITY_WRITE",
  WORKSPACE_MIGRATION: "WORKSPACE_MIGRATION",
});
const WRITE_CLASS_SET = new Set(Object.values(WRITE_CLASSES));
const REVISION_REQUIRED = new Set([
  WRITE_CLASSES.NORMAL_SAVE,
  WRITE_CLASSES.CANON_TRANSITION,
  WRITE_CLASSES.RESTORE_SNAPSHOT,
]);
const CREATE_ONLY = new Set([
  WRITE_CLASSES.UNTRUSTED_IMPORT,
  WRITE_CLASSES.WORKSPACE_MIGRATION,
]);
/* THE list of classes that may only create, asked rather than restated. The caller
   supplies filesystem mechanics, so the caller is what has to publish exclusively —
   and a private copy of this list on that side is exactly how UNTRUSTED_IMPORT came
   to be classified CREATE_ONLY here and published with a rename over there. */
function isCreateOnlyWriteClass(writeClass) { return CREATE_ONLY.has(text(writeClass)); }

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function list(value) { return Array.isArray(value) ? value : []; }
function text(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}
function stableJson(value) { return JSON.stringify(stable(value)); }

function receiptRows(project) {
  return list(object(object(project).productionAuthority).receipts);
}

function parseTargetKey(key) {
  const raw = text(key);
  let match = raw.match(/^shot-frame:([^#]+)#(.+)$/);
  if (match) return Authority.authorityTarget({ kind: "shot-frame", shotId: match[1], frameId: match[2] });
  match = raw.match(/^shot-motion:([^#]+)#(.+)$/);
  if (match) return Authority.authorityTarget({ kind: "shot-motion", shotId: match[1], unitKey: match[2] });
  match = raw.match(/^shot-delivery:(.+)$/);
  if (match) return Authority.authorityTarget({ kind: "shot-delivery", shotId: match[1] });
  match = raw.match(/^entity-state:([^:]+):([^#]+)#(.+)$/);
  if (match) return Authority.authorityTarget({ kind: "entity-state", list: match[1], entityId: match[2], stateId: match[3] });
  return null;
}

/* O8 freezes the comparison domain from RAW current rows in BOTH documents.
 * A damaged row contributes its stored key and its re-derived key. Historic
 * rows do not freeze an edge. */
function rawCurrentTargetDomain(current, successor) {
  const targets = new Map();
  for (const project of [current, successor]) {
    for (const rowValue of receiptRows(project)) {
      const row = object(rowValue);
      if (row.status !== "current") continue;
      const storedKey = text(row.targetKey);
      if (storedKey) targets.set(storedKey, parseTargetKey(storedKey));
      const derived = Authority.authorityTarget(row);
      if (derived) targets.set(derived.key, derived);
    }
  }
  return targets;
}

function edgeTuple(project, target) {
  if (!target) return { value: "", assetId: "", recordId: "", field: "", form: "" };
  const edge = object(Authority.liveAuthorityEdge(project, target));
  return {
    value: text(edge.value),
    assetId: text(edge.assetId),
    recordId: text(edge.recordId),
    field: text(edge.field),
    form: text(edge.form),
  };
}

function targetExists(project, target) {
  if (!target) return false;
  const P = object(project);
  const shot = list(P.shots).find((row) => text(object(row).id) === target.shotId);
  if (target.kind === "shot-delivery") return !!shot;
  if (target.kind === "shot-frame")
    return !!shot && list(object(shot).keyframes).some((row) => text(object(row).id) === target.frameId);
  if (target.kind === "shot-motion") {
    if (!shot) return false;
    const matches = list(object(shot).clips).filter((row) => {
      const clip = object(row);
      return text(clip.id) === target.unitKey || text(clip.suffix) === target.unitKey;
    });
    return matches.length > 0;
  }
  if (target.kind === "entity-state") {
    const entity = list(P[target.list]).find((row) => text(object(row).id) === target.entityId);
    if (!entity) return false;
    return list(object(entity).continuityStates).some((row) => text(object(row).id) === target.stateId)
      || target.stateId === "state-default";
  }
  return false;
}

function canonComparison(current, successor) {
  return Authority.authorityWriteTransition(current, successor);
}

function canonicalLedger(project) {
  const ledger = object(project).productionAuthority;
  if (ledger === undefined) return "__absent__";
  const copy = clone(ledger);
  if (copy && Array.isArray(copy.receipts)) {
    copy.receipts.sort((a, b) => {
      const left = `${text(object(a).id)}\u0000${stableJson(a)}`;
      const right = `${text(object(b).id)}\u0000${stableJson(b)}`;
      return left.localeCompare(right);
    });
  }
  return stableJson(copy);
}

function refusal(status, code, message, detail = {}) {
  return { status, code, message, ...detail };
}

function currentReceiptById(project) {
  return new Map(receiptRows(project).map((row) => [text(object(row).id), row]));
}

function changedReceipts(current, successor) {
  const before = currentReceiptById(current), after = currentReceiptById(successor);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changed = [];
  for (const id of ids) {
    const prior = before.get(id), next = after.get(id);
    if (stableJson(prior) !== stableJson(next)) changed.push({ id, before: prior, after: next });
  }
  return changed.sort((a, b) => a.id.localeCompare(b.id));
}

function targetRemovalDisposition(current, successor, comparison) {
  if (!comparison.targetRemoval) return { ok: false, allowedIds: new Set(), keys: new Set() };
  const removable = comparison.targets.filter((row) => row.beforeExists && !row.afterExists);
  if (!removable.length) return { ok: false, allowedIds: new Set(), keys: new Set() };
  const beforeRows = receiptRows(current), afterById = currentReceiptById(successor);
  const allowedIds = new Set(), keys = new Set();
  for (const delta of removable) {
    const rows = beforeRows.filter((rowValue) => {
      const row = object(rowValue);
      if (row.status !== "current") return false;
      /* Stored key OR re-derived identity, through the kernel's one predicate — the same
         call public/mutations.js plans a removal with, so what this refuses and what that
         refuses to remove cannot come apart. */
      return Authority.authorityReceiptTargetKeys(row).includes(delta.targetKey);
    });
    if (!rows.length) return { ok: false, allowedIds: new Set(), keys: new Set() };
    for (const priorValue of rows) {
      const prior = object(priorValue), next = object(afterById.get(text(prior.id)));
      if (next.status !== "revoked" || next.revocationReason !== "target-removed")
        return { ok: false, allowedIds: new Set(), keys: new Set() };
      const restored = { ...next };
      for (const key of ["status", "revokedAt", "revocationReason", "revokedVia", "revokedBy"])
        if (Object.prototype.hasOwnProperty.call(prior, key)) restored[key] = prior[key]; else delete restored[key];
      if (stableJson(restored) !== stableJson(prior)) return { ok: false, allowedIds: new Set(), keys: new Set() };
      allowedIds.add(text(prior.id));
    }
    keys.add(delta.targetKey);
  }
  const changed = changedReceipts(current, successor);
  if (changed.some((row) => !allowedIds.has(row.id))) return { ok: false, allowedIds: new Set(), keys: new Set() };
  if (comparison.targets.some((row) => !keys.has(row.targetKey))) return { ok: false, allowedIds: new Set(), keys: new Set() };
  return { ok: true, allowedIds, keys };
}

function normalPolicy(current, successor, comparison, allowRemoval) {
  if (!comparison.ledgerChanged && !comparison.targets.length) return null;
  if (allowRemoval && targetRemovalDisposition(current, successor, comparison).ok) return null;
  const targets = comparison.targets.map((row) => ({
    targetKey: row.targetKey,
    value: row.before.value,
    assetId: row.before.assetId,
  }));
  /* A ledger-only mutation still names every current target whose authority
     record was frozen, so the browser can explain what was protected. */
  if (!targets.length) {
    for (const targetKey of rawCurrentTargetDomain(current, successor).keys()) {
      const target = parseTargetKey(targetKey);
      const before = edgeTuple(current, target);
      targets.push({ targetKey, value: before.value, assetId: before.assetId });
    }
  }
  return refusal(422, "CANON_TRANSITION_REQUIRED",
    "This ordinary save would change production authority. Use the explicit Canon transition protocol.",
    { targets });
}

function transitionPolicy(current, successor, comparison, metadata) {
  const declaration = object(metadata);
  const declaredTargets = [...new Set(list(declaration.targetKeys).map(text).filter(Boolean))].sort();
  const declaredReceipts = [...new Set(list(declaration.receiptIds).map(text).filter(Boolean))].sort();
  const ledger = Authority.validateAuthorityLedger(successor);
  if (!ledger.trusted)
    return refusal(422, "AUTHORITY_LEDGER_UNTRUSTED", "The submitted authority ledger is not trustworthy.", { diagnostics: ledger.diagnostics });

  const changed = changedReceipts(current, successor);
  const affectedTargets = new Set(comparison.changedTargetKeys);
  for (const row of changed) {
    for (const value of [row.before, row.after]) {
      const receipt = object(value);
      const derived = Authority.authorityTarget(receipt);
      if (derived) affectedTargets.add(derived.key);
      if (text(receipt.targetKey)) affectedTargets.add(text(receipt.targetKey));
    }
  }
  const actualTargets = [...affectedTargets].sort();
  const actualReceipts = changed.map((row) => row.id).sort();
  if (stableJson(declaredTargets) !== stableJson(actualTargets) || stableJson(declaredReceipts) !== stableJson(actualReceipts))
    return refusal(422, "CANON_DECLARATION_MISMATCH", "The Canon transition changed targets or receipts outside its explicit declaration.", {
      declaredTargets, actualTargets, declaredReceipts, actualReceipts,
    });

  for (const row of changed) {
    if (row.before === undefined && row.after !== undefined) {
      const index = receiptRows(successor).findIndex((candidate) => text(object(candidate).id) === row.id);
      const shape = Authority.validateReceiptShape(row.after, index);
      if (!shape.ok)
        return refusal(422, "AUTHORITY_RECEIPT_INVALID", "A new authority receipt failed validation.", { receiptId: row.id, diagnostics: shape.problems });
    }
  }

  for (const targetKey of declaredTargets) {
    const target = parseTargetKey(targetKey);
    if (!target) return refusal(422, "AUTHORITY_TARGET_INVALID", "A declared Canon target is invalid.", { targetKey });
    const currentRows = ledger.receipts.filter((row) => row.status === "current" && row.target.key === targetKey);
    if (currentRows.length > 1)
      return refusal(422, "AUTHORITY_TARGET_AMBIGUOUS", "A declared Canon target has more than one current receipt.", { targetKey });
    if (currentRows.length === 1) {
      const receipt = currentRows[0], edge = edgeTuple(successor, target);
      if (edge.value !== text(receipt.value) || (text(receipt.assetId) && edge.assetId !== text(receipt.assetId)))
        return refusal(422, "AUTHORITY_EDGE_RECEIPT_MISMATCH", "A declared Canon edge does not match its current receipt.", { targetKey, receiptId: receipt.id });
    } else {
      const beforeEdge = edgeTuple(current, target), afterEdge = edgeTuple(successor, target);
      const revokedCurrent = changed.some((row) => {
        const prior = object(row.before), next = object(row.after), priorTarget = Authority.authorityTarget(prior);
        return prior.status === "current" && next.status !== "current" && priorTarget?.key === targetKey;
      });
      const cleared = !afterEdge.value && !afterEdge.assetId;
      if (stableJson(beforeEdge) !== stableJson(afterEdge) && !(revokedCurrent && cleared))
        return refusal(422, "AUTHORITY_EDGE_WITHOUT_CURRENT_RECEIPT", "A Canon transition cannot add or alter an authority edge without a matching current receipt.", { targetKey });
    }
  }

  const systemChanges = changed.filter((row) => object(row.after).revokedBy === "system");
  if (systemChanges.length && declaration.transitionKind !== "SYSTEM_INVALIDATE")
    return refusal(422, "SYSTEM_INVALIDATION_DECLARATION_REQUIRED", "A system invalidation must be declared explicitly.");
  if (declaration.transitionKind === "SYSTEM_INVALIDATE" && !systemChanges.length)
    return refusal(422, "SYSTEM_INVALIDATION_SHAPE_INVALID", "The declared system invalidation did not revoke any current authority.");
  for (const row of systemChanges) {
    const before = object(row.before), after = object(row.after);
    if (before.status !== "current" || after.status !== "revoked" || after.revocationReason !== "target-cleared" || after.revokedBy !== "system")
      return refusal(422, "SYSTEM_INVALIDATION_SHAPE_INVALID", "System invalidation may only revoke current authority for target-cleared.", { receiptId: row.id });
    if (Object.prototype.hasOwnProperty.call(after, "revocationProvenance"))
      return refusal(422, "SYSTEM_INVALIDATION_PROVENANCE_FORBIDDEN", "System invalidation cannot write human provenance.", { receiptId: row.id });
    const target = Authority.authorityTarget(before);
    if (!systemInvalidationDerivedFromStoredState(current, successor, target))
      return refusal(422, "SYSTEM_INVALIDATION_PRECONDITION_FAILED", "Stored project state does not establish a deterministic invalidation cause.", { targetKey: target?.key || "" });
  }
  return null;
}

function systemInvalidationDerivedFromStoredState(current, successor, target) {
  if (!target || !["shot-motion", "shot-delivery"].includes(target.kind)) return false;
  const beforeShot = list(object(current).shots).find((row) => text(object(row).id) === target.shotId);
  const afterShot = list(object(successor).shots).find((row) => text(object(row).id) === target.shotId);
  if (!beforeShot || !afterShot) return false;
  const beforeFrames = list(object(beforeShot).keyframes);
  const afterFrames = list(object(afterShot).keyframes);
  const frameIds = new Set([...beforeFrames, ...afterFrames].map((row) => text(object(row).id)).filter(Boolean));
  for (const frameId of frameIds) {
    const frameTarget = Authority.authorityTarget({ kind: "shot-frame", shotId: target.shotId, frameId });
    if (stableJson(edgeTuple(current, frameTarget)) !== stableJson(edgeTuple(successor, frameTarget))) return true;
  }
  return false;
}

function enumerateAuthorityEdges(project) {
  const targets = [];
  for (const shotValue of list(object(project).shots)) {
    const shot = object(shotValue), shotId = text(shot.id);
    for (const frameValue of list(shot.keyframes)) {
      const frameId = text(object(frameValue).id);
      if (shotId && frameId) targets.push(Authority.authorityTarget({ kind: "shot-frame", shotId, frameId }));
    }
    const unitKeys = new Set();
    for (const clipValue of list(shot.clips)) {
      const clip = object(clipValue);
      for (const unitKey of [text(clip.id), text(clip.suffix)]) if (unitKey) unitKeys.add(unitKey);
    }
    for (const unitKey of unitKeys) if (shotId) targets.push(Authority.authorityTarget({ kind: "shot-motion", shotId, unitKey }));
    if (shotId) targets.push(Authority.authorityTarget({ kind: "shot-delivery", shotId }));
  }
  /* THE KERNEL'S LIST, NOT A COPY OF IT. This enumeration is the import-policy
     half of a two-layer defence; a private four-list literal here made it a
     restatement of the builder stripper instead, and silently omitted `audio`,
     which the kernel has always resolved entity-state edges for. */
  for (const name of Authority.AUTHORITY_ENTITY_LISTS) {
    for (const entityValue of list(object(project)[name])) {
      const entity = object(entityValue), entityId = text(entity.id);
      const stateIds = new Set(list(entity.continuityStates).map((row) => text(object(row).id)).filter(Boolean));
      /* The kernel resolves an addressed `#state-default` through the ENTITY-level
         pointer whenever no state of that id is declared. Declared siblings do NOT
         suppress it, so gating this on an empty state list missed a live edge on
         every entity that carries its own approved pointer alongside named states.
         A declared default with no own file needs nothing extra: its own id is
         already enumerated, and the kernel falls back through it. */
      if (text(entity.approvedFile) || text(entity.approvedAssetId)) stateIds.add("state-default");
      for (const stateId of stateIds)
        if (entityId) targets.push(Authority.authorityTarget({ kind: "entity-state", list: name, entityId, stateId }));
    }
  }
  return targets.filter(Boolean);
}

function importPolicy(successor) {
  if (Object.prototype.hasOwnProperty.call(object(successor), "productionAuthority") || receiptRows(successor).length)
    return refusal(422, "UNTRUSTED_IMPORT_AUTHORITY_PRESENT", "An untrusted import cannot carry production-authority receipts.");
  const surviving = enumerateAuthorityEdges(successor)
    .map((target) => ({ targetKey: target.key, edge: edgeTuple(successor, target) }))
    .filter((row) => row.edge.value || row.edge.assetId);
  if (surviving.length)
    return refusal(422, "UNTRUSTED_IMPORT_EDGE_PRESENT", "An untrusted import cannot carry authority-bearing edges.", { targets: surviving });
  return null;
}

function recoveryPolicy(current, successor) {
  const before = Authority.validateAuthorityLedger(current);
  if (before.trusted)
    return refusal(409, "AUTHORITY_RECOVERY_NOT_REQUIRED", "Recovery is only available for an untrusted authority ledger.");
  if (before.diagnostics.some((row) => row.code === "AUTHORITY_LEDGER_VERSION_UNSUPPORTED"))
    return refusal(409, "AUTHORITY_LEDGER_COMPATIBILITY_REQUIRED", "This authority ledger was written by an unsupported version and cannot be recovered by this build.", { diagnostics: before.diagnostics });
  const after = Authority.validateAuthorityLedger(successor);
  if (!after.trusted || after.receipts.some((row) => row.status === "current"))
    return refusal(422, "AUTHORITY_RECOVERY_UNSAFE", "Recovery must leave an operable project with zero current authority receipts.", { diagnostics: after.diagnostics });
  const beforeIds = new Set(receiptRows(current).map((row) => text(object(row).id)).filter(Boolean));
  const added = receiptRows(successor).filter((row) => !beforeIds.has(text(object(row).id)));
  if (added.length) return refusal(422, "AUTHORITY_RECOVERY_ADDED_RECEIPT", "Recovery cannot add an authority receipt.", { receiptIds: added.map((row) => text(object(row).id)) });
  return null;
}

function restorePolicy(metadata) {
  const it = object(metadata);
  if (it.confirmed !== true)
    return refusal(409, "RESTORE_CONFIRMATION_REQUIRED", "Review the snapshot trust verdict and authority delta before restoring it.");
  if (it.resurrection === true && it.resurrectionConfirmed !== true)
    return refusal(409, "RESTORE_RESURRECTION_CONFIRMATION_REQUIRED", "This restore would resurrect production authority and requires a second explicit confirmation.");
  return null;
}

function createAuthorityWriteSeam(io = {}) {
  for (const name of ["resolveFile", "readProject", "validateProject", "writeProject", "revisionFor"])
    if (typeof io[name] !== "function") throw new Error(`Authority Write Seam requires io.${name}().`);

  function persistProjectSuccessor({ slug, successor, writeClass, expectedRevision, transitionMetadata } = {}) {
    let file = "", current = {}, storedRevision = "";
    try {
      if (!WRITE_CLASS_SET.has(writeClass))
        return { ok: false, revision: "", refusal: refusal(422, "WRITE_CLASS_REQUIRED", "A known Authority Write Seam class is required. No project bytes were written.") };
      file = io.resolveFile(slug, writeClass, transitionMetadata);
      const exists = io.exists ? io.exists(file) : true;
      /* A pre-check, and only a pre-check. It answers for the destination as it was
         at this instant, and nothing holds the name between here and the publish —
         so it exists to choose well, not to keep CREATE_ONLY. The publish is what
         keeps CREATE_ONLY; see the EEXIST arm of the catch below. */
      if (isCreateOnlyWriteClass(writeClass) && exists)
        return { ok: false, revision: io.revisionFor(file), refusal: refusal(409, "PROJECT_DESTINATION_EXISTS", "The destination project document already exists.", { slug: text(slug) }) };
      /* THE STORED DOCUMENT, AND THE ONE CLASS THAT MAY REPLACE ONE IT CANNOT READ.

         Every write class compares its successor against what is stored, so every
         class but one requires the stored document to be readable — and a class
         that cannot read it must fail rather than write past it, which is what
         letting this throw does.

         RESTORE_SNAPSHOT is the exception, and it is the exception because it is
         the operation whose entire purpose is to replace a document that has gone
         bad. Refusing it there would make the recovery path unreachable in exactly
         the situation recovery exists for.

         WHAT IS NOT WEAKENED. `storedRevision` is a hash of the BYTES and is taken
         either way, so the exact-If-Match precondition on RESTORE_SNAPSHOT still
         holds: the caller must still name the unreadable document it read. The
         successor is still validated. `{}` holds no authority, so canonComparison
         reports every current authority in the snapshot as an addition and the
         restore policy's resurrection confirmation is REQUIRED rather than skipped —
         the fail-closed direction. And io.writeProject still takes its
         before-restore backup of the unreadable bytes first. */
      current = {};
      if (exists) {
        try {
          current = io.readProject(file);
        } catch (error) {
          if (writeClass !== WRITE_CLASSES.RESTORE_SNAPSHOT) throw error;
          current = {};
        }
      }
      storedRevision = exists ? io.revisionFor(file) : "";
      if (typeof io.prepareSuccessor === "function")
        successor = io.prepareSuccessor(successor, current, { slug, writeClass, transitionMetadata });

      if (REVISION_REQUIRED.has(writeClass)) {
        const requested = text(expectedRevision);
        if (storedRevision && !requested)
          return { ok: false, revision: storedRevision, refusal: refusal(428, "PROJECT_REVISION_REQUIRED", "This write did not identify the project revision it read.") };
        if (storedRevision && requested !== storedRevision)
          return { ok: false, revision: storedRevision, refusal: refusal(409, "PROJECT_REVISION_CONFLICT", "The project changed before this write, so the entire operation was refused.", { yourRevision: requested, action: "reload" }) };
      }

      const validation = io.validateProject(successor);
      if (!validation || validation.ok !== true)
        return { ok: false, revision: storedRevision, refusal: refusal(422, "PROJECT_VALIDATION_FAILED", "Project validation failed.", { issues: list(validation?.errors) }) };

      const comparison = canonComparison(current, successor);
      let denied = null;
      if (writeClass === WRITE_CLASSES.NORMAL_SAVE) denied = normalPolicy(current, successor, comparison, true);
      else if (writeClass === WRITE_CLASSES.INTERNAL_NONAUTHORITY_WRITE) denied = normalPolicy(current, successor, comparison, false);
      else if (writeClass === WRITE_CLASSES.CANON_TRANSITION) denied = transitionPolicy(current, successor, comparison, transitionMetadata);
      else if (writeClass === WRITE_CLASSES.UNTRUSTED_IMPORT) denied = importPolicy(successor);
      else if (writeClass === WRITE_CLASSES.RESTORE_SNAPSHOT) denied = restorePolicy(transitionMetadata);
      else if (writeClass === WRITE_CLASSES.RECOVERY) denied = recoveryPolicy(current, successor);
      /* WORKSPACE_MIGRATION is allowed to preserve a complete valid source
         document, but only into the non-existing destination checked above. */
      if (denied) return { ok: false, revision: storedRevision, refusal: denied };

      if (exists && stableJson(current) === stableJson(successor))
        return { ok: true, revision: storedRevision, refusal: null, unchanged: true, created: false, comparison, successor: clone(successor) };
      io.writeProject(file, successor, { slug, writeClass, transitionMetadata, current });
      /* `created` says THIS call brought the document into existence, rather than
         replacing one that was already there. A caller that has to clean up after
         itself cannot ask the filesystem afterwards — by then another writer's
         document is indistinguishable from its own — so the one place that knows
         says so. For a CREATE_ONLY class io.writeProject publishes exclusively and
         a lost publish never reaches this line, which is what makes this a proof
         rather than a report. */
      return { ok: true, revision: io.revisionFor(file), refusal: null, created: !exists, comparison, successor: clone(successor) };
    } catch (error) {
      /* A CREATE_ONLY publish that loses is not a new kind of fact. The pre-check
         above answers PROJECT_DESTINATION_EXISTS when it can see the destination;
         the exclusive publish answers the same thing when nothing could have. One
         condition, one refusal, learned at whichever moment noticed — so a caller
         that already knows what to do about a taken destination needs nothing new.

         EEXIST and nothing else. COPYFILE_EXCL also answers EPERM on Windows for a
         destination that is a directory or a reparse point, and for a SOURCE it
         could not read at all; calling any of those "occupied" would turn a real
         failure into a retry that quietly succeeds somewhere else. */
      if (isCreateOnlyWriteClass(writeClass) && text(error?.code) === "EEXIST") {
        let revision = "";
        try { revision = io.revisionFor(file); } catch { /* the winner's bytes; unreadable is not our failure */ }
        return {
          ok: false,
          revision,
          refusal: refusal(409, "PROJECT_DESTINATION_EXISTS", "The destination project document already exists.", { slug: text(slug) }),
        };
      }
      return {
        ok: false,
        revision: storedRevision,
        refusal: refusal(500, "PROJECT_PERSISTENCE_FAILED", text(error?.message) || "Project persistence failed.", { slug: text(slug) }),
      };
    }
  }

  return { persistProjectSuccessor };
}

module.exports = {
  WRITE_CLASSES,
  isCreateOnlyWriteClass,
  createAuthorityWriteSeam,
  canonComparison,
  rawCurrentTargetDomain,
  canonicalLedger,
  enumerateAuthorityEdges,
};
