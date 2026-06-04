import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath, extname } from "node:path";
import { existsSync } from "node:fs";

const packageToDist = new Map([
  ["@stitch/contract", "dist/contract/src/index.js"],
  ["@stitch/capture", "dist/capture/src/index.js"],
  ["@stitch/capsule", "dist/capsule/src/index.js"],
  ["@stitch/kernel", "dist/kernel/src/index.js"],
  ["@stitch/adapters", "dist/adapters/src/index.js"],
  ["@stitch/compiler", "dist/compiler/src/index.js"],
  ["@stitch/cli", "dist/cli/src/index.js"]
]);

export async function resolve(specifier, context, nextResolve) {
  const mapped = packageToDist.get(specifier);
  if (mapped) {
    return {
      url: pathToFileURL(resolvePath(process.cwd(), mapped)).href,
      shortCircuit: true
    };
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier) && context.parentURL?.startsWith("file:")) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const candidate = resolvePath(parentDir, `${specifier}.js`);
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
