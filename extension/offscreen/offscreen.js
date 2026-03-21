import { extractText } from '../content/pdf-extractor.js';

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'EXTRACT_PDF') {
    extractText(msg.url)
      .then((result) => {
        chrome.runtime.sendMessage({
          type: 'PDF_EXTRACTED',
          result,
        });
      })
      .catch((err) => {
        chrome.runtime.sendMessage({
          type: 'PDF_EXTRACTED',
          error: {
            code: err.code || 'parse_failed',
            message: err.message,
          },
        });
      });
  }
});
