(function() {
  'use strict';

  // Allow re-extraction on retry (e.g., SPA content loaded late)
  // but prevent double-running if injected twice in quick succession
  if (window._speakademicWebExtractorRunning) return;
  window._speakademicWebExtractorRunning = true;
  // Clear the flag after extraction completes (set in runExtraction)
  window._speakademicWebExtractorLoaded = false;

  // Minimum chars to consider extraction successful
  const MIN_CONTENT_LENGTH = 200;
  // SPA wait: use MutationObserver (instant) with a hard timeout
  const SPA_WAIT_MAX = 6000;

  const _t0 = performance.now();
  console.log('[WebExtractor] Extracting from',
    window.location.href);

  runExtraction();

  async function runExtraction() {
    try {
      let result = extractArticle();

      // If we got too little, wait for SPA content to render
      if (!result.fullText
        || result.fullText.trim().length < MIN_CONTENT_LENGTH) {
        console.log(
          '[WebExtractor] Low content ('
          + (result.fullText?.length || 0)
          + ' chars), waiting for SPA render...'
        );
        result = await waitForContent();
      }

      const elapsed = Math.round(performance.now() - _t0);
      chrome.runtime.sendMessage({
        type: 'TEXT_EXTRACTED',
        payload: result,
      });
      console.log(
        `[WebExtractor] Done: ${result.fullText.length} chars`
        + ` (${result.sections.length} sections)`
        + ` in ${elapsed}ms`
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
    } finally {
      window._speakademicWebExtractorRunning = false;
    }
  }

  /**
   * Wait for SPA content using MutationObserver (reacts instantly
   * when new nodes are added) instead of polling. Falls back to a
   * single re-check after timeout.
   */
  function waitForContent() {
    return new Promise((resolve) => {
      let settled = false;
      let observer = null;
      let debounceTimer = null;

      function tryExtract(source) {
        if (settled) return;
        const result = extractArticle();
        if (result.fullText
          && result.fullText.trim().length >= MIN_CONTENT_LENGTH) {
          settled = true;
          if (observer) observer.disconnect();
          clearTimeout(debounceTimer);
          console.log(
            '[WebExtractor] SPA content appeared ('
            + source + ', '
            + Math.round(performance.now() - _t0) + 'ms)'
          );
          resolve(result);
        }
      }

      // Watch for DOM mutations — SPA frameworks add nodes
      observer = new MutationObserver(() => {
        // Debounce: SPAs often add many nodes in quick succession
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(
          () => tryExtract('mutation'), 150
        );
      });
      observer.observe(document.body, {
        childList: true, subtree: true,
      });

      // Hard timeout — resolve with whatever we have
      setTimeout(() => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(debounceTimer);
        console.warn('[WebExtractor] SPA wait timed out');
        resolve(extractArticle());
      }, SPA_WAIT_MAX);
    });
  }

  function extractArticle() {
    // ── 1. Site-specific adapters (fastest, most accurate) ──
    if (typeof _speakademicExtractWithAdapter === 'function') {
      const adapted = _speakademicExtractWithAdapter(
        document, window.location.href
      );
      if (adapted && adapted.fullText
        && adapted.fullText.trim().length > 50) {
        adapted.fullText = cleanText(adapted.fullText);
        adapted.meta = {
          ...adapted.meta,
          numPages: 1,
          avgCharsPerPage: adapted.fullText.length,
          isLikelyScanned: false,
        };
        return adapted;
      }
    }

    // ── 2. Quick DOM extraction (fast — no Readability clone) ──
    let title = document.title || '';
    let fullText = '';
    let articleHtml = '';

    fullText = extractFallback();

    // ── 3. Readability (slower — clones entire DOM) ──
    // Only use if quick extraction got too little
    if (fullText.length < 500
      && typeof Readability === 'function') {
      const clonedDoc = document.cloneNode(true);
      stripDomJunk(clonedDoc);
      const article = new Readability(clonedDoc).parse();

      if (article && article.textContent
        && article.textContent.trim().length > fullText.length) {
        fullText = article.textContent;
        articleHtml = article.content;
        title = article.title || title;
      }
    }

    // Extract LaTeX from MathJax/KaTeX before cleaning
    fullText = inlineMathFromHtml(fullText, articleHtml);

    fullText = cleanText(fullText);
    fullText = stripLeadingMetadata(fullText);
    fullText = stripTrailingJunk(fullText);

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

  // DOM elements to strip before any extraction
  const DOM_JUNK_SELECTORS = [
    // Navigation, chrome, sidebars
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.sidebar', '.toc', '.table-of-contents',
    // Social, sharing, comments
    '.social-share', '.share-buttons', '.sharedaddy', '.sd-sharing',
    '.comments', '.comment-section', '#comments', '.disqus',
    '.jp-relatedposts', '.related-posts', '.related-articles',
    // Subscription / newsletter CTAs
    '.newsletter', '.subscribe', '.signup', '.cta',
    // Cookie banners, modals, consent
    '.cookie-banner', '.consent', '.modal',
    // Author / byline / meta containers
    '.article-meta__author-container', '.article-hero',
    '.article-meta', '.post-header__meta',
    '[class*="author-container"]', '[class*="article-hero"]',
    // Nature.com specific
    '.c-article-references', '.c-article-metrics',
    '.c-article-share-box', '.c-article-identifiers',
    '.c-article-author-list', '.c-article-rights',
    '.c-article-supplementary', '.c-article-additional-information',
    '.c-article-access-provider', '.c-recommendations',
    '[data-test="article-identifier"]',
    // Nature.com extra: recommendations, PDF button, comments
    '.c-article-recommendations', '.c-pdf-download',
    '.c-article-main-column aside',
    '#article-comments-section', '.c-comments',
    '[data-component="article-container"] aside',
    '.c-article-extras',
    // Distill / transformer-circuits
    'd-bibliography', 'd-appendix', 'd-footnote-list',
    // Generic
    '.post-meta', '.entry-meta', '.byline', '.author-info',
    '.breadcrumbs', '.pagination',
    // Scripts, styles
    'script', 'style', 'noscript', 'iframe', 'svg',
  ].join(', ');

  /**
   * Strip noisy DOM elements before Readability or text extraction.
   */
  function stripDomJunk(docOrEl) {
    for (const el of docOrEl.querySelectorAll(DOM_JUNK_SELECTORS)) {
      el.remove();
    }
  }

  function extractFallback() {
    // Stage 1: try known content selectors
    const selectors = [
      'article',
      'd-article',
      '[role="main"]',
      'main',
      '.post-content',
      '.article-content',
      '.article__body',
      '.entry-content',
      '.post-body',
      '.content',
      '#content',
      '.post',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 200) {
        const clone = el.cloneNode(true);
        stripDomJunk(clone);
        const text = clone.innerText.trim();
        if (text.length > 200) return text;
      }
    }

    // Stage 2: content-density scoring — find the element with the
    // most paragraph text, ignoring nav/sidebar/footer junk.
    const best = findDensestContentBlock();
    if (best) return best;

    return document.body.innerText || '';
  }

  /**
   * Score DOM elements by "content density" — the ratio of
   * paragraph text to total text. The element with the most
   * long-paragraph text wins. This handles SPAs and unusual
   * layouts where semantic selectors don't match.
   */
  function findDensestContentBlock() {
    const candidates = document.querySelectorAll(
      'div, section, main, article'
    );
    let bestEl = null;
    let bestScore = 0;

    for (const el of candidates) {
      // Skip tiny or page-wide elements
      const rect = el.getBoundingClientRect();
      if (rect.width < 250 || rect.height < 200) continue;

      // Count paragraph text (long <p> elements = real content)
      const paras = el.querySelectorAll('p');
      let paraChars = 0;
      let longParas = 0;
      for (const p of paras) {
        const len = p.textContent.trim().length;
        if (len > 60) {
          paraChars += len;
          longParas++;
        }
      }

      // Need at least 3 real paragraphs
      if (longParas < 3) continue;

      // Score: paragraph text density relative to total text
      const totalChars = el.textContent.length;
      const density = paraChars / (totalChars || 1);
      // Prefer elements with high density AND enough content
      const score = paraChars * density;

      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    if (!bestEl) return null;

    const clone = bestEl.cloneNode(true);
    stripDomJunk(clone);
    const text = clone.innerText.trim();

    console.log(
      '[WebExtractor] Content-density fallback: '
      + text.length + ' chars'
    );

    return text.length > 200 ? text : null;
  }

  // ---- Leading metadata detection ----
  // Lines that are NOT body prose — metadata, bylines, social, etc.
  const NON_PROSE_LINE_PATTERNS = [
    // Dates: "Jan 5, 2024", "2024-01-05", "December 12, 2023"
    /^(?:(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2},?\s+\d{4}|\d{4}[-\/]\d{2}[-\/]\d{2})/i,
    // "Dec 06, 2023 · 13 min read"
    /^\w+\s+\d{1,2},?\s+\d{4}\s*[·•|—–-]/i,
    // "Posted on ...", "Published ...", "Updated ..."
    /^(?:posted|published|updated|written|created|modified)\s+(?:on\s+|by\s+)?/i,
    // "By Author Name"
    /^by\s+[A-Z][a-z]+/i,
    // "Date: ...", "Author: ...", "Tags: ..."
    /^(?:date|author|tags?|categories?|topics?|reading time)\s*:/i,
    // Social: "Share", "Tweet", "Share this"
    /^(?:share|tweet|pin|email|print|like)\s*$/i,
    /^share\s+(?:this|on|via)/i,
    // "N min read"
    /^\d+\s*min(?:ute)?s?\s*read$/i,
    // "Discussions: ..."
    /^discussions?:\s/i,
    // "Translations: ..."
    /^translations?:\s/i,
    // "Watch: ..."
    /^watch:\s/i,
    // "Featured in courses at ..."
    /^featured\s+in\s+/i,
    // "Update: ..." (author notes before the article)
    /^update:\s/i,
    // "Download PDF" / "PDF: ..."
    /^(?:download\s+)?pdf\s*[:.]?$/i,
    /^pdf:\s/i,
    // "Note: ..." at very start
    /^note:\s/i,
    // HN/Reddit links
    /^(?:hacker\s*news|reddit)\s+/i,
    // "Estimated Reading Time: ..."
    /^estimated\s+reading/i,
    // "Table of Contents"
    /^(?:table of contents|contents)\s*$/i,
    // "Release" (OpenAI style category labels)
    /^(?:release|research|announcement|blog|report)\s*$/i,
    // "Contributions" labels
    /^(?:contributions?|contributors?)\s*$/i,
    // Link-like short lines: "Use o1" "Read more"
    /^(?:use|read|try|get|learn|see|view|open)\s+\w+(?:\s+\w+)?\s*$/i,
    // Video timestamps: "00:00 ..."
    /^\d{1,2}:\d{2}\s/,
    // Breadcrumb navigation
    /^(?:home|blog)\s*[›>\/]/i,
    // "x.com Facebook" social link text
    /^(?:x\.com|facebook|linkedin|twitter|whatsapp)\s*$/i,
    // "Download PDF" / "Download" buttons
    /^download\s*(?:pdf|article)?\s*$/i,
    // "Similar content being viewed by others"
    /^similar\s+content/i,
    // "An Addendum/Correction/Erratum to this article..."
    /^an?\s+(?:addendum|correction|erratum|corrigendum)\s+to\s+this/i,
    // "Article" / "Open access" labels
    /^(?:article|open\s+access|full\s+text|free)\s*$/i,
    // "Commenting on this article is now closed"
    /^commenting\s+on\s+this/i,
    // Date formats: "04 December 2025", "12 Jan 2024"
    /^\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{4}\s*$/i,
    // "Back to Articles", "Return to blog"
    /^(?:back to|return to)\s+/i,
    // "Upvote 889", "Like 42"
    /^(?:upvote|like|clap)\s*\d*/i,
    // "Update on GitHub", "View on GitHub"
    /^(?:update|view|fork|star)\s+on\s+github/i,
    // Author name lists: "Elie Bakouch eliebak Follow Leandro..."
    /^[A-Z][a-z]+\s+[A-Z][a-z]+\s+\w+\s+Follow\s/i,
    // "Community" section label
    /^community\s*$/i,
  ];

  /**
   * Strip leading metadata from extracted text.
   * Strategy: split into lines, skip short non-prose lines at the top
   * until we hit the first line that looks like a real paragraph
   * (80+ chars of prose that doesn't match any junk pattern).
   */
  function stripLeadingMetadata(text) {
    const lines = text.split('\n');
    let firstProseIdx = 0;

    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // If this line is 80+ chars and doesn't match junk, it's prose
      if (line.length >= 80
        && !NON_PROSE_LINE_PATTERNS.some((p) => p.test(line))) {
        firstProseIdx = i;
        break;
      }

      // Short lines at the top — check if they're metadata
      if (line.length < 80) {
        if (NON_PROSE_LINE_PATTERNS.some((p) => p.test(line))) {
          firstProseIdx = i + 1;
          continue;
        }
        // Short line that might be a heading — keep looking
        firstProseIdx = i;
        // But don't skip it if nothing follows
      }
    }

    // Keep the title (first non-empty line) if it looks like a heading
    // and we're skipping metadata lines after it
    let startIdx = firstProseIdx;
    if (firstProseIdx > 0) {
      // Find the first non-empty line — it's likely the title
      for (let i = 0; i < firstProseIdx; i++) {
        const line = lines[i].trim();
        if (line && line.length > 3 && line.length < 150
          && !NON_PROSE_LINE_PATTERNS.some((p) => p.test(line))) {
          // This could be the article title — keep it
          // But only if the immediately next lines are metadata
          break;
        }
      }
    }

    return lines.slice(startIdx).join('\n').trimStart();
  }

  // ---- Trailing junk patterns ----
  const TRAILING_JUNK_PATTERNS = [
    /(?:share\s+this|posted\s+in|filed\s+under|tags?:)[^\n]*$/i,
    /(?:leave\s+a\s+comment|comments?\s*\(\d+\))[^\n]*$/i,
    /(?:subscribe|sign\s+up\s+for\s+(?:our|the)\s+newsletter)[^\n]*$/i,
    /(?:related\s+(?:posts?|articles?|reading))\s*$/i,
    /(?:\d+\s*(?:likes?|shares?|retweets?))\s*$/i,
    // Trailing "POSTED IN:" category labels
    /\s*(?:posted|filed|published|categorized)\s+in\s*:?\s*$/i,
    // Trailing share/social buttons text
    /\s*(?:x\.com|facebook|linkedin|whatsapp|copy\s+link)\s*$/i,
  ];

  /**
   * Strip trailing junk from extracted text.
   */
  function stripTrailingJunk(text) {
    let result = text.trimEnd();
    for (const pattern of TRAILING_JUNK_PATTERNS) {
      result = result.replace(pattern, '').trimEnd();
    }
    return result;
  }

  /**
   * Extract LaTeX from MathJax/KaTeX alt-text or annotation elements
   * and tag them as [equation:<latex>] for downstream processing.
   */
  function inlineMathFromHtml(text, html) {
    if (!html) return text;

    const div = document.createElement('div');
    div.innerHTML = html;

    // MathJax uses <script type="math/tex"> or <span class="MathJax">
    // with alt text; KaTeX uses <span class="katex"> with
    // <annotation encoding="application/x-tex">
    const annotations = div.querySelectorAll(
      'annotation[encoding="application/x-tex"], '
      + 'script[type="math/tex"], '
      + 'script[type="math/tex; mode=display"]'
    );

    // If there are no math annotations, return text as-is
    if (annotations.length === 0) return text;

    // For HTML papers with math, replace MathJax rendered text with
    // equation markers containing the LaTeX source
    const mathElements = div.querySelectorAll(
      '.MathJax, .MathJax_Display, .katex, .katex-display, '
      + 'mjx-container, .MathJax_SVG'
    );

    for (const el of mathElements) {
      const annotation = el.querySelector(
        'annotation[encoding="application/x-tex"]'
      );
      const script = el.querySelector(
        'script[type="math/tex"], script[type="math/tex; mode=display"]'
      );

      let latex = '';
      if (annotation) {
        latex = annotation.textContent.trim();
      } else if (script) {
        latex = script.textContent.trim();
      } else if (el.getAttribute('alt')) {
        latex = el.getAttribute('alt').trim();
      }

      if (latex) {
        // Replace the math element's text representation with a tagged marker
        const rendered = el.textContent.trim();
        if (rendered && text.includes(rendered)) {
          text = text.replace(rendered, `[equation:${latex}]`);
        }
      }
    }

    return text;
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
        outlineLevel: Math.max(
          0,
          parseInt(h.tagName[1], 10) - 1
        ),
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
        outlineLevel: Math.max(
          0,
          parseInt(h.tagName[1], 10) - 1
        ),
        isReferences: /^references$/i.test(headingText)
          || /^bibliography$/i.test(headingText),
        isAbstract: /^abstract$/i.test(headingText)
          || /^summary$/i.test(headingText),
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

  // ---- Text cleaning (mirrors cleanSpecialContent for web path) ----

  // Metadata junk patterns
  const METADATA_JUNK_PATTERNS = [
    /permission to (?:make|copy)\s+digital/i,
    /copyright\s+(?:©|\(c\))\s*\d{4}/i,
    /licensed under (?:a )?creative commons/i,
    /all rights reserved/i,
    /\barXiv:\s*\d{4}\.\d{4,5}/i,
    /\bDOI:\s*\S+/i,
    /\bISSN:\s*\S+/i,
    /\bISBN:\s*\S+/i,
    /ACM Reference Format:/i,
    /^(?:submitted|received|accepted|revised|published)\s*:?\s*(?:on\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|\d)/i,
    /^keywords\s*:/i,
    /^categories\s*:/i,
    /^(?:CCS )?concepts\s*:/i,
    /^\{?[\w.+-]+@[\w.-]+\}?$/,
    /^[\w.+-]+@[\w.-]+(?:,\s*[\w.+-]+@[\w.-]+)*$/,
  ];

  // Figure/table captions
  const FIGURE_TABLE_CAPTION_RE =
    /^(?:figure|fig\.|table|tab\.)\s*\d+[.:]/i;

  // Square bracket numeric citations
  const SQUARE_BRACKET_CITATION_RE =
    /\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\]/g;

  // Parenthetical author-year citation support
  const YEAR_RE = /(?:19|20)\d{2}[a-z]?/i;
  const TRAILING_YEAR_RE =
    /(?:19|20)\d{2}[a-z]?(?:,\s*(?:p|pp)\.?\s*\d+(?:\s*[-–]\s*\d+)?)?$/i;
  const CIT_PREFIX_RE =
    /^(?:see(?: also)?|e\.g\.,?|i\.e\.,?|cf\.|compare|contra|but see|for example|for discussion)\s+/i;
  const AUTHOR_CONNECTORS = new Set([
    '&', 'al', 'and', 'da', 'de', 'del', 'der', 'di',
    'et', 'la', 'le', 'van', 'von',
  ]);
  const NON_AUTHOR = new Set([
    'algorithm', 'april', 'appendix', 'august', 'chapter',
    'december', 'equation', 'february', 'figure', 'friday',
    'january', 'july', 'june', 'march', 'monday', 'november',
    'october', 'saturday', 'section', 'september', 'sunday',
    'table', 'thursday', 'tuesday', 'wednesday',
  ]);

  // Unicode math symbols → spoken
  const UNICODE_MATH = [
    [/∈/g, ' in '], [/∉/g, ' not in '],
    [/∀/g, ' for all '], [/∃/g, ' there exists '],
    [/∑/g, ' the sum of '], [/∏/g, ' the product of '],
    [/∫/g, ' the integral of '], [/∂/g, ' partial '],
    [/∇/g, ' the gradient of '], [/∞/g, ' infinity '],
    [/∝/g, ' proportional to '],
    [/·/g, ' times '], [/×/g, ' times '], [/÷/g, ' divided by '],
    [/≠/g, ' not equal to '], [/≡/g, ' equivalent to '],
    [/⊂/g, ' subset of '], [/⊃/g, ' superset of '],
    [/⊆/g, ' subset of or equal to '],
    [/⊇/g, ' superset of or equal to '],
    [/∅/g, ' the empty set '],
    [/∩/g, ' intersection '], [/∪/g, ' union '],
    [/¬/g, ' not '], [/∧/g, ' and '], [/∨/g, ' or '],
    [/⟨/g, ''], [/⟩/g, ''], [/‖/g, ' norm of '],
    [/√/g, ' the square root of '],
    [/ℝ/g, ' R '], [/ℤ/g, ' Z '], [/ℕ/g, ' N '],
    [/ℂ/g, ' C '], [/ℚ/g, ' Q '],
  ];

  // Superscript/subscript maps
  const SUPER_MAP = {
    '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4',
    '⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9',
    '⁺':'+','⁻':'-','⁼':'=','⁽':'(','⁾':')',
    'ⁿ':'n','ⁱ':'i',
  };
  const SUB_MAP = {
    '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4',
    '₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
    '₊':'+','₋':'-','₌':'=','₍':'(','₎':')',
  };

  function isAuthorToken(tok) {
    if (!tok) return false;
    if (/^[A-Z][A-Za-z'`-]*$/.test(tok)) {
      return !NON_AUTHOR.has(tok.toLowerCase());
    }
    return false;
  }

  function isAuthorList(text) {
    if (!text) return false;
    const norm = text.replace(/\bet\s+al\.?$/i, 'et al')
      .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!norm) return false;
    const tokens = norm.split(' ');
    let found = false;
    for (const t of tokens) {
      if (AUTHOR_CONNECTORS.has(t.toLowerCase())) continue;
      if (!isAuthorToken(t)) return false;
      found = true;
    }
    return found;
  }

  function isCitSegment(seg) {
    const trimmed = seg.replace(CIT_PREFIX_RE, '').replace(/\s+/g, ' ').trim();
    if (!trimmed || !YEAR_RE.test(trimmed)) return false;
    const m = trimmed.match(TRAILING_YEAR_RE);
    if (!m || m.index === undefined) return false;
    const auth = trimmed.slice(0, m.index).replace(/,\s*$/, '').trim();
    return isAuthorList(auth);
  }

  function stripParenCitations(text) {
    return text.replace(/\(([^()]*)\)/g, (match, content) => {
      const parts = content.split(/\s*;\s*/).map(s => s.trim()).filter(Boolean);
      if (parts.length === 0) return match;
      return parts.every(isCitSegment) ? '' : match;
    });
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

    // Rejoin hyphenated words across lines
    cleaned = cleaned.replace(/(\w)-\s+([a-z])/g, '$1$2');

    // Replace long URLs
    cleaned = cleaned.replace(
      /https?:\/\/[^\s]{40,}/g, 'link'
    );

    // Remove metadata junk lines
    cleaned = cleaned.split('\n').filter((line) => {
      const t = line.trim();
      if (!t) return true;
      return !METADATA_JUNK_PATTERNS.some((p) => p.test(t));
    }).join('\n');

    // Remove figure/table captions
    cleaned = cleaned.split('\n').filter((line) => {
      return !FIGURE_TABLE_CAPTION_RE.test(line.trim());
    }).join('\n');

    // Strip parenthetical author-year citations
    cleaned = stripParenCitations(cleaned);

    // Strip square bracket numeric citations
    cleaned = cleaned.replace(SQUARE_BRACKET_CITATION_RE, '');

    // Deduplicate equation markers
    cleaned = cleaned.replace(
      /(\[equation(?::[^\]]*?)?\]\s*)+/g,
      (match) => {
        const first = match.match(/\[equation(?::[^\]]*?)?\]/);
        return first ? first[0] + ' ' : match;
      }
    );

    // Convert superscript/subscript Unicode
    const superRe = new RegExp(
      `[${Object.keys(SUPER_MAP).join('')}]+`, 'g'
    );
    cleaned = cleaned.replace(superRe, (m) => {
      const d = [...m].map(ch => SUPER_MAP[ch] || ch).join('');
      return ` to the ${d}`;
    });
    const subRe = new RegExp(
      `[${Object.keys(SUB_MAP).join('')}]+`, 'g'
    );
    cleaned = cleaned.replace(subRe, (m) => {
      const d = [...m].map(ch => SUB_MAP[ch] || ch).join('');
      return ` sub ${d}`;
    });

    // Convert Unicode math symbols to words
    for (const [p, r] of UNICODE_MATH) {
      cleaned = cleaned.replace(p, r);
    }

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
      .replace(/≥/g, ' greater than or equal to ')
      .replace(/→/g, ' leads to ')
      .replace(/←/g, ' from ');

    return cleaned.trim();
  }
})();
