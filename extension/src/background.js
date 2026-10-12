import { startBackup } from './backup.js';
import { extractFromTab } from './page.js';
import { findByUrl, getState, saveProduct, updateProduct } from './store.js';

const MENU_ID = 'saver-save-page';
const BADGE_OK = '#1f6f5c';
const BADGE_ERROR = '#b3261e';

// Keeps the backup file current when no Saver page is open.
startBackup();

chrome.runtime.onInstalled.addListener(() => {
  // Menus survive updates, so start clean instead of failing on a duplicate id.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Save this product to Saver', contexts: ['page', 'image'] });
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

function flashBadge(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2500);
}
