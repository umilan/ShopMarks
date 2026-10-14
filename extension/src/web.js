// Lets the dashboard run as a plain web page: the web app (PWA) on a phone. It stands in
// for the chrome.* APIs the dashboard uses, keeping the data in this browser's
// localStorage; Dropbox sync (sync.js) shares it with the other devices. Inside the
// extension (or the localhost preview, which brings its own stand-in) it does nothing.
(() => {
  if (globalThis.chrome?.storage) return;
  globalThis.shopMarksWeb = true;

  const KEY = 'shopmarks';
  const listeners = new Set();
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? {};
    } catch {
      return {};
    }
  };
  const notify = (keys) => {
    const changes = Object.fromEntries(keys.map((key) => [key, {}]));
    for (const listener of listeners) listener(changes, 'local');
  };

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
          queueMicrotask(() => notify(Object.keys(items)));
        },
        async remove(keys) {
          const data = read();
          for (const key of [].concat(keys)) delete data[key];
          localStorage.setItem(KEY, JSON.stringify(data));
          queueMicrotask(() => notify([].concat(keys)));
        },
      },
      onChanged: { addListener: (listener) => listeners.add(listener) },
    },
    // A web page cannot read other shops' pages, so nothing to grant.
    permissions: { request: async () => false },
    runtime: { openOptionsPage() {} },
    tabs: { create: ({ url }) => open(url, '_blank', 'noopener') },
  };

  // Another tab of the web app changed the data.
  addEventListener('storage', (event) => {
    if (event.key === KEY) notify(['products', 'lists', 'deleted']);
  });
})();
