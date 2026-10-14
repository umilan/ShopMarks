// All persistence goes through this module. Records carry ids and timestamps
// so a sync backend can replace chrome.storage later without touching the UI.

export const DEFAULT_LIST_ID = 'default';

const DEFAULT_LIST = { id: DEFAULT_LIST_ID, name: 'Saved' };
const TRACKING_PARAM = /^(utm_\w+|gclid|fbclid|msclkid|mc_[ce]id|_ga)$/i;
const EDITABLE_FIELDS = ['title', 'image', 'listId', 'note'];
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

// Prices are shown in euros the Slovak way ("17,30 €"); a converted one starts with "≈".
// Without a rate for its currency, a price stays in that currency.
export function formatPrice(price, currency, rates) {
  if (price == null) return '';
  const euros = toEuro(price, currency, rates);
  try {
    if (euros == null) return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(price);
    const converted = currency && currency !== 'EUR';
    return `${converted ? '≈ ' : ''}${new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' }).format(euros)}`;
  } catch {
    return `${price} ${currency}`;
  }
}

// How the current price compares with the price when the product was saved.
export function priceChange(product) {
  const first = product.priceHistory?.[0]?.price;
  if (first == null || product.price == null || first === product.price) return null;
  return { from: first, percent: ((product.price - first) / first) * 100 };
}

export async function getState() {
  const { products = [], lists = [] } = await chrome.storage.local.get(['products', 'lists']);
  return { products, lists: [DEFAULT_LIST, ...lists] };
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
    const data = { products: [], lists: [], ...(await chrome.storage.local.get(['products', 'lists'])) };
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
        listId: DEFAULT_LIST_ID,
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

export function removeProduct(id) {
  return mutate((data) => {
    data.products = data.products.filter((p) => p.id !== id);
  });
}

export function createList(name) {
  return mutate(({ lists }) => {
    const created = { id: crypto.randomUUID(), name: name.trim(), createdAt: Date.now() };
    lists.push(created);
    return created;
  });
}

export function renameList(id, name) {
  return mutate(({ lists }) => {
    const target = lists.find((l) => l.id === id);
    if (target) target.name = name.trim();
  });
}

// Products in a deleted list are kept and moved to the default list.
export function deleteList(id) {
  return mutate((data) => {
    data.lists = data.lists.filter((l) => l.id !== id);
    for (const product of data.products) {
      if (product.listId === id) product.listId = DEFAULT_LIST_ID;
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
    const listIds = new Set([DEFAULT_LIST_ID, ...lists.map((l) => l.id)]);
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
        listId: listIds.has(incoming.listId) ? incoming.listId : DEFAULT_LIST_ID,
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
