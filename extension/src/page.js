import { priceSpotFor, titleSpotFor } from './store.js';

// Runs the extractor inside a tab the user has just given us access to. The price and title
// spots remembered for this shop (see picker.js) are passed along.
export async function extractFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const [priceSpot, titleSpot] = await Promise.all([priceSpotFor(tab.url), titleSpotFor(tab.url)]);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/extractor.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (price, title) => globalThis.SaverExtract(document, location.href, { priceSpot: price, titleSpot: title }),
    args: [priceSpot, titleSpot],
  });
  return result;
}

// Lets the user click the price (kind 'price') or the product name (kind 'title') on the
// page; picker.js reports back to the background worker.
export async function startPicker(tabId, kind = 'price') {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (pick) => {
      globalThis.__shopMarksPickKind = pick;
    },
    args: [kind],
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/extractor.js', 'src/picker.js'] });
}
