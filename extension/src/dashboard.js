import { BACKUP_FILE, backupStatus, chooseFolder, forgetFolder, startBackup, writeBackup } from './backup.js';
import {
  DEFAULT_LIST_ID,
  NO_LIST_NAME,
  createList,
  deleteList,
  exportData,
  formatPrice,
  getState,
  importData,
  loadRates,
  onChange,
  priceChange,
  removeProduct,
  renameList,
  toEuro,
  updateProduct,
} from './store.js';

const $ = (id) => document.getElementById(id);
const PRICE_CHECKS_AT_ONCE = 4;
const TOAST_MS = 5000;

const euros = (product) => toEuro(product.price, product.currency, rates);
const comparePrice = (a, b) => (euros(a) ?? Infinity) - (euros(b) ?? Infinity) || 0;
const SORTS = {
  newest: (a, b) => b.createdAt - a.createdAt,
  'price-asc': comparePrice,
  'price-desc': (a, b) => (euros(b) ?? -Infinity) - (euros(a) ?? -Infinity) || 0,
  drop: (a, b) => (priceChange(a)?.percent ?? 0) - (priceChange(b)?.percent ?? 0),
  store: (a, b) => a.store.localeCompare(b.store),
};

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  edit: svg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  delete: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>'),
};

// listId null means "all items".
const view = { listId: null, query: '', sort: 'newest' };
let state = { products: [], lists: [] };
let rates = {};
let toastTimer;
let backup = { state: 'off' };

$('search').addEventListener('input', (event) => setView({ query: event.target.value }));
$('sort').addEventListener('change', (event) => setView({ sort: event.target.value }));
$('new-list').addEventListener('click', newList);
$('rename-list').addEventListener('click', renameCurrentList);
$('delete-list').addEventListener('click', deleteCurrentList);
$('check-prices').addEventListener('click', checkPrices);
$('export').addEventListener('click', exportToFile);
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', importFromFile);
$('backup-choose').addEventListener('click', chooseBackupFolder);
$('backup-resume').addEventListener('click', resumeBackup);
$('backup-stop').addEventListener('click', stopBackup);
$('theme-toggle').addEventListener('click', toggleTheme);

// Each .menu is a toggle plus a sheet. Choosing an item closes it, and so does a click
// anywhere outside it; opening one menu closes the others.
for (const menu of document.querySelectorAll('.menu')) {
  menu.querySelector('.menu__toggle').addEventListener('click', () => setMenu(menu, menu.querySelector('.menu__sheet').hidden));
  menu.querySelector('.menu__sheet').addEventListener('click', () => setMenu(menu, false));
}
document.addEventListener('click', (event) => {
  for (const menu of document.querySelectorAll('.menu')) {
    if (!menu.contains(event.target)) setMenu(menu, false);
  }
});
// Without hover (touch screens) a tap opens a note; a tap anywhere else closes it.
document.addEventListener('click', (event) => {
  if (!matchMedia('(hover: none)').matches) return;
  const tapped = event.target.closest('.card__note');
  for (const note of document.querySelectorAll('.card__note--open')) {
    if (note !== tapped) note.classList.remove('card__note--open');
  }
  tapped?.classList.toggle('card__note--open');
});
document.addEventListener('keydown', (event) => {
  const open = document.querySelector('.menu:has(.menu__sheet:not([hidden]))');
  if (event.key !== 'Escape' || !open) return;
  setMenu(open, false);
  open.querySelector('.menu__toggle').focus();
});

// The sticky rows sit under the ones above them, whose heights change as they wrap.
const stickyRows = new ResizeObserver(() => {
  document.body.style.setProperty('--topbar-height', `${document.querySelector('.topbar').offsetHeight}px`);
  document.body.style.setProperty('--sidebar-height', `${document.querySelector('.sidebar').offsetHeight}px`);
});
stickyRows.observe(document.querySelector('.topbar'));
stickyRows.observe(document.querySelector('.sidebar'));

// On small screens the list picker and sorting move up into the top bar.
const narrow = matchMedia('(max-width: 800px)');
const placeControls = () => {
  if (narrow.matches) {
    $('search-field').before($('list-picker'), $('sort-field'));
  } else {
    $('lists').after($('list-picker'));
    $('list-menu').before($('sort-field'));
  }
};
narrow.addEventListener('change', placeControls);
placeControls();

// On small screens search is an icon that opens the field in place of the pickers.
$('search-toggle').addEventListener('click', () => setSearch($('search-toggle').getAttribute('aria-expanded') !== 'true'));
$('search').addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !narrow.matches) return;
  setSearch(false);
  $('search-toggle').focus();
});

const NEW_LIST = 'new-list';
$('list-picker').addEventListener('change', (event) => {
  if (event.target.value !== NEW_LIST) return setView({ listId: event.target.value || null });
  // Not a real list: snap back to the current one and ask for a name.
  event.target.value = view.listId ?? '';
  newList();
});

onChange(refresh);
refresh();
loadRates().then((loaded) => {
  rates = loaded;
  render();
});

// The switch offers the opposite of what is showing, which follows the system until it is used.
const systemDark = matchMedia('(prefers-color-scheme: dark)');
systemDark.addEventListener('change', showThemeSwitch);
showThemeSwitch();

// Folder access is a Chromium feature; other browsers keep Export and Import only.
if ('showDirectoryPicker' in globalThis) {
  $('backup-menu').hidden = false;
  startBackup();
  refreshBackup().then(() => {
    if (backup.state === 'paused') toast(`Backup to “${backup.name}” is paused. Open the settings menu and choose Resume backup.`);
  });
}

function setSearch(open) {
  $('search-toggle').setAttribute('aria-expanded', String(open));
  document.querySelector('.topbar').classList.toggle('topbar--searching', open);
  if (open) {
    $('search').focus();
  } else if ($('search').value) {
    // Closing clears the query, so no hidden filter is left behind.
    $('search').value = '';
    setView({ query: '' });
  }
}

function setMenu(menu, open) {
  menu.querySelector('.menu__sheet').hidden = !open;
  menu.querySelector('.menu__toggle').setAttribute('aria-expanded', String(open));
}

async function refresh() {
  state = await getState();
  if (!state.lists.some((list) => list.id === view.listId)) view.listId = null;
  render();
}

function setView(change) {
  Object.assign(view, change);
  render();
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(Boolean));
  return node;
}

function visibleProducts() {
  const query = view.query.trim().toLowerCase();
  return state.products
    .filter((p) => !view.listId || p.listId === view.listId)
    .filter((p) => !query || [p.title, p.store, p.note].some((text) => text?.toLowerCase().includes(query)))
    .sort(SORTS[view.sort]);
}

function render() {
  const products = visibleProducts();
  const currentList = state.lists.find((list) => list.id === view.listId);

  $('lists').replaceChildren(
    listLink(null, 'All Items', state.products.length),
    ...state.lists.map((list) => listLink(list.id, list.name, state.products.filter((p) => p.listId === list.id).length)),
  );
  // Small screens pick the list from a dropdown instead of the row of tabs.
  $('list-picker').replaceChildren(
    new Option(`All Items (${state.products.length})`, ''),
    ...state.lists.map((list) => new Option(`${list.name} (${state.products.filter((p) => p.listId === list.id).length})`, list.id)),
    document.createElement('hr'),
    new Option('New list', NEW_LIST),
  );
  $('list-picker').value = view.listId ?? '';

  $('lists-title').textContent = `Lists (${state.lists.length})`;
  $('list-title').textContent = `${currentList?.name ?? 'All Items'} (${products.length})`;
  $('list-menu').hidden = !currentList;

  $('grid').replaceChildren(...products.map(card));
  $('empty').hidden = products.length > 0;
  $('empty').textContent = state.products.length
    ? 'Nothing here matches.'
    : 'Nothing saved yet. Open a product page in any online shop and click the ShopMarks icon in the toolbar.';
}

function listLink(id, name, count) {
  const link = el(
    'button',
    { className: 'list-link', type: 'button', onclick: () => setView({ listId: id }) },
    el('span', { className: 'list-link__name', textContent: name }),
    el('span', { className: 'list-link__count', textContent: count }),
  );
  link.setAttribute('aria-current', String(view.listId === id));
  return link;
}

function card(product) {
  const change = priceChange(product);
  const link = { href: product.url, target: '_blank', rel: 'noopener' };
  const image = el('a', { ...link, className: 'card__image', ariaLabel: product.title });
  // No picture, or one that fails to load: the shop's name on the shop's own colour.
  const showPlaceholder = () => {
    image.classList.add('card__image--empty');
    image.style.setProperty('--hue', hueOf(product.store));
    image.replaceChildren(product.store || 'No image');
  };
  if (product.image) {
    image.append(el('img', { src: product.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: showPlaceholder }));
  } else {
    showPlaceholder();
  }

  return el(
    'article',
    { className: 'card' },
    el(
      'div',
      { className: 'card__media' },
      image,
      el(
        'div',
        { className: 'card__actions' },
        iconButton('Edit', ICONS.edit, () => editProduct(product)),
        iconButton('Delete', ICONS.delete, () => confirmDelete(product), 'button--danger'),
      ),
      product.note && el('p', { className: 'card__note', textContent: product.note }),
    ),
    el(
      'div',
      { className: 'card__body' },
      el('h3', { className: 'card__title', title: product.title }, el('a', { ...link, textContent: product.title })),
      el(
        'div',
        { className: 'card__meta' },
        el(
          'p',
          { className: 'card__pricing' },
          el('span', { className: 'card__price', textContent: product.price != null ? formatPrice(product.price, product.currency, rates) : 'N/A' }),
          change &&
            el('span', {
              className: change.percent < 0 ? 'card__change card__change--down' : 'card__change card__change--up',
              textContent: `${change.percent < 0 ? '▼' : '▲'} ${Math.abs(change.percent).toFixed(0)}%`,
              title: `Was ${formatPrice(change.from, product.currency, rates)}`,
            }),
        ),
        el('p', { className: 'card__store', textContent: product.store }),
      ),
    ),
  );
}

// The same shop always gets the same colour.
function hueOf(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return hash;
}

function iconButton(label, icon, onclick, modifier = '') {
  return el('button', { className: `button ${modifier}`.trim(), type: 'button', title: label, ariaLabel: label, innerHTML: icon, onclick });
}

// Dialogs

// Cancel is a plain button, not a submit one: pressing Enter in a field submits with the
// form's first submit button, which is then Save rather than Cancel.
for (const cancel of document.querySelectorAll('.dialog [value="cancel"]')) {
  cancel.addEventListener('click', () => cancel.closest('dialog').close('cancel'));
}

function ask(dialog) {
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

async function askName(title, value = '') {
  $('name-title').textContent = title;
  $('name-input').value = value;
  return (await ask($('name-dialog'))) ? $('name-input').value.trim() : null;
}

function confirmAction(title, text) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  return ask($('confirm-dialog'));
}

async function editProduct(product) {
  $('edit-title').value = product.title;
  $('edit-price').value = product.price ?? '';
  $('edit-currency').value = product.currency ?? '';
  $('edit-note').value = product.note;
  $('edit-list').replaceChildren(
    new Option(NO_LIST_NAME, DEFAULT_LIST_ID),
    ...state.lists.map((list) => new Option(list.name, list.id)),
  );
  $('edit-list').value = product.listId;
  if (!(await ask($('edit-dialog')))) return;
  await updateProduct(product.id, {
    title: $('edit-title').value.trim(),
    price: globalThis.SaverExtract.parsePrice($('edit-price').value),
    currency: $('edit-currency').value.trim().toUpperCase() || null,
    listId: $('edit-list').value,
    note: $('edit-note').value.trim(),
  });
}

async function confirmDelete(product) {
  if (await confirmAction('Delete this item?', product.title)) await removeProduct(product.id);
}

async function newList() {
  const name = await askName('New list');
  if (!name) return;
  const list = await createList(name);
  view.listId = list.id;
  refresh();
}

async function renameCurrentList() {
  const list = state.lists.find((l) => l.id === view.listId);
  const name = await askName('Rename list', list.name);
  if (name) await renameList(list.id, name);
}

async function deleteCurrentList() {
  const list = state.lists.find((l) => l.id === view.listId);
  const text = 'The items in it are kept and move to “Saved”.';
  if (await confirmAction(`Delete the list “${list.name}”?`, text)) await deleteList(list.id);
}

// Price checks

async function checkPrices() {
  const targets = visibleProducts();
  if (!targets.length) return toast('There is nothing here to check.');

  // Must stay the first await: the permission prompt needs the click that got us here.
  const origins = [...new Set(targets.map((product) => `${new URL(product.url).origin}/*`))];
  const granted = await chrome.permissions.request({ origins }).catch(() => false);
  if (!granted) return toast('ShopMarks needs access to those shops to read their prices.');

  const button = $('check-prices');
  button.disabled = true;
  button.querySelector('.menu__label').textContent = 'Updating prices';
  let changed = 0;
  let unreadable = 0;
  const pending = [...targets];
  const worker = async () => {
    for (let product = pending.shift(); product; product = pending.shift()) {
      const price = await readCurrentPrice(product);
      if (price == null) {
        unreadable += 1;
        continue;
      }
      if (price !== product.price) changed += 1;
      await updateProduct(product.id, { price, checkedAt: Date.now() });
    }
  };
  await Promise.all(Array.from({ length: PRICE_CHECKS_AT_ONCE }, worker));
  button.disabled = false;
  button.querySelector('.menu__label').textContent = 'Update prices';

  const parts = [`Checked ${targets.length}`, `${changed} changed`];
  if (unreadable) parts.push(`${unreadable} could not be read`);
  toast(`${parts.join(' · ')}.`);
}

async function readCurrentPrice(product) {
  try {
    const response = await fetch(product.url, { credentials: 'omit' });
    if (!response.ok) return null;
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const { price, currency } = globalThis.SaverExtract(doc, product.url);
    // Without cookies a shop may answer in another currency; that is not a price change.
    if (currency && product.currency && currency !== product.currency) return null;
    return price;
  } catch {
    return null;
  }
}

// Export and import

async function exportToFile() {
  const blob = new Blob([JSON.stringify(await exportData(), null, 2)], { type: 'application/json' });
  const link = el('a', { href: URL.createObjectURL(blob), download: `saver-${new Date().toISOString().slice(0, 10)}.json` });
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importFromFile(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  try {
    const added = await importData(JSON.parse(await file.text()));
    toast(`Imported ${added} ${added === 1 ? 'item' : 'items'}.`);
  } catch {
    toast('That file is not a ShopMarks export.');
  }
}

// Backup folder

async function refreshBackup() {
  backup = await backupStatus();
  $('backup-status').hidden = backup.state === 'off';
  $('backup-status').textContent = backup.state === 'on' ? `Backing up to “${backup.name}”` : `Backup to “${backup.name}” is paused`;
  $('backup-resume').hidden = backup.state !== 'paused';
  $('backup-stop').hidden = backup.state === 'off';
}

async function chooseBackupFolder() {
  let existing;
  try {
    existing = await chooseFolder();
  } catch {
    return; // The picker was closed.
  }
  // A backup already in the folder is merged in first, so choosing a folder never loses what it holds.
  let added = 0;
  try {
    if (existing) added = await importData(existing);
  } catch {}
  try {
    await writeBackup();
  } catch {
    await refreshBackup();
    return toast('ShopMarks could not write to that folder.');
  }
  await refreshBackup();
  const restored = added ? ` ${added} ${added === 1 ? 'item' : 'items'} from the backup already there ${added === 1 ? 'was' : 'were'} added.` : '';
  toast(`Backing up to “${backup.name}” as ${BACKUP_FILE}.${restored}`);
}

async function resumeBackup() {
  // Must stay the first await: the permission prompt needs the click that got us here.
  const granted = (await backup.folder.requestPermission({ mode: 'readwrite' })) === 'granted';
  if (granted) await writeBackup().catch(() => {});
  await refreshBackup();
  toast(granted ? `Backing up to “${backup.name}” again.` : 'The backup is still paused.');
}

async function stopBackup() {
  await forgetFolder();
  await refreshBackup();
  toast(`Backup stopped. ${BACKUP_FILE} stays in the folder.`);
}

// Theme (applied on load by theme.js)

function currentTheme() {
  return document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');
}

function toggleTheme() {
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  showThemeSwitch();
}

function showThemeSwitch() {
  const dark = currentTheme() === 'dark';
  $('theme-toggle').dataset.target = dark ? 'light' : 'dark';
  $('theme-toggle').querySelector('.menu__label').textContent = dark ? 'Light mode' : 'Dark mode';
}

function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), TOAST_MS);
}
