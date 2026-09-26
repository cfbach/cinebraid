"use strict";

// Server-owned facts only. Prompt instructions are not a reliable gate: when a
// selected shot is blocked, this task returns readiness without invoking a model.
function braidyReadinessContext(project, feed, { question = "", shotId = "" } = {}) {
  if (!feed || feed.error || !Array.isArray(feed.shots))
    throw new Error("Production readiness is unavailable. Model advice was not requested.");
  const shots = project.shots || [];
  const mentions = shots.filter((shot) => {
    const escaped = String(shot.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, "i").test(question);
  }).map((shot) => shot.id);
  // The explicit question can discuss another shot from the current Shot Desk.
  const ids = mentions.length ? mentions : shotId ? [shotId] : shots.map((shot) => shot.id);
  if (ids.some((id) => !shots.some((shot) => shot.id === id)))
    throw new Error("The requested shot is not in this project. Model advice was not requested.");
  const readiness = ids.map((id) => {
    const row = feed.shots.find((item) => item.shotId === id);
    if (!row || !row.nextAction?.code || !Array.isArray(row.units))
      throw new Error(`Production readiness is unavailable for ${id}. Model advice was not requested.`);
    const missing = new Map();
    for (const unit of row.units) {
      for (const requirement of unit.requirements || []) {
        if (requirement.kind !== "entity-state" || !requirement.required || ["satisfied", "waived"].includes(requirement.state)) continue;
        const key = requirement.targetKey || requirement.id;
        if (!key || !requirement.label) throw new Error(`Required reference identity is unavailable for ${id}.`);
        missing.set(key, { targetKey: key, label: requirement.label, state: requirement.state, reason: requirement.reason });
      }
    }
    return { shotId: id, status: row.status, nextAction: row.nextAction, missingReferences: [...missing.values()] };
  });
  const blocked = !!feed.truthProblem || readiness.some((row) => row.status === "BLOCKED" || row.status === "NEEDS_DECISION" || row.missingReferences.length);
  const response = blocked ? {
    ok: true,
    source: "production-readiness",
    qualification: "unqualified",
    modelInvoked: false,
    readiness,
    answer: [
      "Model advice is unqualified for this blocked-shot task. Showing current production readiness; no model call or project change.",
      ...(feed.truthProblem ? [feed.truthProblem.message] : []),
      ...readiness.map((row) => `${row.shotId}: ${row.status}. Next action: ${row.nextAction.code} — ${row.nextAction.message} Required references still unresolved: ${row.missingReferences.length ? row.missingReferences.map((ref) => ref.label).join("; ") : "none"}.`),
      "Resolve the stated gate and recheck readiness before generating shot media. Reference approval and shot-output approval are separate decisions.",
    ].join("\n\n"),
  } : null;
  return { readiness, response };
}

module.exports = { braidyReadinessContext };
