import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { openVault, vaultConstants } from "../src/state/vault.mjs";

test("vault encrypts credentials and decrypts only through its CryptoKey", async () => {
  const vault = await openVault(); await vault.set("provider_credentials", "gemini", { key: "SENTINEL_SECRET_KEY" }, { provider: "gemini" });
  assert.equal((await vault.get("provider_credentials", "gemini")).key, "SENTINEL_SECRET_KEY");
  const rawDb = await new Promise((resolve, reject) => { const request = indexedDB.open(vaultConstants.DB_NAME); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const raw = await new Promise((resolve, reject) => { const request = rawDb.transaction("provider_credentials").objectStore("provider_credentials").get("gemini"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  assert.ok(raw.ciphertext instanceof ArrayBuffer); assert.equal(JSON.stringify(raw).includes("SENTINEL_SECRET_KEY"), false); vault.close(); rawDb.close();
});

test("clearAll removes encrypted records but retains the device key", async () => { const vault = await openVault(); await vault.set("runs", "run-1", { status: "completed" }); await vault.clearAll(); assert.equal(await vault.get("runs", "run-1"), null); vault.close(); });

test("document ArrayBuffer survives encrypted round trip", async () => { const vault = await openVault(), source = new Uint8Array([37, 80, 68, 70, 45, 49]).buffer; await vault.set("documents", "doc-1", { name: "sample.pdf", bytes: source }); const stored = await vault.get("documents", "doc-1"); assert.equal(stored.name, "sample.pdf"); assert.deepEqual(Array.from(new Uint8Array(stored.bytes)), [37, 80, 68, 70, 45, 49]); vault.close(); });
