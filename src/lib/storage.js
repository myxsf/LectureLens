// Local persistence. Documents stay on this machine; nothing is uploaded here.

const DB_NAME = 'lecturelens';
const DB_VERSION = 1;
const DOC_STORE = 'documents';
const META_KEY = 'll-last-session';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        const store = db.createObjectStore(DOC_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

async function withStore(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, mode);
    const store = tx.objectStore(DOC_STORE);
    let result;
    try {
      result = run(store);
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const storageAvailable = () => typeof indexedDB !== 'undefined';

export function saveDocument({ id, name, bytes, notes, page, kind, thread }) {
  return withStore('readwrite', (store) =>
    store.put({
      id,
      name,
      kind: kind || 'pdf',
      bytes: new Uint8Array(bytes),
      notes: notes || [],
      thread: thread || [],
      page: page || 1,
      updatedAt: Date.now(),
    }),
  );
}

export function loadDocument(id) {
  return withStore('readonly', (store) => store.get(id));
}

export function deleteDocument(id) {
  return withStore('readwrite', (store) => store.delete(id)).then(() => {
    if (readLastSession()?.id === id) clearLastSession();
  });
}

// Metadata only: reading every stored PDF just to build the recent list would
// pull hundreds of megabytes into memory.
export async function listDocuments() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, 'readonly');
    const request = tx.objectStore(DOC_STORE).openCursor();
    const meta = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const { bytes, ...rest } = cursor.value;
      meta.push(rest);
      cursor.continue();
    };
    tx.oncomplete = () => resolve(meta.sort((a, b) => b.updatedAt - a.updatedAt));
    tx.onerror = () => reject(tx.error);
  });
}

export function rememberLastSession(id) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {}
}

export function readLastSession() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearLastSession() {
  try {
    localStorage.removeItem(META_KEY);
  } catch {}
}

export async function storageUsage() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.usage || 0;
  } catch {
    return 0;
  }
}
