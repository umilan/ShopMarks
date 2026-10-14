import { priceSpotFor } from './store.js';

// Runs the extractor inside a tab the user has just given us access to. A price spot
// remembered for this shop (see picker.js) is passed along.
export async function extractFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const priceSpot = await priceSpotFor(tab.url);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/extractor.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (spot) => globalThis.SaverExtract(document, location.href, { priceSpot: spot }),
    args: [priceSpot],
  });
  return result;
}

// Lets the user click the price on the page; picker.js reports back to the background worker.
export async function startPicker(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/extractor.js', 'src/picker.js'] });
}
