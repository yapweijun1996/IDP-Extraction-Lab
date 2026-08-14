export class AgentRuntimeClient {
  constructor(renderer, onEvent = () => {}, onArtifact = () => {}) {
    this.renderer = renderer; this.onEvent = onEvent; this.onArtifact = onArtifact; this.pending = new Map(); this.worker = null; this.sequence = 0;
  }
  start() {
    this.stop();
    this.worker = new Worker(new URL("./runtime-worker.js", document.baseURI));
    this.worker.onmessage = (event) => this.handle(event.data);
    this.worker.onerror = (event) => this.failAll(new Error(event.message || "Agent worker failed"));
  }
  async handle(message) {
    if (message.type === "event") { this.onEvent(message.event); return; }
    if (message.type === "tool_request") {
      try {
        const result = message.tool === "render_page" ? await this.renderer.render(message.args.page, message.args.dpi) : message.tool === "inspect_region" ? await this.renderer.inspect(message.args.page, message.args.bbox, message.args) : (() => { throw new Error("Unknown visual tool"); })();
        const safe = message.tool === "render_page" ? { page: result.page, dpi: result.dpi, width: result.width, height: result.height, bytes: result.bytes, hash: result.hash, dataUrl: result.dataUrl } : result;
        if (message.tool === "inspect_region") this.onArtifact(safe);
        this.worker.postMessage({ type: "tool_result", requestId: message.requestId, result: safe });
      } catch (error) { this.worker.postMessage({ type: "tool_result", requestId: message.requestId, error: String(error?.message || error) }); }
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.error) { const error = new Error(message.error); error.failure = message.failure || null; pending.reject(error); } else pending.resolve(message.result);
  }
  request(type, payload) {
    if (!this.worker) this.start();
    const requestId = `ui_${++this.sequence}`;
    return new Promise((resolve, reject) => { this.pending.set(requestId, { resolve, reject }); this.worker.postMessage({ type, requestId, ...payload }); });
  }
  run(payload) { return this.request("run", payload); }
  testProvider(payload) { return this.request("test_provider", payload); }
  cancel() { this.worker?.postMessage({ type: "cancel" }); }
  stop() { this.worker?.terminate(); this.worker = null; this.failAll(new Error("Agent worker stopped")); }
  failAll(error) { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); }
}
