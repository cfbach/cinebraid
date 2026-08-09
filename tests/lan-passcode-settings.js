/* LAN passcode Settings — the controls, their write-only semantics, and the auth
   contract they drive.

   The defect this suite exists for: CineBraid has supported an editor and a viewer
   passcode since its first commit. `/api/login` checks them, the gate in front of
   every route re-reads them on each request, the config secret registry masks them,
   and `window.savePass()` in public/settings.js reads `#cfg-epass` and `#cfg-vpass`
   to store them. Settings never rendered those two inputs — not in any of its eight
   subsections, and not in any commit in the repository's history. So the only
   supported way to set an editor passcode was to hand-edit config.json, while the
   product told LAN users to set one; and calling savePass() against the shipped UI
   died with `TypeError: Cannot read properties of null (reading 'value')`.

   Three claims are locked in here, in order:

     PART A — the Access & security panel renders both controls, as password inputs
              that start empty, with exactly one save action wired to savePass(),
              and never echoes a stored passcode into the page.
     PART B — blank means what the existing function always meant by blank, and a
              missing control is a stated failure that sends nothing (the negative
              control: delete either input and this suite fails).
     PART C — the server auth contract is unchanged, against a real server: no
              passcode stays open, a set passcode refuses, a wrong one refuses, the
              right one admits, viewer is read-only, rotation persists, and clearing
              re-opens.

   Nothing here touches the repository's own config or projects. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-lan-passcode-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "passcode-project");
/* Set before ../config is first required, so the render harness reads a disposable
   document rather than the founder's data/config.json. */
process.env.CINEBRAID_CONFIG_PATH = CONFIG_PATH;

const { render, buildFixture } = require("./render-harness");
const { startCineBraidServer } = require("./fixtures/mock-civitai");

/* Distinctive, and never shaped like a real credential, so scripts/scan-secrets.js
   needs no suppression for this file. Every one is grepped for in output that must
   not contain it. */
const EDITOR_PASS = "editor-MUSTNEVERLEAK-4141";
const VIEWER_PASS = "viewer-MUSTNEVERLEAK-4242";
const ROTATED_PASS = "rotated-MUSTNEVERLEAK-4343";

const settingsSource = fs.readFileSync(path.join(ROOT, "public", "settings.js"), "utf8");
const viewsSource = fs.readFileSync(path.join(ROOT, "public", "views.js"), "utf8");

/* ------------------------------------------------------------------ */
/* The rendered panel, mounted the way a browser would present it: the ids the
   panel declared answer, and every other id answers null. That is the condition
   the original defect lived in — the harness's document hands back an element for
   any id asked for, which would hide a save reading a control that is not there. */
function mountPanel(view) {
  const { html, document, map } = view;
  const present = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const controls = [];
  for (const match of html.matchAll(/<input\b([^>]*)>/g)) {
    const tag = `<input${match[1]}>`;
    const id = (tag.match(/\bid="([^"]*)"/) || [])[1] || "";
    const control = {
      id,
      type: (tag.match(/\btype="([^"]*)"/) || [])[1] || "text",
      value: (tag.match(/\bvalue="([^"]*)"/) || [])[1] || "",
      dataset: {},
      style: { setProperty() {} },
      addEventListener() {},
    };
    controls.push(control);
    if (id) map.set(id, control);
  }
  const panel = {
    dataset: { settingsTab: "access" },
    querySelectorAll: () => controls,
  };
  const realGetById = document.getElementById.bind(document);
  document.getElementById = (id) => (map.has(id) || present.has(id) ? realGetById(id) : null);
  document.querySelector = (selector) =>
    (selector === ".settings-selected-tab" ? panel
      : selector.startsWith("#") ? document.getElementById(selector.slice(1)) : null);
  document.querySelectorAll = () => [];
  return { panel, controls, present };
}

async function accessPanel(options = {}) {
  const view = await render("#/settings", buildFixture(), {
    ...options,
    storage: { "cinebraid-focused:fixture:settings-task:settings": "access", ...(options.storage || {}) },
  });
  view.mounted = mountPanel(view);
  view.context.initSettingsPanel();
  /* Every request the panel makes is recorded, so "sent nothing" is provable. */
  view.sent = [];
  const realFetch = view.context.fetch;
  view.context.fetch = async (url, init = {}) => {
    if (String(url) === "/api/config" && init.method === "PUT") view.sent.push(JSON.parse(init.body));
    return realFetch(url, init);
  };
  return view;
}

function tagFor(html, id) {
  const match = html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`));
  return match ? match[0] : "";
}

/* ------------------------------------------------------------------ */
async function partA() {
  const view = await accessPanel();
  const { html } = view;

  /* The regression guard. Remove either control from views.js and this fails —
     which is exactly the state main was in before this fix. */
  for (const id of ["cfg-epass", "cfg-vpass"]) {
    assert(tagFor(html, id), `Settings must render the ${id} control that savePass() reads`);
  }
  assert(
    /savePass\(\)/.test(html),
    "the passcode panel must offer the save action that stores them",
  );
  assert.strictEqual(
    (html.match(/savePass\(\)/g) || []).length,
    1,
    "there must be exactly one save control for the passcodes, not a duplicate elsewhere",
  );

  for (const [id, label] of [["cfg-epass", "New editor passcode"], ["cfg-vpass", "New viewer passcode"]]) {
    const tag = tagFor(html, id);
    assert(/type="password"/.test(tag), `${id} must be a password input`);
    assert(!/\svalue=/.test(tag), `${id} must not be pre-filled with anything`);
    assert(
      html.includes(`<label for="${id}">${label}</label>`),
      `${id} must carry a real label rather than a bare box`,
    );
    assert(
      new RegExp(`id="${id}-state"`).test(html),
      `${id} must say whether a passcode is currently stored`,
    );
  }
  /* Entering a value replaces the stored passcode — stated, not implied. */
  assert(
    /becomes the editor passcode when you save/.test(html) && /becomes the viewer passcode when you save/.test(html),
    "the panel must say that typing a value changes the passcode",
  );
  assert(
    /Leave it blank to keep/.test(html),
    "the panel must state what leaving a box blank does",
  );
  /* Generic wording: nothing about any one machine or deployment. */
  assert(
    /other devices on your network/i.test(html) && !/spark/i.test(html),
    "the LAN explanation must be generic, not written for one host",
  );
  assert(
    (view.mounted.controls.filter((c) => c.type === "password")).length === 2,
    "the mounted panel must present exactly the two password boxes",
  );

  /* A stored passcode never reaches the page, even when the response carries one.
     The projection masks it in production; this proves the view would not echo a
     value even if it were handed one. */
  const leaky = await render("#/settings", buildFixture(), {
    storage: { "cinebraid-focused:fixture:settings-task:settings": "access" },
    fetch: async (url, _init, respond) =>
      (url === "/api/config"
        ? respond({ editorPass: EDITOR_PASS, viewerPass: VIEWER_PASS, appearance: {}, workspace: {}, naming: {} })
        : null),
  });
  for (const secret of [EDITOR_PASS, VIEWER_PASS])
    assert(!leaky.html.includes(secret), "a stored passcode must never be rendered into the page");
  assert(
    /id="cfg-epass-state">Set</.test(leaky.html) && /id="cfg-vpass-state">Set</.test(leaky.html),
    "the panel must report a stored passcode as set without disclosing it",
  );
  assert(
    !/id="cfg-epass"[^>]*value=/.test(leaky.html),
    "a stored passcode must never be written back into the input",
  );
  console.log("  A. the Access & security panel renders both write-only controls and discloses nothing");
}

/* ------------------------------------------------------------------ */
async function partB() {
  /* Both filled: both are sent, and nothing else is. */
  {
    const view = await accessPanel();
    view.document.getElementById("cfg-epass").value = EDITOR_PASS;
    view.document.getElementById("cfg-vpass").value = VIEWER_PASS;
    await view.context.savePass();
    assert.deepStrictEqual(view.sent, [{ editorPass: EDITOR_PASS, viewerPass: VIEWER_PASS }],
      "a filled panel must send exactly the two passcodes and no other setting");
    assert.strictEqual(view.document.getElementById("cfg-epass").value, "",
      "a stored passcode must not be left sitting in the input");
    assert.strictEqual(view.document.getElementById("cfg-vpass").value, "");
    assert.strictEqual(view.document.getElementById("cfg-epass-state").textContent, "Set");
    assert(/login\.html/.test(view.document.getElementById("pass-note").textContent),
      "enabling authentication must tell the user where to sign in");
    assert.strictEqual(view.document.getElementById("settings-panel-state").dataset.state, "saved");
  }

  /* Blank viewer box: the viewer passcode is left alone rather than cleared. */
  {
    const view = await accessPanel();
    view.document.getElementById("cfg-epass").value = EDITOR_PASS;
    await view.context.savePass();
    assert.deepStrictEqual(view.sent, [{ editorPass: EDITOR_PASS }],
      "a blank viewer box must leave the stored viewer passcode untouched");
  }

  /* Blank editor box with a passcode stored: an explicit choice, never a silent
     clear. Nothing is sent until one of the two branches is taken. */
  {
    const view = await accessPanel({
      fetch: async (url, _init, respond) =>
        (url === "/api/config" ? respond({ editorPass: "(set)", viewerPass: "", appearance: {}, workspace: {}, naming: {} }) : null),
    });
    await view.context.savePass();
    assert.deepStrictEqual(view.sent, [], "a blank editor box must not save anything on its own");
    const modal = view.document.getElementById("modal").innerHTML;
    assert(/KEEP UNCHANGED/.test(modal) && /TURN AUTH OFF/.test(modal),
      "a blank editor box must ask which of the two things it means");

    await view.context.finishBlankEditorPass("keep");
    assert.deepStrictEqual(view.sent, [{}], "KEEP UNCHANGED must send no passcode at all");

    view.sent.length = 0;
    await view.context.savePass();
    await view.context.finishBlankEditorPass("clear");
    assert.deepStrictEqual(view.sent, [{ editorPass: "" }],
      "TURN AUTH OFF must clear the editor passcode explicitly");
    assert.strictEqual(view.document.getElementById("cfg-epass-state").textContent, "Not set");
    assert(/no longer asks anyone for a passcode/.test(view.document.getElementById("pass-note").textContent),
      "switching authentication off must be reported in words");
  }

  /* Merely opening Settings can never clear a passcode: no request leaves the panel
     until the save action is used. */
  {
    const view = await accessPanel({
      fetch: async (url, _init, respond) =>
        (url === "/api/config" ? respond({ editorPass: "(set)", viewerPass: "(set)", appearance: {}, workspace: {}, naming: {} }) : null),
    });
    view.context.refreshSettingsPanelState();
    assert.deepStrictEqual(view.sent, [], "rendering the panel must not write anything");
  }

  /* THE NEGATIVE CONTROL. With the controls gone — the exact shape of the original
     defect — savePass() must say so and send nothing, rather than throw a null
     property error that reads like a crash of something unrelated. */
  {
    const view = await accessPanel();
    for (const id of ["cfg-epass", "cfg-vpass"]) view.map.delete(id);
    const realGetById = view.document.getElementById;
    view.document.getElementById = (id) => (id === "cfg-epass" || id === "cfg-vpass" ? null : realGetById(id));
    await view.context.savePass();
    assert.deepStrictEqual(view.sent, [], "a save that cannot read its fields must send nothing");
    assert(/not on screen/.test(view.document.getElementById("pass-note").textContent),
      "a missing control must be stated, not thrown");
    assert.strictEqual(view.document.getElementById("settings-panel-state").dataset.state, "error",
      "a save that could not happen must never report itself as saved");
    /* And the same is true of the modal's continuation, which is a second entry
       point into the same store. */
    await view.context.finishBlankEditorPass("clear");
    assert.deepStrictEqual(view.sent, [], "the blank-passcode continuation must not write without its fields either");
  }

  /* A rejected save is reported as a failure, never as success. */
  {
    const view = await accessPanel({
      fetch: async (url, init, respond) =>
        (url === "/api/config" && init.method === "PUT"
          ? respond({ error: "The server rejected the change." }, 400)
          : null),
    });
    view.document.getElementById("cfg-epass").value = EDITOR_PASS;
    await view.context.savePass();
    const note = view.document.getElementById("pass-note").textContent;
    assert(/rejected/i.test(note) && !/^Saved/.test(note), "a refused save must not claim the passcode was stored");
    assert.strictEqual(view.document.getElementById("settings-panel-state").dataset.state, "error");
  }

  /* The panel uses the existing config path, not a second authentication system. */
  assert(
    !/\/api\/(auth|passcode|password|security)/.test(settingsSource),
    "passcodes must go through the existing /api/config contract, not a new endpoint",
  );
  assert(
    /savePass/.test(viewsSource) && !/editorPass\s*:/.test(viewsSource),
    "the view may invoke the existing save path but must not build a passcode payload of its own",
  );
  console.log("  B. blank/clear semantics preserved, and a missing control fails loudly without writing");
}

/* ------------------------------------------------------------------ */
function writeProject(extra = {}) {
  fs.mkdirSync(path.join(PROJECT_DIR, "shots"), { recursive: true });
  for (const d of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, d), { recursive: true });
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify({
    meta: { title: "Passcode", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [], shots: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "passcode-project", accounts: [], ...extra,
  }, null, 2));
}

async function partC(server) {
  const call = async (pathname, { method = "GET", cookie = "", body = null } = {}) => {
    const response = await fetch(server.base + pathname, {
      method,
      redirect: "manual",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html or a redirect */ }
    return { status: response.status, json, text, setCookie: response.headers.get("set-cookie") || "" };
  };
  const cookieFrom = (header) => String(header).split(";")[0];

  /* 1. No passcode configured — the shipped local posture is unchanged. */
  let me = await call("/api/me");
  assert.deepStrictEqual(me.json, { authEnabled: false, role: "editor" },
    "with no passcode set, a local caller is still the editor");
  assert.strictEqual((await call("/api/projects")).status, 200,
    "with no passcode set, the API must stay open exactly as it always has");

  /* 2. The passcode is stored through the endpoint the panel actually uses. */
  const stored = await call("/api/config", { method: "PUT", body: { editorPass: EDITOR_PASS } });
  assert.strictEqual(stored.status, 200, "the Settings save path must store an editor passcode");
  assert.strictEqual(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).editorPass, EDITOR_PASS,
    "the passcode the panel sent must be the one on disk");

  /* 3. And it is never read back to a browser in cleartext. */
  me = await call("/api/me");
  assert.deepStrictEqual(me.json, { authEnabled: true, role: null }, "authentication must now be on");
  assert.strictEqual((await call("/api/projects")).status, 401,
    "an unauthenticated protected request must be refused once a passcode is set");

  /* 4. Wrong passcode. */
  assert.strictEqual((await call("/api/login", { method: "POST", body: { pass: "not-the-passcode" } })).status, 401,
    "a wrong passcode must be refused");
  assert.strictEqual((await call("/api/login", { method: "POST", body: { pass: "" } })).status, 401,
    "an empty passcode must not be accepted as a blank stored one");

  /* 5. Correct editor passcode. */
  const editorLogin = await call("/api/login", { method: "POST", body: { pass: EDITOR_PASS } });
  assert.strictEqual(editorLogin.status, 200);
  assert.strictEqual(editorLogin.json.role, "editor");
  const editorCookie = cookieFrom(editorLogin.setCookie);
  assert(/^ahub=/.test(editorCookie), "signing in must issue the session cookie");
  assert(/HttpOnly/i.test(editorLogin.setCookie), "the session cookie must stay out of page scripts");
  assert.strictEqual((await call("/api/projects", { cookie: editorCookie })).status, 200,
    "the editor session must reach the whole API");
  const configRead = await call("/api/config", { cookie: editorCookie });
  assert.strictEqual(configRead.json.editorPass, "(set)",
    "the configuration a browser reads must carry a marker, never the passcode");
  assert(!configRead.text.includes(EDITOR_PASS), "the stored passcode must not appear anywhere in the response");

  /* 6. Viewer passcode: read-only, exactly as the existing contract has it. */
  assert.strictEqual(
    (await call("/api/config", { method: "PUT", cookie: editorCookie, body: { viewerPass: VIEWER_PASS } })).status, 200);
  const viewerLogin = await call("/api/login", { method: "POST", body: { pass: VIEWER_PASS } });
  assert.strictEqual(viewerLogin.json.role, "viewer", "the viewer passcode must produce the viewer role");
  const viewerCookie = cookieFrom(viewerLogin.setCookie);
  assert.strictEqual((await call("/api/bible", { cookie: viewerCookie })).status, 200,
    "a viewer must still read the Project Bible");
  const viewerWrite = await call("/api/projects", { cookie: viewerCookie });
  assert.strictEqual(viewerWrite.status, 403, "a viewer must not reach the editor API");
  assert(/editor only/i.test(viewerWrite.json?.error || ""), "and must be told why");

  /* 7. Changing a passcode persists, and the old value stops working. */
  assert.strictEqual(
    (await call("/api/config", { method: "PUT", cookie: editorCookie, body: { editorPass: ROTATED_PASS } })).status, 200);
  assert.strictEqual(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).editorPass, ROTATED_PASS,
    "a changed passcode must be the one stored");
  assert.strictEqual((await call("/api/login", { method: "POST", body: { pass: EDITOR_PASS } })).status, 401,
    "the previous passcode must stop working");
  const rotatedLogin = await call("/api/login", { method: "POST", body: { pass: ROTATED_PASS } });
  assert.strictEqual(rotatedLogin.json.role, "editor", "the new passcode must work");
  assert.strictEqual(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).viewerPass, VIEWER_PASS,
    "changing the editor passcode must not disturb the viewer passcode");

  /* 8. Recorded, deliberately unfixed: rotating a passcode does not end sessions
        already signed in. The cookie is an HMAC of the ROLE under authSecret, so it
        carries nothing about the passcode it was obtained with. That is the deferred
        session-revocation finding, and it is pinned here so it cannot quietly change
        in either direction while this UI is being used. */
  assert.strictEqual((await call("/api/projects", { cookie: editorCookie })).status, 200,
    "known and deferred: an existing session survives a passcode change — see the PR notes on session revocation");

  /* 9. Clearing takes an explicit empty value, and re-opens the install. */
  assert.strictEqual(
    (await call("/api/config", { method: "PUT", cookie: editorCookie, body: { editorPass: "" } })).status, 200);
  assert.strictEqual(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).editorPass, "",
    "clearing must store an empty passcode rather than a marker");
  assert.deepStrictEqual((await call("/api/me")).json, { authEnabled: false, role: "editor" },
    "clearing the editor passcode must return the install to its open local posture");
  assert.strictEqual((await call("/api/projects")).status, 200);
  /* And the marker is never mistaken for a passcode. */
  assert.strictEqual(
    (await call("/api/config", { method: "PUT", body: { editorPass: "(set)" } })).status, 200);
  assert.strictEqual(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).editorPass, "",
    "the set-marker must never become the stored passcode");
  console.log("  C. the server auth contract is unchanged: open, refused, wrong, right, viewer, rotated, cleared");
}

/* ------------------------------------------------------------------ */
async function main() {
  writeProject();
  console.log("LAN passcode Settings suite");
  await partA();
  await partB();
  const server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH,
    CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    FAL_KEY: "",
  });
  try {
    await partC(server);
  } finally {
    server.stop();
  }
  console.log(
    "LAN passcode Settings suite passed: Settings renders the editor and viewer passcode controls savePass() reads, "
    + "as write-only password inputs that never receive a stored secret; blank still means leave-unchanged and clearing "
    + "still takes an explicit choice; a missing control fails in words and writes nothing; and the existing server "
    + "contract is intact from an open install through refusal, viewer scope, rotation and clearing.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(TEMP, { recursive: true, force: true }));
