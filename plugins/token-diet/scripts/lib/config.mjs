// Shared configuration: plugin defaults, overridden by a user-level file that
// survives plugin updates.
//
// Precedence (later wins):
//   1. DEFAULT_CONFIG below
//   2. <plugin>/scripts/config.json  (shipped defaults)
//   3. ~/.zcode/token-diet.config.json  (or $TOKEN_DIET_CONFIG)
//
// Hooks must never print to stdout while loading config, so every failure is
// silent and falls back to the previous layer.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CONFIG = {
  guard: {
    enabled: true,
    read: {
      maxBytes: 131072,
      suggestLines: 200,
      maxLimitLines: 400,
    },
    bash: {
      enabled: true,
      catMaxBytes: 131072,
      denyRecursiveGrep: true,
      denyPatchLog: true,
      denyVerboseBuild: false,
    },
  },
  loopBreaker: {
    enabled: true,
    threshold: 3,
  },
  build: {
    toolchain: "auto",
    msbuildPath: "",
    configuration: "Debug",
    platform: "Any CPU",
  },
  search: {
    extensions: [],
    respectGitignore: true,
    cacheTtlMs: 30000,
    cacheMaxBytes: 33554432,
  },
  run: {
    timeoutMs: 600000,
  },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function mergeConfig(base, extra) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = mergeConfig(base?.[key] && typeof base[key] === "object" ? base[key] : {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function userConfigPath() {
  return process.env.TOKEN_DIET_CONFIG || path.join(os.homedir(), ".zcode", "token-diet.config.json");
}

export function loadConfig(scriptDir) {
  let cfg = mergeConfig(structuredClone(DEFAULT_CONFIG), readJson(path.join(scriptDir, "config.json")) || {});
  const user = readJson(userConfigPath());
  if (user) cfg = mergeConfig(cfg, user);
  return cfg;
}
