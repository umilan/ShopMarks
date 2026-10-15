import './tooltip.js';
import { chosenLists, fillListChoice } from './listchoice.js';
import {
  connectDropbox,
  disconnectDropbox,
  dropboxAppKey,
  dropboxStatus,
  finishDropboxRedirect,
  redirectUri as dropboxRedirectUri,
  resetDropbox,
  saveDropboxAppKey,
  startDropboxSync,
  syncNow,
} from './sync.js';
import { BACKUP_FILE, backupStatus, chooseFolder, forgetFolder, startBackup, writeBackup } from './backup.js';
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  NO_LIST_NAME,
  createList,
  deleteList,
  exportData,
  findByUrl,
  formatPrice,
  getState,
  importData,
  listsOf,
  loadRates,
  onChange,
  priceChange,
  priceSpots,
  titleSpotFor,
  removeProduct,
  saveProduct,
  renameList,
  setCurrency,
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
  more: svg('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'),
  grip: svg('<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>'),
};
// Cards ticked with their checkbox; dragging one of them moves them all.
const selected = new Set();
// Until this time, redraws slide the cards to their new places (after a drop on a list).
let animateGridUntil = 0;

// listId null means "all items"; UNSORTED shows the items in no list.
const UNSORTED = 'unsorted';
const DRAG_TYPE = 'application/x-shopmarks-item';
// Running as the web app (PWA, see web.js) rather than inside the extension.
const WEB = Boolean(globalThis.shopMarksWeb);
// A drop target shown only while a card is dragged: deletes for good, after asking.
const TRASH = 'trash';
// layout: 'grid' of cards or 'list' of rows; remembered per browser.
const view = { listId: null, query: '', sort: 'newest', layout: savedLayout() };

// Long lists show the first BATCH items; the next batch is added when the end of the
// grid comes near the screen. A new list, search or sort starts again from the first batch.
const BATCH = 50;
const NEAR_END = 400;
let shownCount = BATCH;
let shownKey = '';

function nearEnd() {
  return $('grid-more').getBoundingClientRect().top < innerHeight + NEAR_END;
}

function showMore() {
  const products = visibleProducts();
  if (shownCount >= products.length) return;
  const start = shownCount;
  shownCount += BATCH;
  $('grid').append(...products.slice(start, shownCount).map(card));
  // Keep going while the end is still on screen, so a short batch does not stall.
  if (nearEnd()) showMore();
}

new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) showMore();
}, { rootMargin: `0px 0px ${NEAR_END}px` }).observe($('grid-more'));

function savedLayout() {
  try {
    return localStorage.getItem('layout') === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}
let state = { products: [], lists: [], currency: DEFAULT_CURRENCY };
let rates = {};
let toastTimer;
let backup = { state: 'off' };

$('search').addEventListener('input', (event) => setView({ query: event.target.value }));
$('sort').addEventListener('change', (event) => setView({ sort: event.target.value }));
$('new-list').addEventListener('click', newList);
$('rename-list').addEventListener('click', renameCurrentList);
$('delete-list').addEventListener('click', deleteCurrentList);
$('check-prices').addEventListener('click', checkPrices);
$('add-item').addEventListener('click', addByLink);
$('dropbox-connect').addEventListener('click', () => connectToDropbox());
$('dropbox-manage').addEventListener('click', () => connectToDropbox(true));
$('dropbox-clear').addEventListener('click', clearDropboxSetup);
$('dropbox-sync').addEventListener('click', () => runSync(true));
$('dropbox-disconnect').addEventListener('click', disconnectFromDropbox);
// Reading the linked page needs access to its shop, asked for while the Add click still
// counts as the user's (permissions.request needs that).
let addPermission = null;
$('add-dialog').querySelector('form').addEventListener('submit', (event) => {
  addPermission = null;
  if (WEB || event.submitter?.value !== 'ok') return;
  try {
    const origins = [`${new URL($('add-url').value.trim()).origin}/*`];
    // Already allowed (e.g. by Update prices) also counts.
    addPermission = chrome.permissions.request({ origins }).catch(() => chrome.permissions.contains({ origins }));
  } catch {
    // Not a link; addByLink says so.
  }
});
$('export').addEventListener('click', exportToFile);
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', importFromFile);
$('backup-choose').addEventListener('click', chooseBackupFolder);
$('backup-resume').addEventListener('click', resumeBackup);
$('backup-manage').addEventListener('click', chooseBackupFolder);
$('backup-clear').addEventListener('click', stopBackup);
$('theme-toggle').addEventListener('click', toggleTheme);
$('view-toggle').addEventListener('click', () => {
  view.layout = view.layout === 'list' ? 'grid' : 'list';
  try {
    localStorage.setItem('layout', view.layout);
  } catch {}
  render();
});
$('delete-selected').addEventListener('click', () => deleteItems([...selected]));
$('select-toggle').addEventListener('click', () => {
  const shown = visibleProducts();
  if (shown.every((p) => selected.has(p.id))) selected.clear();
  else for (const product of shown) selected.add(product.id);
  render();
});
$('currency').append(...CURRENCIES.map((code) => new Option(code, code)));
$('currency').addEventListener('change', (event) => setCurrency(event.target.value));
$('brand').addEventListener('click', () => WEB || togglePopupPreview());
$('brand').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  togglePopupPreview();
});

// Each .menu is a toggle plus a sheet (cards make theirs on every redraw, so one handler
// serves all). The toggle opens or closes its menu; choosing an item closes it, and so
// does a click anywhere outside; opening one menu closes the others.
// Menus can sit inside menus (the ⋯ beside a settings item): opening the inner one leaves
// the outer one open.
document.addEventListener('click', (event) => {
  const toggled = event.target.closest('.menu__toggle')?.closest('.menu');
  for (const menu of document.querySelectorAll('.menu')) {
    if (menu === toggled) setMenu(menu, menu.querySelector(':scope > .menu__sheet').hidden);
    else if (toggled && menu.contains(toggled)) continue;
    else if (!menu.contains(event.target) || event.target.closest('.menu__item')) setMenu(menu, false);
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

// On small screens the list picker moves up into the top bar and sorting goes to the top of
// the settings menu.
const narrow = matchMedia('(max-width: 800px)');
const placeControls = () => {
  if (narrow.matches) {
    $('search-field').before($('list-picker'));
    $('menu').prepend($('sort-field'));
  } else {
    $('lists').after($('list-picker'));
    // Sort first, then the grid / list switch.
    $('view-toggle').before($('sort-field'));
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

// The web app cannot read shop pages or open the toolbar popup.
if (WEB) {
  $('check-prices').hidden = true;
  $('brand').removeAttribute('role');
  $('brand').removeAttribute('tabindex');
  document.querySelector('.brand').style.cursor = 'auto';
}

// Dropbox: finish a sign-in the web app just came back from, then sync now, whenever the
// page is shown again, and (in the web app, which has no background worker) after changes.
finishDropboxRedirect()
  .then((connected) => connected && toast('Connected to Dropbox.'))
  .catch(() => toast('Dropbox sign-in did not finish. Try again from the settings menu.'))
  .finally(() => runSync(false));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') runSync(false);
});
if (WEB) startDropboxSync();

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

// Its own toggle and sheet (direct children): a menu may hold other menus, which close with it.
function setMenu(menu, open) {
  menu.querySelector(':scope > .menu__sheet').hidden = !open;
  menu.querySelector(':scope > .menu__toggle').setAttribute('aria-expanded', String(open));
  if (!open) for (const inner of menu.querySelectorAll('.menu')) setMenu(inner, false);
}

async function refresh() {
  state = await getState();
  if (view.listId !== UNSORTED && !state.lists.some((list) => list.id === view.listId)) view.listId = null;
  // Deleted items drop out of the selection.
  for (const id of selected) if (!state.products.some((p) => p.id === id)) selected.delete(id);
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

// The text as nodes, with each match of the search wrapped in a <mark> so the results show
// where the phrase was found.
function highlight(text = '') {
  const query = view.query.trim();
  if (!query || !text) return [text];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // With a capture group, split() puts the matches at the odd indexes.
  return text.split(new RegExp(`(${escaped})`, 'i')).map((part, index) => (index % 2 ? el('mark', { textContent: part }) : part));
}

function countIn(listId) {
  return state.products.filter((p) => listsOf(p).includes(listId)).length;
}

function visibleProducts() {
  const query = view.query.trim().toLowerCase();
  return state.products
    .filter((p) => !view.listId || (view.listId === UNSORTED ? !listsOf(p).length : listsOf(p).includes(view.listId)))
    .filter((p) => !query || [p.title, p.store, p.note].some((text) => text?.toLowerCase().includes(query)))
    .sort(SORTS[view.sort]);
}

function render() {
  const products = visibleProducts();
  const currentList = state.lists.find((list) => list.id === view.listId);
  const unsortedCount = state.products.filter((p) => !listsOf(p).length).length;

  $('lists').replaceChildren(
    listLink(null, 'All Items', state.products.length),
    listLink(UNSORTED, NO_LIST_NAME, unsortedCount),
    ...state.lists.map((list) => listLink(list.id, list.name, countIn(list.id))),
    trashLink(),
  );
  // Small screens pick the list from a dropdown instead of the row of tabs.
  $('list-picker').replaceChildren(
    new Option(`All Items (${state.products.length})`, ''),
    new Option(`${NO_LIST_NAME} (${unsortedCount})`, UNSORTED),
    ...state.lists.map((list) => new Option(`${list.name} (${countIn(list.id)})`, list.id)),
    document.createElement('hr'),
    new Option('New list', NEW_LIST),
  );
  $('list-picker').value = view.listId ?? '';
  $('currency').value = state.currency;

  $('lists-title').textContent = `Lists (${state.lists.length})`;
  // The sidebar already shows which list is open; the heading counts what is shown.
  // With cards ticked, the heading row is about the selection instead of the list.
  const selecting = selected.size > 0;
  $('list-title').textContent = selecting ? `Selected items (${selected.size})` : `Saved items (${products.length})`;
  document.querySelector('.main-head').classList.toggle('main-head--selecting', selecting);
  // One button: selects every shown card, or, once they all are, clears the selection.
  const allShown = products.length > 0 && products.every((p) => selected.has(p.id));
  $('select-toggle').hidden = !selecting;
  $('delete-selected').hidden = !selecting;
  $('select-toggle').textContent = allShown ? 'Select none' : 'Select all';
  $('list-menu').hidden = !currentList || selecting;

  const before = Date.now() < animateGridUntil ? cardPositions() : null;
  const key = `${view.listId}|${view.query}|${view.sort}`;
  if (key !== shownKey) {
    shownKey = key;
    shownCount = BATCH;
  }
  $('grid').replaceChildren(...products.slice(0, shownCount).map(card));
  // Once any card is ticked, every card shows its checkbox and grip.
  $('grid').classList.toggle('grid--selecting', selected.size > 0);
  const list = view.layout === 'list';
  $('grid').classList.toggle('grid--list', list);
  $('view-toggle').setAttribute('aria-pressed', String(list));
  $('view-toggle').title = $('view-toggle').ariaLabel = list ? 'Grid view' : 'List view';
  if (before) rearrange(before);
  if (nearEnd()) showMore();
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
  // Lists and Unsorted take dropped cards; All Items is not a place to move to.
  if (id !== null) {
    link.dataset.listId = id;
    link.addEventListener('dragover', (event) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE) || link.classList.contains('list-link--disabled')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      link.classList.add('list-link--drop');
    });
    link.addEventListener('dragleave', (event) => {
      if (!link.contains(event.relatedTarget)) link.classList.remove('list-link--drop');
    });
    link.addEventListener('drop', (event) => {
      event.preventDefault();
      link.classList.remove('list-link--drop');
      const ids = event.dataTransfer.getData(DRAG_TYPE).split(',');
      if (id === TRASH) deleteItems(ids);
      else moveToList(ids, id, name);
    });
  }
  // A row: the link, and for the user's lists a ⋯ menu that shows on hover.
  const row = el('div', { className: 'list-row' }, link);
  const list = state.lists.find((l) => l.id === id);
  if (list) row.append(listMenu(list));
  return row;
}

// The ⋯ menu of one list: rename it, or remove it (its items move to Saved).
function listMenu(list) {
  const toggle = el('button', {
    className: 'button button--ghost menu__toggle list-link__more',
    type: 'button',
    title: 'List actions',
    ariaLabel: `Actions for ${list.name}`,
    innerHTML: ICONS.more,
  });
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');
  const item = (label, icon, onclick, modifier, tip) =>
    el('button', { className: `menu__item ${modifier}`.trim(), type: 'button', role: 'menuitem', title: tip, innerHTML: `${icon}<span class="menu__label">${label}</span>`, onclick });
  const sheet = el(
    'div',
    { className: 'menu__sheet', role: 'menu', hidden: true },
    item('Rename', ICONS.edit, () => renameListDialog(list), '', 'Rename this list'),
    item('Remove', ICONS.delete, () => removeListDialog(list), 'menu__item--danger', 'Remove this list; its items move to Saved'),
  );
  return el('div', { className: 'menu list-link__menu' }, toggle, sheet);
}

function trashLink() {
  const row = listLink(TRASH, 'Trash', '');
  const link = row.querySelector('.list-link');
  link.classList.add('list-link--trash');
  link.onclick = null;
  link.tabIndex = -1;
  return row;
}

// Deletes for good after asking; used by the Trash drop target and Delete selected.
async function deleteItems(ids) {
  const products = state.products.filter((p) => ids.includes(p.id));
  if (!products.length) return;
  const title = products.length === 1 ? 'Delete this item?' : `Delete ${products.length} items?`;
  const text = products.length === 1 ? `${products[0].title}\n\nThis deletes it for good.` : 'This deletes them for good.';
  if (!(await confirmAction(title, text))) return;
  animateGridUntil = Date.now() + 1000;
  for (const product of products) {
    await removeProduct(product.id);
    selected.delete(product.id);
  }
  toast(products.length === 1 ? 'Deleted.' : `Deleted ${products.length} items.`);
}

// A card dropped on a list moves out of the list being viewed and into that one; from All
// Items or Unsorted it is added, keeping its other lists. Dropped on Unsorted, it leaves
// every list.
async function moveToList(productIds, listId, name) {
  const fromList = view.listId && view.listId !== UNSORTED;
  // Each update redraws the grid; let those redraws animate.
  animateGridUntil = Date.now() + 1000;
  let changed = 0;
  for (const product of state.products.filter((p) => productIds.includes(p.id))) {
    const current = listsOf(product);
    let next;
    if (listId === UNSORTED) next = [];
    else if (fromList) next = [...new Set([...current.filter((id) => id !== view.listId), listId])];
    else next = [...new Set([...current, listId])];
    if (next.length === current.length && next.every((id) => current.includes(id))) continue;
    await updateProduct(product.id, { listIds: next });
    changed += 1;
  }
  if (!changed) return toast(`Already in “${name}”.`);
  selected.clear();
  render();
  const what = changed === 1 ? '' : ` ${changed} items`;
  toast(listId === UNSORTED ? `Moved${what} to Unsorted.` : `${fromList ? 'Moved' : 'Added'}${what} to “${name}”.`);
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
    // The same picture twice: blurred to fill the area behind, and whole on top.
    image.append(
      el('img', { className: 'card__backdrop', src: product.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', ariaHidden: 'true' }),
      el('img', { src: product.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: showPlaceholder }),
    );
  } else {
    showPlaceholder();
  }

  const article = el(
    'article',
    { className: `card${selected.has(product.id) ? ' card--selected' : ''}`, draggable: true },
    el(
      'div',
      { className: 'card__media' },
      image,
      el(
        'div',
        { className: 'card__actions' },
        iconButton('Edit', ICONS.edit, () => editProduct(product), '', 'Change the title, price, lists, note or picture'),
        iconButton('Delete', ICONS.delete, () => confirmDelete(product), 'button--danger', 'Delete this item'),
      ),
      el('div', { className: 'card__corner' }, el('span', { className: 'card__grip', title: 'Drag to a list', innerHTML: ICONS.grip }), selectBox(product)),
      product.note && el('p', { className: 'card__note' }, ...highlight(product.note)),
    ),
    cardMenu(product),
    el(
      'div',
      { className: 'card__body' },
      el('h3', { className: 'card__title', title: product.title }, el('a', link, ...highlight(product.title))),
      el(
        'div',
        { className: 'card__meta' },
        el(
          'p',
          { className: 'card__pricing' },
          el('span', { className: 'card__price', textContent: product.price != null ? formatPrice(product.price, product.currency, rates, state.currency) : 'N/A' }),
          change &&
            el('span', {
              className: change.percent < 0 ? 'card__change card__change--down' : 'card__change card__change--up',
              textContent: `${change.percent < 0 ? '▼' : '▲'} ${Math.abs(change.percent).toFixed(0)}%`,
              title: `Was ${formatPrice(change.from, product.currency, rates, state.currency)}`,
            }),
        ),
        el('p', { className: 'card__store' }, ...highlight(product.store)),
      ),
    ),
  );
  article.dataset.id = product.id;
  // Desktop: drag the card onto a list in the sidebar. Its links and picture are not
  // dragged on their own, so the drag always carries the whole card.
  for (const part of article.querySelectorAll('a, img')) part.draggable = false;
  article.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData(DRAG_TYPE, draggedIds(product).join());
    event.dataTransfer.effectAllowed = 'move';
    setDragGhost(event, article);
    article.classList.add('card--dragging');
    document.body.classList.add('dragging-card');
    markDropTargets(draggedIds(product));
  });
  article.addEventListener('dragend', () => {
    article.classList.remove('card--dragging');
    document.body.classList.remove('dragging-card');
    for (const link of document.querySelectorAll('.list-link--disabled')) link.classList.remove('list-link--disabled');
  });
  return article;
}

// List view: the hover buttons become one ⋯ menu at the end of the row.
function cardMenu(product) {
  const item = (label, icon, onclick, modifier = '', tip = label) =>
    el('button', { className: `menu__item ${modifier}`.trim(), type: 'button', role: 'menuitem', title: tip, innerHTML: `${icon}<span class="menu__label">${label}</span>`, onclick });
  const sheet = el(
    'div',
    { className: 'menu__sheet', role: 'menu', hidden: true },
    item('Edit', ICONS.edit, () => editProduct(product), '', 'Change the title, price, lists, note or picture'),
    item('Delete', ICONS.delete, () => confirmDelete(product), 'menu__item--danger', 'Delete this item'),
  );
  const toggle = el('button', { className: 'button button--ghost menu__toggle card__menu-toggle', type: 'button', title: 'Actions', ariaLabel: 'Actions', innerHTML: ICONS.more });
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');
  return el('div', { className: 'menu card__menu' }, toggle, sheet);
}

// Where each card is on screen, by item id.
function cardPositions() {
  return new Map([...$('grid').children].map((card) => [card.dataset.id, card.getBoundingClientRect()]));
}

// After a redraw: cards that stayed slide from their old place to the new one (FLIP),
// cards that are new fade in. A card that left is simply gone, and the rest close the gap.
function rearrange(before) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const card of $('grid').children) {
    const old = before.get(card.dataset.id);
    const now = card.getBoundingClientRect();
    if (!old) {
      card.animate([{ opacity: 0, transform: 'scale(0.95)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    } else if (old.left !== now.left || old.top !== now.top) {
      card.animate([{ transform: `translate(${old.left - now.left}px, ${old.top - now.top}px)` }, { transform: 'none' }], {
        duration: 300,
        easing: 'ease-in-out',
      });
    }
  }
}

// A ticked card carries every ticked card with it; any other card goes alone.
function draggedIds(product) {
  return selected.has(product.id) ? [...selected] : [product.id];
}

function selectBox(product) {
  return el('input', {
    type: 'checkbox',
    className: 'card__select',
    checked: selected.has(product.id),
    title: 'Select',
    ariaLabel: `Select ${product.title}`,
    onchange: (event) => {
      if (event.target.checked) selected.add(product.id);
      else selected.delete(product.id);
      render();
    },
  });
}

// Lists a drop would not change are shown disabled while dragging: the list being viewed,
// and (from All Items or Unsorted) lists the item is already in, or Unsorted for an item
// in no list.
function markDropTargets(ids) {
  const products = state.products.filter((p) => ids.includes(p.id));
  const fromList = view.listId && view.listId !== UNSORTED;
  for (const link of document.querySelectorAll('#lists .list-link')) {
    const id = link.dataset.listId;
    // All Items (no id) is never a target. Others are unchanged only when the drop would
    // change none of the dragged items.
    const unchanged =
      !id || id === view.listId || products.every((p) => (id === UNSORTED ? !listsOf(p).length : !fromList && listsOf(p).includes(id)));
    link.classList.toggle('list-link--disabled', unchanged);
  }
}

// The picture that follows the pointer: the card at a quarter of its size, half see-through.
// Chrome takes a snapshot of the element at drag start, so it only needs to exist briefly
// (off screen).
function setDragGhost(event, article) {
  const SCALE = 0.25;
  const rect = article.getBoundingClientRect();
  const ghost = document.createElement('div');
  Object.assign(ghost.style, {
    position: 'fixed',
    top: '-10000px',
    left: '0',
    width: `${rect.width * SCALE}px`,
    height: `${rect.height * SCALE}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
  });
  const copy = article.cloneNode(true);
  Object.assign(copy.style, { width: `${rect.width}px`, transform: `scale(${SCALE})`, transformOrigin: '0 0', opacity: '0.5' });
  ghost.append(copy);
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, (event.clientX - rect.left) * SCALE, (event.clientY - rect.top) * SCALE);
  setTimeout(() => ghost.remove());
}

// The same shop always gets the same colour.
function hueOf(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return hash;
}

function iconButton(label, icon, onclick, modifier = '', tip = label) {
  return el('button', { className: `button ${modifier}`.trim(), type: 'button', title: tip, ariaLabel: label, innerHTML: icon, onclick });
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
  // The usual single Delete button and no dropdown (removeListDialog may have set up more).
  Object.assign($('confirm-ok'), { textContent: 'Delete', title: 'Delete permanently', className: 'button button--danger-solid' });
  $('confirm-all').hidden = true;
  $('confirm-choice').hidden = true;
  return ask($('confirm-dialog'));
}

// Pictures for the edit dialog, stepped through with the pager as in the popup: the item's
// own picture first, then the ones on its shop page.
let editImages = [];
let editImageIndex = 0;

function showEditImage(index) {
  const count = editImages.length;
  editImageIndex = (index + count) % count || 0;
  $('edit-image').hidden = count === 0;
  // Hidden but still taking its room, so the picture column keeps the height of the fields.
  $('edit-pager').style.visibility = count < 2 ? 'hidden' : 'visible';
  if (count) $('edit-image').src = editImages[editImageIndex];
  $('edit-image-index').textContent = `${editImageIndex + 1} / ${count}`;
}

$('edit-prev-image').addEventListener('click', () => showEditImage(editImageIndex - 1));
$('edit-next-image').addEventListener('click', () => showEditImage(editImageIndex + 1));

// Reads the pictures from the item's shop page. Needs the shop's access, asked for like
// "Update prices" does; without it, or in the web app, there are none to find.
async function findPageImages(product) {
  if (!globalThis.chrome?.permissions) return [];
  // Must stay the first await: the permission prompt needs the click that got us here.
  const origins = [`${new URL(product.url).origin}/*`];
  const granted = await chrome.permissions.request({ origins }).catch(() => false);
  if (!granted) return [];
  try {
    const response = await fetch(product.url, { credentials: 'omit' });
    if (!response.ok) return [];
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    return globalThis.SaverExtract(doc, product.url, { fetched: true }).images;
  } catch {
    return [];
  }
}

async function editProduct(product) {
  $('edit-title').value = product.title;
  $('edit-price').value = product.price ?? '';
  $('edit-price-unit').textContent = product.currency ?? state.currency;
  $('edit-note').value = product.note;
  fillListChoice($('edit-lists'), state.lists, listsOf(product), NO_LIST_NAME);
  $('edit-lists').open = false;
  // Starts before the dialog opens: the permission prompt needs the click that got us here.
  const pageImages = findPageImages(product);
  editImages = [product.image].filter(Boolean);
  showEditImage(0);
  pageImages.then((found) => {
    if (!$('edit-dialog').open) return;
    const current = editImages[editImageIndex];
    editImages = [...new Set([...editImages, ...found])];
    showEditImage(Math.max(0, editImages.indexOf(current)));
  });
  if (!(await ask($('edit-dialog')))) return;
  const listIds = await chosenLists($('edit-lists'));
  await updateProduct(product.id, {
    title: $('edit-title').value.trim(),
    image: editImages[editImageIndex] ?? null,
    price: globalThis.SaverExtract.parsePrice($('edit-price').value),
    listIds,
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

async function renameListDialog(list) {
  const name = await askName('Rename list', list.name);
  if (name) await renameList(list.id, name);
}

// A list with items offers two ways out: delete only the list, its items moving to where the
// dropdown says (Unsorted by default, or another list), or delete the list with all its items.
// "Unsorted" only takes them out of this list; items also in other lists stay there.
async function removeListDialog(list) {
  const title = `Remove the list “${list.name}”?`;
  const products = state.products.filter((p) => listsOf(p).includes(list.id));
  const count = products.length;
  if (!count) {
    if (await confirmAction(title, 'It has no items.')) await deleteList(list.id);
    return;
  }

  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = `It has ${items}. Delete only the list and move them, or delete the list with them.`;
  const select = $('confirm-choice');
  select.replaceChildren(
    new Option(`Move items (${count}) to ${NO_LIST_NAME}`, UNSORTED, true, true),
    ...state.lists.filter((l) => l.id !== list.id).map((l) => new Option(`Move items (${count}) to “${l.name}”`, l.id)),
  );
  select.hidden = false;
  Object.assign($('confirm-ok'), { textContent: 'Delete & move', title: 'Delete the list; move its items as chosen above', className: 'button button--danger-tint' });
  Object.assign($('confirm-all'), { textContent: `Delete with items (${count})`, title: 'Delete the list and every item in it', hidden: false });
  const dialog = $('confirm-dialog');
  dialog.returnValue = '';
  dialog.showModal();
  const choice = await new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  if (choice !== 'ok' && choice !== 'all') return;

  const target = select.value;
  const targetName = state.lists.find((l) => l.id === target)?.name;
  animateGridUntil = Date.now() + 1000;
  for (const product of products) {
    if (choice === 'all') {
      await removeProduct(product.id);
      selected.delete(product.id);
    } else if (target !== UNSORTED) {
      await updateProduct(product.id, { listIds: [...new Set([...listsOf(product).filter((id) => id !== list.id), target])] });
    }
  }
  await deleteList(list.id);
  if (choice === 'all') toast(`Deleted the list and ${items}.`);
  else toast(`Deleted the list; moved ${items} to ${targetName ? `“${targetName}”` : NO_LIST_NAME}.`);
}

function renameCurrentList() {
  return renameListDialog(state.lists.find((l) => l.id === view.listId));
}

function deleteCurrentList() {
  return removeListDialog(state.lists.find((l) => l.id === view.listId));
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
  const spots = await priceSpots();
  const pending = [...targets];
  const worker = async () => {
    for (let product = pending.shift(); product; product = pending.shift()) {
      const price = await readCurrentPrice(product, spots);
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

async function readCurrentPrice(product, spots = {}) {
  try {
    const response = await fetch(product.url, { credentials: 'omit' });
    if (!response.ok) return null;
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const { price, currency } = globalThis.SaverExtract(doc, product.url, { priceSpot: spots[product.store] });
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
  // The ⋯ (Manage, Reset to default) beside Backup folder once a folder is set.
  $('backup-more').hidden = backup.state === 'off';
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

// Popup preview: the real popup page in a frame, loaded fresh on every open so it shows
// current styles and data. Its height follows the content.

// A click on the title while the preview is open first closes it (a click outside a popover
// closes it); without this guard the same click would open it again.
let previewClosedAt = 0;
$('popup-preview').addEventListener('toggle', (event) => {
  if (event.newState === 'closed') previewClosedAt = performance.now();
});

function togglePopupPreview() {
  const preview = $('popup-preview');
  if (performance.now() - previewClosedAt < 300) return;
  if (preview.matches(':popover-open')) return preview.hidePopover();
  const frame = $('popup-preview-frame');
  // Sized by the popup's body: the page's own scroll height never drops below the frame,
  // so it would only ever grow.
  frame.onload = () => {
    const body = frame.contentDocument.body;
    new ResizeObserver(() => (frame.style.height = `${body.offsetHeight}px`)).observe(body);
  };
  frame.src = 'popup.html?preview';
  preview.showPopover();
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

// Add by link (the + in the top bar): in the extension the page is read like the popup
// does; the web app cannot read other sites, so it saves the link and opens the item to
// fill in the rest.

async function addByLink() {
  $('add-url').value = '';
  const preselected = view.listId && view.listId !== UNSORTED ? [view.listId] : [];
  fillListChoice($('add-lists'), state.lists, preselected, NO_LIST_NAME);
  $('add-lists').open = false;
  if (!(await ask($('add-dialog')))) return;
  let url;
  try {
    url = new URL($('add-url').value.trim()).href;
  } catch {
    return toast('That is not a link.');
  }
  const listIds = await chosenLists($('add-lists'));
  const existing = findByUrl(state.products, url);
  if (existing) {
    toast('Already saved; here it is.');
    return editProduct(existing);
  }
  const page = (await addPermission) ? await readPage(url) : null;
  const product = await saveProduct({
    url: page?.url ?? url,
    title: page?.title || url,
    image: page?.images[0] ?? null,
    price: page?.price ?? null,
    currency: page?.currency ?? state.currency,
    listIds,
  });
  if (page?.title && page.price != null) toast('Added.');
  else editProduct(product);
}

async function readPage(url) {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) return null;
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const spots = await priceSpots();
    return globalThis.SaverExtract(doc, url, {
      priceSpot: spots[new URL(url).hostname.replace(/^www\./, '')],
      titleSpot: await titleSpotFor(url),
    });
  } catch {
    return null;
  }
}

// Dropbox sync

async function refreshDropbox() {
  const status = await dropboxStatus();
  const on = status.state === 'on';
  $('dropbox-status').hidden = !on;
  if (on) {
    const when = status.lastSync ? new Date(status.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not yet';
    $('dropbox-status').textContent = `Syncing with ${status.name}'s Dropbox · last ${when}`;
  }
  $('dropbox-connect-row').hidden = on;
  // The ⋯ (Manage, Reset to default) beside Sync with Dropbox once there is a setup.
  $('dropbox-more').hidden = !(await dropboxAppKey());
  $('dropbox-sync').hidden = !on;
  $('dropbox-disconnect').hidden = !on;
}

async function runSync(announce) {
  try {
    const synced = await syncNow();
    if (synced && announce) toast('Synced with Dropbox.');
  } catch (error) {
    console.error(error);
    if (announce) toast('Dropbox sync failed. Check the connection and try again.');
  }
  await refreshDropbox();
}

// Asks for the app key the first time only; it is then kept on this device.
// Asks for the app key the first time; `again` shows the setup steps once more, with the
// saved key filled in (after a sign-in that did not finish).
async function askDropboxAppKey(again = false) {
  const saved = await dropboxAppKey();
  if (saved && !again) return true;
  $('dropbox-key-input').value = saved;
  try {
    $('dropbox-redirect').textContent = dropboxRedirectUri();
  } catch {
    $('dropbox-redirect').textContent = 'shown when this runs as the extension'; // e.g. the localhost preview
  }
  if (!(await ask($('dropbox-key-dialog')))) return false;
  const key = $('dropbox-key-input').value.trim();
  if (!key) return false;
  await saveDropboxAppKey(key);
  refreshDropbox(); // Shows the × that clears it.
  return true;
}

async function connectToDropbox(again = false) {
  if (!(await askDropboxAppKey(again))) return;
  try {
    await connectDropbox(); // The web app leaves the page here and comes back connected.
    toast('Connected to Dropbox.');
    await runSync(true);
  } catch (error) {
    console.error(error);
    // Usually a setup step is missing (the redirect URI, public clients) or the key is wrong:
    // show the steps again so it can be fixed and retried.
    toast('Dropbox sign-in did not finish. Check the steps and try again.');
    connectToDropbox(true);
  }
}

async function clearDropboxSetup() {
  await resetDropbox();
  await refreshDropbox();
  toast('Dropbox setup cleared. Sync with Dropbox starts over.');
}

async function disconnectFromDropbox() {
  await disconnectDropbox();
  await refreshDropbox();
  toast('Dropbox sync stopped. shopmarks.json stays in your Dropbox.');
}

function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), TOAST_MS);
}
