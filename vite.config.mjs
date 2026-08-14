import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const root = path.dirname(fileURLToPath(import.meta.url));
const agrunFile = path.join(root, "vendor", "agrun.js");
const sampleFile = path.join(root, "samples", "SYN_USD_PO_TEST001.pdf");
const officialLogoFile = path.join(root, "assets", "idp-extraction-lab-logo.png");

function isolatedAssets() {
  const files = new Map([
    ["/vendor/agrun.js", agrunFile],
    ["/samples/SYN_USD_PO_TEST001.pdf", sampleFile],
    ["/inspection-action-config.js", path.join(root, "src", "contracts", "inspection-action-config.js")],
    ["/structured-json.js", path.join(root, "src", "validation", "structured-json.js")],
    ["/extraction-prompt.js", path.join(root, "src", "contracts", "extraction-prompt.js")],
    ["/provider-client.js", path.join(root, "src", "providers", "provider-client.js")],
    ["/provider-page-normalizer.js", path.join(root, "src", "providers", "provider-page-normalizer.js")],
    ["/localization.js", path.join(root, "src", "i18n", "localization.js")],
    ["/validation-core.js", path.join(root, "src", "validation", "validation-core.js")],
    ["/runtime-worker.js", path.join(root, "src", "runtime", "runtime-worker.js")]
  ]);
  return {
    name: "idp-isolated-static-assets",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        const source = files.get(pathname);
        if (!source) return next();
        response.setHeader("Content-Type", pathname.endsWith(".pdf") ? "application/pdf" : "text/javascript; charset=utf-8");
        response.end(await fs.readFile(source));
      });
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: "vendor/agrun.js", source: await fs.readFile(agrunFile) });
      this.emitFile({ type: "asset", fileName: "samples/SYN_USD_PO_TEST001.pdf", source: await fs.readFile(sampleFile) });
      this.emitFile({ type: "asset", fileName: "inspection-action-config.js", source: await fs.readFile(path.join(root, "src", "contracts", "inspection-action-config.js")) });
      this.emitFile({ type: "asset", fileName: "structured-json.js", source: await fs.readFile(path.join(root, "src", "validation", "structured-json.js")) });
      this.emitFile({ type: "asset", fileName: "extraction-prompt.js", source: await fs.readFile(path.join(root, "src", "contracts", "extraction-prompt.js")) });
      this.emitFile({ type: "asset", fileName: "provider-client.js", source: await fs.readFile(path.join(root, "src", "providers", "provider-client.js")) });
      this.emitFile({ type: "asset", fileName: "provider-page-normalizer.js", source: await fs.readFile(path.join(root, "src", "providers", "provider-page-normalizer.js")) });
      this.emitFile({ type: "asset", fileName: "localization.js", source: await fs.readFile(path.join(root, "src", "i18n", "localization.js")) });
      this.emitFile({ type: "asset", fileName: "validation-core.js", source: await fs.readFile(path.join(root, "src", "validation", "validation-core.js")) });
      this.emitFile({ type: "asset", fileName: "runtime-worker.js", source: await fs.readFile(path.join(root, "src", "runtime", "runtime-worker.js")) });
      this.emitFile({ type: "asset", fileName: "assets/idp-extraction-lab-logo.png", source: await fs.readFile(officialLogoFile) });
      const logo = await fs.readFile(officialLogoFile);
      for (const size of [192, 512]) {
        const png = await sharp(logo).resize(size, size, { fit: "contain" }).png().toBuffer();
        this.emitFile({ type: "asset", fileName: `icons/icon-${size}.png`, source: png });
        this.emitFile({ type: "asset", fileName: `icons/icon-${size}-maskable.png`, source: png });
      }
      this.emitFile({ type: "asset", fileName: ".nojekyll", source: "" });
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    isolatedAssets(),
    VitePWA({
    // Updates are intentionally user-controlled.  The Lab must never reload
    // while a document, extraction run, or provenance view is open.
    registerType: "prompt",
      strategies: "generateSW",
      includeAssets: ["assets/idp-extraction-lab-logo.png", "icons/*.png", "vendor/agrun.js", "samples/SYN_USD_PO_TEST001.pdf"],
      manifest: {
        name: "IDP Extraction Lab",
        short_name: "IDP Lab",
        description: "Experimental, local-first Agentic document extraction PWA with BYOK providers.",
        id: "./",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        background_color: "#f7f8fc",
        theme_color: "#f7f8fc",
        icons: [
          { src: "./icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "./icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "./icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "./icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ["**/*.{html,css,js,mjs,svg,png,pdf}"],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === "https://api.openai.com" || url.origin === "https://generativelanguage.googleapis.com" || url.origin === "https://gpt.yapweijun1996.com",
            handler: "NetworkOnly",
            method: "POST"
          }
        ]
      }
    })
  ],
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  server: { host: "127.0.0.1" }
});
