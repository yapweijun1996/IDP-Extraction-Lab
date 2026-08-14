import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requiredFiles = [
  "package.json",
  "package-lock.json",
  "index.html",
  "vite.config.mjs",
  ".gitignore",
  "THIRD_PARTY_NOTICES.md",
  ".github/workflows/pages.yml",
  "assets/idp-extraction-lab-logo.png",
  "vendor/agrun.js",
  "samples/SYN_USD_PO_TEST001.pdf"
];

const problems = [];
const excludedDirectories = new Set(["node_modules", "dist", ".git", ".vite"]);
const textExtensions = new Set([".js", ".mjs", ".json", ".html", ".css", ".md", ".yml", ".yaml"]);

async function listTextFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listTextFiles(absolute));
    else if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

for (const relative of requiredFiles) {
  const absolute = path.join(root, relative);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size === 0) problems.push(`Required file is empty: ${relative}`);
  } catch {
    problems.push(`Missing required file: ${relative}`);
  }
}

const viteConfig = await fs.readFile(path.join(root, "vite.config.mjs"), "utf8");
if (/path\.dirname\(root\)|path\.join\(parent\b|\.\.\/agrun\.js|\.\.\/SYN_USD_PO_TEST001\.pdf/.test(viteConfig)) {
  problems.push("vite.config.mjs still depends on files outside the repository root");
}
if (!/path\.join\(root,\s*["']vendor["'],\s*["']agrun\.js["']\)/.test(viteConfig)) {
  problems.push("vite.config.mjs does not load vendor/agrun.js from this repository");
}
if (!/path\.join\(root,\s*["']samples["'],\s*["']SYN_USD_PO_TEST001\.pdf["']\)/.test(viteConfig)) {
  problems.push("vite.config.mjs does not load the synthetic PDF from this repository");
}

for (const absolute of await listTextFiles(root)) {
  if (absolute.endsWith(path.join("vendor", "agrun.js"))) continue;
  const text = await fs.readFile(absolute, "utf8");
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (/\.\.\/\.\.\/agrun\.js|\.\.\/\.\.\/SYN_USD_PO_TEST001\.pdf|path\.join\(parent\b/.test(text)) {
    problems.push(`Repository file still depends on a parent-directory asset: ${relative}`);
  }
}

const workflow = await fs.readFile(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
for (const requiredText of ["npm ci", "npm run check", "actions/upload-pages-artifact@", "path: dist", "actions/deploy-pages@"]) {
  if (!workflow.includes(requiredText)) problems.push(`Pages workflow is missing: ${requiredText}`);
}

const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
for (const ignored of ["node_modules/", "dist/", "*.log", "tmp-*.png"]) {
  if (!gitignore.split(/\r?\n/).includes(ignored)) problems.push(`.gitignore is missing: ${ignored}`);
}

if (problems.length) {
  console.error(problems.map((problem) => `- ${problem}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Standalone repository verification passed.");
}
