// Runs the extractor inside a tab the user has just given us access to.
export async function extractFromTab(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/extractor.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.SaverExtract(document, location.href),
  });
  return result;
}
