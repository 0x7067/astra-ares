import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { Bridge } from "./bridge.mjs";
import { Jev } from "./jev.mjs";
import { loadConfig, readKey, binaryFor } from "./config.mjs";
import { assertLocalCliArgs } from "./cli-args.mjs";
import {
  DEFAULT_FLAVOR,
  FLAVORS,
  flavorFromArgs,
  flavorMeta,
} from "./flavors.mjs";
export function verifyBinary(binary, flavor) {
  const candidates = flavor ? [flavor] : FLAVORS;
  if (!existsSync(binary))
    throw new Error("Patched Codex is missing. Run ares setup.");
  const bytes = readFileSync(binary);
  let version;
  for (const candidate of candidates) {
    const meta = flavorMeta(candidate);
    const markers = [
      "CODEX_STEP_CONTROLLER_CONTEXT_V3",
      "Jev requires its bridge",
      "Astra Ares",
      "Sol Ares",
      ...(candidate === "luna" ? ["Luna Ares"] : []),
    ];
    if (!markers.every((marker) => bytes.includes(Buffer.from(marker))))
      continue;
    try {
      version = execFileSync(binary, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
    } catch {
      continue;
    }
    if (version === "codex-cli " + meta.version) break;
  }
  if (!version || !candidates.some(
    (candidate) => version === "codex-cli " + flavorMeta(candidate).version,
  ))
    throw new Error(
      "This Codex binary has no compatible Jev checkpoint. Run ares setup.",
    );
  if (!existsSync(join(dirname(binary), "codex-code-mode-host")))
    throw new Error("codex-code-mode-host must be beside the patched Codex");
}
export async function launch(argv, config = loadConfig()) {
  if (!["darwin", "linux"].includes(process.platform))
    throw new Error("Jev native checkpoint requires macOS or Linux");
  const { flavor: requested, args } = flavorFromArgs(argv);
  const flavor = requested ?? config.flavor ?? DEFAULT_FLAVOR;
  assertLocalCliArgs(args);
  const binary =
    config.codexBinary ?? binaryFor(config.paths.home, flavor);
  verifyBinary(binary, config.codexBinary ? undefined : flavor);
  const home = config.codexHome ?? config.paths.codexHome;
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (!existsSync(join(home, "config.toml")))
    writeFileSync(
      join(home, "config.toml"),
      'model = "Astra-Jev"\nmodel_provider = "openai"\n',
      { mode: 0o600 },
    );
  const auth = join(
    process.env.CODEX_HOME || join(homedir(), ".codex"),
    "auth.json",
  );
  if (!existsSync(join(home, "auth.json")) && existsSync(auth))
    symlinkSync(auth, join(home, "auth.json"));
  const socketDir = mkdtempSync(join(tmpdir(), "ares-"));
  const runDir = join(
    config.paths.runs,
    new Date().toISOString().replaceAll(":", "-") + "-" + process.pid,
  );
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const record = (event) =>
    appendFileSync(
      join(runDir, "decisions.jsonl"),
      JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
      { mode: 0o600 },
    );
  let evaluator;
  const jev = {
    decide(state, options) {
      evaluator ??= new Jev({
        apiKey: readKey(config),
        provider: config.provider,
        maxLeaseSteps: config.maxLeaseSteps,
        record,
      });
      return evaluator.decide(state, options);
    },
  };
  const bridge = new Bridge({
    socketPath: join(socketDir, "step.sock"),
    jev,
    record,
  });
  const env = {
    ...process.env,
    CODEX_HOME: home,
    CODEX_STEP_CONTROLLER_SOCKET: bridge.socketPath,
  };
  for (const name of [
    "AI_GATEWAY_API_KEY",
    "TYPESAFE_API_KEY",
    "OPENROUTER_API_KEY",
    config.apiKeyEnv,
  ].filter(Boolean))
    delete env[name];
  let child;
  const onInt = () => child?.kill("SIGINT"),
    onTerm = () => child?.kill("SIGTERM");
  try {
    await bridge.start();
    record({
      type: "cli_started",
      version: "0.2.1",
      provider: config.provider,
      maxLeaseSteps: config.maxLeaseSteps,
    });
    child = spawn(
      binary,
      [
        "-c",
        "features.step_model_switching=true",
        "-c",
        "features.reasoning_effort_override=true",
        ...args,
      ],
      { stdio: "inherit", env },
    );
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 130 : 1)));
    });
    record({
      type: "cli_exited",
      exitCode: code,
      confirmedCheckpoints: bridge.completedCheckpoints,
    });
    return code;
  } finally {
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
    await bridge.stop();
    rmSync(socketDir, { recursive: true, force: true });
  }
}
