import { startBackup } from './backup.js';
import { startDropboxSync } from './sync.js';
import { syncThumbs } from './thumbs.js';
import { extractFromTab } from './page.js';
import { findByUrl, getState, saveProduct, setPriceSpot, setTitleSpot, updateProduct } from './store.js';

const MENU_ID = 'saver-save-page';
const BADGE_OK = '#1f6f5c';
const BADGE_ERROR = '#b3261e';

// Keeps the backup file and the Dropbox copy (with the picture copies) current when no
// ShopMarks page is open.
startBackup();
startDropboxSync(syncThumbs);

chrome.runtime.onInstalled.addListener(() => {
  // Menus survive updates, so start clean instead of failing on a duplicate id.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Save this product to ShopMarks', contexts: ['page', 'image'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  try {
    const draft = await extractFromTab(tab.id);
    const { products } = await getState();
    const saved = findByUrl(products, draft.url);
    if (saved) {
      // Already saved: record the current price, keep what the user edited.
      if (draft.price != null) await updateProduct(saved.id, { price: draft.price, currency: draft.currency ?? saved.currency });
    } else {
      // Right-clicking a picture is a clear statement of which image to keep.
      const image = info.mediaType === 'image' && info.srcUrl ? info.srcUrl : draft.images[0] ?? null;
      await saveProduct({ ...draft, image });
    }
    flashBadge(tab.id, '✓', BADGE_OK);
  } catch {
    flashBadge(tab.id, '!', BADGE_ERROR);
  }
});

// The popup's picker found the price or the product name on a shop page: remember the spot
// for that shop and reopen the popup, which then reads it from there (openPopup needs Chrome 127).
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab) return;
  const save = { 'price-spot': setPriceSpot, 'title-spot': setTitleSpot }[message?.type];
  if (!save) return;
  save(message.url, message.spot)
    .then(() => chrome.action.openPopup?.())
    .catch(() => {});
});

function flashBadge(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2500);
}
