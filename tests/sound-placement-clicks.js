/* The shot sound listener shares document clicks with the render harness. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const listeners = new Map();
const shot = { id: "S-01", soundPlacements: [] };
const approved = {
  entityId: "A-01", receiptId: "receipt-1", assetId: "asset-1",
  value: "door.wav", available: true, url: "/assets/door.wav",
};
const values = {
  "[data-sound-source]": { value: "A-01|receipt-1|asset-1|door.wav" },
  "[data-sound-role]": { value: "ambience" },
  "[data-sound-timing]": { value: "at-cue" },
  "[data-sound-cue]": { value: "Door closes at 00:03. " },
  "[data-sound-message]": { textContent: "" },
};
const form = { querySelector: selector => values[selector] };
const add = {
  dataset: { soundAdd: shot.id },
  closest: selector => selector === "[data-sound-form]" ? form : null,
};
const remove = {
  dataset: { soundShot: shot.id, soundRemove: "sound-fixed-uuid" },
  closest: () => null,
};
let saves = 0, renders = 0;
const context = {
  P: { audio: [{ id: "A-01", name: "Door ambience" }] },
  SCAN: { audio: [{ available: true, approvedAudio: [approved] }] },
  entityProductionTruth: () => ({ canon: [{ ...approved, id: approved.receiptId }] }),
  document: { addEventListener: (kind, fn) => listeners.set(kind, fn) },
  shotById: id => id === shot.id ? shot : null,
  dirty: () => { saves++; },
  route: () => { renders++; },
  crypto: { randomUUID: () => "fixed-uuid" },
  attr: String,
  esc: String,
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/sound-placement.js"), "utf8"), context, {
  filename: "sound-placement.js",
});
const click = listeners.get("click");
assert.strictEqual(typeof click, "function");

click({ type: "click", isTrusted: true }); // Existing render harness gesture has no target.
click({ type: "click", isTrusted: true, target: { nodeType: 3 } }); // A non-element target.
assert.strictEqual(shot.soundPlacements.length, 0);
assert.deepStrictEqual([saves, renders], [0, 0]);

const element = match => ({ closest: selector => selector === match ? (match === "[data-sound-add]" ? add : remove) : null });
click({ type: "click", isTrusted: true, target: element("[data-sound-add]") });
assert.strictEqual(shot.soundPlacements.length, 1);
assert.deepStrictEqual(
  [shot.soundPlacements[0].audioEntityId, shot.soundPlacements[0].receiptId,
    shot.soundPlacements[0].assetId, shot.soundPlacements[0].role,
    shot.soundPlacements[0].timing, shot.soundPlacements[0].cue],
  ["A-01", "receipt-1", "asset-1", "ambience", "at-cue", "Door closes at 00:03."],
);
assert.deepStrictEqual([saves, renders], [1, 1]);

click({ type: "click", isTrusted: true, target: element("[data-sound-remove]") });
assert.strictEqual(shot.soundPlacements.length, 0);
assert.deepStrictEqual([saves, renders], [2, 2]);
console.log("Sound placement click regression passed: targetless gesture, non-element target, add and remove.");
