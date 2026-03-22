/**
 * Site-specific extraction adapters for academic paper websites.
 *
 * Injected as a content script before web-extractor.js.
 * Exposes window._speakademicExtractWithAdapter(document, url).
 *
 * Each adapter implements:
 *   match(hostname, pathname) → boolean
 *   extract(document)         → { title, fullText, sections, sectionCharOffsets, meta }
 *
 * Adapters are tried in order; the first match wins.
 * If no adapter matches, returns null and the caller uses Readability.
 */
(function () {
  'use strict';

  if (window._speakademicSiteAdaptersLoaded) return;
  window._speakademicSiteAdaptersLoaded = true;

  // ═══════════════════════════════════════════════════════════
  // Shared helpers
  // ═══════════════════════════════════════════════════════════

  const REFERENCES_RE =
    /^(?:references|bibliography|works\s+cited|literature\s+cited)$/i;
  const ABSTRACT_RE = /^(?:abstract|summary)$/i;
  const ACKNOWLEDGEMENTS_RE =
    /^(?:acknowledg(?:e?ments?|ing)|funding|disclosure)$/i;

  // Elements to strip from cloned DOM before extracting text
  const STRIP_SELECTORS = [
    // arxiv LaTeXML "Report issue" screen-reader buttons
    'button.sr-only',
    'button[class*="sr-only"]',
    // Footnote markers, error annotations
    '.ltx_ERROR',
    // Citation reference numbers (we strip these in text cleaning)
    'cite .ltx_bib_cited',
  ].join(', ');

  function textOf(el) {
    if (!el) return '';

    // Clone to avoid mutating the live DOM
    const clone = el.cloneNode(true);

    // Remove UI junk elements (arxiv "Report issue" buttons, etc.)
    for (const junk of clone.querySelectorAll(STRIP_SELECTORS)) {
      junk.remove();
    }

    // Replace <math> blocks with [equation] markers
    // so TTS doesn't read raw MathML gibberish
    for (const m of clone.querySelectorAll(
      'math.ltx_Math, math[alttext]'
    )) {
      const alt = m.getAttribute('alttext') || '';
      const marker = alt
        ? ` [equation:${alt}] `
        : ' [equation] ';
      m.replaceWith(document.createTextNode(marker));
    }

    return clone.textContent.trim();
  }

  /**
   * Walk section elements, collecting text and building a section map.
   * Stops at the references section.
   */
  function walkSections(sectionEls, getTitle, getLevel, getBody) {
    const sections = [];
    const sectionCharOffsets = [];
    const textParts = [];
    let charPos = 0;

    for (const el of sectionEls) {
      const title = getTitle(el);
      if (!title) continue;

      if (REFERENCES_RE.test(title)) break;
      if (ACKNOWLEDGEMENTS_RE.test(title)) continue;

      const isAbstract = ABSTRACT_RE.test(title);

      sections.push({
        title,
        pageNum: 1,
        itemIndex: sections.length,
        outlineLevel: getLevel(el),
        isReferences: false,
        isAbstract,
      });
      sectionCharOffsets.push(charPos);

      const bodyNodes = getBody(el);
      const partTexts = [];

      for (const node of bodyNodes) {
        const tag = node.tagName?.toLowerCase();
        if (tag === 'figure' || tag === 'table' || tag === 'figcaption') {
          continue;
        }
        if (node.classList?.contains('ltx_figure')
          || node.classList?.contains('ltx_table')
          || node.classList?.contains('ltx_equation')
          || node.classList?.contains('ltx_equationgroup')) {
          continue;
        }
        const t = textOf(node);
        if (t) partTexts.push(t);
      }

      const sectionText = partTexts.join('\n');
      if (sectionText) {
        if (charPos > 0) {
          textParts.push('');
          charPos += 1;
        }
        textParts.push(sectionText);
        charPos += sectionText.length;
      }
    }

    return { fullText: textParts.join('\n'), sections, sectionCharOffsets };
  }

  // ═══════════════════════════════════════════════════════════
  // arXiv HTML  (arxiv.org/html/*)
  // ═══════════════════════════════════════════════════════════

  const arxivAdapter = {
    name: 'arxiv',

    match(hostname, pathname) {
      return (
        hostname === 'arxiv.org'
        || hostname === 'www.arxiv.org'
        || hostname === 'ar5iv.labs.arxiv.org'
      ) && (
        pathname.startsWith('/html/')
        || pathname.startsWith('/abs/')
        || pathname.startsWith('/pdf/')
      );
    },

    extract(doc) {
      const title =
        textOf(doc.querySelector('.ltx_title.ltx_title_document'))
        || textOf(doc.querySelector('h1'))
        || doc.title;

      // LaTeXML structure — include abstract (div or section)
      const ltxSections = doc.querySelectorAll(
        'section.ltx_section, section.ltx_subsection, '
        + 'section.ltx_subsubsection, section.ltx_appendix, '
        + 'section.ltx_abstract, div.ltx_abstract, '
        + 'section[id^="S"], section#abstract1, div#abstract1'
      );

      if (ltxSections.length > 0) {
        const result = walkSections(
          ltxSections,
          (el) => {
            const h = el.querySelector(
              '.ltx_title, h1, h2, h3, h4, h5, h6'
            );
            return textOf(h);
          },
          (el) => {
            if (el.classList.contains('ltx_abstract')) return 0;
            if (el.classList.contains('ltx_section')) return 0;
            if (el.classList.contains('ltx_subsection')) return 1;
            if (el.classList.contains('ltx_subsubsection')) return 2;
            const id = el.id || '';
            return Math.min((id.match(/\./g) || []).length, 3);
          },
          (el) => el.querySelectorAll(
            ':scope > .ltx_para, :scope > p, :scope > .ltx_theorem, '
            + ':scope > .ltx_proof, :scope > .ltx_itemize, '
            + ':scope > .ltx_enumerate, :scope > ul, :scope > ol, '
            + ':scope > dl'
          ),
        );
        return { ...result, meta: { source: 'web', title, siteName: 'arxiv.org' } };
      }

      // Fallback: heading-based
      return extractByHeadings(doc, title, 'arxiv.org');
    },
  };

  // ═══════════════════════════════════════════════════════════
  // PubMed Central  (ncbi.nlm.nih.gov/pmc/articles/*)
  // ═══════════════════════════════════════════════════════════

  const pmcAdapter = {
    name: 'pmc',

    match(hostname) {
      return hostname.includes('ncbi.nlm.nih.gov');
    },

    extract(doc) {
      const title =
        textOf(doc.querySelector('.content-title, #article-title, h1'))
        || doc.title;

      const sectionEls = doc.querySelectorAll(
        '.tsec, .sec, section[id^="s"], section[id^="S"]'
      );
      if (sectionEls.length === 0) return null;

      const result = walkSections(
        sectionEls,
        (el) => textOf(el.querySelector('h2, h3, h4, .head')),
        (el) => {
          const h = el.querySelector('h2, h3, h4');
          return h ? parseInt(h.tagName[1], 10) - 2 : 0;
        },
        (el) => el.querySelectorAll(':scope > p, :scope > .sec'),
      );

      return { ...result, meta: { source: 'web', title, siteName: 'PubMed Central' } };
    },
  };

  // ═══════════════════════════════════════════════════════════
  // Generic academic paper heuristics (any site)
  // ═══════════════════════════════════════════════════════════

  const genericAcademicAdapter = {
    name: 'generic-academic',

    match() { return true; },

    extract(doc) {
      const container =
        doc.querySelector('article')
        || doc.querySelector('[role="main"]')
        || doc.querySelector('main')
        || doc.querySelector(
          '.article-content, .paper-content, '
          + '.article__body, .fulltext-view'
        );
      if (!container) return null;

      const headings = container.querySelectorAll('h2, h3, h4');
      if (headings.length < 2) return null;

      const texts = [...headings].map((h) => textOf(h).toLowerCase());
      const hasAbstract = texts.some((t) => ABSTRACT_RE.test(t));
      const hasIntro = texts.some((t) => /^(?:\d+\.?\s+)?introduction$/i.test(t));
      const hasRefs = texts.some((t) => REFERENCES_RE.test(t));

      if (!hasAbstract && !(hasIntro && hasRefs)) return null;

      const title =
        textOf(doc.querySelector('h1'))
        || textOf(doc.querySelector('.article-title, .paper-title'))
        || doc.title;

      return extractByHeadings(doc, title, '');
    },
  };

  // ═══════════════════════════════════════════════════════════
  // Shared heading-based extraction (fallback for any site)
  // ═══════════════════════════════════════════════════════════

  function extractByHeadings(doc, title, siteName) {
    const container =
      doc.querySelector('article')
      || doc.querySelector('[role="main"]')
      || doc.querySelector('main')
      || doc.body;

    const headings = container.querySelectorAll('h2, h3, h4');
    if (headings.length === 0) return null;

    const sections = [];
    const sectionCharOffsets = [];
    const textParts = [];
    let charPos = 0;
    let foundBody = false;

    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const headingText = textOf(h);
      if (!headingText) continue;
      if (REFERENCES_RE.test(headingText)) break;

      // Skip everything before abstract or introduction
      if (!foundBody) {
        if (ABSTRACT_RE.test(headingText)
          || /introduction/i.test(headingText)) {
          foundBody = true;
        } else {
          continue;
        }
      }

      if (ACKNOWLEDGEMENTS_RE.test(headingText)) continue;

      const level = Math.max(0, parseInt(h.tagName[1], 10) - 2);

      sections.push({
        title: headingText,
        pageNum: 1,
        itemIndex: sections.length,
        outlineLevel: level,
        isReferences: false,
        isAbstract: ABSTRACT_RE.test(headingText),
      });
      sectionCharOffsets.push(charPos);

      // Collect text from siblings until next heading
      const bodyTexts = [];
      let sibling = h.nextElementSibling;
      const nextH = i + 1 < headings.length ? headings[i + 1] : null;

      while (sibling && sibling !== nextH) {
        const tag = sibling.tagName?.toLowerCase();
        if (/^h[1-6]$/.test(tag)) break;
        if (tag !== 'figure' && tag !== 'table' && tag !== 'figcaption') {
          const t = textOf(sibling);
          if (t) bodyTexts.push(t);
        }
        sibling = sibling.nextElementSibling;
      }

      const sectionText = bodyTexts.join('\n');
      if (sectionText) {
        if (charPos > 0) { textParts.push(''); charPos += 1; }
        textParts.push(sectionText);
        charPos += sectionText.length;
      }
    }

    if (sections.length === 0) return null;

    return {
      fullText: textParts.join('\n'),
      sections,
      sectionCharOffsets,
      meta: { source: 'web', title, siteName },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Registry — ordered, first match wins
  // ═══════════════════════════════════════════════════════════

  const ADAPTERS = [
    arxivAdapter,
    pmcAdapter,
    genericAcademicAdapter,
  ];

  window._speakademicExtractWithAdapter = function (doc, url) {
    let hostname, pathname;
    try {
      const u = new URL(url);
      hostname = u.hostname;
      pathname = u.pathname;
    } catch {
      return null;
    }

    for (const adapter of ADAPTERS) {
      if (!adapter.match(hostname, pathname)) continue;

      try {
        const result = adapter.extract(doc);
        if (result && result.fullText && result.fullText.length > 50) {
          console.log(
            `[SiteAdapter] ${adapter.name} extracted`
            + ` ${result.fullText.length} chars`
            + ` (${result.sections.length} sections)`
          );
          return result;
        }
      } catch (err) {
        console.warn(
          `[SiteAdapter] ${adapter.name} failed:`, err.message
        );
      }
    }

    return null;
  };
})();
