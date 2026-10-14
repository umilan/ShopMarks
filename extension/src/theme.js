// The light / dark choice from the settings menu, applied before the page paints so it
// never flashes the other theme. Without a choice the pages follow the system.
// localStorage is shared by every Saver page (they all live on the extension's origin).
try {
  const theme = localStorage.getItem('theme');
  if (theme) document.documentElement.dataset.theme = theme;
} catch {}
