#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const targetArg = process.argv[2] ?? ".";
const targetPath = resolve(process.cwd(), targetArg);

const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
const child = spawn(bunCommand, ["run", "tauri", "dev", "--", targetPath], {
  cwd: repoRoot,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
