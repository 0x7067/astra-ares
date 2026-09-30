import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const FLAVOR_META_FILES = {
  "astra-ares": "upstream-astra-ares.json",
  "luna-ares": "upstream-luna-ares.json",
};

export const FLAVORS = Object.keys(FLAVOR_META_FILES);
export const DEFAULT_FLAVOR = "astra-ares";

export function flavorMeta(flavor) {
  const file = FLAVOR_META_FILES[flavor];
  if (!file)
    throw new Error("Unknown flavor " + flavor + ": use astra-ares or luna-ares");
  return JSON.parse(readFileSync(join(root, "patches", file), "utf8"));
}

export function flavorFromArgs(argv) {
  const args = [...argv];
  let flavor = process.env.ARES_FLAVOR;
  for (const flag of ["--flavor", "--flavor="]) {
    const i = args.findIndex((a) => a === flag || a.startsWith(flag + "="));
    if (i === -1) continue;
    if (args[i] === flag) flavor = args.splice(i, 2)[1];
    else flavor = args.splice(i, 1)[0].slice(flag.length + 1);
  }
  return { flavor, args };
}
