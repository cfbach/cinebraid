/* Provider-neutral editable-region map. No approval or Canon semantics. */
const { PNG } = require("pngjs");
const crypto = require("crypto");
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 4096 * 4096;
function fail(message) { const e = new Error(message); e.code = "REPAIR_MASK_INVALID"; e.status = 400; throw e; }
function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function decode(bytes, maxBytes = MAX_BYTES) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.length > maxBytes ||
      !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail("Supply a valid bounded PNG image.");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > MAX_PIXELS) fail("PNG dimensions exceed the supported pixel limit.");
  try { return PNG.sync.read(bytes, { checkCRC: true }); }
  catch { fail("The PNG cannot be decoded or its checksum is invalid."); }
}
function normalizeMask(bytes, convention, base) {
  const image = decode(bytes);
  if (!base || image.width !== base.width || image.height !== base.height) fail("Mask dimensions must match exact Image 1.");
  if (!["alpha-transparent-edit", "white-edit-black-preserve"].includes(convention)) fail("Choose the mask source convention explicitly.");
  const map = Buffer.alloc(image.width * image.height);
  let editable = 0;
  for (let n = 0; n < map.length; n++) {
    const p = n * 4, [r,g,b,a] = image.data.subarray(p, p + 4);
    if (convention === "alpha-transparent-edit") {
      if (a !== 0 && a !== 255) fail("This repair path supports binary alpha masks: transparent editable, opaque preserved.");
      map[n] = a === 0 ? 255 : 0;
    } else {
      if (a !== 255 || r !== g || g !== b || (r !== 0 && r !== 255)) fail("Supply an opaque black/white mask: white editable, black preserved.");
      map[n] = r;
    }
    if (map[n]) editable++;
  }
  if (!editable || editable === map.length) fail("The repair mask must contain both editable and preserved regions.");
  /* fal adapter convention: actual opaque RGB white-edit / black-preserve PNG.
     Never a relabelled alpha image. Known pixels are tested through decoding. */
  const provider = new PNG({ width: image.width, height: image.height });
  for (let n = 0; n < map.length; n++) {
    provider.data.fill(map[n], n * 4, n * 4 + 3); provider.data[n * 4 + 3] = 255;
  }
  const providerBytes = PNG.sync.write(provider, { colorType: 2, bitDepth: 8, inputHasAlpha: true });
  return { providerBytes, meaning: { version: "editable-region-map-v1", sourceConvention: convention,
    sourceHash: digest(bytes), mapHash: digest(map), providerHash: digest(providerBytes),
    providerConvention: "white-edit-black-preserve", providerField: "mask_url",
    width: image.width, height: image.height, editablePixels: editable, totalPixels: map.length,
    baseAssetId: base.assetId, baseHash: base.contentHash } };
}
module.exports = { MAX_BYTES, MAX_PIXELS, digest, decode, normalizeMask };
