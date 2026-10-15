// Picks any number of lists for an item: a field that opens into checkboxes, plus a box
// to name a new list. Used by the popup and the dashboard's edit dialog.
//
// Markup (see popup.html):
//   <details class="list-choice">
//     <summary class="input list-choice__summary"></summary>
//     <div class="list-choice__panel">
//       <div class="list-choice__options"></div>
//       <div class="list-choice__new-row">
//         <input type="checkbox" class="list-choice__new-box">
//         <input class="list-choice__new" placeholder="Create new list...">
//       </div>
//     </div>
//   </details>

import { NO_LIST_NAME, createList, listTree } from './store.js';

// A details element stays open when you click elsewhere; the sheet closes on any press
// outside it, so only one picker is open at a time.
document.addEventListener('pointerdown', (event) => {
  for (const root of document.querySelectorAll('.list-choice[open]')) {
    if (!root.contains(event.target)) root.open = false;
  }
});

// Fills the choice with the lists, ticking the selected ones. emptyLabel names the
// "no list" state, e.g. "Unsorted". With lastUsed, the selection is the one used last
// time and reads "Save to last used (…)" until it is changed, "Save to last used (Unsorted)" for none.
export function fillListChoice(root, lists, selected, emptyLabel, { lastUsed = false } = {}) {
  root.dataset.empty = emptyLabel;
  if (lastUsed) root.dataset.lastUsed = [...selected].sort().join();
  else delete root.dataset.lastUsed;
  const options = root.querySelector('.list-choice__options');
  options.replaceChildren(
    // In tree order, sub-lists indented under their list.
    ...listTree(lists).map(({ list, depth }) => {
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', value: list.id, checked: selected.includes(list.id) });
      box.dataset.name = list.name;
      const label = document.createElement('label');
      label.className = 'list-choice__option';
      label.style.paddingLeft = `${8 + depth * 16}px`;
      label.append(box, list.name);
      return label;
    }),
  );
  root.querySelector('.list-choice__new').value = '';
  if (!root.dataset.ready) {
    root.dataset.ready = 'true';
    root.addEventListener('change', () => summarize(root));
    root.querySelector('.list-choice__new').addEventListener('input', () => summarize(root));
  }
  summarize(root);
}

// The ticked list ids. A name typed in the new-list box becomes a list first.
export async function chosenLists(root) {
  const ids = [...root.querySelectorAll('.list-choice__options input:checked')].map((box) => box.value);
  const name = root.querySelector('.list-choice__new').value.trim();
  if (name) ids.push((await createList(name)).id);
  return ids;
}

function summarize(root) {
  const checked = [...root.querySelectorAll('.list-choice__options input:checked')];
  const names = checked.map((box) => box.dataset.name);
  const typed = root.querySelector('.list-choice__new').value.trim();
  if (typed) names.push(typed);
  root.querySelector('.list-choice__new-box').checked = Boolean(typed);
  const untouched = !typed && 'lastUsed' in root.dataset && checked.map((box) => box.value).sort().join() === root.dataset.lastUsed;
  const summary = root.querySelector('.list-choice__summary');
  if (untouched) summary.textContent = `Save to last used (${names.length ? names.join(', ') : NO_LIST_NAME})`;
  else summary.textContent = names.length ? names.join(', ') : root.dataset.empty;
}
