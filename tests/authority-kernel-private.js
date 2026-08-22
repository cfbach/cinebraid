"use strict";

/* Test-only loader for the destructive Canon owners that O8 deliberately keeps
 * out of AUTHORITY_KERNEL_EXPORTS. Appending the capture inside a fresh VM
 * reaches lexical declarations without changing the production module API. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUBLIC = path.join(__dirname, "..", "public");
const source = fs.readFileSync(path.join(PUBLIC, "shared-authority-kernel.js"), "utf8")
  + "\n;globalThis.__CINEBRAID_AUTHORITY_PRIVATE_TEST_ONLY = {"
  + " revokeFrameCanon, revokeMotionCanon, revokeDeliveryCanon, revokeEntityStateCanon,"
  + " systemInvalidateFrameCanon, systemInvalidateMotionCanon, systemInvalidateDeliveryCanon, systemInvalidateEntityStateCanon,"
  + " repairCanonValue };";
const context = vm.createContext({
  console,
  structuredClone,
  module: { exports: {} },
  exports: {},
  require(request) {
    if (!String(request).startsWith("./")) return require(request);
    return require(path.join(PUBLIC, String(request).slice(2)));
  },
});
new vm.Script(source, { filename: "shared-authority-kernel.js" }).runInContext(context);

module.exports = {
  Kernel: context.module.exports,
  Private: context.__CINEBRAID_AUTHORITY_PRIVATE_TEST_ONLY,
};
