import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("dist");
const forbiddenNames = [/\.cfm$/i, /^\.env/i, /SCAN_Popular_PO/i, /golden.*\.(pdf|json)$/i];
const forbiddenText = [/D:\\globe3/i, /v50foldersetadmin/i, /<cf(?:include|script|set|query)/i, /sk-[A-Za-z0-9_-]{20,}/, /AIza[A-Za-z0-9_-]{20,}/];

async function filesAt(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesAt(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
}

const files = await filesAt(root), problems = [];
for (const file of files) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (forbiddenNames.some((pattern) => pattern.test(path.basename(file)))) problems.push(`Forbidden file: ${relative}`);
  if (!/\.(?:html|js|mjs|css|json|webmanifest|svg)$/i.test(file) || relative === "vendor/agrun.js") continue;
  const text = await fs.readFile(file, "utf8");
  for (const pattern of forbiddenText) if (pattern.test(text)) problems.push(`Forbidden content ${pattern} in ${relative}`);
  if (relative.endsWith(".html")) for (const match of text.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//gi)) problems.push(`Remote script/style reference in ${relative}: ${match[0].slice(0, 100)}`);
}
if (!files.some((file) => file.endsWith(".nojekyll"))) problems.push("Missing .nojekyll");
if (!files.some((file) => file.endsWith("samples\\SYN_USD_PO_TEST001.pdf") || file.endsWith("samples/SYN_USD_PO_TEST001.pdf"))) problems.push("Missing synthetic sample PDF");
if (!files.some((file) => file.endsWith("assets\\idp-extraction-lab-logo.png") || file.endsWith("assets/idp-extraction-lab-logo.png"))) problems.push("Missing official Lab logo asset");
for (const icon of ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-192-maskable.png", "icons/icon-512-maskable.png"]) if (!files.some((file) => path.relative(root, file).replaceAll("\\", "/") === icon)) problems.push(`Missing PWA logo: ${icon}`);
for (const asset of ["runtime-worker.js", "localization.js", "validation-core.js", "provider-client.js", "inspection-action-config.js"]) if (!files.some((file) => path.relative(root, file).replaceAll("\\", "/") === asset)) problems.push(`Missing Worker runtime asset: ${asset}`);
if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1; } else console.log(`Static artifact scan passed (${files.length} files).`);
