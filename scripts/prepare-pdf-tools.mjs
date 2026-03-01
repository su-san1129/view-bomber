#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const lockFile = path.join(rootDir, "tools", "pdf-tools.lock.json");
const cacheDir = path.join(rootDir, "tools", "cache");
const stageRoot = path.join(rootDir, "tools", ".staging");
const resourcesBinDir = path.join(rootDir, "resources", "bin");

const SUPPORTED_ARCH = new Set(["x64", "arm64"]);
const TOOLS = ["pandoc", "tectonic"];

function resolvePlatform() {
  const arch = process.arch;
  if (!SUPPORTED_ARCH.has(arch)) {
    throw new Error(`Unsupported arch: ${arch}. Supported: x64, arm64.`);
  }

  if (process.platform === "darwin") {
    return { lockTarget: `macos-${arch}`, binDir: "macos", arch };
  }
  if (process.platform === "linux") {
    return { lockTarget: `linux-${arch}`, binDir: "linux", arch };
  }
  if (process.platform === "win32") {
    if (arch === "arm64") {
      return { lockTarget: "windows-x64", binDir: "windows", arch, fallback: true };
    }
    return { lockTarget: `windows-${arch}`, binDir: "windows", arch };
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function sha256Hex(buffer) {
  const hash = createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
    });
  });
}

async function downloadWithRetry(url, attempts = 2) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while downloading ${url}`);
      }
      const data = Buffer.from(await response.arrayBuffer());
      return data;
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(`[prepare-pdf-tools] download retry ${i}/${attempts - 1}: ${url}`);
      }
    }
  }
  throw lastErr;
}

async function ensureArchive(toolName, target, targetConfig) {
  await ensureDir(cacheDir);

  const fileName = path.basename(new URL(targetConfig.url).pathname);
  const archivePath = path.join(cacheDir, `${toolName}-${target}-${fileName}`);

  if (await fileExists(archivePath)) {
    const existing = await fs.readFile(archivePath);
    const currentSha = sha256Hex(existing);
    if (currentSha === targetConfig.sha256) {
      return archivePath;
    }
    await fs.rm(archivePath, { force: true });
  }

  console.log(`[prepare-pdf-tools] downloading ${toolName} for ${target}`);
  const archiveBuffer = await downloadWithRetry(targetConfig.url);
  const actualSha = sha256Hex(archiveBuffer);
  if (actualSha !== targetConfig.sha256) {
    throw new Error(
      `${toolName} sha256 mismatch for ${target}. expected=${targetConfig.sha256} actual=${actualSha}`
    );
  }

  const tempPath = `${archivePath}.tmp`;
  await fs.writeFile(tempPath, archiveBuffer);
  await fs.rename(tempPath, archivePath);
  return archivePath;
}

async function extractArchive(archivePath, archiveType, destinationDir) {
  await fs.rm(destinationDir, { recursive: true, force: true });
  await ensureDir(destinationDir);

  if (archiveType === "tar.gz") {
    await runCommand("tar", ["-xzf", archivePath, "-C", destinationDir]);
    return;
  }
  if (archiveType === "tar.xz") {
    await runCommand("tar", ["-xJf", archivePath, "-C", destinationDir]);
    return;
  }
  if (archiveType === "zip") {
    if (process.platform === "win32") {
      await runCommand("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path \"${archivePath}\" -DestinationPath \"${destinationDir}\" -Force`
      ]);
      return;
    }

    try {
      await runCommand("unzip", ["-q", archivePath, "-d", destinationDir]);
      return;
    } catch {
      await runCommand("tar", ["-xf", archivePath, "-C", destinationDir]);
      return;
    }
  }

  throw new Error(`Unsupported archiveType: ${archiveType}`);
}

async function walkFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

async function findExtractedBinary(extractDir, executableName) {
  const files = await walkFiles(extractDir);
  const normalized = process.platform === "win32"
    ? executableName.toLowerCase()
    : executableName;

  const matches = files
    .filter((filePath) => {
      const fileName = path.basename(filePath);
      const checkName = process.platform === "win32" ? fileName.toLowerCase() : fileName;
      return checkName === normalized;
    })
    .sort((a, b) => a.length - b.length);

  return matches[0] ?? null;
}

async function verifyExecutable(binaryPath) {
  const args = ["--version"];
  await runCommand(binaryPath, args);
}

async function copyBinary(sourcePath, destinationPath) {
  await ensureDir(path.dirname(destinationPath));
  await fs.copyFile(sourcePath, destinationPath);
  if (process.platform !== "win32") {
    await fs.chmod(destinationPath, 0o755);
  }
}

function binaryName(toolName) {
  if (process.platform === "win32") {
    return `${toolName}.exe`;
  }
  return toolName;
}

async function main() {
  const platform = resolvePlatform();
  if (platform.fallback) {
    console.warn(
      "[prepare-pdf-tools] windows-arm64 host detected; using windows-x64 assets (x64 emulation required)."
    );
  }

  const lock = await readJson(lockFile);
  if (lock.schemaVersion !== 1) {
    throw new Error(`Unsupported lock schemaVersion: ${lock.schemaVersion}`);
  }

  await ensureDir(stageRoot);
  await ensureDir(resourcesBinDir);

  for (const toolName of TOOLS) {
    const tool = lock.tools?.[toolName];
    if (!tool) {
      throw new Error(`Missing lock entry for tool: ${toolName}`);
    }

    const targetConfig = tool.targets?.[platform.lockTarget];
    if (!targetConfig) {
      throw new Error(`No lock target for ${toolName}: ${platform.lockTarget}`);
    }

    const archivePath = await ensureArchive(toolName, platform.lockTarget, targetConfig);
    const extractionDir = path.join(stageRoot, `${toolName}-${platform.lockTarget}`);
    await extractArchive(archivePath, targetConfig.archiveType, extractionDir);

    const fileName = binaryName(toolName);
    const sourceBinary = await findExtractedBinary(extractionDir, fileName);
    if (!sourceBinary) {
      throw new Error(`Could not locate extracted binary: ${fileName} in ${extractionDir}`);
    }

    const outputBinary = path.join(resourcesBinDir, platform.binDir, fileName);
    await copyBinary(sourceBinary, outputBinary);
    await verifyExecutable(outputBinary);
    console.log(`[prepare-pdf-tools] ready: ${outputBinary}`);
  }

  console.log("[prepare-pdf-tools] completed.");
}

main().catch((err) => {
  console.error(`[prepare-pdf-tools] failed: ${String(err)}`);
  process.exit(1);
});
