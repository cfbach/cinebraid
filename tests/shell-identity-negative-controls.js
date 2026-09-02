/* NEGATIVE CONTROLS FOR A2 SHELL IDENTITY.
 *
 * Every rule in tests/shell-identity.js is an ABSENCE or an EQUALITY, and both
 * kinds pass for free when they are pointed at the wrong thing. So each control
 * below reintroduces exactly one of the failures A2 fixed — in memory, over the
 * real sources — hands the result to the REAL rule, and requires that rule to
 * fail. A control that passes means the rule it guards is not doing its job.
 *
 * PROPORTIONAL BY DESIGN. There is one control per claim and no more. A2 is a
 * presentation slice, and a mutation suite over typography would cost more to
 * maintain than the thing it guards is worth. What is worth guarding is the
 * specific confusion this slice removed: a project record field standing where
 * an application version belongs.
 *
 * NOTHING IN THE WORKING TREE IS WRITTEN. NO PROJECT DATA IS TOUCHED. NO
 * PROVIDER, MODEL OR PAID CALL IS POSSIBLE.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rules = require("./shell-identity");
const { releaseIdentity } = require("../release-identity");

const identity = releaseIdentity(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
const toLF = (text) => String(text).split("\r\n").join("\n");

let controls = 0;
const notes = [];

/* THE PROBE RECEIPT. A plain Error rather than an assertion: a control whose
   anchor has moved must fail loudly, not be mistaken for the rule firing. */
function mutate(text, needle, replacement, label, expected = 1) {
  const body = toLF(text);
  const anchor = toLF(needle);
  const hits = body.split(anchor).length - 1;
  if (hits !== expected) {
    throw new Error(`probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
      + "The control is no longer mutating the live path and must be rewritten.");
  }
  return body.split(anchor).join(toLF(replacement));
}

async function control(label, run) {
  controls++;
  let failed = false;
  try {
    await run();
  } catch (error) {
    if (/probe receipt:/.test(error.message)) throw error;
    failed = true;
  }
  assert(failed, `NEGATIVE CONTROL DID NOT FIRE: ${label}`);
  notes.push(`  ${label} — caught`);
}

async function main() {
  /* Every rule is exercised against the SHIPPED sources first, so a rule that
     cannot hold at all is caught before it is trusted to break. */
  const shipped = rules.SOURCES();
  rules.checkReleaseAuthority(shipped);
  rules.checkNoRetiredConcatenation(shipped);
  rules.checkNoRuntimeGit(shipped);
  rules.checkMenuDeclaration(shipped);
  rules.checkCompactTitleRules(shipped);
  rules.checkA1Ownership(shipped);
  notes.push("  all six source rules hold against the shipped tree before anything is broken");

  /* N1 — THE CONFUSION ITSELF, PUT BACK. The retired concatenation returns to
     the one writer that paints the rail, and the rendered rule must catch the
     project record version reappearing under the project title. */
  await control("N1 the format line appends meta.version again", async () => {
    await rules.checkProjectIdentityRendered({
      mutateSource: (file, source) => file !== "app.js" ? source : mutate(source,
        'if (format) format.textContent = P?.meta?.format || "";',
        'if (format) format.textContent = (P?.meta?.format || "") + (P?.meta?.version ? " · " + P.meta.version : "");',
        "N1"),
    });
  });

  /* N2 — THE PROJECT BECOMES THE APPLICATION. The rail foot starts reading the
     open project instead of the served identity. This is the subtle one: with an
     ordinary fixture the line still looks like a version. */
  await control("N2 the application line reads the project record", async () => {
    await rules.checkProjectIdentityRendered({
      mutateSource: (file, source) => file !== "app.js" ? source : mutate(source,
        "  const version = APP_IDENTITY?.app?.version || \"\";\n  return version ? `CineBraid ${version}` : \"CineBraid\";",
        "  const version = P?.meta?.version || APP_IDENTITY?.app?.version || \"\";\n  return version ? `CineBraid ${version}` : \"CineBraid\";",
        "N2"),
    });
  });

  /* N3 — A SECOND HAND-WRITTEN APPLICATION VERSION. The browser stops asking and
     starts declaring, which is exactly how the last stale string was born. */
  await control("N3 the browser declares its own application version", () => {
    rules.checkReleaseAuthority({
      ...shipped,
      app: mutate(shipped.app,
        'let APP_IDENTITY = null;',
        `const CINEBRAID_VERSION = "${identity.version}";\nlet APP_IDENTITY = null;`,
        "N3"),
    });
  });

  /* N4 — THE ROUTE STOPS DERIVING. It answers a literal instead of asking the
     release authority, so the two can drift with nothing noticing. */
  await control("N4 the app-identity route hardcodes a version", () => {
    rules.checkReleaseAuthority({
      ...shipped,
      server: mutate(shipped.server,
        "  const app = releaseIdentity();",
        `  const app = { version: "${identity.version}", displayName: "CineBraid ${identity.version}", channel: "stable", isPrerelease: false };`,
        "N4"),
    });
  });

  /* N5 — BUILD IDENTITY STARTS DISCOVERING. A runtime that shells out to Git:
     the exact thing the brief forbids, and the thing that would break on every
     packaged install where there is no .git and possibly no Git. */
  await control("N5 build identity shells out to Git", () => {
    rules.checkNoRuntimeGit({
      ...shipped,
      build: mutate(shipped.build,
        'const fs = require("fs");',
        'const fs = require("fs");\nconst { execFileSync } = require("child_process");\nconst discovered = () => execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();',
        "N5"),
    });
  });

  /* N6 — A FABRICATED FALLBACK. The development answer stops being "no build id
     was supplied" and starts being a hash-shaped thing a person would quote in a
     bug report. Run against a real mutated module, because this is behaviour
     rather than text. */
  await control("N6 the development fallback invents an identifier", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-build-control-"));
    try {
      const broken = mutate(fs.readFileSync(path.join(ROOT, "build-identity.js"), "utf8"),
        `    label: "Development build",`,
        `    label: "Build 0000000",`,
        "N6");
      const file = path.join(temp, "build-identity.js");
      fs.writeFileSync(file, broken);
      rules.checkBuildFallback(require(file).buildIdentity);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  /* N7 — AN UNDECLARED MENU ENTRY. The menu grows a capability nobody listed,
     which is how a small menu becomes a second Settings. */
  await control("N7 the project menu grows an undeclared action", async () => {
    await rules.checkMenuBehaviour({
      mutateSource: (file, source) => file !== "app.js" ? source : mutate(source,
        '    { label: "About CineBraid", detail: "Version and build details", run: "openAboutCineBraid()", enabled: true },',
        '    { label: "About CineBraid", detail: "Version and build details", run: "openAboutCineBraid()", enabled: true },\n    { label: "Delete project", detail: "Remove this project", run: "requestDeleteProject()", enabled: true },',
        "N7"),
    });
  });

  /* N8 — THE MENU KEEPS ITS DOCUMENT LISTENER. Closing stops unregistering, so
     every open leaves another handler swallowing Escape from the modal that owns
     it. Invisible in a screenshot, and exactly what a behavioural rule is for. */
  await control("N8 closing the menu leaks its document listener", async () => {
    await rules.checkMenuBehaviour({
      mutateSource: (file, source) => file !== "app.js" ? source : mutate(source,
        '    document.removeEventListener?.("keydown", PROJECT_MENU_DISMISS.keydown, true);',
        "",
        "N8"),
    });
  });

  /* N9 — THE TITLE LOSES ITS WRAPPING RULE, which is what stops a long project
     name widening a 220px rail on a 1280-wide laptop. */
  await control("N9 the rail title stops wrapping", () => {
    rules.checkCompactTitleRules({
      ...shipped,
      css: mutate(toLF(shipped.css),
        ".project-title{display:-webkit-box;width:100%;overflow-wrap:anywhere;hyphens:auto;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}",
        ".project-title{display:block;width:100%;white-space:nowrap}",
        "N9"),
    });
  });

  /* N10 — A1 REGRESSES. The retired Global Activity drawer comes back into the
     markup A2 edited, which is the ownership A2 is forbidden to disturb. */
  await control("N10 the retired activity drawer returns to the markup", () => {
    rules.checkA1Ownership({
      ...shipped,
      markup: mutate(shipped.markup,
        '  <div id="modal" class="modal hidden"></div>',
        '  <div id="automation-activity-drawer"></div>\n  <div id="modal" class="modal hidden"></div>',
        "N10"),
    });
  });

  /* N11 — THE MENU MOVES INTO A REGION A1 OWNS. Declared inside the workspace
     shell it would be a second thing mounting into a slot
     public/workspace-shell.js is responsible for. */
  await control("N11 the project menu is declared inside the workspace shell", () => {
    rules.checkA1Ownership({
      ...shipped,
      markup: mutate(shipped.markup,
        '        <div id="project-menu" class="project-menu" role="group" aria-labelledby="project-title" hidden></div>\n',
        "",
        "N11").replace(
        '<div id="cb-shell-main" class="cb-shell-main">',
        '<div id="project-menu" role="group" hidden></div><div id="cb-shell-main" class="cb-shell-main">'),
    });
  });

  /* N12 — THE BUTTON STOPS DECLARING ITS MENU. Visually identical, and unusable
     with a screen reader or a keyboard that expects a menu button. */
  await control("N12 the project title stops declaring the menu it opens", () => {
    rules.checkMenuDeclaration({
      ...shipped,
      markup: mutate(shipped.markup,
        'aria-expanded="false" aria-controls="project-menu" ',
        "",
        "N12"),
    });
  });

  console.log(`A2 shell identity negative controls passed: ${controls} controls, all driven to failure.`);
  for (const line of notes) console.log(line);
  console.log("No file in the working tree was modified. Provider calls made: 0.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
