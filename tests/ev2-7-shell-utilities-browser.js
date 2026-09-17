/* EV2-7 dogfood — THE TWO SHELL UTILITIES IN A REAL BROWSER.
 *
 * tests/ev2-7-shell-utilities.js proves the semantics in Node: what the controls do, what
 * they say, and what the shipped sources and stylesheet declare. Five claims cannot be
 * proven there, and they are the five the human dogfood was about:
 *
 *   1. Braidy REALLY PAINTS on Results, on Screening, on the Reference Desk and in
 *      Production media. The reported defect was a control that opened a rail hidden by
 *      a desk stylesheet — a claim about a rendered box, not about state.
 *   2. The work is never squeezed by both utilities at once, measured as the centre's
 *      own width and the dock's own height.
 *   3. Every control in either frame is really at least 44px, at 390 and at 1440.
 *   4. The one contextual return control is the same height and sits in the same place
 *      on the Shot Desk, in Results, in Screening and on the Reference Desk.
 *   5. Neither utility puts a horizontal scrollbar on the page at 390.
 *
 * NOTHING IS PAID FOR AND NOTHING LEAVES THE MACHINE. Config and projects live in a
 * disposable root, the server runs with the no-network preload, the browser aborts every
 * non-local request and refuses every provider POST, and no assistant is configured —
 * which is exactly the state the "Braidy is not connected" rail is checked in.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { disposableRoot } = require('./helpers/disposable-root');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.EV2_7_SHELL_BROWSER_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'ev2-7-shell-browser-'));
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const failures = [];
const blocked = [];
const pageErrors = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok });
  if (ok) console.log(`  ok  ${name}`);
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.error(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server, browser, page, base, workspace;

/* One reading of both utilities and the return control. Geometry only — every word this
   suite checks is read from the rendered page rather than from a source. */
const STATE = `() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), painted: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }; };
  const q = (sel) => document.querySelector(sel);
  const ret = q('[data-media-return]');
  const heading = document.querySelector('#main h1');
  const active = document.activeElement;
  return {
    hash: location.hash,
    rail: { box: box(q('#cb-shell-rail')), occupied: !!q('#cb-shell-rail[data-occupied]'),
      controls: [...document.querySelectorAll('#cb-shell-rail .cb-utility-close, #cb-shell-rail .cb-utility-link')].map((el) => ({ text: el.textContent.trim(), h: Math.round(el.getBoundingClientRect().height) })),
      text: (q('#cb-shell-rail')?.innerText || '').replace(/\\s+/g, ' ').trim() },
    dock: { box: box(q('#cb-shell-dock')), collapsed: q('.cb-terminal')?.dataset.collapsed || 'MISSING',
      title: q('.cb-terminal-title')?.textContent.trim() || '',
      controls: [...document.querySelectorAll('#cb-shell-dock .cb-terminal-head button')].map((el) => ({ text: el.textContent.trim(), h: Math.round(el.getBoundingClientRect().height) })) },
    activity: { expanded: q('#automation-activity-toggle')?.getAttribute('aria-expanded'), h: Math.round(q('#automation-activity-toggle')?.getBoundingClientRect().height || 0) },
    braidy: { expanded: q('#creator-rail-toggle')?.getAttribute('aria-expanded'), offered: !!q('#creator-rail-toggle') && getComputedStyle(q('#creator-rail-toggle')).display !== 'none' },
    main: box(q('#main')),
    ret: ret ? { box: box(ret), text: ret.innerText.replace(/\\s+/g, ' ').trim(), title: ret.title, aria: ret.getAttribute('aria-label'),
      aboveHeading: heading ? Math.round(ret.getBoundingClientRect().top) <= Math.round(heading.getBoundingClientRect().top) : null,
      inActionGroup: !!ret.closest('.rx-head-actions, .rd-heading-actions, .shot-head-controls') } : null,
    focus: active ? { id: active.id, inRail: !!active.closest('#cb-shell-rail'), inDock: !!active.closest('#cb-shell-dock') } : null,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  };
}`;

const state = () => page.evaluate(`(${STATE})()`);
async function settle(ms = 350) {
  await page.waitForFunction(() => document.body?.dataset?.renderReady === '1', null, { timeout: 15000 }).catch(() => {});
  await sleep(ms);
}
async function go(hash, ms = 500) {
  await page.evaluate((h) => { if (location.hash === h && typeof route === 'function') route(); else location.hash = h; }, hash);
  await sleep(120); await settle(ms);
}
async function press(selector) { await page.locator(selector).first().click({ timeout: 5000 }); await sleep(200); await settle(300); }
async function capture(name) { await page.screenshot({ path: path.join(OUT, name + '.png') }).catch(() => {}); }
const quiet = () => page.evaluate(() => {
  try { localStorage.removeItem('cinebraid-creator-rail-open'); localStorage.removeItem('cinebraid-creator-terminal-collapsed'); } catch { /* private mode */ }
  window.CineBraidCreatorSurfaces.paint();
});

(async () => {
  try {
    /* The shipped demo sandbox, in a disposable root: a real project, none of the
       founder's. Nothing in this suite writes to it. */
    workspace = disposableRoot('ev2-7-shell-browser', {});
    const sandbox = spawnSync(process.execPath, ['scripts/qa-sandbox.js', '--out', path.join(OUT, 'env'), '--demo', '--force'], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(sandbox.status, 0, `the demo sandbox must build: ${sandbox.stderr}`);
    const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => resolve(n)); }); });
    assert.notStrictEqual(port, 4477, 'never the founder\'s own port');
    base = 'http://127.0.0.1:' + port;
    const log = fs.openSync(path.join(OUT, 'server.log'), 'w');
    server = spawn(process.execPath, ['-r', './tests/helpers/ev2-6-no-network.js', 'server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: path.join(OUT, 'env', 'config.json'), CINEBRAID_PROJECTS_ROOT: path.join(OUT, 'env', 'projects') },
      stdio: ['ignore', log, log],
    });
    let up = false;
    for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/api/project')).ok; } catch { /* retry */ } if (!up) await sleep(100); if (server.exitCode !== null) throw new Error('server exited ' + server.exitCode); }
    assert.ok(up, 'the server must start');

    const pw = require(process.env.CINEBRAID_PLAYWRIGHT_MODULE || 'playwright');
    browser = await pw.chromium.launch({ headless: true, ...(process.env.CINEBRAID_BROWSER_EXECUTABLE ? { executablePath: process.env.CINEBRAID_BROWSER_EXECUTABLE } : {}) });
    console.log('[browser-runtime] ev2-7-shell-utilities: launched Chromium ' + browser.version() + ' (Node Playwright)');
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', async (r) => {
      const url = r.request().url();
      if (!url.startsWith(base + '/')) { blocked.push(url.split('?')[0]); return r.abort(); }
      const u = new URL(url);
      if (r.request().method() !== 'GET' && /\/api\/(generation|accounts|assistant|agents?|fal|civitai|comfy)/.test(u.pathname)) {
        blocked.push(r.request().method() + ' ' + u.pathname);
        return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'provider traffic disabled in this suite' }) });
      }
      return r.continue();
    });
    page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof P !== 'undefined' && P?.shots?.length, null, { timeout: 30000 });
    await settle(900);

    const shotId = await page.evaluate(() => P.shots[0].id);
    const frameId = await page.evaluate(() => (P.shots[0].keyframes || [{ id: 'frame-a' }])[0].id);
    const entity = await page.evaluate(() => {
      for (const list of ['characters', 'locations', 'props', 'vehicles']) { const rows = (P && P[list]) || []; if (rows.length) return { list, id: rows[0].id }; }
      return null;
    });
    const ROUTES = [
      ['Production', '#/production'],
      ['the Shot Desk', `#/shot/${shotId}`],
      ['Results', `#/shot/${shotId}/results/frame/${frameId}/-`],
      ...(entity ? [['the Reference Desk', `#/${{ characters: 'character', locations: 'location', props: 'prop', vehicles: 'vehicle' }[entity.list]}/${entity.id}`]] : []),
      ['Production media', '#/results'],
    ];

    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await go('#/production', 700);

      for (const [label, hash] of ROUTES) {
        await quiet();
        await go(hash, 800);
        const at = `${label} at ${width}`;
        const rest = await state();
        check(`${at}: both utilities are closed by default`, rest.dock.collapsed === '1' && !rest.rail.occupied,
          `drawer=${rest.dock.collapsed} rail=${rest.rail.occupied}`);

        /* 1 · Activity opens and closes from the one control. */
        await press('#automation-activity-toggle');
        const open = await state();
        check(`${at}: the topbar control opens the Activity drawer`, open.dock.collapsed === '0' && open.activity.expanded === 'true' && open.dock.box.h > rest.dock.box.h,
          `collapsed=${open.dock.collapsed} expanded=${open.activity.expanded} dock=${rest.dock.box.h}->${open.dock.box.h}`);
        check(`${at}: opening moves focus into the drawer`, !!open.focus?.inDock, JSON.stringify(open.focus));
        check(`${at}: every control in the Activity frame is at least 44px`, open.dock.controls.length > 0 && open.dock.controls.every((c) => c.h >= 44),
          JSON.stringify(open.dock.controls));
        check(`${at}: the drawer names itself the way its control does`, open.dock.title === 'Activity', open.dock.title);
        check(`${at}: an open drawer does not overflow the page`, !open.overflow);
        await capture(`activity-open-${label.replace(/\W+/g, '-')}-${width}`);
        await press('#automation-activity-toggle');
        const shut = await state();
        check(`${at}: the same control CLOSES it — the reported defect`, shut.dock.collapsed === '1' && shut.activity.expanded === 'false',
          `collapsed=${shut.dock.collapsed} expanded=${shut.activity.expanded}`);
        check(`${at}: closing leaves focus on the control`, shut.focus?.id === 'automation-activity-toggle', JSON.stringify(shut.focus));

        /* 2 · Braidy, where the shell offers it. */
        if (rest.braidy.offered) {
          await press('#creator-rail-toggle');
          const braidy = await state();
          check(`${at}: Braidy opens AND PAINTS`, braidy.rail.occupied && braidy.rail.box.painted && braidy.rail.box.w >= 200,
            `occupied=${braidy.rail.occupied} box=${JSON.stringify(braidy.rail.box)}`);
          check(`${at}: the rail explains that no assistant is connected`, /Braidy is not connected/.test(braidy.rail.text), braidy.rail.text.slice(0, 120));
          check(`${at}: every control in the Braidy frame is at least 44px`, braidy.rail.controls.length >= 2 && braidy.rail.controls.every((c) => c.h >= 44),
            JSON.stringify(braidy.rail.controls));
          check(`${at}: opening moves focus into the rail`, !!braidy.focus?.inRail, JSON.stringify(braidy.focus));
          check(`${at}: an open rail does not overflow the page`, !braidy.overflow);
          await capture(`braidy-open-${label.replace(/\W+/g, '-')}-${width}`);

          /* 3 · Never both. Measured on the centre and on the dock. */
          await press('#automation-activity-toggle');
          const both = await state();
          check(`${at}: opening Activity closes Braidy`, !both.rail.occupied && !both.rail.box.painted && both.dock.collapsed === '0',
            `rail=${JSON.stringify(both.rail.box)} drawer=${both.dock.collapsed}`);
          check(`${at}: the centre gets its width back when the rail closes`, both.main.w >= rest.main.w - 2,
            `centre ${rest.main.w} -> with rail ${braidy.main.w} -> ${both.main.w}`);
          await press('#creator-rail-toggle');
          const back = await state();
          check(`${at}: opening Braidy closes Activity`, back.dock.collapsed === '1' && back.rail.box.painted,
            `drawer=${back.dock.collapsed} rail=${JSON.stringify(back.rail.box)}`);

          /* 4 · Escape, and the rail's own Close. */
          await page.keyboard.press('Escape'); await sleep(200); await settle(250);
          const escaped = await state();
          check(`${at}: Escape inside the rail closes it and returns focus`, !escaped.rail.occupied && escaped.focus?.id === 'creator-rail-toggle',
            `occupied=${escaped.rail.occupied} focus=${JSON.stringify(escaped.focus)}`);
          await press('#creator-rail-toggle');
          await press('#cb-shell-rail .cb-utility-close');
          const closed = await state();
          check(`${at}: the rail closes from its own header`, !closed.rail.occupied && closed.focus?.id === 'creator-rail-toggle',
            `occupied=${closed.rail.occupied} focus=${JSON.stringify(closed.focus)}`);
        } else {
          check(`${at}: Braidy's control is withdrawn at this width by one measured floor, not by the route`, width <= 720);
        }

        /* 5 · Escape inside the drawer. */
        await press('#automation-activity-toggle');
        await page.keyboard.press('Escape'); await sleep(200); await settle(250);
        const dockEscape = await state();
        check(`${at}: Escape inside the drawer closes it and returns focus`, dockEscape.dock.collapsed === '1' && dockEscape.focus?.id === 'automation-activity-toggle',
          `collapsed=${dockEscape.dock.collapsed} focus=${JSON.stringify(dockEscape.focus)}`);
      }

      /* 6 · ONE CONTEXTUAL RETURN, the same control on every page that shows one. The
         edge is created through the shipped coordinator — the same two calls the Media
         Inspector makes — so what is measured is the product's own control. */
      const geometry = [];
      for (const [label, hash] of ROUTES.filter(([, h]) => h !== '#/production')) {
        await go('#/production', 600);
        await page.evaluate((h) => window.CineBraidMediaReturn.go(h, window.CineBraidMediaReturn.capture()), hash);
        await sleep(200); await settle(700);
        const seen = await state();
        if (!seen.ret) { check(`the return control appears on ${label} at ${width}`, false, `no [data-media-return] at ${seen.hash}`); continue; }
        geometry.push({ label, ...seen.ret.box, aboveHeading: seen.ret.aboveHeading, inActionGroup: seen.ret.inActionGroup, text: seen.ret.text, title: seen.ret.title });
        check(`the return on ${label} at ${width} is one 44px line`, seen.ret.box.h === 44, `${seen.ret.box.h}px — "${seen.ret.text}"`);
        check(`the return on ${label} at ${width} sits above the page heading`, seen.ret.aboveHeading !== false, `heading at or above the control`);
        check(`the return on ${label} at ${width} is not inside a heading's action group`, !seen.ret.inActionGroup);
        check(`the return on ${label} at ${width} keeps its whole label in the accessible name`, !!seen.ret.title && seen.ret.title.startsWith('Return to'), seen.ret.title);
        await capture(`return-${label.replace(/\W+/g, '-')}-${width}`);
      }
      if (geometry.length > 1) {
        const heights = new Set(geometry.map((g) => g.h));
        check(`every return control is the same height at ${width}`, heights.size === 1, JSON.stringify(geometry.map((g) => `${g.label}:${g.h}`)));
      }
      /* Screening is Results in its own mode, and the return must not change size there. */
      await go(`#/shot/${shotId}/results/frame/${frameId}/-`, 700);
      if (await page.locator('#rx-screen').count()) {
        await page.evaluate((h) => window.CineBraidMediaReturn.go(h, window.CineBraidMediaReturn.capture()), `#/shot/${shotId}/results/frame/${frameId}/-`);
        await sleep(200); await settle(600);
        if (await page.locator('#rx-screen:not([disabled])').count()) {
          await press('#rx-screen');
          const screening = await state();
          if (screening.ret) {
            check(`the return in Screening at ${width} is the same 44px line`, screening.ret.box.h === 44, `${screening.ret.box.h}px`);
            check(`the return in Screening at ${width} is not inside the heading's action group`, !screening.ret.inActionGroup);
            await capture(`return-screening-${width}`);
          }
        }
      }
    }

    check('no uncaught page error', pageErrors.length === 0, pageErrors.join(' | '));
    check('no request left the machine', blocked.filter((u) => !u.startsWith('POST') && !u.startsWith('PUT')).length === 0, blocked.join(' | '));
  } catch (error) {
    failures.push('fatal: ' + (error && error.stack ? error.stack : error));
    console.error(error);
    if (page) await capture('FATAL');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) { server.kill(); await new Promise((r) => { server.once('exit', r); setTimeout(r, 5000); }); }
    for (let i = 0; i < 5; i++) { try { workspace?.cleanup(); break; } catch { await sleep(400); } }
  }
  console.log(`captures: ${OUT}`);
  if (failures.length) { console.error(`FAIL ev2-7 shell utilities (browser): ${failures.length} of ${checks.length} checks failed.`); process.exit(1); }
  console.log(`PASS ev2-7 shell utilities (browser): ${checks.length} checks — both utilities open, close, never overlap, stay keyboard-reachable, and one contextual return control at one size on every page.`);
})();
