# ShopMarks — Dropbox sync and the iPhone web app

ShopMarks keeps one file, `Apps/ShopMarks/shopmarks.json`, in your Dropbox. Every device that is connected reads and writes it: the extension on a computer and the web app on a phone. Each sync merges item by item, so changes made on different devices are combined; when the same item was changed in two places, the more recent change wins, and a deletion wins over changes made before it.

## One-time setup

### 1. Create the Dropbox app

1. Open the [Dropbox App Console](https://www.dropbox.com/developers/apps) and click **Create app**.
2. Choose **Scoped access** and **App folder**, and name it (e.g. `ShopMarks`). Dropbox creates `Apps/ShopMarks/` for it; ShopMarks can see nothing else in your Dropbox.
3. **Permissions** tab: tick `files.content.read` and `files.content.write` (`account_info.read` is on already), then **Submit**.
4. **Settings** tab:
   - Keep the **App key** at hand: the first time you choose **Sync with Dropbox**, ShopMarks asks for it.
   - Under **OAuth 2 → Allow public clients (Implicit Grant & PKCE)**, choose **Allow**.
   - Under **OAuth 2 → Redirect URIs**, add both:
     - the extension's: `https://<extension-id>.chromiumapp.org/dropbox` — the ID is on the ShopMarks card in `chrome://extensions`
     - the web app's page, e.g. `https://umilan.github.io/ShopMarks/extension/src/dashboard.html`
5. Reload ShopMarks in `chrome://extensions` (the manifest gained the `identity` permission).

### 2. Put the web app online

The web app is the dashboard page itself, so any static hosting works. With GitHub Pages: repository **Settings → Pages → Deploy from a branch → `main` / root**. After a minute it is at `https://umilan.github.io/ShopMarks/` (the address must match the redirect URI above). The App key is public (it is a "public client"), so it is not a secret; ShopMarks stores it on each device after you paste it once.

### 3. Connect each device

- **Computer:** dashboard → settings menu → **Sync with Dropbox**, and allow access.
- **iPhone:** open the web app address in Safari → Share → **Add to Home Screen**. Open ShopMarks from the Home Screen → settings → **Sync with Dropbox**.

## Using it

- Syncs happen on their own: a couple of seconds after a change, when a ShopMarks page is opened, and when you come back to it. **Sync now** in the settings menu forces one.
- On the phone, the **+** in the top bar adds an item from a link (copy it in Safari, paste it there). The web app cannot read other sites, so it saves the link and opens the item for you to add the title and price; the next **Update prices** on the computer fills in the price.
- **Stop Dropbox sync** disconnects this device; the file stays in Dropbox.

## Limits

- The web app needs a connection to open (no offline copy yet) and cannot check prices.
- Theme, currency and price spots are per device; only items and lists are synced.
- The same product saved on two devices before they synced shows up twice; delete one.
