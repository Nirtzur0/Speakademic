/**
 * Equationeer API client.
 *
 * Manages equation thread lifecycle and fetches equation explanations
 * from the Equationeer service for inline TTS narration.
 */

const EQUATIONEER_LOCAL_URL = 'http://localhost:8000';
const EQUATIONEER_CLOUD_URL = 'https://eq.speakademic.com';

class EquationeerClient {
  constructor() {
    this._baseUrl = EQUATIONEER_LOCAL_URL;
    this._threadId = null;
    this._explanationCache = new Map();
    this._pending = new Map();
  }

  /** Set the base URL (local or cloud). */
  setBaseUrl(url) {
    this._baseUrl = url.replace(/\/+$/, '');
  }

  /** Check if the Equationeer service is reachable. */
  async isHealthy() {
    try {
      const resp = await fetch(`${this._baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create a new equation thread for a document.
   * Call this when playback starts.
   */
  async createThread(paperTitle = '', paperAbstract = '', domain = null) {
    const body = { paper_title: paperTitle, paper_abstract: paperAbstract };
    if (domain) body.domain = domain;

    const resp = await this._post('/threads', body);
    this._threadId = resp.thread_id;
    this._explanationCache.clear();
    this._pending.clear();

    console.log(
      `[Equationeer] Thread created: ${this._threadId}`
      + ` (domain: ${resp.domain})`
    );

    return resp;
  }

  /**
   * Add an equation to the current thread and get its explanation.
   * Returns the TTS narration text for inline playback.
   *
   * @param {string} latex - LaTeX string of the equation
   * @param {string} preContext - Text before the equation
   * @param {string} postContext - Text after the equation
   * @param {string} section - Current section name
   * @returns {Promise<string>} TTS narration text
   */
  async explainEquation(latex, preContext = '', postContext = '', section = '') {
    if (!this._threadId) {
      console.warn('[Equationeer] No active thread');
      return null;
    }

    // Check cache by latex content
    const cacheKey = latex.trim();
    if (this._explanationCache.has(cacheKey)) {
      return this._explanationCache.get(cacheKey);
    }

    // Deduplicate in-flight requests
    if (this._pending.has(cacheKey)) {
      return this._pending.get(cacheKey);
    }

    const promise = this._fetchExplanation(
      latex, preContext, postContext, section
    );
    this._pending.set(cacheKey, promise);

    try {
      const result = await promise;
      this._pending.delete(cacheKey);
      return result;
    } catch (err) {
      this._pending.delete(cacheKey);
      throw err;
    }
  }

  async _fetchExplanation(latex, preContext, postContext, section) {
    // 1. Add the equation to the thread
    const addResp = await this._post(
      `/threads/${this._threadId}/equations`,
      {
        raw_latex: latex,
        pre_context: preContext,
        post_context: postContext,
        section: section,
      }
    );

    const eqId = addResp.equation_id;

    // 2. Get the explanation (runs the full prompt chain)
    const explainResp = await this._post(
      `/threads/${this._threadId}/equations/${eqId}/explain`,
      { include_tts: true }
    );

    const narration = explainResp.level4_tts || null;

    // Cache the result
    if (narration) {
      this._explanationCache.set(latex.trim(), narration);
    }

    console.log(
      `[Equationeer] Eq ${eqId} explained`
      + ` (${narration ? narration.split(' ').length : 0} words)`
    );

    return narration;
  }

  /**
   * Upload an equation image and get its explanation.
   * For image-based equation capture.
   */
  async explainEquationImage(imageBlob, preContext = '', postContext = '', section = '') {
    if (!this._threadId) {
      console.warn('[Equationeer] No active thread');
      return null;
    }

    const formData = new FormData();
    formData.append('image', imageBlob, 'equation.png');
    formData.append('pre_context', preContext);
    formData.append('post_context', postContext);
    formData.append('section', section);
    formData.append('validate', 'true');

    const resp = await fetch(
      `${this._baseUrl}/threads/${this._threadId}/equations/ocr`,
      { method: 'POST', body: formData }
    );

    if (!resp.ok) {
      throw new Error(`OCR failed: ${resp.status}`);
    }

    const ocrResult = await resp.json();
    const eqId = ocrResult.equation_id;

    // Now get the explanation
    const explainResp = await this._post(
      `/threads/${this._threadId}/equations/${eqId}/explain`,
      { include_tts: true }
    );

    return explainResp.level4_tts || null;
  }

  /**
   * Close the current thread.
   * Call this when playback stops.
   */
  closeThread() {
    if (this._threadId) {
      // Fire-and-forget delete
      fetch(`${this._baseUrl}/threads/${this._threadId}`, {
        method: 'DELETE',
      }).catch(() => {});

      console.log(`[Equationeer] Thread closed: ${this._threadId}`);
      this._threadId = null;
      this._explanationCache.clear();
      this._pending.clear();
    }
  }

  /** Get the current thread ID. */
  get threadId() {
    return this._threadId;
  }

  /** Get the number of cached explanations. */
  get cacheSize() {
    return this._explanationCache.size;
  }

  async _post(path, body) {
    const resp = await fetch(`${this._baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(
        `Equationeer API error ${resp.status}: ${text.slice(0, 200)}`
      );
    }

    return resp.json();
  }
}

export { EquationeerClient, EQUATIONEER_LOCAL_URL, EQUATIONEER_CLOUD_URL };
