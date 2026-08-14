import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

function dataUrlBytes(dataUrl) { return Math.max(0, Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75)); }
async function sha256(blob) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))).map((value) => value.toString(16).padStart(2, "0")).join(""); }

export class BrowserDocumentRenderer {
  constructor() { this.document = null; this.file = null; this.imageBitmap = null; this.cache = new Map(); }
  async load(file) {
    this.dispose(); this.file = file;
    if (file.size > 20 * 1024 * 1024) throw new Error("File exceeds the 20 MB limit");
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      this.document = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      if (this.document.numPages > 50) throw new Error("Document exceeds the 50-page limit");
      return { pageCount: this.document.numPages, type: "pdf" };
    }
    if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error("Choose a PDF, PNG, or JPEG");
    this.imageBitmap = await createImageBitmap(file);
    return { pageCount: 1, type: "image" };
  }
  async render(pageNumber, dpi = 144) {
    const key = `${pageNumber}:${dpi}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let width, height, draw;
    if (this.document) {
      if (pageNumber < 1 || pageNumber > this.document.numPages) throw new Error("Invalid page number");
      const page = await this.document.getPage(pageNumber), viewport = page.getViewport({ scale: dpi / 72 });
      width = Math.ceil(viewport.width); height = Math.ceil(viewport.height);
      draw = (context) => page.render({ canvasContext: context, viewport }).promise;
    } else {
      if (pageNumber !== 1 || !this.imageBitmap) throw new Error("Invalid image page");
      const scale = Math.min(1, 2200 / Math.max(this.imageBitmap.width, this.imageBitmap.height));
      width = Math.round(this.imageBitmap.width * scale); height = Math.round(this.imageBitmap.height * scale);
      draw = async (context) => context.drawImage(this.imageBitmap, 0, 0, width, height);
    }
    if (width * height > 16_000_000) throw new Error("Rendered page exceeds the 16 MP limit");
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false }); context.fillStyle = "#fff"; context.fillRect(0, 0, width, height); await draw(context);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    const result = { page: pageNumber, dpi, width, height, bytes: blob.size, hash: await sha256(blob), blob, url: URL.createObjectURL(blob), dataUrl: await blobToDataUrl(blob) };
    this.cache.set(key, result); return result;
  }
  async inspect(pageNumber, bbox, options = {}) {
    const dpi = Math.min(500, Math.max(72, Number(options.renderDpi || 400))), scale = Math.min(4, Math.max(1, Number(options.scale || 2))), padding = Math.min(0.1, Math.max(0, Number(options.padding || 0.02)));
    if (!bbox || bbox.width <= 0 || bbox.height <= 0 || bbox.width * bbox.height > 0.5) throw new Error("Invalid or excessive inspection bbox");
    const source = await this.render(pageNumber, dpi), bitmap = await createImageBitmap(source.blob);
    const x = Math.max(0, (bbox.x - padding) * source.width), y = Math.max(0, (bbox.y - padding) * source.height), right = Math.min(source.width, (bbox.x + bbox.width + padding) * source.width), bottom = Math.min(source.height, (bbox.y + bbox.height + padding) * source.height);
    const width = Math.max(1, Math.round((right - x) * scale)), height = Math.max(1, Math.round((bottom - y) * scale));
    if (width * height > 16_000_000) throw new Error("Inspection exceeds the 16 MP limit");
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d", { alpha: false }); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.drawImage(bitmap, x, y, right - x, bottom - y, 0, 0, width, height);
    const original = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const enhancedCanvas = document.createElement("canvas"); enhancedCanvas.width = width; enhancedCanvas.height = height; const enhancedContext = enhancedCanvas.getContext("2d"); enhancedContext.filter = "grayscale(1) contrast(1.35)"; enhancedContext.drawImage(canvas, 0, 0);
    const enhanced = await new Promise((resolve) => enhancedCanvas.toBlob(resolve, "image/png"));
    if (original.size > 8 * 1024 * 1024 || enhanced.size > 8 * 1024 * 1024) throw new Error("Inspection image exceeds the 8 MB limit");
    return { page: pageNumber, bbox, renderDpi: dpi, scale, sourceHash: source.hash, views: [{ kind: "original", dataUrl: await blobToDataUrl(original), bytes: original.size, hash: await sha256(original) }, { kind: "enhanced", dataUrl: await blobToDataUrl(enhanced), bytes: enhanced.size, hash: await sha256(enhanced) }] };
  }
  dispose() { for (const value of this.cache.values()) URL.revokeObjectURL(value.url); this.cache.clear(); this.document?.destroy?.(); this.document = null; this.imageBitmap?.close?.(); this.imageBitmap = null; }
}

function blobToDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
