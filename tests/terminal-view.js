/* READING THE ACTIVITY TERMINAL FROM A SUITE.
 *
 * A1 retired the Global Activity drawer and made the Terminal the canonical
 * operational surface. The suites that used to assert against
 * `v641RenderActivityDrawer()` assert against this instead.
 *
 * WHY IT RENDERS RATHER THAN MOUNTS. The Terminal normally reaches the page through
 * CineBraidShell.mountSlot("dock", …), which needs the shell modules and the real
 * slot markup. None of that is what these suites are about — they are about WHAT the
 * operational surface says about a set of runs. So this asks the shipped renderer for
 * its markup directly, through the same projection the mounted surface uses:
 * collectActivityFacts() → creatorState() → terminalMarkup(). One classifier, one
 * projection, one renderer — the same three the product uses, with the mount left out.
 *
 * REQUIRES the harness opt-in: render(hash, project, { creatorSurfaces: true }).
 * Without it window.CineBraidCreatorSurfaces is absent and this throws by name, which
 * is what makes a suite that forgot the flag fail loudly instead of silently
 * asserting against an empty string.
 */
const vm = require("vm");

/* STANDING IN FOR paint(), NOT FOR terminalMarkup(). paint() supplies the renderer
   with two things: the projection, and the foreign-project flag it reads from
   public/live-activity.js on the app's behalf. A helper that passed only the first
   would render a Terminal that can never show the foreign-project warning — and would
   then quietly agree with any suite asserting the warning is absent. */
const READ = `(() => {
  const S = window.CineBraidCreatorSurfaces;
  if (!S) throw new Error("creator surfaces are not loaded: render(..., { creatorSurfaces: true })");
  const foreign = typeof V641_ACTIVITY_FOREIGN_PROJECT === "undefined" ? "" : String(V641_ACTIVITY_FOREIGN_PROJECT || "");
  return S.terminalMarkup(S.projection(), COLLAPSED, foreign);
})()`;

/* The Terminal's markup for the current context state. `collapsed` matters: a
   collapsed Terminal renders its header and the foreign-project warning and nothing
   else, which is itself a property worth asserting. */
function terminalHtml(context, { collapsed = false } = {}) {
  return vm.runInContext(READ.replace("COLLAPSED", collapsed ? "true" : "false"), context);
}

/* The Assistant rail's markup, for the suites that asked the drawer about narration. */
function assistantHtml(context) {
  return vm.runInContext(`(() => {
    const S = window.CineBraidCreatorSurfaces;
    if (!S) throw new Error("creator surfaces are not loaded: render(..., { creatorSurfaces: true })");
    return S.assistantMarkup(S.projection());
  })()`, context);
}

/* The tone the shipped classifier gave one run, read off the row the Terminal
   rendered for it. This is the replacement for "which drawer section did it land in":
   the section headings were a presentation of the same verdict, and asking the row's
   tone asks the verdict itself. Returns "" when the run has no row. */
function runTone(context, runId) {
  const html = terminalHtml(context);
  const row = html.split("<article").find((chunk) => chunk.includes(`run:${runId}"`));
  if (!row) return "";
  const tone = row.match(/cb-terminal-row tone-([a-z]+)/);
  return tone ? tone[1] : "";
}

module.exports = { terminalHtml, assistantHtml, runTone };
