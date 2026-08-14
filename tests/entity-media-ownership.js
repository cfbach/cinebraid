/* EXACT ENTITY / MEDIA OWNERSHIP. Dogfood Pass #2 A4, forensic audit F4.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: `CHAR-SWEEP-YOUNG`'s media is
 * never eligible for `CHAR-SWEEP` — not for display, not for the review pool,
 * not for approval, not for coverage automation, and not for the server's batch
 * reviewer.
 *
 * THE CASE, from the pass. Young Sweep had three candidates. They appeared
 * correctly under Young Sweep, and ALSO under the adult Chimbley Sweep. The
 * Widow stayed clean, and that is the diagnostic detail: she has no overlapping
 * id, so the leak was exact string prefix collision and nothing to do with
 * parent/child lineage.
 *
 * WHY THE UNRELATED CONTROL IS LOAD-BEARING. `CHAR-WIDOW` proves the fix did not
 * simply stop showing media. A repair that isolates everything from everything
 * passes the leak test and breaks the product.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. The resolver is pure and the harness
 * renders in-process.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const Ownership = require("../public/shared-entity-ownership");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

/* ===========================================================================
   The fixture. Three characters: an overlapping pair and an unrelated control,
   exactly the shape the pass reported. */

const ADULT = "CHAR-SWEEP";
const CHILD = "CHAR-SWEEP-YOUNG";
const CONTROL = "CHAR-WIDOW";

const ADULT_FILES = ["CHAR-SWEEP_PRIMARY_V001.png", "CHAR-SWEEP_PRIMARY_V002.png"];
const CHILD_FILES = ["CHAR-SWEEP-YOUNG_PRIMARY_V001.png", "CHAR-SWEEP-YOUNG_PRIMARY_V002.png", "CHAR-SWEEP-YOUNG_PRIMARY_V003.png"];
const CONTROL_FILES = ["CHAR-WIDOW_PRIMARY_V001.png"];
const UNCLAIMED = "CHAR-SWEEP-YOUNG_IMPORTED_BY_HAND.png";

function project(options = {}) {
  const { claims = true, contested = false, unclaimed = false } = options;
  const rows = (files) => (claims ? files.map((file) => ({ stored: file, decision: "unreviewed" })) : []);
  return {
    characters: [
      { id: ADULT, name: "Chimbley Sweep", approvedFile: claims ? ADULT_FILES[0] : "", candidateFiles: rows(ADULT_FILES), continuityStates: [] },
      {
        id: CHILD, name: "Young Sweep",
        candidateFiles: [
          ...rows(CHILD_FILES),
          /* The contaminated state the OLD behaviour could create: the creator
             reviewed a child's file from the ADULT's pool, and the adult
             materialised a candidate row for bytes it does not own. */
          ...(contested ? [] : []),
        ],
        continuityStates: [],
      },
      { id: CONTROL, name: "Widow Ashgrove", candidateFiles: rows(CONTROL_FILES), continuityStates: [] },
    ],
    locations: [], props: [], vehicles: [], audio: [], shots: [],
    ...(unclaimed ? {} : {}),
  };
}

function allFiles(options = {}) {
  return [...ADULT_FILES, ...CHILD_FILES, ...CONTROL_FILES, ...(options.unclaimed ? [UNCLAIMED] : [])]
    .map((name) => ({ name, url: `/assets/anchors/${name}` }));
}

/* ===========================================================================
   1. THE LEAK, closed. */

const index = Ownership.buildEntityOwnerIndex(project(), "characters");

eq(Ownership.filterEntityMedia(index, ADULT, allFiles()).map((row) => row.name), ADULT_FILES,
  "the adult sees exactly its own two files — the three CHAR-SWEEP-YOUNG candidates are gone");
eq(Ownership.filterEntityMedia(index, CHILD, allFiles()).map((row) => row.name), CHILD_FILES,
  "the child still sees all three of its own");
eq(Ownership.filterEntityMedia(index, CONTROL, allFiles()).map((row) => row.name), CONTROL_FILES,
  "and the unrelated control is unaffected — the fix isolates the right thing, not everything");

for (const file of CHILD_FILES) {
  ok(!Ownership.entityOwnsMedia(index, ADULT, file), `${file} is not eligible for the adult`);
  ok(Ownership.entityOwnsMedia(index, CHILD, file), `${file} is eligible for the child`);
}
eq(Ownership.mediaOwnerId(index, CHILD_FILES[0]), CHILD, "ownership resolves to exactly one entity");

/* ===========================================================================
   2. THE FALLBACK. Media nobody claims must stay visible, and must resolve to
      the MOST SPECIFIC declaration rather than the shortest matching one. */

/* CHANGED IN BATCH 1B. This block used to assert that an unclaimed file
   `filterEntityMedia` returned was "visible to its owner" — and the pool
   `filterEntityMedia` answers is the pool review, approval, coverage automation
   and the server batch reviewer all draw from. So the old expectation was
   literally "a guess is canon-eligible", which is what the acceptance audit
   demonstrated by approving `SWEEP_CHILD_UNCLAIMED.png` into the child's pool.

   VISIBILITY WAS NEVER THE PROBLEM AND IS NOT WITHDRAWN. It moved to a reader
   that answers a different question. */

const unclaimedIndex = Ownership.buildEntityOwnerIndex(project(), "characters");
const unclaimedResolution = Ownership.resolveMediaOwnership(unclaimedIndex, UNCLAIMED);
eq(unclaimedResolution.basis, "prefix-inference",
  "a hand-imported file no record claims is resolved by INFERENCE, and the resolution says so out loud");
eq(unclaimedResolution.ownerId, CHILD,
  "the inference still picks the LONGEST matching prefix — `CHAR-SWEEP-YOUNG` is a more specific statement about those bytes than `CHAR-SWEEP`");
eq(unclaimedResolution.authoritative, false,
  "and it is NOT authoritative: nothing durable in the project says these bytes belong to anybody");
ok(!Ownership.entityOwnsMedia(unclaimedIndex, CHILD, UNCLAIMED),
  "so it does not enter the child's approval-capable pool — a filename is a possible match, not ownership");
ok(!Ownership.entityOwnsMedia(unclaimedIndex, ADULT, UNCLAIMED), "and certainly not the parent's");
ok(Ownership.entityMayDiscoverMedia(unclaimedIndex, CHILD, UNCLAIMED),
  "it IS discoverable by its likely owner — a creator who drops a reference into anchors/ must still find it");
ok(Ownership.unassignedEntityMedia(unclaimedIndex, CHILD, allFiles({ unclaimed: true })).some((row) => row.name === UNCLAIMED),
  "and it appears in the unassigned surface, which is the quarantine: visible, explained, and outside every approval workflow");
eq(Ownership.planEntityMediaClaim(unclaimedIndex, CHILD, UNCLAIMED).claim, true,
  "one human act turns the possible match into a durable claim");
eq(Ownership.planEntityMediaClaim(unclaimedIndex, ADULT, UNCLAIMED).claim, true,
  "and the claim is a decision, not a confirmation of the guess — the adult may claim it too if that is the truth");

const noClaims = Ownership.buildEntityOwnerIndex(project({ claims: false }), "characters");
eq(Ownership.filterEntityMedia(noClaims, ADULT, allFiles()).map((row) => row.name), [],
  "a project with no durable claims at all has no approval-capable media — inference cannot substitute for a record");
eq(Ownership.unassignedEntityMedia(noClaims, ADULT, allFiles()).map((row) => row.name), ADULT_FILES,
  "every one of those files is still discoverable under the entity whose prefix it matches");
eq(Ownership.unassignedEntityMedia(noClaims, CHILD, allFiles()).map((row) => row.name), CHILD_FILES, "for the child too, by prefix specificity alone");

/* A tie between two entities declaring the identical prefix attributes to
   NEITHER. A project that cannot say who owns a file must not have an answer
   invented for it. */
const tied = Ownership.buildEntityOwnerIndex({
  characters: [{ id: "CHAR-A", prefix: "SHARED" }, { id: "CHAR-B", prefix: "SHARED" }],
}, "characters");
eq(Ownership.mediaOwnerId(tied, "SHARED_001.png"), "", "an identical declared prefix on two entities resolves to nobody");

/* ===========================================================================
   3. CONTESTED CLAIMS. The durable wrong-owner rows the OLD behaviour could
      create are REPORTED, not silently resolved — the Dogfood #2 evidence is not
      rewritten by this repair. */

const contaminated = project();
/* Exactly what a creator approving a child's candidate from the adult's review
   surface would have produced. */
contaminated.characters[0].candidateFiles.push({ stored: CHILD_FILES[0], decision: "approved-reference" });
const contestedIndex = Ownership.buildEntityOwnerIndex(contaminated, "characters");

const contested = Ownership.contestedOwnership(contestedIndex);
eq(contested.length, 1, "the contested file is reported");
eq(contested[0].file, CHILD_FILES[0], "by name");
eq(contested[0].entityIds, [ADULT, CHILD].sort(), "with both claimants named, so a migration can be planned rather than guessed");
/* CHANGED IN BATCH 1B. `attributedTo` used to resolve a contest by prefix
   specificity and hand the file to the child. The acceptance audit's objection
   is precise: filename specificity is the reasoning that CREATED the
   contamination, so it may not be the reasoning that settles it — and a
   contested file that is silently attributed becomes approval-eligible for
   whichever claimant won the tie-break, which is the same defect one layer
   along. A conflict has no owner until a person resolves it. */
eq(contested[0].attributedTo, "",
  "a contested file is attributed to NOBODY — a conflict is not a tie to break by filename length");
eq(contested[0].resolution.status, "contested", "and the resolution says so, with the reason attached");
eq(contested[0].resolution.authoritative, false, "so nothing downstream can read it as canon-eligible");
ok(!Ownership.entityOwnsMedia(contestedIndex, ADULT, CHILD_FILES[0]),
  "the adult's stale row does not give it the bytes back");
ok(!Ownership.entityOwnsMedia(contestedIndex, CHILD, CHILD_FILES[0]),
  "and the child does not get them either while the conflict stands — that is what BLOCKED means");
eq(Ownership.contestedEntityMedia(contestedIndex, ADULT, allFiles()).map((row) => row.name), [CHILD_FILES[0]],
  "both claimants can see the conflict on their own page, so it is surfaced at the decision boundary rather than computed and discarded");
eq(Ownership.contestedEntityMedia(contestedIndex, CHILD, allFiles()).map((row) => row.name), [CHILD_FILES[0]], "for the child too");
eq(Ownership.planEntityMediaClaim(contestedIndex, CHILD, CHILD_FILES[0]).reason, "contested",
  "and it cannot be claimed out of the conflict — the wrong row has to be removed first");

/* ===========================================================================
   4. WHAT COUNTS AS A CLAIM. Enumerated rather than remembered — a list that is
      written down cannot quietly miss a member, which is the P4-SEM-C2 lesson. */

const pointerProject = {
  characters: [
    {
      id: "CHAR-A", name: "A", approvedFile: "A_PRIMARY.png",
      continuityStates: [{ id: "st", approvedFile: "A_STATE.png" }],
      coverageSlots: [{ id: "front", approvedFile: "A_FRONT.png" }],
      expressionSlots: [{ id: "smile", approvedFile: "A_SMILE.png" }],
      candidateFiles: [{ stored: "A_CANDIDATE.png" }],
    },
  ],
};
eq(Ownership.entityClaimedFileNames(pointerProject.characters[0]).sort(),
  ["A_CANDIDATE.png", "A_FRONT.png", "A_PRIMARY.png", "A_SMILE.png", "A_STATE.png"],
  "every approval edge and the candidate row are claims — coverage and expression slots included, which is exactly the pair an earlier repair missed");

/* ===========================================================================
   5. THE CALL SITES. Both sides of the client/server boundary.

   The forensic audit's fifth "missed by Dogfood #2" item: repairing only the
   visible entity selector would leave the server batch reviewer able to make the
   same wrong-owner decision. */

const app = read("public/app.js");
ok(!/function mediaByPrefix/.test(app),
  "the prefix selector is DELETED, not deprecated — one left in the file is one a future caller reaches for");

const entities = read("public/entities.js");
ok(/filterEntityMedia\(entityOwnerIndex\(list\), it\?\.id, entityMediaPool\(list\)\)/.test(entities),
  "entityMedia() — the approval-capable pool every entity surface draws from — uses the exact resolver");
ok(/function entityUnassignedMedia/.test(entities) && /unassignedEntityMedia\(entityOwnerIndex\(list\), it\?\.id/.test(entities),
  "and discovery is a SEPARATE reader, so one function can no longer answer both questions with one list");
ok(/function entityContestedMedia/.test(entities) && /contestedEntityMedia\(entityOwnerIndex\(list\), it\?\.id/.test(entities),
  "with a third for conflicts, which the shipped build computed and never showed anyone");
ok(/window\.claimEntityMedia/.test(entities) && /planEntityMediaClaim\(entityOwnerIndex\(list\), id, fileName\)/.test(entities),
  "and a human claim act, because that is the only thing that turns a possible match into ownership");
ok(/entity-media-contested/.test(entities) && /entity-media-unassigned/.test(entities),
  "both are rendered on the entity page — a quarantine nobody can see is a deletion");

const planning = read("public/planning.js");
ok(/filterEntityMedia\(buildEntityOwnerIndex/.test(planning),
  "and so does the prompt-provenance reader, which held a second copy of the prefix rule");

/* Comments are stripped: the repairs quote the code they replaced, because a
   repair that deletes the record of what it repaired is one nobody can review. */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const server = stripComments(read("server.js"));
ok(/EntityOwnership\.filterEntityFileNames/.test(server), "the server's batch reviewer uses it");
ok(!/f\.toUpperCase\(\)\.startsWith\(prefix\)/.test(server), "and no longer filters its directory read by prefix");
ok(/EntityOwnership\.filterEntityMedia\(ownerIndex, e\.id, pool\)/.test(server),
  "and the Bible export, which held a third copy");
ok(!/\.startsWith\(\s*\(\(e\.prefix \|\| e\.anchorPrefix \|\| e\.id\)/.test(server), "with its prefix match removed");

/* No special-case filename checks anywhere in the repair — the audit forbids
   repairing this by naming the ids involved. */
for (const [name, source] of [["public/shared-entity-ownership.js", read("public/shared-entity-ownership.js")], ["public/entities.js", entities]]) {
  ok(!/SWEEP|WIDOW/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "")),
    `${name}: the repair must not name the dogfood entities — ownership is a rule, not a special case`);
}

/* ===========================================================================
   6. THE POOLS THAT MATTER. Review, approval and coverage automation all read
      through entityMedia(), so isolating it isolates them. Asserted rather than
      assumed, because a fourth private reader is exactly how this defect
      returns. */

for (const [name, source] of [
  ["public/review.js", read("public/review.js")],
  ["public/coverage-automation.js", read("public/coverage-automation.js")],
]) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/startsWith\(\s*\(?\s*(?:entity|it|x)\.(?:prefix|anchorPrefix|id)/.test(code),
    `${name}: must hold no private prefix reader`);
  ok(/entityMedia\(/.test(code), `${name}: reads media through the shared resolver`);
}

console.log(`Entity-ownership suite passed ${checks} checks: the overlapping-id leak closed in both directions, the unrelated control unaffected, unclaimed media still visible and resolved to the most specific declaration, contested claims reported rather than silently rewritten, every claim source enumerated, and the prefix reader removed from the client selector, the provenance reader, the server batch reviewer and the Bible export.`);
