// Keeps a copy of everything saved as one JSON file in a folder the user picked
// (a Dropbox folder, for example). chrome.storage stays the source of truth;
// the file is rewritten after every change and is in the Export format, so
// Import… can read it back.

import { exportData, onChange } from './store.js';

export const BACKUP_FILE = 'saver-backup.json';

const DB_NAME = 'saver-backup';
const DB_STORE = 'handles';
const FOLDER_KEY = 'folder';
const LOCK = 'saver-backup-write';
const READWRITE = { mode: 'readwrite' };

// A folder handle can't go into chrome.storage, only into IndexedDB.
function handles(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = run(open.result.transaction(DB_STORE, mode).objectStore(DB_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}

// state is 'off' (no folder), 'on', or 'paused' (the browser wants the user to allow the folder again).
export async function backupStatus() {
  const folder = await handles('readonly', (store) => store.get(FOLDER_KEY));
  if (!folder) return { state: 'off' };
  const granted = (await folder.queryPermission(READWRITE)) === 'granted';
  return { state: granted ? 'on' : 'paused', name: folder.name, folder };
}

// Opens the folder picker and remembers the choice. Returns the backup already
// in that folder, if there is one, so the caller can merge it before it is overwritten.
export async function chooseFolder() {
  const folder = await showDirectoryPicker({ id: 'saver-backup', ...READWRITE });
  let existing = null;
  try {
    const file = await (await folder.getFileHandle(BACKUP_FILE)).getFile();
    existing = JSON.parse(await file.text());
  } catch {
    // No backup there yet, or not one we can read.
  }
  await handles('readwrite', (store) => store.put(folder, FOLDER_KEY));
  return existing;
}

export function forgetFolder() {
  return handles('readwrite', (store) => store.delete(FOLDER_KEY));
}

// Resolves to false when there is no folder or it is not allowed right now.
// The lock keeps the dashboard and the background worker from writing at once.
export function writeBackup() {
  return navigator.locks.request(LOCK, async () => {
    const { state, folder } = await backupStatus();
    if (state !== 'on') return false;
    const file = await folder.getFileHandle(BACKUP_FILE, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(await exportData(), null, 2));
    await writable.close();
    return true;
  });
}

export function startBackup() {
  onChange(() => writeBackup().catch(() => {}));
}
