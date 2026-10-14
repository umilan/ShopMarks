// Preview only. Stands in for the chrome.* APIs the dashboard uses, so the page
// can run from localhost. Data lives in this origin's localStorage, not in the
// extension's storage.
(() => {
  // A new key starts the preview over with the sample below; data saved under an older
  // key (an older sample format) is left alone.
  const KEY = 'shopmarks-preview-2';
  const DAY = 24 * 60 * 60 * 1000;
  const listeners = new Set();

  function sample() {
    const now = Date.now();
    const product = (index, url, title, prices, currency, listIds = [], note = '') => {
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
        listIds,
        note,
        priceHistory: prices.map((price, step) => ({ price, at: createdAt + step * DAY })),
        createdAt,
        updatedAt: createdAt + prices.length * DAY,
      };
    };
    const HOME = 'sample-home';
    const MUSIC = 'sample-music';
    const GIFTS = 'sample-gifts';
    return {
      lists: [
        { id: HOME, name: 'Home office', createdAt: now - 30 * DAY, updatedAt: now - 30 * DAY },
        { id: MUSIC, name: 'Music gear', createdAt: now - 20 * DAY, updatedAt: now - 20 * DAY },
        { id: GIFTS, name: 'Gift ideas', createdAt: now - 10 * DAY, updatedAt: now - 10 * DAY },
      ],
      products: [
        product(0, 'https://www.ikea.com/sk/sk/p/sample-stool/', 'IKEA PS 2026 height-adjustable stool, birch / light blue', [49.99, 39.99], 'EUR', [HOME], 'For the standing desk. Light blue matches the shelf.'),
        product(1, 'https://www.alza.sk/sample-label-tape.htm', 'Label tape 45013 for Dymo printers, 12 mm, black on white', [7.9], 'EUR', [HOME], 'Check that it fits the LabelManager 160.'),
        product(2, 'https://hudba.bazos.sk/inzerat/sample/novation-launchpad-pro.php', 'Novation Launchpad Pro', [180, 195], 'EUR', [MUSIC], 'Seller in Bratislava, ask if the power adapter is included.'),
        product(3, 'https://www.aliexpress.com/item/sample.html', 'USB-C hub, 7 ports, aluminium', [23.4, 21.1, 18.75], 'USD', [HOME, GIFTS], 'Two of these: one for me, one for Peter.'),
        product(4, 'https://www.example.com/product/desk-lamp', 'Desk lamp with a very long product title that has to wrap onto several lines to show how the card copes with it', [], null, [], 'No price on the page yet. A long note too, to see how the stripe on the picture copes when there is more to say than fits on one line.'),
        product(5, 'https://www.thomann.de/sk/sample_headphones.htm', 'Beyerdynamic DT 770 PRO 80 Ohm studio headphones', [139, 125, 119], 'EUR', [MUSIC, GIFTS], 'Birthday idea for Anna. 80 Ohm works without an amp.'),
        product(6, 'https://www.mall.sk/sample-coffee-grinder', 'Hand coffee grinder, ceramic burr', [34.9, 39.9], 'EUR', [GIFTS]),
        product(7, 'https://www.amazon.de/sample-cable-organiser', 'Under-desk cable tray, steel, 60 cm', [24.99], 'EUR', [], 'Measure the desk first: 60 or 80 cm?'),
      ],
    };
  }

  function read() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY));
      if (stored && typeof stored === 'object') return stored;
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
        async remove(keys) {
          const data = read();
          for (const key of [].concat(keys)) delete data[key];
          localStorage.setItem(KEY, JSON.stringify(data));
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
