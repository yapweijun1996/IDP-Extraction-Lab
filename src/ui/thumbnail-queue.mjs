export class ProgressiveThumbnailQueue {
  constructor({ render, onState, yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)) }) {
    if (typeof render !== "function" || typeof onState !== "function") throw new Error("Thumbnail queue requires render and onState callbacks");
    this.render = render;
    this.onState = onState;
    this.yieldControl = yieldControl;
    this.generation = 0;
    this.pages = [];
    this.states = new Map();
    this.runners = new Map();
  }

  reset(pageCount) {
    const generation = ++this.generation;
    this.pages = Array.from({ length: Math.max(0, Number(pageCount) || 0) }, (_, index) => index + 1);
    this.states = new Map(this.pages.map((page) => [page, { status: "pending" }]));
    for (const page of this.pages) this.onState(page, this.states.get(page), generation);
    this.start(generation);
    return generation;
  }

  cancel() {
    this.generation += 1;
    this.pages = [];
    this.states = new Map();
  }

  prioritize(page) {
    const target = Number(page);
    if (!this.states.has(target)) return;
    const state = this.states.get(target);
    if (state.status === "error") this.states.set(target, { status: "pending" });
    if (this.states.get(target).status === "pending") {
      this.pages = [target, ...this.pages.filter((candidate) => candidate !== target)];
      this.start(this.generation);
    }
  }

  start(generation = this.generation) {
    if (generation !== this.generation || this.runners.has(generation)) return;
    const runner = this.drain(generation).finally(() => {
      this.runners.delete(generation);
      if (generation === this.generation && this.pages.some((page) => this.states.get(page)?.status === "pending")) this.start(generation);
    });
    this.runners.set(generation, runner);
  }

  async drain(generation) {
    while (generation === this.generation) {
      const page = this.pages.find((candidate) => this.states.get(candidate)?.status === "pending");
      if (!page) return;
      this.states.set(page, { status: "loading" });
      this.onState(page, this.states.get(page), generation);
      try {
        const result = await this.render(page, generation);
        if (generation !== this.generation) return;
        this.states.set(page, { status: "ready", result });
      } catch (error) {
        if (generation !== this.generation) return;
        this.states.set(page, { status: "error", error: String(error?.message || error) });
      }
      this.onState(page, this.states.get(page), generation);
      await this.yieldControl();
    }
  }
}
