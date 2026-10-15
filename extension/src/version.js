// Fills every .app-version label with the version from manifest.json ("0.1.0" shows as
// "v0.1"). Extension pages ask chrome.runtime; the web app and the localhost preview have
// none, so they read the same file.
(globalThis.chrome?.runtime?.getManifest
  ? Promise.resolve(chrome.runtime.getManifest())
  : fetch('../manifest.json').then((response) => response.json())
)
  .then(({ version }) => {
    for (const label of document.querySelectorAll('.app-version')) label.textContent = `v${version.replace(/(\.0)+$/, '')}`;
  })
  .catch(() => {});
