import { extractFromTab, startPicker } from './page.js';
import { fillListChoice, chosenLists } from './listchoice.js';
import { findByUrl, formatPrice, getState, listsOf, loadRates, rememberLists, saveProduct } from './store.js';

const $ = (id) => document.getElementById(id);
const SAVED_DELAY = 3000;
// In the popup the no-list state reads as an action.
const NO_LIST_LABEL = 'Save to unsorted';
// popup.html?preview: shown inside the dashboard (click the app title there) with a sample
// product instead of the current tab, and nothing is saved.
const PREVIEW = new URLSearchParams(location.search).has('preview');
// Drawn sample pictures, so the preview shows the image pager too.
const sampleImage = (color, label) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${color}"/><text x="48" y="56" font-family="system-ui" font-size="24" font-weight="600" fill="#fff" text-anchor="middle">${label}</text></svg>`,
  )}`;
const SAMPLE = {
  url: 'https://www.example.com/product/sample-lamp',
  title: 'Sample desk lamp, matte black',
  images: [sampleImage('#8a6142', '1'), sampleImage('#46648a', '2'), sampleImage('#4e3f8a', '3')],
  price: 49.9,
  currency: 'EUR',
  isProduct: true,
};

let draft = null;
// The page's own currency when it has one, otherwise the one chosen in settings.
let currency = null;
let saved = null;
let images = [];
let imageIndex = 0;

$('price-target').addEventListener('click', pickPrice);
$('prev-image').addEventListener('click', () => showImage(imageIndex - 1));
$('next-image').addEventListener('click', () => showImage(imageIndex + 1));
$('save-form').addEventListener('submit', save);

init();

async function init() {
  if (PREVIEW) return initPreview();
  const { products, lists, currency: chosen, lastListIds } = await getState();

  try {
    draft = await extractFromTab((await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  } catch {
    // Browser pages, the Web Store and PDFs don't allow scripts.
    $('message').textContent = 'Open a product page in an online shop, then click ShopMarks to save it.';
    return;
  }

  saved = findByUrl(products, draft.url) ?? null;
  images = [...new Set([saved?.image, ...draft.images].filter(Boolean))];

  $('title').value = saved?.title ?? draft.title;
  $('price').value = draft.price ?? saved?.price ?? '';
  currency = draft.currency ?? saved?.currency ?? chosen;
  $('price-label').textContent = `Price (${currency})`;
  $('price-unit').textContent = currency;
  $('note').value = saved?.note ?? '';
  $('hint').hidden = draft.isProduct || Boolean(saved);

  // A saved item shows its own lists; a new one starts with the lists used last time.
  if (saved) fillListChoice($('lists'), lists, listsOf(saved), NO_LIST_LABEL);
  else fillListChoice($('lists'), lists, lastListIds, NO_LIST_LABEL, { lastUsed: true });

  showImage(0);
  showSavedState();
  if (saved?.price != null && draft.price != null && saved.price !== draft.price) {
    const rates = await loadRates();
    const before = formatPrice(saved.price, saved.currency, rates, chosen);
    const now = formatPrice(draft.price, currency, rates, chosen);
    $('status').textContent = `Price changed since you saved it: ${before} → ${now}. Update to record it.`;
  }

  $('message').hidden = true;
  $('save-form').hidden = false;
  $('save').hidden = false;
}

// The preview never touches a tab: it goes straight to the form with the sample product,
// and works without saved data too.
async function initPreview() {
  $('message').hidden = true;
  draft = SAMPLE;
  const { lists, lastListIds } = await getState().catch(() => ({ lists: [], lastListIds: [] }));
  currency = draft.currency;
  $('price-label').textContent = `Price (${currency})`;
  $('price-unit').textContent = currency;
  $('title').value = draft.title;
  $('price').value = draft.price;
  images = draft.images;
  fillListChoice($('lists'), lists, lastListIds, NO_LIST_LABEL, { lastUsed: true });
  showImage(0);
  showSavedState();
  // Elements that normally appear only in some cases are all shown here.
  $('hint').hidden = false;
  $('save-form').hidden = false;
  $('save').hidden = false;
}

function showImage(index) {
  imageIndex = (index + images.length) % images.length || 0;
  $('image').hidden = images.length === 0;
  $('pager').hidden = images.length < 2;
  if (images.length) $('image').src = images[imageIndex];
  $('image-index').textContent = `${imageIndex + 1} / ${images.length}`;
}

function showSavedState() {
  $('save').textContent = saved ? 'Update' : 'Save';
}

async function save(event) {
  event.preventDefault();
  if (PREVIEW) return ($('status').textContent = 'Preview only, nothing was saved.');
  const listIds = await chosenLists($('lists'));
  await rememberLists(listIds);
  saved = await saveProduct({
    url: draft.url,
    title: $('title').value.trim(),
    image: images[imageIndex] ?? null,
    price: globalThis.SaverExtract.parsePrice($('price').value),
    currency,
    listIds,
    note: $('note').value.trim(),
  });

  // A list named in the new-list box now exists: show it ticked among the others.
  const { lists } = await getState();
  fillListChoice($('lists'), lists, listsOf(saved), NO_LIST_LABEL);
  $('lists').open = false;
  // Confirmed on the button itself, with a bar filling it over 3s; then the popup closes.
  $('status').textContent = '';
  $('save').textContent = 'Saved, closing…';
  $('save').classList.add('button--saved');
  setTimeout(() => window.close(), SAVED_DELAY);
}

// The popup closes once the page is clicked, so the picker takes over from here.
async function pickPrice() {
  if (PREVIEW) return ($('status').textContent = 'Preview only: on a shop page this lets you click the price.');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await startPicker(tab.id);
    window.close();
  } catch {
    $('status').textContent = 'This page does not allow picking.';
  }
}
