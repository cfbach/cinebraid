/* EV2-7 Working draft export — the pure serializer and its route gate.

   src/server/working-draft-export.js turns a SAVED project into a readable Markdown copy of
   the creative intent the Working Bible shows. It is an allowlist: what is not a Working Bible
   field must never reach the file, however it is nested. No server, disk, provider or network
   is touched here; the route itself is exercised by tests/ev2-4-bible-audience.js. */
'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const readLF = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const { workingDraftMarkdown } = require('../src/server/working-draft-export');

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const X = 'ExcludedSentinel';
const between = (md, start, end) => { const i = md.indexOf(start); assert.ok(i >= 0, 'section located: ' + start); const j = end ? md.indexOf(end, i + start.length) : -1; return md.slice(i, j < 0 ? undefined : j); };

function fixture() {
  const longNote = 'Keep the sea light soft and the practical lights warm. '.repeat(100).trim();
  const P = {
    meta: { title: 'Signal House', format: 'Short film', worldSetting: 'LegacyWorldLoses', world: { setting: 'SavedSettingSentinel on the coast.', include: 'Salt-stained surfaces.', reject: 'RejectLoses' },
      globalStylePrompt: 'Quiet observation.', globalNegativePrompt: 'NegativeWins', styleBlocks: [{ text: X }], generationPackages: [{ prompt: X }] },
    characters: [
      { id: 'KAI', name: 'Kai', role: 'Relay engineer', creationDescription: 'A maintenance engineer in a worn coat.', block: 'IdentitySentinel', notes: 'Sections 7, 9, N347. Kai measures each answer.',
        prompts: [{ id: 'p', text: X }], driftNotes: X, candidateFiles: [{ stored: X + '.png' }], continuityStates: [{ id: 'state-default', name: 'Default', approvedFile: X + '.png' }], generationPackages: [{ prompt: X }], approvedFile: X + '.png' },
      { id: { nested: 'NestedSentinel' }, name: 'Malformed legacy row', notes: 'Readable malformed note.' },
    ],
    locations: [{ id: 'HULL', name: 'Hull bay', creationDescription: 'An exposed maintenance bay.', block: 'LocationBlockLoses', notes: longNote }],
    props: [{ id: 'TOOL', name: 'Relay tool', creationDescription: '', description: 'LegacyDescriptionSentinel', block: 'PropBlockLoses',
      notes: '# Heading\n<script>alert(1)</script>\n- list\n[x](y)\n1. one\n> quote\n---\n| a | b |' }],
    vehicles: [{ id: 'VAN', name: 'Relay van', notes: 'Sections 3, N12. A dented relay van.' }], audio: [],
    shots: [
      { id: 'SH010', title: 'The signal', codes: ['KAI', 'HULL'], notes: X, prompt: X, keyframes: [{ id: 'A', label: X, winner: X + '.png' }], candidateFiles: [{ stored: X + '.png' }] },
      { id: 'SH020', title: 'Unrelated shot', codes: ['HULL'], notes: X },
      { id: { nested: 'NestedShotSentinel' }, title: 'Malformed shot', codes: ['KAI'] },
    ],
    scenes: [{ id: 'SC1', title: X }],
    productionAuthority: { receipts: [{ id: 'receipt-' + X, value: X + '.png' }] },
  };
  for (let i = 0; i < 247; i++) P.characters.push({ id: `CAST-${String(i).padStart(3, '0')}`, name: `Crew member ${String(i).padStart(3, '0')}`, notes: 'Synthetic large-cast record.' });
  return { P, longNote };
}

/* 1 · Header, placement and precedence. */
{
  const { P, longNote } = fixture();
  const before = JSON.stringify(P);
  const md = workingDraftMarkdown(P, { revision: 'abc', exportedAt: '2026-09-16T00:00:00Z' });
  check(JSON.stringify(P) === before, 'serializing writes nothing back into the project');
  check(md.startsWith('# Signal House — Working draft\n'), 'the title names a Working draft');
  check(md.includes('**WORKING DRAFT · SAVED SNAPSHOT · NOT APPROVED**'), 'the fixed audience label is present');
  check(md.includes('It is not the Approved record and it approves nothing.'), 'the draft disclaims approval');
  check(md.includes('- Exported: 2026-09-16T00:00:00Z') && md.includes('revision sha256:abc'), 'injected time and revision are stated');
  check(between(md, '### World / setting', '### Visual language').includes('SavedSettingSentinel'), 'the saved world setting sits under World / setting');
  check(!md.includes('LegacyWorldLoses'), 'world.setting wins over the legacy worldSetting mirror');
  check(between(md, '### Creative exclusions', '##').includes('NegativeWins') && !md.includes('RejectLoses'), 'globalNegativePrompt wins over world.reject');
  check(md.includes('### Existing world inclusions') && md.includes('Salt-stained surfaces.'), 'existing world inclusions are carried read-only');

  /* 2 · Per-type fields. */
  const kai = between(md, '### Kai', '### Malformed legacy row');
  check(kai.includes('#### Identity') && kai.includes('IdentitySentinel'), 'character identity is exported');
  check(!kai.includes('#### Existing description fallback'), 'no fallback when a visual description is saved');
  check(kai.includes('_Relay engineer_'), 'the role is carried as a lede');
  const hull = between(md, '### Hull bay', '## Props');
  check(!hull.includes('#### Identity') && !md.includes('LocationBlockLoses') && !md.includes('PropBlockLoses'), 'identity appears for characters only');
  const tool = between(md, '### Relay tool', '## Vehicles');
  check(tool.includes('#### Existing description fallback') && tool.includes('LegacyDescriptionSentinel') && tool.includes('_Not yet written._'), 'the fallback appears only when the visual description is empty and another description resolves');
  check((md.match(/^#### Identity$/gm) || []).length === P.characters.length, 'one Identity section per character and none elsewhere');

  /* 3 · Notes provenance goes to Sources & history only. */
  const sources = md.slice(md.indexOf('## Sources & history'));
  check(kai.includes('Kai measures each answer.') && !kai.includes('N347'), 'readable notes stay in the body without imported identifiers');
  check(sources.includes('Imported source references: Sections 7, 9, N347.') && md.indexOf('N347') > md.indexOf('## Sources & history'), 'imported source references appear only under Sources & history');
  check(sources.includes('- Characters · Kai · ID KAI'), 'element IDs are listed under Sources & history');
  const van = between(md, '### Relay van', '## Sources & history');
  check(!van.includes('#### Existing description fallback') && (van.match(/A dented relay van\./g) || []).length === 1 && van.includes('_Other workflows currently read these notes as the visual description.'), 'notes that serve as the description fallback are said once, under Creative notes');
  check(!van.includes('N12') && sources.includes('- Vehicles · Relay van · ID VAN · Imported source references: Sections 3, N12.'), 'and their imported identifiers still stay under Sources & history');

  /* 4 · No truncation. */
  check(md.includes('### Crew member 000') && md.includes('### Crew member 246') && (md.match(/^### Crew member \d{3}$/gm) || []).length === 247, 'a 247-row cast is exported in full');
  check(longNote.length > 5000 && md.includes(longNote), 'long prose is exported intact');

  /* 5 · Allowlist. */
  check(!md.includes(X), 'prompts, drift notes, packages, candidates, approved files, receipts, shot notes, frame labels and scene titles never appear');
  check(!/approvedFile|candidateFiles|generationPackages|productionAuthority/.test(md), 'no approval or generation containers are named');

  /* 6 · Malformed input. */
  check(!md.includes('[object Object]') && !md.includes('NestedSentinel') && !md.includes('NestedShotSentinel'), 'malformed ids never print an object or its nested content');
  check(md.includes('### Malformed legacy row') && md.includes('Readable malformed note.') && md.includes('ID not recorded'), 'a malformed row keeps its readable fields');

  /* 7 · Markdown injection. */
  check(!/^# Heading/m.test(md) && md.includes('\\# Heading'), 'a heading in notes is escaped');
  check(!md.includes('<script>') && md.includes('\\<script\\>'), 'HTML in notes is escaped');
  check(!/^- list/m.test(md) && md.includes('\\- list'), 'a list marker in notes is escaped');
  check(!md.includes('[x](y)') && md.includes('\\[x\\](y)'), 'a link in notes is escaped');
  check(md.includes('1\\. one') && md.includes('\\> quote') && md.includes('\\---') && md.includes('\\| a \\| b \\|'), 'ordered lists, quotes, rules and tables in notes are escaped');

  /* 8 · Shot links through shotDependencyRecords. */
  const kaiShots = between(kai, '#### In this production', '###');
  check(kaiShots.includes('- SH010 · The signal') && !kaiShots.includes('SH020'), 'a resolved character link lists its shot, an unrelated shot is absent');
  check(between(hull, '#### In this production').includes('- SH020 · Unrelated shot'), 'a location link lists every linked shot');
  check(between(md, '### Crew member 000', '### Crew member 001').includes('_No recorded shot links. This does not establish that the element is unused._'), 'an unlinked element states the honest absence');
}

/* 9 · Empty and hostile top-level input. */
{
  const md = workingDraftMarkdown({ meta: {} });
  check(md.includes('# Untitled project — Working draft') && md.includes('_Not yet written._') && md.includes('_No production elements recorded yet._'), 'an empty project is honest');
  check(!/premise|theme/i.test(md), 'an empty project invents no premise or theme headings');
  check(!md.includes('Exported:') && !md.includes('revision sha256'), 'nothing is claimed about time or revision unless supplied');
  for (const hostile of [null, undefined, 42, 'text', [], { meta: 'x', characters: 'x', shots: {} }]) check(workingDraftMarkdown(hostile).includes('WORKING DRAFT · SAVED SNAPSHOT · NOT APPROVED'), 'hostile project shape still yields a labelled draft: ' + JSON.stringify(hostile));
  check(workingDraftMarkdown({ meta: { title: 42, format: { x: 1 } } }).includes('# 42 — Working draft\n') , 'numeric titles print and object formats do not');
}

/* 9b · Indented code, line-start markers in inline values, and the project named in the snapshot. */
{
  const P = { meta: { title: 'Probe', world: { setting: 'a\n\n    indented code line\n\ttabbed line\n   \n- after' } },
    characters: [{ id: 'KAI', name: 'Kai', notes: 'Readable.' }],
    shots: [{ id: '- 1', title: 'x', codes: ['KAI'] }, { id: '2.', title: 'y', codes: ['KAI'] }, { id: '+', title: 'z', codes: ['KAI'] }] };
  const md = workingDraftMarkdown(P, { revision: 'abc', projectSlug: 'probe-project' });
  check(!/^( {4}|\t)/m.test(md), 'no exported line opens with four spaces or a tab, so saved prose never becomes an indented code block');
  const setting = between(md, '### World / setting', '### Visual language');
  check(setting.includes('a  \n  \n    indented code line  \n    tabbed line  \n  \n\\- after'), 'authored indentation survives as no-break spaces and a whitespace-only line stays blank');
  const kaiShots = between(md, '#### In this production', '## Sources & history');
  check(kaiShots.includes('- \\- 1 · x') && !/^- - 1/m.test(md), 'a shot id beginning with a list marker cannot nest a list');
  check(kaiShots.includes('- 2\\. · y') && kaiShots.includes('- \\+ · z'), 'ordered and plus markers at the start of a shot id are escaped');
  check(md.includes('- Snapshot: saved project file · project probe-project · revision sha256:abc'), 'the snapshot line names the project it was read from');
  check(!workingDraftMarkdown(P).includes('· project '), 'no project is claimed unless supplied');
}

/* 10 · Source boundaries. */
{
  const code = readLF('src/server/working-draft-export.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  check(!/require\(['"](fs|path|\.\/approved-record|\.\.\/\.\.\/public\/shared-production-authority)/.test(code), 'the serializer reads no disk and no approval authority');
  check(!/productionAuthority|approvedFile|candidateFiles|generationPackages|receiptId/.test(code), 'the serializer names no approval or generation container');
  const declares = /function entityNotesProvenance\(|function entityReadableNotes\(|const V672_PROVENANCE_PREFIX\s*=/g;
  check(!declares.test(readLF('public/entities.js')) && (readLF('public/shared-entities.js').match(declares) || []).length === 3, 'the notes readers are moved, not duplicated, into shared-entities.js');
  const server = readLF('src/server/server.js');
  const route = server.slice(server.indexOf('app.get("/api/bible/export"'), server.indexOf('/* ---- project management ----'));
  const gate = route.indexOf('if(workingDraft && req.role!=="editor") return res.status(403)'), read = route.indexOf('fs.readFileSync(DATA())');
  check(gate > 0 && read > gate, 'the working draft is gated by the server editor role before any read');
  check(/filename="working-draft\.md"/.test(route) && /WorkingDraft\.workingDraftMarkdown\(project/.test(route), 'the route serves the saved snapshot as working-draft.md');
  check(/app\.get\("\/api\/bible", \(req, res\) => \{[\s\S]{0,200}approvedRecordProjection\(readJsonSync\(DATA\(\)\)\)/.test(server), '/api/bible still serves only the Approved projection');
  const viewer = readLF('public/bible.html') + readLF('public/bible.js');
  check(!/working-draft|preset=supporting/.test(viewer), 'the viewer offers no working export');
  const bible = readLF('public/working-bible.js');
  check(bible.includes(`href="\${esc(exportHref('working-draft'))}" download`) && bible.includes(`href="\${esc(exportHref('approved'))}" download`) && bible.includes(`href="\${esc(exportHref('supporting'))}" download`), 'the Working Bible offers the three explicit downloads');
  check(bible.includes("const exportHref=preset=>'/api/bible/export?preset='+preset+'&project='+encodeURIComponent(ACTIVE_PROJECT_SLUG);"), 'every Working Bible download names the open project');
  const binding = route.indexOf('if(req.query?.project!==undefined && String(req.query.project)!==openSlug) return res.status(409)');
  check(binding > gate && binding < read && route.indexOf('if(supporting && req.role!=="editor") return res.status(403)') < binding, 'a changed active project is refused after the editor gates and before any project read');
  check(route.indexOf('res.setHeader("X-CineBraid-Project",openSlug);') > 0 && route.indexOf('res.setHeader("X-CineBraid-Project",openSlug);') < route.indexOf('return res.status(403)'), 'every export response names the active project, refusals included');
  check(/projectSlug:openSlug/.test(route), 'the working draft names the project it was read from');
  check(!/exportHref|project=/.test(viewer), 'the viewer page keeps its unparameterised Approved link');
  check(/const fallback=f\.effective&&f\.effective===str\(f\.notes\)\.trim\(\)&&typeof entityReadableNotes==='function'\?entityReadableNotes\(f\.effective\)/.test(bible) && bible.includes('<p class="wb-long">${esc(fallback)}</p>'), 'the page fallback disclosure reads notes without their imported identifiers');
  check((bible.match(/indexOpen=(?!=)/g) || []).length === 3 && bible.includes('function setIndexOpen(open){indexOpen=!!open;') && !/indexOpen=!indexOpen|indexOpen=false;const aside/.test(bible), 'the phone index open state has one writer besides its declaration and the project-open reset');
  check(/navigation\.closest\('#wb-browser'\)\)\{const wasOpen=indexOpen;setIndexOpen\(false\);/.test(bible) && /if\(action==='find'\)\{setIndexOpen\(!indexOpen\);/.test(bible), 'row clicks (including the current row) and Find both go through setIndexOpen');
  check(bible.includes('id="wb-preview-approved"') && bible.includes('href="/bible.html" target="_blank"'), 'the Working Bible links its Approved record preview');
}

console.log(JSON.stringify({ suite: 'EV2-7 Bible working draft', checks, passed: true }));
