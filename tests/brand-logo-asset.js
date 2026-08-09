/* The shipped mini logo, checked without a browser.

   The defect this pins down had three parts, and only the third was the picture:

     1. public/bible.html carried <img src="/cinebraid-mark.svg"> and NOTHING in
        styles.css ever sized it, so it rendered at its intrinsic 256x256 inside a
        250px sidebar and overflowed it entirely.
     2. Every place that did size it pinned width AND height to the same number
        with the default object-fit:fill. That looked correct only because the old
        mark happened to be square; any other asset would be squashed.
     3. The mark itself was replaced with the supplied 80x103 mini logo - which is
        exactly the non-square asset case (2) would have distorted.

   So the assertions here are about the RULES, not about a picture: a fixed height
   with an automatic width, object-fit that cannot distort, and no shipped <img>
   still pointing at the old mark. tests/brand-logo-real-browser.py then measures
   what a real Chromium actually lays out, because CSS that reads correctly and CSS
   that computes correctly are different claims. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const LOGO = "public/cinebraid-logo-xs.png";
const LOGO_URL = "/cinebraid-logo-xs.png";
const OLD_MARK = "/cinebraid-mark.svg";
const MARKUP = ["public/index.html", "public/bible.html", "public/login.html"];

/* PNG dimensions from the IHDR chunk: signature (8 bytes), length (4), "IHDR" (4),
   then width and height as big-endian uint32. No decoder needed to answer the only
   question that matters here, which is the asset's aspect ratio. */
function pngSize(rel) {
  const buffer = fs.readFileSync(path.join(ROOT, rel));
  assert.strictEqual(buffer.subarray(1, 4).toString("ascii"), "PNG", `${rel} is not a PNG`);
  assert.strictEqual(buffer.subarray(12, 16).toString("ascii"), "IHDR", `${rel} has no IHDR chunk`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/* ---- the asset ships and is the supplied one ---------------------------- */

assert(fs.existsSync(path.join(ROOT, LOGO)), `${LOGO} must ship with the application`);
const size = pngSize(LOGO);
assert(size.width > 0 && size.height > 0, "the mini logo must have real dimensions");
assert.notStrictEqual(size.width, size.height,
  "the mini logo is not square, which is the whole reason the square-box CSS had to change; " +
  "if a square asset is ever shipped here, re-read the aspect-ratio rules below before relaxing them");
const sourceRatio = size.width / size.height;

/* ---- every brand image points at it ------------------------------------- */

for (const rel of MARKUP) {
  const markup = read(rel);
  const images = [...markup.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
  const brandImages = images.filter((tag) => /cinebraid-(logo-xs\.png|mark\.svg)/.test(tag));
  assert(brandImages.length >= 1, `${rel} must render the CineBraid mark`);
  for (const tag of brandImages) {
    assert(tag.includes(LOGO_URL), `${rel} still renders the superseded mark: ${tag}`);
    /* Intrinsic dimensions on the tag itself so the browser reserves the right box
       before the PNG arrives, instead of reflowing the rail head on load. */
    assert(new RegExp(`width="${size.width}"`).test(tag) && new RegExp(`height="${size.height}"`).test(tag),
      `${rel} must declare the mini logo's intrinsic ${size.width}x${size.height} on the tag: ${tag}`);
  }
}

/* The old mark is still a legitimate favicon - it is square, scalable and drawn for
   exactly that job. What must not survive is an <img> in the page body pointing at
   it, which is what this separates. */
for (const rel of MARKUP) {
  for (const tag of [...read(rel).matchAll(/<img\b[^>]*>/g)].map((match) => match[0]))
    assert(!tag.includes(OLD_MARK), `${rel} has an <img> still using ${OLD_MARK}: ${tag}`);
}

/* ---- the CSS cannot distort it ------------------------------------------ */

const css = read("public/styles.css");
const login = read("public/login.html");

function ruleFor(source, selector) {
  const match = source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  assert(match, `expected a CSS rule for ${selector}`);
  return match[1];
}

for (const [label, body] of [
  ["public/styles.css .brand-logo", ruleFor(css, ".brand-logo")],
  ["public/styles.css .bible-brand img", ruleFor(css, ".bible-brand img")],
  ["public/login.html .login-brand img", ruleFor(login, ".login-brand img")],
]) {
  assert(/height:\s*\d+px/.test(body), `${label} must fix the logo's height`);
  assert(/width:\s*auto/.test(body), `${label} must let width follow the asset, not pin it to the height`);
  assert(/object-fit:\s*contain/.test(body), `${label} must use object-fit:contain so no asset can be stretched`);
  assert(!/\bwidth:\s*\d+px/.test(body), `${label} must not pin a pixel width beside a pixel height`);
}

/* The bible sidebar's mark had no rule at all and rendered at 256px. Its rule now
   exists and, because .bible-brand::before used to draw a "CB" chip in the mark's
   place, that stand-in must not still be drawn beside the real logo. */
assert(!/\.bible-brand::before\s*\{/.test(css),
  "the bible sidebar must not draw a CB text chip beside the real mini logo");

/* ---- the sign-in page can actually load it ------------------------------ */

/* Everything above was already true on the day the login screen shipped a broken
   image. The asset existed, the src was right, the CSS was right — and with an
   editor passcode set the server answered /cinebraid-logo-xs.png with a 302 to
   /login.html, because the pre-auth allowlist named the page and its stylesheet
   but not its pictures. The <img> got HTML instead of a PNG and drew the broken-
   image icon on the first screen a LAN user ever sees.

   So the claim is reachability, not existence: every file the sign-in page loads
   from this server must be fetchable BEFORE anyone has signed in. Stated over the
   whole page rather than over the logo alone, because the next asset added to
   login.html would fail in exactly the same way. */
const serverSource = read("server.js");
const allowlist = serverSource.split("const PRE_AUTH_PATHS = [")[1];
assert(allowlist, "server.js must declare PRE_AUTH_PATHS — the pre-auth allowlist this check reads");
const preAuth = new Set((allowlist.split("];")[0].match(/"([^"]+)"/g) || []).map((entry) => entry.slice(1, -1)));

assert(preAuth.has(LOGO_URL),
  `${LOGO_URL} must be reachable before sign-in, or the login screen renders a broken image`);
for (const attribute of [...login.matchAll(/\b(?:src|href)="(\/[^"]*)"/g)].map((match) => match[1])) {
  const file = attribute.split(/[?#]/)[0];
  assert(preAuth.has(file),
    `public/login.html loads ${file}, which an unauthenticated browser cannot fetch. `
    + "Add it to PRE_AUTH_PATHS in server.js or the sign-in page loads it broken.");
}

/* ---- the release carries the asset -------------------------------------- */

const gitignore = read(".gitignore");
assert(!/cinebraid-logo-xs/.test(gitignore), "the mini logo must not be ignored out of the release");

console.log(
  `Brand mini logo suite passed: ${LOGO} ships at ${size.width}x${size.height} (ratio ${sourceRatio.toFixed(4)}), ` +
  `${MARKUP.length} shipped pages reference it with intrinsic dimensions, no <img> still uses ${OLD_MARK}, ` +
  "all three sizing rules fix height with an automatic width under object-fit:contain, and every file the " +
  "sign-in page loads is reachable before sign-in.");
