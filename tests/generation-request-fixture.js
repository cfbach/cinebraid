/* WHAT A CINEBRAID GENERATION DIALOG WOULD HAVE ATTACHED TO THIS BODY.
 *
 * Since Paid Request Truth V1, POST /api/generation/fal/jobs refuses a paid request that
 * does not say which surface built it and which view the filmmaker was using. That is the
 * point of the slice: an undeclared body is one CineBraid cannot restrict, and the safe
 * answer at a boundary that spends money is to refuse rather than to guess.
 *
 * Every suite that exercises that route is standing in for a dialog, so every suite has
 * to attach what a dialog attaches. This is the ONE place that does it, for two reasons:
 *
 *   1. The surface is derived from the request through the SAME function the route uses -
 *      generationRequestSurfacesFor() in public/shared-generation-presentation.js - so a
 *      fixture can never declare a surface the route would reject, and a change to that
 *      rule moves both sides together.
 *
 *   2. `advanced` is the view, deliberately and explicitly. A fixture is standing in for
 *      a filmmaker with every control open, which is the only view under which a body
 *      carrying an expert control (a size, a duration) is a truthful body. Stamping
 *      `simple` here would silently delete those keys from thirty existing assertions and
 *      the suites would go on passing while testing something narrower than they say.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it does not stamp a body that already carries a
 * declaration, so a test that wants to assert a specific view - or a refused one - just
 * writes it and this stays out of the way. And it is not used by the suite that proves
 * the refusal itself: tests/paid-request-truth.js posts undeclared bodies on purpose. */

const Presentation = require("../public/shared-generation-presentation");

const FIXTURE_VIEW_MODE = "advanced";

function declaredGenerationBody(body, options = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  /* An explicit declaration always wins. A test that is making a point about the
     declaration must be able to make it. */
  if (body[Presentation.CINEBRAID_REQUEST_PLAN_KEY]) return body;
  const { canonical } = Presentation.generationRequestSurfacesFor(body, body.purpose);
  return {
    ...body,
    [Presentation.CINEBRAID_REQUEST_PLAN_KEY]: Presentation.generationRequestDeclaration({
      surface: options.surface || canonical,
      viewMode: options.viewMode || FIXTURE_VIEW_MODE,
      ...(options.selectedOptionId ? { selectedOptionId: options.selectedOptionId } : {}),
      ...(options.selectedModelId ? { selectedModelId: options.selectedModelId } : {}),
    }),
  };
}

/* The same stamp, applied only to the route that requires one. A suite's post helper
   usually serves several routes - refresh, cancel, the plan previews - and a declaration
   on those would be noise claiming to be evidence. */
function withGenerationDeclaration(url, body, options) {
  return /\/api\/generation\/fal\/jobs$/.test(String(url || "")) ? declaredGenerationBody(body, options) : body;
}

/* For a helper that is handed a fetch init with the body already serialised. Round-trips
   through JSON rather than string-splicing it, so a body is either parsed and stamped or
   left exactly alone - there is no half-edited third outcome. */
function declaredRequestInit(url, init) {
  if (!init || typeof init.body !== "string") return init;
  if (!/\/api\/generation\/fal\/jobs$/.test(String(url || ""))) return init;
  return { ...init, body: JSON.stringify(declaredGenerationBody(JSON.parse(init.body))) };
}

module.exports = { FIXTURE_VIEW_MODE, declaredGenerationBody, declaredRequestInit, withGenerationDeclaration };
