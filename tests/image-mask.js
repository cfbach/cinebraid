const assert = require("assert");
const Mask = require("../src/media/image-mask");
const { png } = require("./helpers/native-candidate-repair-fixture");
const base = { width: 2, height: 1, assetId: "exact-base", contentHash: "a".repeat(64) };
const alpha = png(2, 1, i => [30, 70, 90, i ? 255 : 0]);
const bw = png(2, 1, i => i ? [0, 0, 0, 255] : [255, 255, 255, 255]);
const a = Mask.normalizeMask(alpha, "alpha-transparent-edit", base);
const b = Mask.normalizeMask(bw, "white-edit-black-preserve", base);
assert.deepStrictEqual(a.providerBytes, b.providerBytes);
assert.strictEqual(a.meaning.mapHash, b.meaning.mapHash);
assert.deepStrictEqual([...Mask.decode(a.providerBytes).data], [255,255,255,255,0,0,0,255]);
assert.strictEqual(a.meaning.providerField, "mask_url");
assert.strictEqual(a.meaning.baseAssetId, base.assetId);
for (const [bytes, convention, dims] of [
  [alpha, "", base], [alpha, "alpha-transparent-edit", { width: 1, height: 2 }],
  [Buffer.from("not-png"), "alpha-transparent-edit", base],
  [png(2, 1, () => [0,0,0,0]), "alpha-transparent-edit", base],
  [png(2, 1, () => [0,0,0,255]), "alpha-transparent-edit", base],
  [png(2, 1, () => [0,0,0,128]), "alpha-transparent-edit", base],
  [png(2, 1, () => [50,50,50,255]), "white-edit-black-preserve", base],
]) assert.throws(() => Mask.normalizeMask(bytes, convention, dims), e => e.code === "REPAIR_MASK_INVALID");
console.log("image-mask: source conventions, exact pixels/binding, deterministic encoding and 7 refusals PASS");
