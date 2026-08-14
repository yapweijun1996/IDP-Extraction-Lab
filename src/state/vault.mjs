const DB_NAME = "idp-extraction-lab-v1";
const DB_VERSION = 1;
const STORES = ["vault", "provider_credentials", "documents", "runs", "artifacts"];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function base64ToBuffer(value) { const binary = atob(value), bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); return bytes.buffer; }
function serialize(value) { return JSON.stringify(value, (_key, item) => item instanceof ArrayBuffer ? { __idp_array_buffer__: bufferToBase64(item) } : item); }
function deserialize(value) { return JSON.parse(value, (_key, item) => item?.__idp_array_buffer__ ? base64ToBuffer(item.__idp_array_buffer__) : item); }

function requestResult(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

export async function openVault() {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => { for (const store of STORES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: "id" }); };
  const db = await requestResult(request);
  let key = await getRaw(db, "vault", "device-key");
  if (!key?.key) {
    key = { id: "device-key", key: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]), createdAt: new Date().toISOString() };
    await putRaw(db, "vault", key);
  }
  return createApi(db, key.key);
}

function transaction(db, store, mode = "readonly") { return db.transaction(store, mode).objectStore(store); }
function getRaw(db, store, id) { return requestResult(transaction(db, store).get(id)); }
function putRaw(db, store, value) { return requestResult(transaction(db, store, "readwrite").put(value)); }
function deleteRaw(db, store, id) { return requestResult(transaction(db, store, "readwrite").delete(id)); }
function getAllRaw(db, store) { return requestResult(transaction(db, store).getAll()); }

async function encrypt(key, store, id, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`v1:${store}:${id}`);
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : encoder.encode(serialize(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, bytes);
  return { id, version: 1, iv: Array.from(iv), ciphertext, binary: value instanceof ArrayBuffer, updatedAt: new Date().toISOString() };
}

async function decrypt(key, store, record) {
  if (!record) return null;
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv), additionalData: encoder.encode(`v1:${store}:${record.id}`) }, key, record.ciphertext);
  return record.binary ? clear : deserialize(decoder.decode(clear));
}

function createApi(db, key) {
  return {
    async set(store, id, value, index = {}) {
      if (!STORES.includes(store) || store === "vault") throw new Error("Invalid encrypted store");
      const record = await encrypt(key, store, id, value);
      await putRaw(db, store, { ...record, ...index });
      return id;
    },
    async get(store, id) { return decrypt(key, store, await getRaw(db, store, id)); },
    async remove(store, id) { return deleteRaw(db, store, id); },
    async list(store) {
      if (!STORES.includes(store) || store === "vault") throw new Error("Invalid encrypted store");
      return (await getAllRaw(db, store)).map(({ id, updatedAt, provider, status, createdAt }) => ({ id, updatedAt, provider, status, createdAt })).sort((a, b) => String(b.createdAt || b.updatedAt).localeCompare(String(a.createdAt || a.updatedAt)));
    },
    async clearAll() {
      for (const store of STORES.filter((name) => name !== "vault")) await requestResult(transaction(db, store, "readwrite").clear());
    },
    close() { db.close(); }
  };
}

export async function storageHealth() {
  const estimate = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persist?.().catch(() => false);
  const quota = Number(estimate?.quota || 0), usage = Number(estimate?.usage || 0);
  return { persisted: Boolean(persisted), quota, usage, allowed: Math.min(250 * 1024 * 1024, quota ? quota * 0.8 : 250 * 1024 * 1024), available: !quota || usage < quota * 0.8 };
}

export const vaultConstants = { DB_NAME, STORES };
