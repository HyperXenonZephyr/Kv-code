#!/usr/bin/env node

import { existsSync, mkdirSync } from "fs";
import { createRequire } from "node:module";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const GITHUB_REPO = "HyperXenonZephyr/Kv-code";

const TARGET_BY_PLATFORM_ARCH = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
};

const PLATFORM_PACKAGE_BY_TARGET = {
  "x86_64-unknown-linux-musl": "@hyperxenonzephyr/kv-code-linux-x64",
  "aarch64-unknown-linux-musl": "@hyperxenonzephyr/kv-code-linux-arm64",
  "x86_64-apple-darwin": "@hyperxenonzephyr/kv-code-darwin-x64",
  "aarch64-apple-darwin": "@hyperxenonzephyr/kv-code-darwin-arm64",
  "x86_64-pc-windows-msvc": "@hyperxenonzephyr/kv-code-win32-x64",
  "aarch64-pc-windows-msvc": "@hyperxenonzephyr/kv-code-win32-arm64",
};

const { platform, arch } = process;
const platformKey = `${platform}-${arch}`;
const targetTriple = TARGET_BY_PLATFORM_ARCH[platformKey];

if (!targetTriple) {
  console.error(`[kv-code] Unsupported platform: ${platform} (${arch})`);
  process.exit(1);
}

const packageRoot = path.resolve(__dirname, "..");
const vendorDir = path.join(packageRoot, "vendor", targetTriple, "bin");
const binaryName = platform === "win32" ? "kv-code.exe" : "kv-code";
const binaryPath = path.join(vendorDir, binaryName);

function findExistingBinary() {
  if (existsSync(binaryPath)) return binaryPath;

  // Try platform-specific optional dependency
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  try {
    const pkgJsonPath = require.resolve(`${platformPackage}/package.json`);
    const pkgDir = path.dirname(pkgJsonPath);
    const depBinary = path.join(pkgDir, "vendor", targetTriple, "bin", binaryName);
    if (existsSync(depBinary)) return depBinary;
    const compatBinary = path.join(pkgDir, "vendor", targetTriple, platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(compatBinary)) return compatBinary;
  } catch {
    // optional dependency not installed
  }

  return null;
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "kv-code-installer" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, { headers: { "User-Agent": "kv-code-installer" } }, (r) => {
          let d = "";
          r.on("data", (c) => d += c);
          r.on("end", () => resolve(JSON.parse(d)));
        }).on("error", reject);
        return;
      }
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        else resolve(JSON.parse(data));
      });
    }).on("error", reject);
  });
}

async function downloadFile(url, destPath) {
  mkdirSync(path.dirname(destPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const file = require("fs").createWriteStream(destPath);
    https.get(url, { headers: { "User-Agent": "kv-code-installer" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        require("fs").unlinkSync(destPath);
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        require("fs").unlinkSync(destPath);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const totalSize = parseInt(res.headers["content-length"] || "0", 10);
      let downloaded = 0;
      res.on("data", (chunk) => {
        downloaded += chunk.length;
        if (totalSize > 0) {
          const pct = Math.round((downloaded / totalSize) * 100);
          process.stderr.write(`\r[kv-code] Downloading binary... ${pct}%`);
        }
      });
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        if (totalSize > 0) process.stderr.write("\n");
        resolve();
      });
    }).on("error", (err) => {
      file.close();
      require("fs").unlinkSync(destPath);
      reject(err);
    });
  });
}

async function downloadAndInstall() {
  console.error(`[kv-code] Downloading native binary for ${platform} (${arch})...`);

  let releaseInfo;
  try {
    releaseInfo = await fetchJSON(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
  } catch (err) {
    console.error(`[kv-code] Failed to query GitHub releases: ${err.message}`);
    return false;
  }

  const version = releaseInfo.tag_name || "";
  const assets = releaseInfo.assets || [];

  // Try package archive first
  const packageAssetName = `kv-code-package-${targetTriple}.tar.gz`;

  let assetUrl = null;
  for (const a of assets) {
    if (a.name === packageAssetName) {
      assetUrl = a.browser_download_url;
      break;
    }
  }

  if (!assetUrl) {
    // Try npm platform package as fallback
    const versionNum = version.replace(/^rust-v/, "");
    const os = targetTriple.includes("win32") ? "win32" : targetTriple.includes("darwin") ? "darwin" : "linux";
    const cpu = targetTriple.includes("x86_64") ? "x64" : "arm64";
    const npmAssetName = `kv-code-npm-${os}-${cpu}-${versionNum}.tgz`;
    for (const a of assets) {
      if (a.name === npmAssetName) {
        assetUrl = a.browser_download_url;
        break;
      }
    }
  }

  if (!assetUrl) {
    console.error(`[kv-code] No binary asset found in ${GITHUB_REPO} release ${version}`);
    console.error(`[kv-code] Expected asset: ${packageAssetName}`);
    return false;
  }

  // Download to temp directory
  const tmpDir = path.join(packageRoot, ".tmp-install");
  mkdirSync(tmpDir, { recursive: true });
  const archivePath = path.join(tmpDir, path.basename(assetUrl));

  try {
    console.error(`[kv-code] Downloading from ${GITHUB_REPO}...`);
    await downloadFile(assetUrl, archivePath);

    // Extract archive
    console.error(`[kv-code] Extracting binary...`);
    const extractDir = path.join(tmpDir, "extract");
    mkdirSync(extractDir, { recursive: true });

    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: "pipe" });

    // Find the binary in the extracted structure
    // Package layout: bin/kv-code(.exe), codex-path/rg, etc.
    // NPM layout: package/vendor/{triple}/codex/codex(.exe)
    let srcBinary = null;

    // Try package layout first
    const packageBin = path.join(extractDir, "bin", binaryName);
    if (existsSync(packageBin)) {
      srcBinary = packageBin;
    }

    // Try NPM legacy layout
    if (!srcBinary) {
      const npmVendorBin = path.join(extractDir, "package", "vendor", targetTriple, "kv-code", binaryName);
      if (existsSync(npmVendorBin)) {
        srcBinary = npmVendorBin;
      }
    }

    // Try flat codex binary
    if (!srcBinary) {
      const flatCodex = path.join(extractDir, platform === "win32" ? "codex.exe" : "codex");
      if (existsSync(flatCodex)) {
        srcBinary = flatCodex;
      }
    }

    if (!srcBinary) {
      console.error(`[kv-code] Could not find binary in downloaded archive`);
      return false;
    }

    // Copy binary to vendor directory
    mkdirSync(vendorDir, { recursive: true });
    require("fs").copyFileSync(srcBinary, binaryPath);
    if (platform !== "win32") {
      execSync(`chmod +x "${binaryPath}"`);
    }

    console.error(`[kv-code] Binary installed to ${binaryPath}`);
    return true;
  } catch (err) {
    console.error(`[kv-code] Failed to install binary: ${err.message}`);
    return false;
  } finally {
    // Cleanup temp files
    try { require("fs").rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const existing = findExistingBinary();
  if (existing) {
    console.error(`[kv-code] Native binary found at ${existing}`);
    process.exit(0);
  }

  const installed = await downloadAndInstall();
  if (installed) {
    process.exit(0);
  }

  console.error("");
  console.error(`[kv-code] Native binary not found for ${platform} (${arch})`);
  console.error(`  The kv-code command will not be available until the binary is installed.`);
  console.error("");
  console.error("  To install manually:");
  console.error("");
  console.error(`  1. Download from GitHub Releases:`);
  console.error(`     https://github.com/${GITHUB_REPO}/releases`);
  console.error("");
  console.error("  2. Build from source:");
  console.error("     cd kv-code-rs && cargo build --release");
  console.error(`     Then copy the binary to:`);
  console.error(`     ${binaryPath}`);
  console.error("");
  process.exit(0);
}

main();
