// Shows the title of any control as a styled tooltip after a short pause, instead of the
// browser's own, which is slow to appear and often not shown at all. While the pointer is
// on the control its title is moved aside, so the browser does not show a second tooltip;
// it comes back when the pointer leaves. Mouse only: touch has no hover.

const SHOW_DELAY = 300;

let tip = null;
let timer = 0;
let current = null;

function show(el) {
  if (!el.dataset.tip) return;
  // Inside an open dialog the tooltip must sit in that dialog: the modal top layer covers the page.
  const parent = el.closest('dialog[open]') ?? document.body;
  tip ??= Object.assign(document.createElement('div'), { className: 'tooltip', role: 'tooltip' });
  tip.textContent = el.dataset.tip;
  parent.append(tip);

  const box = el.getBoundingClientRect();
  const size = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, box.left + box.width / 2 - size.width / 2), innerWidth - size.width - 8);
  const above = box.top - size.height - 8 >= 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${above ? box.top - size.height - 8 : box.bottom + 8}px`;
}

function hide() {
  clearTimeout(timer);
  tip?.remove();
  if (current) {
    // A title set while hovered (a toggle that renames itself on click) is newer: keep it.
    if (!current.hasAttribute('title')) current.title = current.dataset.tip;
    delete current.dataset.tip;
    current = null;
  }
}

document.addEventListener('pointerover', (event) => {
  if (event.pointerType !== 'mouse') return;
  const el = event.target.closest?.('[title]');
  if (!el || el === current) return;
  hide();
  current = el;
  el.dataset.tip = el.title;
  el.removeAttribute('title');
  timer = setTimeout(() => show(el), SHOW_DELAY);
});

document.addEventListener('pointerout', (event) => {
  if (current && !current.contains(event.relatedTarget)) hide();
});
document.addEventListener('pointerdown', hide);
document.addEventListener('scroll', hide, true);
