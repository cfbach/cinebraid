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
 * the refusal itself: tests/paid-request-truth.js posts undeclared bodies on purpose.
 *
 * AND SINCE THE PAID DISPATCH PERMIT, THE OTHER HALF OF STANDING IN FOR A DIALOG.
 *
 * A real dialog does not only declare what built it. It also obtains a permit from the
 * direct issuance route inside the same Generate press, because the boundary will not
 * accept a paid dispatch whose authorization the server did not establish itself. A
 * fixture that only declared would be standing in for half a dialog, so both stamps live
 * here and reach every suite together.
 *
 * This is why the helpers are ASYNC: the permit is minted by the SHIPPED route on the
 * suite's own server. Nothing is faked, and a fixture therefore cannot obtain a permit the
 * real issuance path would refuse. */

const Presentation = require("../public/shared-generation-presentation");

const FIXTURE_VIEW_MODE = "advanced";

function declaredGenerationBody(body, options = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  /* An explicit declaration always wins. A test that is making a point about the
     declaration must be able to make it. */
  if (body[Presentation.CINEBRAID_REQUEST_PLAN_KEY]) return body;
  const { canonical, legal } = Presentation.generationRequestSurfacesFor(body, body.purpose);
  /* THE COVERAGE SURFACE IS NEVER STAMPED AUTOMATICALLY.
   *
   * `reference-automation` is corroborated at the paid boundary against a live coverage
   * run recorded on the entity — state a fixture has not created and should not fake in
   * passing. A suite that is genuinely exercising coverage automation writes that record
   * and names the surface explicitly (tests/paid-request-truth.js does both); every other
   * suite is standing in for the ordinary entity dialog, which declares `fixed-image`.
   *
   * Chosen by NAME, not by list position: `fixed-image` is the surface that needs no
   * corroboration, and saying so is the point. */
  const surfaceless = canonical === "reference-automation" && legal.includes("fixed-image")
    ? "fixed-image"
    : canonical;
  return {
    ...body,
    [Presentation.CINEBRAID_REQUEST_PLAN_KEY]: Presentation.generationRequestDeclaration({
      surface: options.surface || surfaceless,
      viewMode: options.viewMode || FIXTURE_VIEW_MODE,
      ...(options.selectedOptionId ? { selectedOptionId: options.selectedOptionId } : {}),
      ...(options.selectedModelId ? { selectedModelId: options.selectedModelId } : {}),
    }),
  };
}

/* THE PERMIT A DIALOG WOULD HAVE OBTAINED, from the shipped route on the suite's own
   server.

   The suites post RELATIVE paths and prefix their own origin at the fetch, so the base is
   asked for rather than guessed. A caller that supplies neither an origin nor an absolute
   URL is standing in for half a dialog, and that throws HERE — loudly — instead of quietly
   posting a permitless body and letting the boundary's refusal be read as the behaviour
   under test. A silent fixture is how a suite goes on passing while proving nothing. */
async function paidPermitFor(url, body, origin) {
  const base = String(origin || "") || (/^https?:/i.test(String(url)) ? new URL(String(url)).origin : "");
  if (!base) throw new Error("generation-request-fixture: a paid dispatch needs an origin to obtain its permit from - pass { origin } or an absolute URL.");
  const response = await fetch(`${base}/api/generation/paid-permit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      generationRequest: body?.generationRequest,
      purpose: body?.purpose,
      shotId: body?.shotId,
      frameId: body?.frameId,
      entityList: body?.entityList,
      entityId: body?.entityId,
      sourceBuildId: body?.sourceBuildId,
      outputCount: body?.outputCount,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.paidPermitId)
    throw new Error(`generation-request-fixture: the direct issuance route refused this scope (${response.status}): ${data.error || "no permit returned"}`);
  return { ...body, paidPermitId: data.paidPermitId };
}

/* The same stamp, applied only to the route that requires one. A suite's post helper
   usually serves several routes - refresh, cancel, the plan previews - and a declaration
   on those would be noise claiming to be evidence. */
async function withGenerationDeclaration(url, body, options) {
  if (!/\/api\/generation\/fal\/jobs$/.test(String(url || ""))) return body;
  const declared = declaredGenerationBody(body, options);
  if (!declared || typeof declared !== "object" || Array.isArray(declared) || declared.paidPermitId) return declared;
  return paidPermitFor(url, declared, options && options.origin);
}

/* For a helper that is handed a fetch init with the body already serialised. Round-trips
   through JSON rather than string-splicing it, so a body is either parsed and stamped or
   left exactly alone - there is no half-edited third outcome. */
async function declaredRequestInit(url, init, options) {
  if (!init || typeof init.body !== "string") return init;
  if (!/\/api\/generation\/fal\/jobs$/.test(String(url || ""))) return init;
  return { ...init, body: JSON.stringify(await withGenerationDeclaration(url, JSON.parse(init.body), options)) };
}

module.exports = { FIXTURE_VIEW_MODE, declaredGenerationBody, declaredRequestInit, paidPermitFor, withGenerationDeclaration };
