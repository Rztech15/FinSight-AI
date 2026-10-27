// Optional on-device persistence of the loaded file, so a page reload (for example when a phone's file picker
// unloads the tab) does not lose the data. Stored in this browser's IndexedDB only — never sent anywhere —
// expires after 24 hours, and can be switched off or cleared in Settings. Every call fails soft.

const DB = 'finsight.data.v1';
const STORE = 'kv';
const TABLES = 'tables';
const KEY = 'loaded';
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(TABLES)) db.createObjectStore(TABLES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function run(mode, fn, store = STORE) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function saveData(data) {
  try { await run('readwrite', (s) => s.put({ ...data, savedAt: Date.now() }, KEY)); return true; } catch { return false; }
}
export async function loadData(maxAge = MAX_AGE_MS) {
  try {
    const v = await run('readonly', (s) => s.get(KEY));
    if (!v || !v.savedAt || Date.now() - v.savedAt > maxAge) { if (v) await clearData(); return null; }
    return v;
  } catch { return null; }
}
export async function clearData() {
  try { await run('readwrite', (s) => s.delete(KEY)); return true; } catch { return false; }
}

// ---- History: previously analysed files, kept on this device so they can be reopened later ----
const IDX = 'history_index';
export const HISTORY_MAX = 10;
export const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let chain = Promise.resolve();
const serial = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

async function readIndex() {
  try { const v = await run('readonly', (st) => st.get(IDX)); return Array.isArray(v) ? v : []; } catch { return []; }
}
const writeIndex = (list) => run('readwrite', (st) => st.put(list, IDX));
const dropTable = (id) => run('readwrite', (st) => st.delete(id), TABLES);

/** meta: {fp, name, rows, first, last, cash, currency, health, shortfallWeek}; payload: the parsed file + mapping. */
export function saveHistory(meta, payload) {
  return serial(async () => {
    try {
      let list = await readIndex();
      const existing = list.find((x) => x.fp === meta.fp);
      const id = existing?.id || `h_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      list = [{ ...meta, id, savedAt: Date.now() }, ...list.filter((x) => x.id !== id)];
      const evicted = list.splice(HISTORY_MAX);
      await run('readwrite', (st) => st.put(payload, id), TABLES);
      for (const e of evicted) await dropTable(e.id);
      await writeIndex(list);
      return id;
    } catch { return null; }
  });
}
export function listHistory() {
  return serial(async () => {
    const list = await readIndex();
    const now = Date.now();
    const fresh = list.filter((x) => now - x.savedAt <= HISTORY_MAX_AGE_MS);
    if (fresh.length !== list.length) {
      try {
        for (const x of list.filter((y) => !fresh.includes(y))) await dropTable(x.id);
        await writeIndex(fresh);
      } catch { /* ignore */ }
    }
    return fresh;
  });
}
export async function loadHistoryItem(id) {
  try { return (await run('readonly', (st) => st.get(id), TABLES)) || null; } catch { return null; }
}
export function deleteHistoryItem(id) {
  return serial(async () => {
    try { await dropTable(id); await writeIndex((await readIndex()).filter((x) => x.id !== id)); return true; } catch { return false; }
  });
}
export function clearHistory() {
  return serial(async () => {
    try { for (const x of await readIndex()) await dropTable(x.id); await writeIndex([]); return true; } catch { return false; }
  });
}
