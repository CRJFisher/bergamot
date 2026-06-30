// util.isNullOrUndefined was deprecated in Node 4 and removed in Node 24.
// @tensorflow/tfjs-node 4.x calls it at runtime via require('util'), so we
// must patch the real module object — not an ESM wrapper — before TF ops run.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const util_real = require("util") as { isNullOrUndefined?: (val: unknown) => boolean };
if (!util_real.isNullOrUndefined) {
  util_real.isNullOrUndefined = (val: unknown): boolean =>
    val === null || val === undefined;
}
