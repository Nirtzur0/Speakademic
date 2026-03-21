(function() {
  'use strict';

  if (window._kokoroWebExtractorLoaded) return;
  window._kokoroWebExtractorLoaded = true;

  console.log('[WebExtractor] Extracting article from',
    window.location.href);

  try {
    const result = extractArticle();
    chrome.runtime.sendMessage({
      type: 'TEXT_EXTRACTED',
      payload: result,
    });
    console.log(
      `[WebExtractor] Extracted ${result.fullText.length} chars`
      + ` (${result.sections.length} sections)`
    );
  } catch (err) {
    console.error('[WebExtractor] Failed:', err.message);
    chrome.runtime.sendMessage({
      type: 'TEXT_EXTRACTED',
      payload: {
        fullText: '',
        sections: [],
        sectionCharOffsets: [],
        meta: { source: 'web', error: err.message },
      },
    });
  }

  function extractArticle() {
    let title = document.title || '';
    let fullText = '';
    let articleHtml = '';

    if (typeof Readability === 'function') {
      const clonedDoc = document.cloneNode(true);
      const article = new Readability(clonedDoc).parse();

      if (article && article.textContent
        && article.textContent.trim().length > 50) {
        fullText = article.textContent;
        articleHtml = article.content;
        title = article.title || title;
      }
    }

    if (!fullText || fullText.trim().length < 50) {
      fullText = extractFallback();
      articleHtml = '';
    }

    fullText = cleanText(fullText);

    const { sections, sectionCharOffsets } = articleHtml
      ? extractSectionsFromHtml(articleHtml, fullText)
      : extractSectionsFromHeadings(fullText);

    return {
      fullText,
      sections,
      sectionCharOffsets,
      meta: {
        source: 'web',
        title,
        siteName: getSiteName(),
        numPages: 1,
        avgCharsPerPage: fullText.length,
        isLikelyScanned: false,
      },
    };
  }

  function extractFallback() {
    const selectors = [
      'article',
      '[role="main"]',
      'main',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.content',
      '#content',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 100) {
        return el.innerText;
      }
    }

    return document.body.innerText || '';
  }

  function extractSectionsFromHtml(html, fullText) {
    const sections = [];
    const sectionCharOffsets = [];
    const div = document.createElement('div');
    div.innerHTML = html;

    const headings = div.querySelectorAll(
      'h1, h2, h3, h4, h5, h6'
    );

    for (const h of headings) {
      const headingText = h.textContent.trim();
      if (!headingText || headingText.length < 2) continue;

      const offset = fullText.indexOf(headingText);
      if (offset === -1) continue;

      sections.push({
        title: headingText,
        pageNum: 1,
        itemIndex: sections.length,
        isReferences: /^references$/i.test(headingText)
          || /^bibliography$/i.test(headingText),
        isAbstract: /^abstract$/i.test(headingText)
          || /^summary$/i.test(headingText),
      });
      sectionCharOffsets.push(offset);
    }

    return { sections, sectionCharOffsets };
  }

  function extractSectionsFromHeadings(fullText) {
    const sections = [];
    const sectionCharOffsets = [];

    const headings = document.querySelectorAll(
      'h1, h2, h3, h4, h5, h6'
    );

    for (const h of headings) {
      const headingText = h.textContent.trim();
      if (!headingText || headingText.length < 2) continue;

      const offset = fullText.indexOf(headingText);
      if (offset === -1) continue;

      sections.push({
        title: headingText,
        pageNum: 1,
        itemIndex: sections.length,
        isReferences: /^references$/i.test(headingText)
          || /^bibliography$/i.test(headingText),
        isAbstract: false,
      });
      sectionCharOffsets.push(offset);
    }

    return { sections, sectionCharOffsets };
  }

  function getSiteName() {
    const meta = document.querySelector(
      'meta[property="og:site_name"]'
    );
    if (meta) return meta.content;
    try {
      return new URL(window.location.href).hostname
        .replace('www.', '');
    } catch {
      return '';
    }
  }

  function cleanText(text) {
    let cleaned = text;

    // Normalize ligatures
    cleaned = cleaned
      .replace(/\ufb00/g, 'ff')
      .replace(/\ufb01/g, 'fi')
      .replace(/\ufb02/g, 'fl')
      .replace(/\ufb03/g, 'ffi')
      .replace(/\ufb04/g, 'ffl');

    // Normalize whitespace
    cleaned = cleaned
      .replace(/\t/g, ' ')
      .replace(/\u00A0/g, ' ')
      .replace(/\u200B/g, '')
      .replace(/\u200C/g, '')
      .replace(/\u200D/g, '')
      .replace(/\uFEFF/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ ]{2,}/g, ' ');

    // TTS-friendly symbols
    cleaned = cleaned
      .replace(/(\d)%/g, '$1 percent')
      .replace(/(\d)°\s*C\b/g, '$1 degrees Celsius')
      .replace(/(\d)°\s*F\b/g, '$1 degrees Fahrenheit')
      .replace(/(\d)°/g, '$1 degrees')
      .replace(/±/g, ' plus or minus ')
      .replace(/≈/g, ' approximately ')
      .replace(/≤/g, ' less than or equal to ')
      .replace(/≥/g, ' greater than or equal to ');

    // Replace long URLs
    cleaned = cleaned.replace(
      /https?:\/\/[^\s]{40,}/g, 'link'
    );

    return cleaned.trim();
  }
})();
