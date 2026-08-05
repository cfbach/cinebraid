const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { render, buildFixture } = require("./render-harness");
const RELEASE_VERSION = require("../package.json").version;

function count(html, needle) { return String(html || "").split(needle).length - 1; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function main() {
  const root = path.join(__dirname, "..");
  const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert(index.includes(`bounded-rendering.js?v=${RELEASE_VERSION}`), "bounded-rendering module must load");
  assert(index.indexOf("bounded-rendering.js") < index.indexOf("app.js"), "bounded helpers must load before route renderers");

  const fixture = buildFixture();
  fixture.characters[0].prefix = "KAI";
  fixture.characters[0].coverageSlots = Array.from({ length: 36 }, (_, index) => ({ id: `slot-${index}`, label: `Angle ${index + 1}`, required: index < 4, approvedFile: "", notes: "" }));
  fixture.characters[0].expressionSlots = Array.from({ length: 12 }, (_, index) => ({ id: `expression-${index}`, label: `Expression ${index + 1}`, required: index < 4, approvedFile: "", notes: "" }));
  fixture.characters[0].candidateFiles = Array.from({ length: 100 }, (_, index) => ({ stored: `KAI_CANDIDATE_${String(index + 1).padStart(3, "0")}.png`, decision: "unreviewed" }));
  const anchors = fixture.characters[0].candidateFiles.map((row) => ({ name: row.stored, url: `/assets/anchors/${row.stored}` }));
  const before = JSON.stringify(fixture);

  const candidateStorage = { "cinebraid-focused:fixture:entity-task:characters:KAI": "candidates" };
  const candidateRender = await render("#/character/KAI", fixture, { storage: candidateStorage, scan: { anchors, plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} } });
  assert(count(candidateRender.html, 'class="entity-candidate-card') <= 12, "reference candidate HTML must be sliced before rendering");
  assert(!candidateRender.html.includes("KAI_CANDIDATE_100.png"), "off-page candidates must not exist in route HTML");

  const coverageStorage = {
    "cinebraid-focused:fixture:entity-task:characters:KAI": "coverage",
    "cinebraid-bounded:fixture:selected:coverage-slot:characters:KAI": "slot-17",
  };
  const coverageRender = await render("#/character/KAI", fixture, { storage: coverageStorage, scan: { anchors, plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} } });
  assert.strictEqual(count(coverageRender.html, 'class="coverage-slot-card'), 1, "only one complete coverage editor may be rendered");
  assert(coverageRender.html.includes("Angle 18"), "stored selected coverage slot must be rendered");
  assert(coverageRender.html.includes("Angle 36"), "lightweight slot rail should preserve all slot navigation");

  const large = buildFixture();
  const baseShot = large.shots[0];
  large.shots = Array.from({ length: 500 }, (_, index) => ({ ...clone(baseShot), id: `L1-${String(index + 1).padStart(3, "0")}`, title: `Shot ${index + 1}`, winner: null, keyframes: clone(baseShot.keyframes || []) }));
  const board = await render("#/shots/board", large, { scan: { anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} } });
  assert(count(board.html, 'class="slate ') <= 40, "shot board must render no more than 40 shot cards");
  assert(!board.html.includes("L1-500"), "off-page shots must not be constructed in the first page HTML");

  const shot = await render("#/shot/L1-001", large, { storage: { "cinebraid-focused:fixture:shot-task:L1-001": "frames" }, scan: { anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: { "L1-001": { takes: [], locked: [] } } } });
  assert(shot.html.includes('data-bounded-task="frames"'), "shot renderer must construct only the selected task");
  assert(!shot.html.includes('data-guided-panel="blocking"'), "inactive blocking editor must not be constructed");
  assert(!shot.html.includes('data-guided-panel="motion"'), "inactive motion editor must not be constructed");

  const runs = Array.from({ length: 50 }, (_, index) => ({ id: `run-${index}`, type: "shot", targetId: `L1-${index}`, label: `Run ${index}`, status: "completed", revision: 1, usage: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  const reports = await render("#/reports", buildFixture(), { fetch: async (url, options, response) => {
    if (String(url).startsWith("/api/automation/runs?view=history")) return response({ runs, page: 0, pages: 10, pageSize: 50, total: 500, targetOptions: [] });
    if (url === "/api/automation/reports/summary") return response({ summary: { runCount: 500, totals: {}, quality: {}, highestEffortTargets: [], repeatedComplaints: [], inefficientFeedback: [] } });
    return null;
  }});
  assert.strictEqual(count(reports.html, 'class="reports-run-row'), 50, "Reports must render one server page only");
  assert(reports.html.includes("1–50 of 500"), "Reports must show server pagination range");

  assert.strictEqual(JSON.stringify(fixture), before, "navigation and bounded rendering must not modify project JSON");
  console.log("Bounded rendering suite passed source-sliced candidates, selected-slot-only editors, 40-shot boards, selected-task-only shot rendering, server-paged reports, and project-data immutability.");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
