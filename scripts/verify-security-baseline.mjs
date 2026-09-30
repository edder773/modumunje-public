import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenImageExtensions = new Set([".avif", ".heic", ".heif", ".icns", ".jxl"]);
const secretFilePattern = /(?:^|\/)(?:\.env(?:\..+)?|credentials?(?:\..+)?|secrets?(?:\..+)?|[^/]+\.(?:key|p12|pem|pfx))$/iu;
const sourceLikePattern = /\.(?:cjs|env|js|json|jsx|md|mjs|sh|ts|tsx|toml|ya?ml)$/iu;
const tokenPatterns = [
  /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bAIza[A-Za-z0-9_-]{20,}\b/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
];

function repositoryFiles() {
  return execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${root.replaceAll("\\", "/")}`,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  ).split("\0").filter(Boolean);
}

function hasUnsafeImageSignature(header) {
  if (header.length >= 4 && header.subarray(0, 4).toString("ascii") === "icns") return true;
  if (header.length >= 2 && header[0] === 0xff && header[1] === 0x0a) return true;
  if (
    header.length >= 12
    && header.subarray(0, 12).equals(Buffer.from([0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]))
  ) return true;
  if (header.length < 12 || header.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  return new Set(["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"])
    .has(header.subarray(8, 12).toString("ascii"));
}

const failures = [];
const files = repositoryFiles();
for (const relative of files) {
  const normalized = relative.replaceAll("\\", "/");
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;

  if (secretFilePattern.test(normalized) && normalized !== ".env.example") {
    failures.push(`${normalized}: secret-bearing file names must not be committed`);
  }

  const descriptor = fs.openSync(absolute, "r");
  const header = Buffer.alloc(16);
  const headerBytes = fs.readSync(descriptor, header, 0, header.length, 0);
  fs.closeSync(descriptor);
  const detectedUnsafeImage = hasUnsafeImageSignature(header.subarray(0, headerBytes));
  if (forbiddenImageExtensions.has(path.extname(normalized).toLocaleLowerCase("en-US")) || detectedUnsafeImage) {
    failures.push(`${normalized}: blocked image format is unsafe with the pinned build image parser`);
  }

  const size = fs.statSync(absolute).size;
  if (!sourceLikePattern.test(normalized) || size > 2 * 1024 * 1024) continue;
  const content = fs.readFileSync(absolute, "utf8");
  if (tokenPatterns.some((pattern) => pattern.test(content))) {
    failures.push(`${normalized}: possible committed credential or private key`);
  }
}

const result = {
  checkedRepositoryFiles: files.length,
  forbiddenBuildInputs: failures.length,
  failures: failures.sort(),
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exitCode = 1;
