import test from "node:test";
import assert from "node:assert/strict";
import { ProgressiveThumbnailQueue } from "../src/ui/thumbnail-queue.mjs";

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for thumbnail queue");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test("all document thumbnails render progressively without page navigation", async () => {
  const states = new Map();
  const queue = new ProgressiveThumbnailQueue({
    render: async (page) => ({ page, url: `blob:page-${page}` }),
    onState: (page, state) => states.set(page, state),
    yieldControl: async () => {}
  });
  queue.reset(12);
  await waitFor(() => [...states.values()].filter((state) => state.status === "ready").length === 12);
  assert.deepEqual([...states.keys()], Array.from({ length: 12 }, (_, index) => index + 1));
});

test("one thumbnail failure does not stop later pages", async () => {
  const states = new Map();
  const queue = new ProgressiveThumbnailQueue({
    render: async (page) => { if (page === 3) throw new Error("render failed"); return { page }; },
    onState: (page, state) => states.set(page, state),
    yieldControl: async () => {}
  });
  queue.reset(5);
  await waitFor(() => states.get(5)?.status === "ready");
  assert.equal(states.get(3).status, "error");
  assert.equal(states.get(4).status, "ready");
});

test("reset prevents an old document render from publishing into the new document", async () => {
  const published = [];
  let releaseOld;
  const oldRender = new Promise((resolve) => { releaseOld = resolve; });
  const queue = new ProgressiveThumbnailQueue({
    render: async (page, generation) => generation === 1 ? oldRender : { page, generation },
    onState: (page, state, generation) => published.push({ page, status: state.status, generation }),
    yieldControl: async () => {}
  });
  queue.reset(1);
  queue.reset(2);
  releaseOld({ page: 1, generation: 1 });
  await waitFor(() => published.some((event) => event.generation === 2 && event.page === 2 && event.status === "ready"));
  assert.equal(published.some((event) => event.generation === 1 && event.status === "ready"), false);
});

test("a failed page can be prioritized and retried", async () => {
  const states = new Map();
  let attempts = 0;
  const queue = new ProgressiveThumbnailQueue({
    render: async (page) => { attempts += 1; if (attempts === 1) throw new Error("temporary"); return { page }; },
    onState: (page, state) => states.set(page, state),
    yieldControl: async () => {}
  });
  queue.reset(1);
  await waitFor(() => states.get(1)?.status === "error");
  queue.prioritize(1);
  await waitFor(() => states.get(1)?.status === "ready");
  assert.equal(attempts, 2);
});
