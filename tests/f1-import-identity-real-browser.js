const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { disposableRoot } = require("./helpers/disposable-root");
const { writeBrowserFixture } = require("./returned-media-ownership");

const ROOT = path.resolve(__dirname, "..");
const OUT = process.env.F1_ACCEPTANCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-f1-import-identity-"));
const MEDIA = path.join(__dirname, "fixtures", "ev2-6");
const SLUG = "f1-import-identity";
const SHOT = "SH-F1";
const FRAME = "frame-0.png";
const MOTION = "motion-0.mp4";
const PREPARE_THROW = "identity-prepare-failed.png";
const REPLACEMENT_ASSET_ID = "asset-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const workspace = disposableRoot("f1-import-identity-browser", { config: { activeProject: SLUG } });
const projectDir = path.join(workspace.projectsRoot, SLUG);
fs.mkdirSync(OUT, { recursive: true });

const project = writeBrowserFixture(projectDir);
const shot = structuredClone(project.shots.find((row) => row.id === "SH-A"));
shot.id = SHOT;
shot.title = "F1 immediate import";
shot.characters = [];
shot.codes = [];
shot.keyframes = [structuredClone(shot.keyframes.find((row) => row.id === "frame-a"))];
shot.keyframes[0].winner = "";
shot.candidateFiles = [];
shot.clips = [{
  id: "motion-a",
  suffix: "A",
  title: "Primary motion",
  fromFrame: "frame-a",
  toFrame: "",
  kind: "interpolate",
  dur: 4,
  motionPrompt: "A slow push in.",
  winner: "",
  winnerEnd: "",
  videoWinner: "",
  generationPackages: [],
}];
shot.creationBrief = {
  ...(shot.creationBrief || {}),
  deliveryIntent: "motion",
  approvedMotionFile: "",
  finalVideoFile: "",
};
shot.finalVideoFile = "";
shot.workflowStatus = "IN PROGRESS";
shot.status = "BUILT";
project.shots = [shot];
project.meta.title = "F1 disposable import identity";
project.productionAuthority.receipts = (project.productionAuthority.receipts || [])
  .filter((row) => row.shotId !== SHOT);
fs.mkdirSync(path.join(projectDir, "shots", SHOT, "takes"), { recursive: true });
fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(project, null, 2));

let server;
let browser;
let page;
let base = "";
let stripIdentityFor = "";
let replacementIdentityFor = "";
const blocked = [];
const uploadReplies = [];
const checks = [];
const check = (name, value) => {
  checks.push({ name, passed: !!value });
  assert(value, name);
};
const disk = () => JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8"));
const capture = async (name) => page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
const assetIdFor = (name) => page.evaluate(({ shotId, fileName }) => {
  return takesFor(shotId).find((row) => row.name === fileName)?.assetId || "";
}, { shotId: SHOT, fileName: name });

async function freePort() {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

async function openShot() {
  const resultsOrigin = page.locator("#rx-origin");
  if (await resultsOrigin.count() && await resultsOrigin.isVisible()) await resultsOrigin.click();
  else await page.goto(base + "/#/shot/" + SHOT);
  await page.waitForFunction((id) => typeof P !== "undefined" && P?.shots?.some((row) => row.id === id), SHOT);
  await page.waitForFunction(() => {
    return !document.querySelector("[data-results-desk]")
      && !document.body.classList.contains("results-desk-active")
      && [...document.querySelectorAll(".focused-task-button")].some((node) => node.getClientRects().length > 0);
  });
  await page.locator("#main").getByText(SHOT, { exact: false }).first().waitFor();
}

async function openTask(label) {
  const task = page.locator(".focused-task-button:visible").filter({ has: page.getByText(label, { exact: true }) });
  await task.click();
  await page.waitForTimeout(100);
}

async function openResults(kind) {
  await page.evaluate(async () => { await flushPendingProjectSave(); });
  await page.waitForFunction(() => projectSaveSettled().settled);
  await page.waitForTimeout(120);
  const target = page.locator('[data-shot-results-rail] [data-results-target="' + kind + '"]');
  const label = kind === "motion" ? "Motion Results" : "Frame A Results";
  const heroLabel = kind === "motion" ? "Review motion result" : "Review Frame A result";
  await target.waitFor();
  const rail = target.getByRole("button", { name: label, exact: true });
  const hero = page.locator("#main .guided-next-action").getByRole("button", { name: heroLabel, exact: true });
  if (await rail.count()) await rail.click();
  else await hero.click();
  await page.locator("[data-results-desk]").waitFor();
}

async function approveSelected() {
  await page.waitForFunction(() => {
    const button = document.getElementById("rx-approve");
    return !!button && !button.disabled;
  });
  await page.locator("#rx-approve").click();
  await page.waitForFunction(() => {
    const confirm = document.getElementById("rx-confirm");
    return (!!confirm && !confirm.disabled) || !!document.getElementById("rx-motion-target");
  });
  if (await page.locator("#rx-motion-target").count()) {
    await page.getByRole("button", { name: "Continue to review" }).click();
    await page.waitForFunction(() => {
      const confirm = document.getElementById("rx-confirm");
      return !!confirm && !confirm.disabled;
    });
  }
  await page.locator("#rx-confirm").click();
  await page.waitForFunction(() => !approvalSubmissionPending());
}

async function waitForSelectedApproved(name, assetId, expectedKey = "") {
  await page.waitForFunction(({ name, assetId, expectedKey }) => {
    const parsed = CineBraidResults.parse();
    const rows = parsed ? CineBraidResults.model(parsed.scope).rows.filter((row) => row.key === parsed.key) : [];
    const selected = document.querySelector('[data-rx-key][aria-pressed="true"]');
    const decision = document.getElementById("rx-decision");
    const media = document.getElementById("rx-primary");
    const mediaReady = media?.tagName === "VIDEO"
      ? media.readyState >= 1
      : !!media?.complete && media.naturalWidth > 0;
    return rows.length === 1
      && (!expectedKey || parsed.key === expectedKey)
      && parsed.key.startsWith("asset:")
      && rows[0].name === name
      && rows[0].assetId === assetId
      && rows[0].approved === true
      && selected?.dataset.rxKey === parsed.key
      && decision?.dataset.rxState === "approved"
      && mediaReady;
  }, { name, assetId, expectedKey });
  return page.evaluate(() => CineBraidResults.parse().key);
}

async function exerciseRefreshRecovery({ scope, name, assetId, label, slug }) {
  const assetKey = await page.evaluate(() => CineBraidResults.parse().key);
  stripIdentityFor = name;
  await page.evaluate(async () => { await load({ intent: "refresh" }); });
  const pathKey = await page.evaluate(({ scope, name }) => {
    return CineBraidResults.model(scope).rows.find((row) => row.name === name).key;
  }, { scope, name });
  check(label + " fixture reproduces the old path-key window", pathKey.startsWith("path:") && pathKey !== assetKey);
  check(label + " old path-key result has no remembered asset identity", await page.evaluate(({ scope, name }) => {
    const row = CineBraidResults.model(scope).rows.find((item) => item.name === name);
    return row?.key.startsWith("path:") && !row.assetId;
  }, { scope, name }));
  await page.evaluate(({ scope, key }) => { location.hash = CineBraidResults.href(scope, key); }, { scope, key: pathKey });
  await page.waitForFunction((key) => CineBraidResults.parse()?.key === key && !document.getElementById("rx-refresh"), pathKey);
  stripIdentityFor = "";
  await page.evaluate(async () => {
    SCAN = await (await fetch("/api/scan")).json();
    await route();
  });
  await page.locator("#rx-refresh").waitFor();
  await page.waitForFunction(() => document.getElementById("toast")?.classList.contains("hidden"));
  await capture("intentional-" + slug + "-path-key-transition-before-refresh");
  await page.locator("#rx-refresh").click();
  const refreshedKey = await waitForSelectedApproved(name, assetId, assetKey);
  check(label + " Refresh record keeps the same selected approved result", refreshedKey === assetKey);
  await capture("after-" + slug + "-refresh-same-approved-result");
}

(async () => {
  try {
    const port = await freePort();
    base = "http://127.0.0.1:" + port;
    const log = fs.openSync(path.join(OUT, "server.log"), "w");
    const serverBoot = [
      "const service=require('./src/media/media-asset-service');",
      "const prepare=service.prepareAssetIdentity;",
      "service.prepareAssetIdentity=async(options)=>{",
      "if(String(options.path||'').endsWith('/'+process.env.F1_THROW_PREPARE_NAME))throw new Error('injected identity preparation failure');",
      "return prepare(options);",
      "};",
      "require('./server.js');",
    ].join("");
    server = spawn(process.execPath, ["-r", "./tests/helpers/ev2-6-no-network.js", "-e", serverBoot], {
      cwd: ROOT,
      env: { ...workspace.serverEnv(port), F1_THROW_PREPARE_NAME: PREPARE_THROW },
      stdio: ["ignore", log, log],
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        if ((await fetch(base + "/api/project")).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const playwright = require("./helpers/playwright-module").requirePlaywright("f1-import-identity-real-browser");
    browser = await playwright.chromium.launch({
      headless: true,
      ...(process.env.CINEBRAID_BROWSER_EXECUTABLE ? { executablePath: process.env.CINEBRAID_BROWSER_EXECUTABLE } : {}),
    });
    console.log("[browser-runtime] f1-import-identity: launched Chromium " + browser.version() + " (Node Playwright)");
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (!url.startsWith(base + "/")) {
        blocked.push(url.split("?")[0]);
        return route.abort();
      }
      const parsed = new URL(url);
      if (request.method() === "POST" && parsed.pathname === "/api/shots/" + SHOT + "/take") {
        const response = await route.fetch();
        const body = await response.json();
        uploadReplies.push(body);
        return route.fulfill({
          status: response.status(),
          headers: { ...response.headers(), "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (replacementIdentityFor && request.method() === "POST" && parsed.pathname === "/api/media/prepare-identity"
          && String(request.postData() || "").includes(replacementIdentityFor)) {
        return route.fulfill({
          status: 200,
          json: { ok: true, status: "ready", reason: "simulated-replacement", assetId: REPLACEMENT_ASSET_ID },
        });
      }
      if ((stripIdentityFor || replacementIdentityFor) && request.method() === "GET" && parsed.pathname === "/api/scan") {
        const response = await route.fetch();
        const body = await response.json();
        const targetName = stripIdentityFor || replacementIdentityFor;
        const row = body.shots?.[SHOT]?.takes?.find((item) => item.name === targetName);
        if (row && stripIdentityFor) delete row.assetId;
        if (row && replacementIdentityFor) row.assetId = REPLACEMENT_ASSET_ID;
        return route.fulfill({
          status: response.status(),
          headers: { ...response.headers(), "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (/\/api\/(generation|accounts|assistant\/test)/.test(parsed.pathname) && request.method() !== "GET") {
        blocked.push(parsed.pathname);
        return route.fulfill({ status: 503, json: { error: "Provider traffic disabled in F1 acceptance" } });
      }
      return route.continue();
    });

    page = await context.newPage();
    page.on("pageerror", (error) => blocked.push("pageerror:" + error.message));
    await openShot();
    await page.evaluate(() => { window.__f1DocumentToken = Math.random().toString(36); });
    const documentToken = await page.evaluate(() => window.__f1DocumentToken);

    await openTask("Frames");
    await page.locator("#frame-file-frame-a").waitFor({ state: "attached" });
    await page.locator("#frame-file-frame-a").setInputFiles(path.join(MEDIA, FRAME));
    await page.waitForFunction(({ shotId, name }) => takesFor(shotId).some((row) => row.name === name && row.assetId), { shotId: SHOT, name: FRAME });
    const frameUploadBody = uploadReplies.find((row) => row.name === FRAME);
    check("Frame upload returns authoritative identity", frameUploadBody?.identityStatus === "ready" && /^asset-[a-f0-9]{32}$/.test(frameUploadBody.assetId || ""));
    const frameAssetId = await assetIdFor(FRAME);
    check("Frame identity in the immediate scan is the upload identity", frameAssetId === frameUploadBody.assetId);
    await openResults("frame");
    check("Frame Results keeps the same document", await page.evaluate((token) => window.__f1DocumentToken === token, documentToken));
    check("Frame Results selects the asset-backed imported file", await page.evaluate((name) => {
      const parsed = CineBraidResults.parse();
      const row = CineBraidResults.model(parsed.scope).rows.find((item) => item.key === parsed.key);
      return parsed.key.startsWith("asset:") && row?.name === name && !!row.assetId;
    }, FRAME));
    await approveSelected();
    const frameSelectedKey = await waitForSelectedApproved(FRAME, frameAssetId);
    check("Frame stays selected, visible, and approved immediately after confirmation", frameSelectedKey === "asset:" + frameAssetId);
    check("Frame approval persisted immediately", disk().shots[0].keyframes[0].winner === FRAME);
    await capture("after-frame-immediate-approval");

    const frameScope = { shotId: SHOT, kind: "frame", frameId: "frame-a" };
    await exerciseRefreshRecovery({ scope: frameScope, name: FRAME, assetId: frameAssetId, label: "Frame", slug: "frame" });

    await openShot();
    await openTask("Motion & sound");
    const motionPanel = page.locator("details.guided-motion-card");
    if (await motionPanel.count()) {
      await motionPanel.first().evaluate((node) => { node.open = true; });
    }
    await page.locator("#motion-file").waitFor({ state: "attached" });
    await page.locator("#motion-file").setInputFiles(path.join(MEDIA, MOTION));
    await page.waitForFunction(({ shotId, name }) => takesFor(shotId).some((row) => row.name === name && row.assetId), { shotId: SHOT, name: MOTION });
    const motionUploadBody = uploadReplies.find((row) => row.name === MOTION);
    check("Motion upload returns authoritative identity", motionUploadBody?.identityStatus === "ready" && /^asset-[a-f0-9]{32}$/.test(motionUploadBody.assetId || ""));
    const motionAssetId = await assetIdFor(MOTION);
    check("Motion identity in the immediate scan is the upload identity", motionAssetId === motionUploadBody.assetId);
    await openResults("motion");
    check("Motion Results keeps the same document", await page.evaluate((token) => window.__f1DocumentToken === token, documentToken));
    await approveSelected();
    const motionSelectedKey = await waitForSelectedApproved(MOTION, motionAssetId);
    check("Motion stays selected, visible, and approved immediately after confirmation", motionSelectedKey === "asset:" + motionAssetId);
    check("Motion approval persisted immediately", disk().shots[0].clips[0].videoWinner === MOTION);
    await capture("after-motion-immediate-approval");

    const motionScope = { shotId: SHOT, kind: "motion", frameId: "" };
    await exerciseRefreshRecovery({ scope: motionScope, name: MOTION, assetId: motionAssetId, label: "Motion", slug: "motion" });

    await openShot();
    await openTask("Deliver");
    const finishPanel = page.locator("details.guided-finish-card");
    if (await finishPanel.count()) await finishPanel.first().evaluate((node) => { node.open = true; });
    await page.evaluate(async () => { await flushPendingProjectSave(); });
    await page.waitForFunction(() => projectSaveSettled().settled);
    await page.getByRole("button", { name: "Mark shot final", exact: true }).click();
    await page.waitForFunction(() => {
      const confirm = document.getElementById("rx-confirm");
      return !!confirm && !confirm.disabled;
    });
    await page.locator("#rx-confirm").click();
    await page.waitForFunction(() => !approvalSubmissionPending());
    check("Final delivery persisted before reload", disk().shots[0].finalVideoFile === MOTION);
    await capture("after-final-delivery");

    await page.evaluate(({ scope, key }) => { location.hash = CineBraidResults.href(scope, key); }, {
      scope: { shotId: SHOT, kind: "motion", frameId: "" },
      key: "asset:asset-00000000000000000000000000000000",
    });
    await page.locator("#rx-refresh").waitFor();
    await page.locator("#rx-refresh").click();
    await page.waitForTimeout(300);
    check("A mismatched identity remains unresolved", await page.locator("#rx-refresh").count() === 1 && await page.locator("#rx-approve").count() === 0);
    check("Refresh never substituted the real motion result", await page.evaluate(() => CineBraidResults.parse().key === "asset:asset-00000000000000000000000000000000"));
    await capture("mismatched-identity-stays-blocked");

    await openShot();
    await openTask("Frames");
    stripIdentityFor = PREPARE_THROW;
    await page.locator("#frame-file-frame-a").setInputFiles({
      name: PREPARE_THROW,
      mimeType: "image/png",
      buffer: fs.readFileSync(path.join(MEDIA, FRAME)),
    });
    await page.waitForFunction(({ shotId, name }) => {
      return shotById(shotId).candidateFiles.some((row) => row.stored === name)
        && takesFor(shotId).some((row) => row.name === name && !row.assetId);
    }, { shotId: SHOT, name: PREPARE_THROW });
    const failedPrepareBody = uploadReplies.find((row) => row.name === PREPARE_THROW);
    check("A preparation throw still reports the successfully saved import", failedPrepareBody?.ok === true
      && failedPrepareBody.identityStatus === "unavailable"
      && failedPrepareBody.identityReason === "identity-preparation-failed"
      && !failedPrepareBody.assetId
      && fs.existsSync(path.join(projectDir, "shots", SHOT, "takes", PREPARE_THROW)));
    await openResults("frame");
    const failedPrepareKey = await page.evaluate(({ scope, name }) => {
      return CineBraidResults.model(scope).rows.find((row) => row.name === name)?.key || "";
    }, { scope: frameScope, name: PREPARE_THROW });
    const resultCards = page.locator("[data-rx-key]");
    let failedPrepareCard = null;
    for (let index = 0; index < await resultCards.count(); index++) {
      if (await resultCards.nth(index).getAttribute("data-rx-key") === failedPrepareKey) {
        failedPrepareCard = resultCards.nth(index);
        break;
      }
    }
    check("The preparation-failed import has its own Results card", !!failedPrepareCard && failedPrepareKey.startsWith("path:"));
    await failedPrepareCard.click();
    await page.waitForFunction((name) => {
      const parsed = CineBraidResults.parse();
      const row = CineBraidResults.model(parsed.scope).rows.find((item) => item.key === parsed.key);
      return parsed.key.startsWith("path:") && row?.name === name && !row.assetId;
    }, PREPARE_THROW);
    const failedApprove = page.locator("#rx-approve");
    if (await failedApprove.count()) {
      await page.waitForFunction(() => !document.getElementById("rx-approve")?.disabled);
      await failedApprove.click();
      await page.waitForFunction(() => document.getElementById("toast")?.textContent.includes("no verified media identity"));
    }
    check("The saved import stays visible but blocked without verified identity",
      await page.locator("#rx-confirm").count() === 0
      && !await page.evaluate(() => approvalSubmissionPending())
      && disk().shots[0].keyframes[0].winner === FRAME);
    await capture("prepare-identity-throw-import-saved-but-blocked");
    stripIdentityFor = "";

    const motionAssetKey = "asset:" + motionAssetId;
    await page.evaluate(({ scope, key }) => { location.hash = CineBraidResults.href(scope, key); }, { scope: motionScope, key: motionAssetKey });
    await waitForSelectedApproved(MOTION, motionAssetId, motionAssetKey);
    replacementIdentityFor = MOTION;
    await page.evaluate(async () => { await load({ intent: "refresh" }); });
    await page.locator("#rx-refresh").waitFor();
    await page.locator("#rx-refresh").click();
    await page.waitForFunction(({ key, name, replacementAssetId }) => {
      const parsed = CineBraidResults.parse();
      const rows = CineBraidResults.model(parsed.scope).rows;
      return parsed.key === key
        && rows.some((row) => row.name === name && row.assetId === replacementAssetId)
        && !!document.getElementById("rx-refresh")
        && !document.getElementById("rx-approve");
    }, { key: motionAssetKey, name: MOTION, replacementAssetId: REPLACEMENT_ASSET_ID });
    check("Refresh refuses a replacement asset at the same name, URL, and media type", await page.evaluate(({ key, replacementAssetId }) => {
      const parsed = CineBraidResults.parse();
      const rows = CineBraidResults.model(parsed.scope).rows;
      return parsed.key === key
        && !rows.some((row) => row.key === key)
        && rows.some((row) => row.assetId === replacementAssetId)
        && !document.getElementById("rx-approve");
    }, { key: motionAssetKey, replacementAssetId: REPLACEMENT_ASSET_ID }));
    await capture("replacement-identity-stays-blocked");
    replacementIdentityFor = "";
    await page.locator("#rx-refresh").click();
    check("The original motion result recovers only when its exact identity returns",
      await waitForSelectedApproved(MOTION, motionAssetId, motionAssetKey) === motionAssetKey);

    await page.reload();
    await page.waitForFunction((id) => typeof P !== "undefined" && P?.shots?.some((row) => row.id === id), SHOT);
    const persisted = await page.evaluate(({ shotId, frameName, motionName, frameAssetId, motionAssetId }) => {
      const shot = P.shots.find((row) => row.id === shotId);
      const current = (P.productionAuthority?.receipts || []).filter((row) => row.shotId === shotId && row.status === "current");
      return {
        frame: shot.keyframes[0].winner === frameName && current.some((row) => row.kind === "shot-frame" && row.value === frameName && row.assetId === frameAssetId),
        motion: shot.clips[0].videoWinner === motionName && current.some((row) => row.kind === "shot-motion" && row.value === motionName && row.assetId === motionAssetId),
        delivery: shot.finalVideoFile === motionName && current.some((row) => row.kind === "shot-delivery" && row.value === motionName && row.assetId === motionAssetId),
      };
    }, { shotId: SHOT, frameName: FRAME, motionName: MOTION, frameAssetId, motionAssetId });
    check("Frame approval persists after reload", persisted.frame);
    check("Motion approval persists after reload", persisted.motion);
    check("Final delivery persists after reload", persisted.delivery);
    check("No provider or off-origin request escaped", blocked.length === 0);

    await openShot();
    await capture("after-reload-persisted-delivery");
    fs.writeFileSync(path.join(OUT, "acceptance.json"), JSON.stringify({
      checks,
      blocked,
      project: SLUG,
      frame: { name: FRAME, assetId: frameAssetId },
      motion: { name: MOTION, assetId: motionAssetId },
      preparationFailure: { name: PREPARE_THROW, status: failedPrepareBody?.identityStatus || "" },
      finalDelivery: MOTION,
    }, null, 2));
    console.log(JSON.stringify({ OUT, checks: checks.length, blocked: blocked.length }));
  } catch (error) {
    fs.writeFileSync(path.join(OUT, "failure.json"), JSON.stringify({ error: error.stack, checks, blocked }, null, 2));
    if (page) await page.screenshot({ path: path.join(OUT, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    workspace.cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
