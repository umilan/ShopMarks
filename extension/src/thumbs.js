// Small copies of the item pictures, kept in Dropbox (Apps/<app>/thumbs/) and on each
// device (IndexedDB), so pictures show offline and survive the shop removing them.
// A copy is named after its picture's address, so a changed picture simply gets a new
// file and copies no item points to any more are deleted. The extension makes the copies
// (it may read pictures from any shop it has access to); every device downloads the ones
// it lacks, which is how the web app gets them.

import { getState } from './store.js';
import { apiResponse, dropboxStatus } from './sync.js';

const FOLDER = '/thumbs';
const DB_NAME = 'shopmarks-thumbs';
const DB_STORE = 'thumbs';
const LOCK = 'shopmarks-thumbs';
const SIZE = 480;
const QUALITY = 0.8;
const AT_ONCE = 3;
// A picture that could not be read is tried again after this long.
const RETRY_AFTER = 3 * 24 * 60 * 60 * 1000;
const NOTICE_DELAY = 500;
// Pages showing the pictures hear about new copies, from the background worker too. A
// channel does not deliver to its own sender, so this page is told separately.
const channel = new BroadcastChannel('shopmarks-thumbs');
const here = new EventTarget();
const notify = () => {
  channel.postMessage('changed');
  here.dispatchEvent(new Event('changed'));
};

// { [name]: { url, blob, at } }; blob is null when the picture could not be read at `at`.
function db(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = run(open.result.transaction(DB_STORE, mode).objectStore(DB_STORE));
      open.result.close(); // Once the request is done; an open connection would block upgrades.
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}

const allLocal = () =>
  Promise.all([db('readonly', (store) => store.getAllKeys()), db('readonly', (store) => store.getAll())]).then(([keys, values]) =>
    new Map(keys.map((key, index) => [key, values[index]])),
  );
const putLocal = (name, value) => db('readwrite', (store) => store.put(value, name));
const removeLocal = (name) => db('readwrite', (store) => store.delete(name));

// The file name for a picture address: part of its SHA-256, so it is the same on every device.
async function nameOf(url) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 32)}.webp`;
}

// Picture address → object URL of its copy, for showing. Call again after onThumbsChange.
let shown = new Map();
export async function loadThumbs() {
  const local = await allLocal().catch(() => new Map());
  for (const url of shown.values()) URL.revokeObjectURL(url);
  shown = new Map([...local.values()].filter((entry) => entry.blob).map((entry) => [entry.url, URL.createObjectURL(entry.blob)]));
}

export const thumbFor = (imageUrl) => shown.get(imageUrl);

// Called once after a burst of new copies (a first run brings hundreds).
export function onThumbsChange(callback) {
  let timer;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(callback, NOTICE_DELAY);
  };
  channel.addEventListener('message', later);
  here.addEventListener('changed', later);
}

// Brings Dropbox and this device to the pictures the items use now. One run at a time per
// browser; a run already going covers this call.
export function syncThumbs() {
  return navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock || (await dropboxStatus()).state !== 'on') return;
    const { products } = await getState();
    const wanted = new Map();
    for (const product of products) if (product.image) wanted.set(await nameOf(product.image), product.image);
    const [local, remote] = await Promise.all([allLocal(), listRemote()]);

    const pending = [...wanted];
    const worker = async () => {
      for (let next = pending.shift(); next; next = pending.shift()) {
        const [name, url] = next;
        try {
          if (await bring(name, url, local.get(name), remote)) notify();
        } catch (error) {
          console.error(error);
        }
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));

    // Copies of pictures no item uses any more.
    const unused = [...remote].filter((name) => !wanted.has(name));
    if (unused.length) await removeRemote(unused);
    const gone = [...local.keys()].filter((name) => !wanted.has(name));
    for (const name of gone) await removeLocal(name);
    if (gone.length) notify();
  });
}

// Gets one copy to both places. True when this device gained a copy.
async function bring(name, url, held, remote) {
  if (held?.blob) {
    if (!remote.has(name)) await uploadThumb(name, held.blob);
    return false;
  }
  if (remote.has(name)) {
    const blob = await downloadThumb(name);
    if (!blob) return false;
    await putLocal(name, { url, blob, at: Date.now() });
    return true;
  }
  if (held && Date.now() - held.at < RETRY_AFTER) return false;
  const blob = await makeThumb(url);
  await putLocal(name, { url, blob, at: Date.now() });
  if (!blob) return false;
  await uploadThumb(name, blob);
  return true;
}

// The picture scaled down to fit SIZE × SIZE (never up), as WebP; null when it cannot be read.
// The extension reads any shop it has access to; elsewhere only pictures the shop allows.
async function makeThumb(url) {
  try {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(1, SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
    // A browser without WebP output gives PNG, which is too big to keep.
    return blob.type === 'image/webp' ? blob : null;
  } catch {
    return null;
  }
}

// After access to all shops was granted: pictures that failed before are tried at once.
export async function retryFailedThumbs() {
  for (const [name, entry] of await allLocal()) if (!entry.blob) await removeLocal(name);
}

// Dropbox

async function listRemote() {
  const names = new Set();
  let response = await apiResponse('https://api.dropboxapi.com/2/files/list_folder', { body: JSON.stringify({ path: FOLDER }), json: true });
  if (response.status === 409) return names; // No folder yet.
  for (;;) {
    if (!response.ok) throw new Error(`Dropbox list: ${response.status}`);
    const page = await response.json();
    for (const entry of page.entries) if (entry['.tag'] === 'file') names.add(entry.name);
    if (!page.has_more) return names;
    response = await apiResponse('https://api.dropboxapi.com/2/files/list_folder/continue', { body: JSON.stringify({ cursor: page.cursor }), json: true });
  }
}

async function downloadThumb(name) {
  const response = await apiResponse('https://content.dropboxapi.com/2/files/download', { arg: { path: `${FOLDER}/${name}` } });
  if (response.status === 409) return null; // Deleted in between.
  if (!response.ok) throw new Error(`Dropbox download: ${response.status}`);
  return new Blob([await response.arrayBuffer()], { type: 'image/webp' });
}

async function uploadThumb(name, blob) {
  const response = await apiResponse('https://content.dropboxapi.com/2/files/upload', {
    arg: { path: `${FOLDER}/${name}`, mode: 'overwrite', mute: true },
    body: blob,
    contentType: 'application/octet-stream',
  });
  if (!response.ok) throw new Error(`Dropbox upload: ${response.status}`);
}

async function removeRemote(names) {
  const entries = names.map((name) => ({ path: `${FOLDER}/${name}` }));
  const response = await apiResponse('https://api.dropboxapi.com/2/files/delete_batch', { body: JSON.stringify({ entries }), json: true });
  if (!response.ok) throw new Error(`Dropbox delete: ${response.status}`);
}
