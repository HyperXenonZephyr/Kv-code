#!/usr/bin/env node
// Unified entry point for the KV Code CLI.

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "fs";
import { createRequire } from "node:module";
import path from "path";
import { fileURLToPath } from "url";

// __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const PLATFORM_PACKAGE_BY_TARGET = {
  "x86_64-unknown-linux-musl": "@hyperxenonzephyr/kv-code-linux-x64",
  "aarch64-unknown-linux-musl": "@hyperxenonzephyr/kv-code-linux-arm64",
  "x86_64-apple-darwin": "@hyperxenonzephyr/kv-code-darwin-x64",
  "aarch64-apple-darwin": "@hyperxenonzephyr/kv-code-darwin-arm64",
  "x86_64-pc-windows-msvc": "@hyperxenonzephyr/kv-code-win32-x64",
  "aarch64-pc-windows-msvc": "@hyperxenonzephyr/kv-code-win32-arm64",
};

const { platform, arch } = process;

let targetTriple = null;
switch (platform) {
  case "linux":
  case "android":
    switch (arch) {
      case "x64":
        targetTriple = "x86_64-unknown-linux-musl";
        break;
      case "arm64":
        targetTriple = "aarch64-unknown-linux-musl";
        break;
      default:
        break;
    }
    break;
  case "darwin":
    switch (arch) {
      case "x64":
        targetTriple = "x86_64-apple-darwin";
        break;
      case "arm64":
        targetTriple = "aarch64-apple-darwin";
        break;
      default:
        break;
    }
    break;
  case "win32":
    switch (arch) {
      case "x64":
        targetTriple = "x86_64-pc-windows-msvc";
        break;
      case "arm64":
        targetTriple = "aarch64-pc-windows-msvc";
        break;
      default:
        break;
    }
    break;
  default:
    break;
}

if (!targetTriple) {
  throw new Error(`Unsupported platform: ${platform} (${arch})`);
}

const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple];
if (!platformPackage) {
  throw new Error(`Unsupported target triple: ${targetTriple}`);
}

function findKvCodeExecutable() {
  let vendorRoot;
  try {
    const packageJsonPath = require.resolve(`${platformPackage}/package.json`);
    vendorRoot = path.join(path.dirname(packageJsonPath), "vendor");
  } catch {
    vendorRoot = path.join(__dirname, "..", "vendor");
  }

  const kvCodeExecutable = path.join(
    vendorRoot,
    targetTriple,
    "bin",
    process.platform === "win32" ? "kv-code.exe" : "kv-code",
  );
  if (existsSync(kvCodeExecutable)) {
    return kvCodeExecutable;
  }

  const compatibilityExecutable = path.join(
    vendorRoot,
    targetTriple,
    "bin",
    process.platform === "win32" ? "codex.exe" : "codex",
  );
  if (existsSync(compatibilityExecutable)) {
    return compatibilityExecutable;
  }

  const packageManager = detectPackageManager();
  const updateCommand =
    packageManager === "bun"
      ? "bun install -g @hyperxenonzephyr/kv-code@latest"
      : "npm install -g @hyperxenonzephyr/kv-code@latest";
  throw new Error(
    `Missing optional dependency ${platformPackage}. Reinstall KV Code: ${updateCommand}`,
  );
}

const binaryPath = findKvCodeExecutable();

// Use an asynchronous spawn instead of spawnSync so Node can forward Ctrl-C
// and other termination signals while the native binary is running.
function detectPackageManager() {
  const userAgent = process.env.npm_config_user_agent || "";
  if (/\bbun\//.test(userAgent)) {
    return "bun";
  }

  const execPath = process.env.npm_execpath || "";
  if (execPath.includes("bun")) {
    return "bun";
  }

  if (
    __dirname.includes(".bun/install/global") ||
    __dirname.includes(".bun\\install\\global")
  ) {
    return "bun";
  }

  return userAgent ? "npm" : null;
}

const packageManagerEnvVar =
  detectPackageManager() === "bun"
    ? "KV_CODE_MANAGED_BY_BUN"
    : "KV_CODE_MANAGED_BY_NPM";
const packageRoot = realpathSync(path.join(__dirname, ".."));
const env = {
  ...process.env,
  [packageManagerEnvVar]: "1",
  KV_CODE_MANAGED_PACKAGE_ROOT: packageRoot,
  CODEX_MANAGED_PACKAGE_ROOT: packageRoot,
};

const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
  env,
});

child.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

const forwardSignal = (signal) => {
  if (child.killed) {
    return;
  }
  try {
    child.kill(signal);
  } catch {
    /* ignore */
  }
};

["SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => {
  process.on(sig, () => forwardSignal(sig));
});

const childResult = await new Promise((resolve) => {
  child.on("exit", (code, signal) => {
    if (signal) {
      resolve({ type: "signal", signal });
    } else {
      resolve({ type: "code", exitCode: code ?? 1 });
    }
  });
});

if (childResult.type === "signal") {
  process.kill(process.pid, childResult.signal);
} else {
  process.exit(childResult.exitCode);
}
