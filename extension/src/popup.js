import { extractFromTab } from './page.js';
import { DEFAULT_LIST_ID, NO_LIST_NAME, createList, findByUrl, formatPrice, getState, loadRates, removeProduct, saveProduct, storeOf } from './store.js';

const $ = (id) => document.getElementById(id);
const NEW_LIST = 'new';

let draft = null;
let saved = null;
let images = [];
let imageIndex = 0;

$('open-dashboard').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('prev-image').addEventListener('click', () => showImage(imageIndex - 1));
$('next-image').addEventListener('click', () => showImage(imageIndex + 1));
$('list').addEventListener('change', toggleNewList);
$('save-form').addEventListener('submit', save);
$('remove').addEventListener('click', remove);

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { products, lists } = await getState();
  $('count').textContent = products.length;

  try {
    draft = await extractFromTab(tab.id);
  } catch {
    // Browser pages, the Web Store and PDFs don't allow scripts.
    $('message').textContent = 'Open a product page in an online shop, then click ShopMarks to save it.';
    return;
  }

  saved = findByUrl(products, draft.url) ?? null;
  images = [...new Set([saved?.image, ...draft.images].filter(Boolean))];

  $('title').value = saved?.title ?? draft.title;
  $('price').value = draft.price ?? saved?.price ?? '';
  $('currency').value = draft.currency ?? saved?.currency ?? '';
  $('note').value = saved?.note ?? '';
  $('store').textContent = storeOf(draft.url);
  $('hint').hidden = draft.isProduct || Boolean(saved);

  $('list').append(new Option(NO_LIST_NAME, DEFAULT_LIST_ID));
  for (const list of lists) $('list').append(new Option(list.name, list.id));
  $('list').append(new Option('+ New list', NEW_LIST));
  $('list').value = saved?.listId ?? DEFAULT_LIST_ID;

  showImage(0);
  showSavedState();
  if (saved?.price != null && draft.price != null && saved.price !== draft.price) {
    const rates = await loadRates();
    const before = formatPrice(saved.price, saved.currency, rates);
    const now = formatPrice(draft.price, draft.currency ?? saved.currency, rates);
    $('status').textContent = `Price changed since you saved it: ${before} → ${now}. Update to record it.`;
  }

  $('message').hidden = true;
  $('save-form').hidden = false;
}

function showImage(index) {
  imageIndex = (index + images.length) % images.length || 0;
  $('image').hidden = images.length === 0;
  $('pager').hidden = images.length < 2;
  if (images.length) $('image').src = images[imageIndex];
  $('image-index').textContent = `${imageIndex + 1} / ${images.length}`;
}

function toggleNewList() {
  const creating = $('list').value === NEW_LIST;
  $('new-list-field').hidden = !creating;
  $('new-list-name').required = creating;
  if (creating) $('new-list-name').focus();
}

function showSavedState() {
  $('save').textContent = saved ? 'Update' : 'Save';
  $('remove').hidden = !saved;
}

async function save(event) {
  event.preventDefault();
  if ($('list').value === NEW_LIST) {
    const list = await createList($('new-list-name').value);
    $('list').lastElementChild.before(new Option(list.name, list.id));
    $('list').value = list.id;
    $('new-list-name').value = '';
    toggleNewList();
  }

  saved = await saveProduct({
    url: draft.url,
    title: $('title').value.trim(),
    image: images[imageIndex] ?? null,
    price: globalThis.SaverExtract.parsePrice($('price').value),
    currency: $('currency').value.trim().toUpperCase() || null,
    listId: $('list').value,
    note: $('note').value.trim(),
  });

  const { products } = await getState();
  $('count').textContent = products.length;
  showSavedState();
  $('status').textContent = 'Saved ✓';
}

async function remove() {
  await removeProduct(saved.id);
  saved = null;
  const { products } = await getState();
  $('count').textContent = products.length;
  showSavedState();
  $('status').textContent = 'Removed.';
}
