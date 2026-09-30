import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const FLAVOR_META_FILES = {
  latest: "upstream.json",
  luna: "upstream-luna.json",
};

export const FLAVORS = Object.keys(FLAVOR_META_FILES);
export const DEFAULT_FLAVOR = "latest";

export function flavorMeta(flavor = DEFAULT_FLAVOR) {
  const file = FLAVOR_META_FILES[flavor];
  if (!file) throw new Error(`Unknown flavor: ${flavor}`);
  return JSON.parse(readFileSync(join(root, "patches", file), "utf8"));
}

export function flavorFromArgs(args, env = process.env) {
  let flavor = env.ARES_FLAVOR;
  const clean = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--flavor") {
      flavor = args[++i];
      continue;
    }
    if (arg.startsWith("--flavor=")) {
      flavor = arg.slice("--flavor=".length);
      continue;
    }
    clean.push(arg);
  }
  return { flavor, args: clean };
}
