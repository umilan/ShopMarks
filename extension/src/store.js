// All persistence goes through this module. Records carry ids and timestamps
// so a sync backend can replace chrome.storage later without touching the UI.

// An item can be in several lists (listIds); with none it is unsorted and shows under All
// Items only. Items saved before that carry a single listId, where this id meant no list.
export const DEFAULT_LIST_ID = 'default';
export const NO_LIST_NAME = 'Unsorted';
// The currency prices are shown in, chosen in the dashboard's settings menu.
export const DEFAULT_CURRENCY = 'EUR';
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CZK', 'PLN', 'HUF', 'SEK', 'DKK', 'NOK'];

const TRACKING_PARAM = /^(utm_\w+|gclid|fbclid|msclkid|mc_[ce]id|_ga)$/i;
const EDITABLE_FIELDS = ['title', 'image', 'listIds', 'note'];
const LOCALE = 'sk-SK';
const RATES_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR';
const RATES_MAX_AGE = 12 * 60 * 60 * 1000;

export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

export function storeOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function findByUrl(products, url) {
  const normalized = normalizeUrl(url);
  return products.find((product) => product.url === normalized);
}

// Euro exchange rates from the ECB (via Frankfurter): how much of each currency one euro buys.
// Kept for half a day; an older copy is used while the service can't be reached.
export async function loadRates() {
  const { rates: cached } = await chrome.storage.local.get('rates');
  if (cached && Date.now() - cached.fetchedAt < RATES_MAX_AGE) return cached.values;
  try {
    const response = await fetch(RATES_URL);
    if (!response.ok) throw new Error(`Rates: ${response.status}`);
    const { rates } = await response.json();
    await chrome.storage.local.set({ rates: { values: rates, fetchedAt: Date.now() } });
    return rates;
  } catch {
    return cached?.values ?? {};
  }
}

// The price in euros, or null when its currency has no known rate. A price without a currency counts as euros.
export function toEuro(price, currency, rates = {}) {
  if (price == null) return null;
  if (!currency || currency === 'EUR') return price;
  return rates[currency] ? price / rates[currency] : null;
}

// Prices are shown in the chosen currency the Slovak way ("17,30 €"); a converted one starts
// with "≈". Without a rate for either currency, a price stays in its own currency.
export function formatPrice(price, currency, rates = {}, display = DEFAULT_CURRENCY) {
  if (price == null) return '';
  const from = currency || display;
  const euros = toEuro(price, from, rates);
  const shown = euros == null ? null : display === 'EUR' ? euros : rates[display] ? euros * rates[display] : null;
  try {
    if (shown == null) return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: from }).format(price);
    return `${from !== display ? '≈ ' : ''}${new Intl.NumberFormat(LOCALE, { style: 'currency', currency: display }).format(shown)}`;
  } catch {
    return `${price} ${from}`;
  }
}

// How the current price compares with the price when the product was saved.
export function priceChange(product) {
  const first = product.priceHistory?.[0]?.price;
  if (first == null || product.price == null || first === product.price) return null;
  return { from: first, percent: ((product.price - first) / first) * 100 };
}

// The lists a product is in, for old single-list records too.
export function listsOf(product) {
  if (Array.isArray(product.listIds)) return product.listIds;
  return product.listId && product.listId !== DEFAULT_LIST_ID ? [product.listId] : [];
}

export async function getState() {
  const keys = ['products', 'lists', 'currency', 'lastListIds'];
  const { products = [], lists = [], currency = DEFAULT_CURRENCY, lastListIds = [] } = await chrome.storage.local.get(keys);
  // The lists the popup saved into last time; deleted ones drop out.
  const lastUsed = lastListIds.filter((id) => lists.some((list) => list.id === id));
  return { products, lists, currency, lastListIds: lastUsed };
}

// Where each shop shows its price, as pointed out by the user with the popup's picker:
// { [shop]: { selector, label } } (see picker.js). Used when reading a product page and
// when checking prices.
export async function priceSpots() {
  const { priceSpots: spots = {} } = await chrome.storage.local.get('priceSpots');
  return spots;
}

export async function priceSpotFor(url) {
  return (await priceSpots())[storeOf(url)] ?? null;
}

export async function setPriceSpot(url, spot) {
  const spots = await priceSpots();
  await chrome.storage.local.set({ priceSpots: { ...spots, [storeOf(url)]: spot } });
}

export function rememberLists(listIds) {
  return chrome.storage.local.set({ lastListIds: listIds });
}

export function setCurrency(currency) {
  return chrome.storage.local.set({ currency });
}

export function onChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    // Fresh exchange rates are not a change to the saved data.
    if (area === 'local' && !('rates' in changes)) callback();
  });
}

let queue = Promise.resolve();

// Every write is read-modify-write on the same keys, so writes from one page
// run one at a time; otherwise parallel price checks would overwrite each other.
function mutate(change) {
  const run = queue.then(async () => {
    const data = { products: [], lists: [], deleted: {}, ...(await chrome.storage.local.get(['products', 'lists', 'deleted'])) };
    data.deleted = { products: {}, lists: {}, ...data.deleted };
    // Old single-list records move to listIds on the first write.
    for (const product of data.products) {
      if (!('listId' in product)) continue;
      product.listIds = listsOf(product);
      delete product.listId;
    }
    const result = change(data);
    await chrome.storage.local.set(data);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function setPrice(product, price, currency, at) {
  product.price = price ?? null;
  if (currency !== undefined) product.currency = currency;
  if (price != null && product.priceHistory.at(-1)?.price !== price) {
    product.priceHistory.push({ price, at });
  }
}

function applyPatch(product, patch, at) {
  const { price, currency, ...rest } = patch;
  Object.assign(product, rest, { updatedAt: at });
  if (price !== undefined) setPrice(product, price, currency, at);
}

// Saves a new product, or updates the one already saved under the same URL.
export function saveProduct(draft) {
  const url = normalizeUrl(draft.url);
  const now = Date.now();
  return mutate(({ products }) => {
    let product = products.find((p) => p.url === url);
    if (!product) {
      product = {
        id: crypto.randomUUID(),
        url,
        store: storeOf(url),
        title: url,
        image: null,
        price: null,
        currency: null,
        listIds: [],
        note: '',
        priceHistory: [],
        createdAt: now,
      };
      products.unshift(product);
    }
    const patch = { price: draft.price, currency: draft.currency };
    for (const field of EDITABLE_FIELDS) {
      if (draft[field] !== undefined) patch[field] = draft[field];
    }
    applyPatch(product, patch, now);
    return product;
  });
}

export function updateProduct(id, patch) {
  return mutate(({ products }) => {
    const product = products.find((p) => p.id === id);
    if (product) applyPatch(product, patch, Date.now());
    return product ?? null;
  });
}

// Deletions leave a marker (id → time) so syncing does not bring the item back from
// another device that still has it.
export function removeProduct(id) {
  return mutate((data) => {
    data.products = data.products.filter((p) => p.id !== id);
    data.deleted.products[id] = Date.now();
  });
}

export function createList(name) {
  return mutate(({ lists }) => {
    const now = Date.now();
    const created = { id: crypto.randomUUID(), name: name.trim(), createdAt: now, updatedAt: now };
    lists.push(created);
    return created;
  });
}

export function renameList(id, name) {
  return mutate(({ lists }) => {
    const target = lists.find((l) => l.id === id);
    if (target) Object.assign(target, { name: name.trim(), updatedAt: Date.now() });
  });
}

// Products in a deleted list are kept, in their other lists or unsorted.
export function deleteList(id) {
  return mutate((data) => {
    const now = Date.now();
    data.lists = data.lists.filter((l) => l.id !== id);
    data.deleted.lists[id] = now;
    for (const product of data.products) {
      if (!product.listIds.includes(id)) continue;
      product.listIds = product.listIds.filter((listId) => listId !== id);
      product.updatedAt = now;
    }
  });
}

export async function exportData() {
  const { products = [], lists = [] } = await chrome.storage.local.get(['products', 'lists']);
  return { app: 'saver', version: 1, exportedAt: new Date().toISOString(), lists, products };
}

// Merges an export into what is already saved and returns how many products
// were added. The file comes from disk, so every field is checked.
export function importData(data) {
  if (!Array.isArray(data?.products)) throw new Error('Not a Saver export');
  const now = Date.now();
  return mutate(({ products, lists }) => {
    const listIds = new Set(lists.map((l) => l.id));
    for (const incoming of Array.isArray(data.lists) ? data.lists : []) {
      if (typeof incoming?.id !== 'string' || typeof incoming.name !== 'string' || listIds.has(incoming.id)) continue;
      lists.push({ id: incoming.id, name: incoming.name, createdAt: Number(incoming.createdAt) || now });
      listIds.add(incoming.id);
    }

    const urls = new Set(products.map((p) => p.url));
    const httpUrl = (value) => (typeof value === 'string' && /^https?:\/\//.test(value) ? value : null);
    let added = 0;
    for (const incoming of data.products) {
      const url = httpUrl(incoming?.url);
      if (!url || urls.has(url)) continue;
      const history = Array.isArray(incoming.priceHistory) ? incoming.priceHistory : [];
      products.push({
        id: crypto.randomUUID(),
        url,
        store: storeOf(url),
        title: String(incoming.title ?? url),
        image: httpUrl(incoming.image),
        price: Number.isFinite(incoming.price) ? incoming.price : null,
        currency: typeof incoming.currency === 'string' ? incoming.currency : null,
        listIds: listsOf(incoming).filter((id) => listIds.has(id)),
        note: String(incoming.note ?? ''),
        priceHistory: history.filter((entry) => Number.isFinite(entry?.price) && Number.isFinite(entry?.at)),
        createdAt: Number(incoming.createdAt) || now,
        updatedAt: now,
      });
      urls.add(url);
      added += 1;
    }
    return added;
  });
}

// Syncing (see sync.js). Every device keeps the whole collection; a sync merges the
// copy in the cloud with this one record by record: the more recently changed record
// wins, and a deletion wins over any change made before it.

const changedAt = (record) => record.updatedAt ?? record.createdAt ?? 0;

function mergeRecords(a = [], b = [], gone = {}) {
  const byId = new Map();
  for (const record of [...a, ...b]) {
    const held = byId.get(record.id);
    if (!held || changedAt(record) > changedAt(held)) byId.set(record.id, record);
  }
  return [...byId.values()].filter((record) => !(gone[record.id] >= changedAt(record)));
}

function mergeMarkers(a = {}, b = {}) {
  const merged = { ...a };
  for (const [id, at] of Object.entries(b)) merged[id] = Math.max(merged[id] ?? 0, at);
  return merged;
}

// The same order on every device, so equal data serialises identically.
const byNewest = (x, y) => y.createdAt - x.createdAt || (x.id < y.id ? -1 : 1);
const byOldest = (x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1);

export function mergeData(a = {}, b = {}) {
  const deleted = {
    products: mergeMarkers(a.deleted?.products, b.deleted?.products),
    lists: mergeMarkers(a.deleted?.lists, b.deleted?.lists),
  };
  const products = mergeRecords(a.products, b.products, deleted.products).map((product) => {
    const listIds = listsOf(product);
    const { listId, ...rest } = product;
    return { ...rest, listIds };
  });
  return {
    lists: mergeRecords(a.lists, b.lists, deleted.lists).sort(byOldest),
    products: products.sort(byNewest),
    deleted,
  };
}

export async function syncData() {
  const { products = [], lists = [], deleted = {} } = await chrome.storage.local.get(['products', 'lists', 'deleted']);
  return { products, lists, deleted: { products: {}, lists: {}, ...deleted } };
}

export const sameData = (a, b) =>
  JSON.stringify([a.products, a.lists, a.deleted]) === JSON.stringify([b.products, b.lists, b.deleted]);

// Replaces this device's collection with a merged one. Writes only on a real change:
// every write starts another sync, which then finds nothing to do.
export async function applySyncData(merged) {
  if (sameData(await syncData(), merged)) return false;
  await mutate((data) => Object.assign(data, merged));
  return true;
}
