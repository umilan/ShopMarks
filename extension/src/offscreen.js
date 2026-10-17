import { readPage } from './readpage.js';

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'read-page') return;
  readPage(message.url, message.spots).then(reply);
  return true; // Replies later.
});
