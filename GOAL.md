# Saver — goal

## Vision

Save products from the e-shops I visit and have them all in one place.

"One place" starts as a browser extension. Later it is also a web app with login, and later still an iOS / Android app.

Inspiration: Microsoft Shopping assistant and Savelist.

## Phases

1. **Chrome extension (POC)** — current focus.
2. **Safari and Firefox** extensions.
3. **iOS app** with integration in the iPhone share sheet.

Later, not yet scheduled: web app with login, Android app.

## What we take from the inspiration

| App | Ideas worth copying |
| --- | --- |
| Microsoft Shopping assistant | One-click save from the product page, product details read automatically, price history, notice when a saved product's price changes |
| Savelist | Works on any shop, lists, notes, mark as purchased, shareable lists, price-drop alerts, same data on every device |

## Phase 1 scope — Chrome extension

In:

- Save the product on the current page from the toolbar popup, the right-click menu, or `Alt+Shift+S`.
- Read title, image, price and currency automatically (schema.org JSON-LD, Open Graph, microdata, then a visible-price fallback). Everything stays editable before saving.
- Lists, notes.
- A full-page view of everything saved: search, filter, sort, edit, delete.
- Price history per product, with a manual "Check prices" action.
- Export / import as JSON.
- Optional backup folder (a Dropbox folder, for example): a JSON copy of everything, rewritten after every change.

Out (later phases):

- Accounts, login, sync between devices.
- Sharing lists.
- Automatic background price checks and price-drop notifications.
- Coupons, cashback, price comparison across shops.

## Decisions for phase 1

- **Manifest V3, plain JavaScript, no build step.** Load the `extension/` folder directly.
- **Data stays local** in `chrome.storage.local`. All reads and writes go through `extension/src/store.js`, and records carry ids and timestamps, so a sync backend can replace the storage later without touching the UI.
- **Minimal permissions.** The extension only reads a page when I ask it to (`activeTab`). Access to a shop for price checks is requested at the moment I click "Check prices".
- **Product reading lives in one dependency-free file** (`extension/src/extractor.js`) so the Safari / Firefox extensions and the web app can reuse it.

## Status

- [x] Phase 1 POC built
- [ ] Phase 1 tried on real shops, extraction gaps collected
- [ ] Phase 2 — Safari and Firefox
- [ ] Phase 3 — iOS app with share sheet
