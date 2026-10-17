// Reads a product page from its address: fetched (needs access to the shop) and run through
// the extractor (extractor.js, loaded by the page as a classic script). Used by the dashboard
// and by the background worker's offscreen page, which has no chrome.storage: the price
// and title spots for the shop are passed in. Null when the page cannot be read.
export async function readPage(url, { priceSpot, titleSpot } = {}) {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) return null;
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    return globalThis.SaverExtract(doc, url, { priceSpot, titleSpot });
  } catch {
    return null;
  }
}
