// Preview only. Stands in for the chrome.* APIs the dashboard uses, so the page
// can run from localhost. Data lives in this origin's localStorage, not in the
// extension's storage.
(() => {
  const KEY = 'saver-preview';
  const DAY = 24 * 60 * 60 * 1000;
  const listeners = new Set();

  function sample() {
    const now = Date.now();
    const product = (index, url, title, prices, currency, listId = 'default', note = '') => {
      const createdAt = now - (index + 1) * 3 * DAY;
      const store = new URL(url).hostname.replace(/^www\./, '');
      return {
        id: `sample-${index}`,
        url,
        store,
        title,
        image: null,
        price: prices.at(-1) ?? null,
        currency,
        listId,
        note,
        priceHistory: prices.map((price, step) => ({ price, at: createdAt + step * DAY })),
        createdAt,
        updatedAt: createdAt + prices.length * DAY,
      };
    };
    return {
      lists: [
        { id: 'sample-home', name: 'Home office', createdAt: now - 20 * DAY },
        { id: 'sample-music', name: 'Music gear', createdAt: now - 10 * DAY },
      ],
      products: [
        product(0, 'https://www.ikea.com/sk/sk/p/sample-stool/', 'IKEA PS 2026 height-adjustable stool, birch / light blue', [49.99, 39.99], 'EUR', 'sample-home'),
        product(1, 'https://www.alza.sk/sample-label-tape.htm', 'Label tape 45013 for Dymo printers, 12 mm, black on white', [7.9], 'EUR', 'sample-home', 'Check that it fits the LabelManager 160.'),
        product(2, 'https://hudba.bazos.sk/inzerat/sample/novation-launchpad-pro.php', 'Novation Launchpad Pro', [180, 195], 'EUR', 'sample-music'),
        product(3, 'https://www.aliexpress.com/item/sample.html', 'USB-C hub, 7 ports, aluminium', [23.4, 21.1, 18.75], 'USD'),
        product(4, 'https://www.example.com/product/desk-lamp', 'Desk lamp with a very long product title that has to wrap onto several lines to show how the card copes with it', [], null),
      ],
    };
  }

  function read() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY));
      if (stored && typeof stored === 'object') {
        // Sample data seeded by an earlier version of this file carried drawn swatch pictures.
        for (const item of stored.products ?? []) {
          if (item.id?.startsWith('sample-') && item.image?.startsWith('data:image/svg')) item.image = null;
        }
        return stored;
      }
    } catch {}
    const seeded = sample();
    localStorage.setItem(KEY, JSON.stringify(seeded));
    return seeded;
  }

  const notify = () => listeners.forEach((listener) => listener({}, 'local'));

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const data = read();
          const wanted = keys == null ? Object.keys(data) : [].concat(keys);
          return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
        },
        async set(items) {
          localStorage.setItem(KEY, JSON.stringify({ ...read(), ...items }));
          queueMicrotask(notify);
        },
      },
      onChanged: { addListener: (listener) => listeners.add(listener) },
    },
    // Granting is harmless here: the page still cannot read other shops from localhost.
    permissions: { request: async () => true },
  };

  // Another preview tab changed the data.
  addEventListener('storage', (event) => {
    if (event.key === KEY) notify();
  });

  // Reload when a file in extension/ changes.
  let seen = null;
  setInterval(async () => {
    try {
      const version = await (await fetch('/__preview/version', { cache: 'no-store' })).text();
      if (seen !== null && version !== seen) location.reload();
      seen = version;
    } catch {}
  }, 700);

  globalThis.saverPreview = {
    reset() {
      localStorage.removeItem(KEY);
      location.reload();
    },
  };
})();
