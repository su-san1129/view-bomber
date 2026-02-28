#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const strict = process.argv.includes("--strict");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const outputPath = join(rootDir, "THIRD_PARTY_NOTICES.md");
const apacheNoticeOutputPath = join(rootDir, "APACHE_NOTICES.md");

function md(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function normalizeSource(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value.url === "string") {
    return value.url;
  }

  return "";
}

function normalizeLicense(pkg) {
  if (!pkg) {
    return "UNKNOWN";
  }

  if (typeof pkg.license === "string" && pkg.license.trim() !== "") {
    return pkg.license.trim();
  }

  if (
    pkg.license
    && typeof pkg.license === "object"
    && typeof pkg.license.type === "string"
    && pkg.license.type.trim() !== ""
  ) {
    return pkg.license.type.trim();
  }

  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    const values = pkg.licenses
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (entry && typeof entry.type === "string") {
          return entry.type.trim();
        }
        return "";
      })
      .filter(Boolean);

    if (values.length > 0) {
      return values.join(" OR ");
    }
  }

  if (typeof pkg.licenseFile === "string" && pkg.licenseFile.trim() !== "") {
    return `SEE LICENSE FILE (${pkg.licenseFile.trim()})`;
  }

  return "UNKNOWN";
}

function detectLicenseFromFiles(packageDir) {
  const candidates = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "license",
    "license.md",
    "license.txt",
    "COPYING"
  ];

  for (const fileName of candidates) {
    const filePath = join(packageDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8").slice(0, 4000);
    if (/MIT License/i.test(content) || /\bMIT\b/i.test(content)) {
      return "MIT";
    }
    if (/Apache License/i.test(content) || /Apache-2\.0/i.test(content)) {
      return "Apache-2.0";
    }
    if (/BSD/i.test(content)) {
      return "BSD";
    }
    if (/\bISC\b/i.test(content)) {
      return "ISC";
    }
    if (/Mozilla Public License|MPL-2\.0/i.test(content)) {
      return "MPL-2.0";
    }
  }

  return "";
}

function readNoticeTextFromDir(dirPath) {
  const candidates = ["NOTICE", "NOTICE.md", "NOTICE.txt", "notice", "notice.md", "notice.txt"];
  for (const fileName of candidates) {
    const filePath = join(dirPath, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      return {
        fileName,
        content: readFileSync(filePath, "utf8")
      };
    } catch {
      return null;
    }
  }

  return null;
}

function formatNoticeText(rawContent) {
  const normalized = rawContent.replace(/\r\n/g, "\n").trim();
  const maxLength = 20000;
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}\n\n...[truncated]`;
}

function hasApacheLicense(license) {
  return /Apache-2\.0|Apache License/i.test(license);
}

function collectNodePackages() {
  const nodeModulesDir = join(rootDir, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    return [];
  }

  const packagesByKey = new Map();

  function addPackage(dirPath) {
    const packageJsonPath = join(dirPath, "package.json");
    if (!existsSync(packageJsonPath)) {
      return;
    }

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    } catch {
      return;
    }

    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
      return;
    }

    const key = `${pkg.name}@${pkg.version}`;

    const packageJsonLicense = normalizeLicense(pkg);
    const fileDetectedLicense = packageJsonLicense === "UNKNOWN"
      ? detectLicenseFromFiles(dirPath)
      : "";

    const nextPackage = {
      ecosystem: "npm",
      name: pkg.name,
      version: pkg.version,
      license: fileDetectedLicense || packageJsonLicense,
      source: normalizeSource(pkg.repository) || normalizeSource(pkg.homepage),
      packageDir: dirPath
    };

    const previous = packagesByKey.get(key);
    if (!previous) {
      packagesByKey.set(key, nextPackage);
      return;
    }

    const mergedLicense = previous.license === "UNKNOWN" && nextPackage.license !== "UNKNOWN"
      ? nextPackage.license
      : previous.license;
    const mergedSource = previous.source || nextPackage.source;

    packagesByKey.set(key, {
      ...previous,
      license: mergedLicense,
      source: mergedSource
    });
  }

  function walkModules(baseDir) {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === ".bin" || entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = join(baseDir, entry.name);

      if (entry.name.startsWith("@")) {
        walkModules(fullPath);
        continue;
      }

      addPackage(fullPath);

      const nestedNodeModules = join(fullPath, "node_modules");
      if (existsSync(nestedNodeModules) && statSync(nestedNodeModules).isDirectory()) {
        walkModules(nestedNodeModules);
      }
    }
  }

  walkModules(nodeModulesDir);
  return [...packagesByKey.values()];
}

function parseCargoLockPackages() {
  const lockPath = join(rootDir, "src-tauri", "Cargo.lock");
  const raw = readFileSync(lockPath, "utf8");
  const blocks = raw.split("[[package]]\n").slice(1);
  const packages = [];

  for (const block of blocks) {
    const nameMatch = block.match(/^name = "([^"]+)"/m);
    const versionMatch = block.match(/^version = "([^"]+)"/m);
    const sourceMatch = block.match(/^source = "([^"]+)"/m);

    if (!nameMatch || !versionMatch) {
      continue;
    }

    const name = nameMatch[1];
    const version = versionMatch[1];
    const source = sourceMatch ? sourceMatch[1] : "";

    if (name === "view-bomber") {
      continue;
    }

    packages.push({ name, version, source });
  }

  return packages;
}

function extractTomlString(content, key) {
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? match[1].trim() : "";
}

function resolveCargoPackageFromCache(name, version) {
  const registrySrcRoot = join(process.env.HOME ?? "", ".cargo", "registry", "src");
  if (!existsSync(registrySrcRoot)) {
    return null;
  }

  const indexDirs = readdirSync(registrySrcRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(registrySrcRoot, entry.name));

  for (const indexDir of indexDirs) {
    const crateDir = join(indexDir, `${name}-${version}`);
    const cargoTomlPath = join(crateDir, "Cargo.toml");
    if (!existsSync(cargoTomlPath)) {
      continue;
    }

    const cargoToml = readFileSync(cargoTomlPath, "utf8");
    const license = extractTomlString(cargoToml, "license");
    const licenseFile = extractTomlString(cargoToml, "license-file");
    const repository = extractTomlString(cargoToml, "repository");
    const homepage = extractTomlString(cargoToml, "homepage");
    const documentation = extractTomlString(cargoToml, "documentation");

    return {
      license: license || (licenseFile ? `SEE LICENSE FILE (${licenseFile})` : "UNKNOWN"),
      source: repository || homepage || documentation,
      crateDir
    };
  }

  return null;
}

function collectCargoPackagesFromMetadata() {
  const manifestPath = join(rootDir, "src-tauri", "Cargo.toml");
  const metadataRaw = execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--manifest-path", manifestPath],
    {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CARGO_HOME: process.env.CARGO_HOME ?? "/tmp/cargo-home" }
    }
  );

  const metadata = JSON.parse(metadataRaw);

  return metadata.packages
    .filter((pkg) => pkg.name !== "view-bomber")
    .map((pkg) => {
      const cached = resolveCargoPackageFromCache(pkg.name, pkg.version);
      return {
        ecosystem: "cargo",
        name: pkg.name,
        version: pkg.version,
        license: typeof pkg.license === "string" && pkg.license.trim() !== ""
          ? pkg.license.trim()
          : "UNKNOWN",
        source: normalizeSource(pkg.repository)
          || normalizeSource(pkg.homepage)
          || normalizeSource(pkg.documentation)
          || cached?.source
          || "",
        crateDir: cached?.crateDir ?? ""
      };
    });
}

function collectCargoPackages() {
  try {
    return {
      packages: collectCargoPackagesFromMetadata(),
      usedFallback: false
    };
  } catch (error) {
    const fallbackPackages = parseCargoLockPackages().map((pkg) => {
      const cached = resolveCargoPackageFromCache(pkg.name, pkg.version);
      const source = cached?.source
        || (pkg.source.includes("crates.io") ? `https://crates.io/crates/${pkg.name}` : pkg.source);

      return {
        ecosystem: "cargo",
        name: pkg.name,
        version: pkg.version,
        license: cached?.license || "UNKNOWN (cache-miss)",
        source,
        crateDir: cached?.crateDir ?? ""
      };
    });

    console.error("Warning: cargo metadata failed; using Cargo.lock + local cargo cache fallback.");
    console.error(String(error).split("\n")[0]);

    return {
      packages: fallbackPackages,
      usedFallback: true
    };
  }
}

function sortPackages(packages) {
  return [...packages].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) {
      return byName;
    }
    return a.version.localeCompare(b.version);
  });
}

function toTableLines(packages) {
  return [
    "| Name | Version | License | Source |",
    "| --- | --- | --- | --- |",
    ...packages.map((pkg) => {
      const source = pkg.source && pkg.source !== "" ? pkg.source : "-";
      return `| ${md(pkg.name)} | ${md(pkg.version)} | ${md(pkg.license)} | ${md(source)} |`;
    })
  ];
}

function collectApacheNotices(packages) {
  const notices = [];

  for (const pkg of packages) {
    if (!hasApacheLicense(pkg.license)) {
      continue;
    }

    const packageDir = pkg.packageDir || pkg.crateDir;
    if (!packageDir) {
      continue;
    }

    const notice = readNoticeTextFromDir(packageDir);
    if (!notice) {
      continue;
    }

    notices.push({
      ecosystem: pkg.ecosystem,
      name: pkg.name,
      version: pkg.version,
      source: pkg.source || "-",
      noticeFile: notice.fileName,
      noticeText: formatNoticeText(notice.content)
    });
  }

  return sortPackages(notices);
}

const npmPackages = sortPackages(collectNodePackages());
const cargoResult = collectCargoPackages();
const cargoPackages = sortPackages(cargoResult.packages);
const allPackages = [...npmPackages, ...cargoPackages];
const unknownPackages = allPackages.filter(
  (pkg) => pkg.license === "UNKNOWN" || pkg.license.startsWith("UNKNOWN (")
);

const lines = [
  "# Third-Party Notices",
  "",
  "This file is generated by `bun run licenses:generate`.",
  "",
  "## JavaScript (npm)",
  "",
  ...toTableLines(npmPackages),
  "",
  "## Rust (Cargo)",
  "",
  ...toTableLines(cargoPackages),
  ""
];

if (cargoResult.usedFallback) {
  lines.push(
    "> Note: Rust package data was resolved from `Cargo.lock` + local cargo cache because `cargo metadata` was unavailable in this environment."
  );
  lines.push("");
}

if (unknownPackages.length > 0) {
  lines.push("## Packages With Unknown License");
  lines.push("");
  lines.push(...toTableLines(sortPackages(unknownPackages)));
  lines.push("");
}

writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${outputPath}`);

const apacheNotices = collectApacheNotices(allPackages);
const apacheLines = [
  "# Apache Notices",
  "",
  "This file is generated by `bun run licenses:generate`.",
  "",
  "Includes NOTICE file contents detected from local dependency sources for packages using Apache licensing.",
  ""
];

if (apacheNotices.length === 0) {
  apacheLines.push("No Apache NOTICE files were detected in the current environment.");
  apacheLines.push("");
} else {
  for (const entry of apacheNotices) {
    apacheLines.push(`## ${entry.ecosystem}: ${entry.name}@${entry.version}`);
    apacheLines.push("");
    apacheLines.push(`- Source: ${entry.source}`);
    apacheLines.push(`- NOTICE file: ${entry.noticeFile}`);
    apacheLines.push("");
    apacheLines.push("```text");
    apacheLines.push(entry.noticeText);
    apacheLines.push("```");
    apacheLines.push("");
  }
}

writeFileSync(apacheNoticeOutputPath, `${apacheLines.join("\n")}\n`, "utf8");
console.log(`Wrote ${apacheNoticeOutputPath}`);

if (strict && cargoResult.usedFallback) {
  console.error(
    "Cargo license scan used fallback mode. Run again in an environment where `cargo metadata` succeeds."
  );
  process.exit(1);
}

if (strict && unknownPackages.length > 0) {
  console.error(
    `Found ${unknownPackages.length} package(s) with UNKNOWN license. Update metadata or allow-list exceptions.`
  );
  process.exit(1);
}
