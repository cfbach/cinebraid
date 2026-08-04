const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function request(port, pathname, options = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => ({})) }));
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited with ${child.exitCode}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/api/projects`); if (response.ok) return; }
    catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error('server did not start');
}

async function projectDeletionRuntime() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-v6641-'));
  const projects = path.join(temp, 'projects');
  fs.mkdirSync(projects, { recursive: true });
  const minimal = (title) => ({ meta: { title, format: '', version: '6.6.4-studio.repair.13', world: {}, styleBlocks: [] }, scenes: [], shots: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [], jobs: [], decisions: [], agentRuns: [] });
  for (const [slug, title] of [['alpha', 'Alpha'], ['beta', 'Beta']]) {
    const dir = path.join(projects, slug); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(minimal(title), null, 2));
  }
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ activeProject: 'alpha' }, null, 2));
  const port = 46000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), CINEBRAID_PROJECTS_ROOT: projects, CINEBRAID_CONFIG_PATH: config }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitForServer(port, child);
    let result = await request(port, '/api/projects/alpha', { method: 'DELETE' });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.nextActive, 'beta');
    assert(!fs.existsSync(path.join(projects, 'alpha')), 'deleted project folder should leave the active projects root');
    const trash = path.join(projects, '.trash');
    assert(fs.readdirSync(trash).some((name) => name.startsWith('alpha-')), 'deleted project should be recoverable in projects/.trash');
    result = await request(port, '/api/projects');
    assert.strictEqual(result.body.active, 'beta');
    assert.deepStrictEqual(result.body.projects.map((row) => row.slug), ['beta']);
    result = await request(port, '/api/projects/beta', { method: 'DELETE' });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.nextActive, null);
    result = await request(port, '/api/project');
    assert.strictEqual(result.status, 404);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  const styles = read('public/styles.css');
  const coverage = read('public/coverage-automation.js');
  const entities = read('public/entities.js');
  const frames = read('public/creation-studio.js');
  const app = read('public/app.js');
  const server = read('server.js');

  assert(styles.includes('.modal-box:has(.imported-reference-mapper)'), 'import mapper must receive a viewport-bounded modal');
  assert(styles.includes('guided-frame-rail'), 'multi-frame workspace must use a compact frame rail');
  assert(styles.includes('minmax(min(240px,100%),320px)'), 'single candidates must remain width-bounded');
  assert(coverage.includes('Other uploaded images'), 'sheet picker must allow unrecognized uploaded sheets');
  assert(coverage.includes('COVERAGE_CROP_LAYOUTS'), 'cropper must expose common sheet layouts');
  assert(coverage.includes('panelIndex: state.panelIndex'), 'crop provenance must retain the selected panel');
  assert(entities.includes('Crop reference sheet'), 'manual reference workspace must expose sheet cropping');
  assert(entities.includes('Generate missing angles'), 'coverage workspace must expose generation from approved authority');
  assert(frames.includes('guidedFrameRailMarkup') && frames.includes('selectedFrame ? guidedFrameCard'), 'only the selected frame editor should render');
  assert(app.includes('requestDeleteProject') && app.includes('restoreTrashedProject') && app.includes('Recently deleted projects'), 'project switcher must expose recoverable deletion and in-app restoration');
  assert(server.includes('app.delete("/api/projects/:slug"'), 'server must implement project deletion');
  await projectDeletionRuntime();
  console.log('v6.6.4-studio.repair.13 usability suite passed viewport-bounded mapping, manual sheet crops, one-frame-at-a-time editing, bounded candidates, and recoverable project deletion.');
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
