/* ==========================================================================
   ai-trainer.js — optional bring-your-own-key AI coach + Course audio.

   Roles (locked):
     DeepSeek  → AI Trainer coach + spoken lesson SCRIPT (text only)
     OpenAI    → TTS voice only (Southern / Texas instructor style)
     Browser   → free fallback if OpenAI TTS unavailable

   The core course never depends on this module. No keys → app still works.
   Keys stay in localStorage on this device only.
   ========================================================================== */

window.AITrainer = (function () {
  'use strict';

  const STORAGE_KEY = 'vcf9.aiTrainer';
  const SCRIPT_CACHE_KEY = 'vcf9.audioScripts';

  const PROVIDERS = {
    openai: {
      id: 'openai',
      label: 'OpenAI',
      defaultBase: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
      role: 'TTS voice (Southern / Texas instructor)'
    },
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek',
      defaultBase: 'https://api.deepseek.com',
      defaultModel: 'deepseek-chat',
      role: 'AI Trainer coach + spoken lesson scripts'
    }
  };

  const DEFAULT_TTS_VOICE = 'coral';
  const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
  const DEFAULT_TTS_STYLE = [
    'Speak in a warm, clear Southern American (Texas) accent.',
    'Sound like a patient human instructor — natural, easy to understand, unhurried.',
    'Moderate pace. Plain words. No slang overload. No robotic cadence. No cartoon voice.'
  ].join(' ');

  const defaultConfig = () => ({
    enabled: false,
    quorum: false,
    openai: {
      enabled: true,
      apiKey: '',
      baseUrl: PROVIDERS.openai.defaultBase,
      model: PROVIDERS.openai.defaultModel,
      ttsModel: DEFAULT_TTS_MODEL,
      ttsVoice: DEFAULT_TTS_VOICE,
      ttsStyle: DEFAULT_TTS_STYLE
    },
    deepseek: {
      enabled: true,
      apiKey: '',
      baseUrl: PROVIDERS.deepseek.defaultBase,
      model: PROVIDERS.deepseek.defaultModel
    }
  });

  function loadConfig() {
    const base = defaultConfig();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      return {
        enabled: !!parsed.enabled,
        quorum: !!parsed.quorum,
        openai: Object.assign({}, base.openai, parsed.openai || {}),
        deepseek: Object.assign({}, base.deepseek, parsed.deepseek || {})
      };
    } catch (err) {
      return base;
    }
  }

  function hasKey(providerCfg) {
    return !!(providerCfg && String(providerCfg.apiKey || '').trim());
  }

  function keyFingerprint(key) {
    const k = String(key || '').trim();
    if (!k) return '';
    if (k.length <= 8) return '••••';
    return `${k.slice(0, 3)}…${k.slice(-4)}`;
  }

  /**
   * Persist BYOK settings to localStorage.
   * Blank API key fields keep the previously saved key (avoids browser
   * password-field wipe on Save). Pass clearOpenAiKey / clearDeepSeekKey to wipe.
   */
  function saveConfig(cfg, opts) {
    const base = defaultConfig();
    const prev = loadConfig();
    const o = opts || {};

    let openAiKey = String((cfg.openai && cfg.openai.apiKey) || '').trim();
    let deepSeekKey = String((cfg.deepseek && cfg.deepseek.apiKey) || '').trim();
    if (o.clearOpenAiKey) openAiKey = '';
    else if (!openAiKey && hasKey(prev.openai)) openAiKey = prev.openai.apiKey;
    if (o.clearDeepSeekKey) deepSeekKey = '';
    else if (!deepSeekKey && hasKey(prev.deepseek)) deepSeekKey = prev.deepseek.apiKey;

    const next = {
      enabled: !!cfg.enabled,
      quorum: !!cfg.quorum,
      openai: {
        enabled: !!(cfg.openai && cfg.openai.enabled),
        apiKey: openAiKey,
        baseUrl: String((cfg.openai && cfg.openai.baseUrl) || base.openai.baseUrl).trim() || base.openai.baseUrl,
        model: String((cfg.openai && cfg.openai.model) || base.openai.model).trim() || base.openai.model,
        ttsModel: String((cfg.openai && cfg.openai.ttsModel) || base.openai.ttsModel).trim() || base.openai.ttsModel,
        ttsVoice: String((cfg.openai && cfg.openai.ttsVoice) || base.openai.ttsVoice).trim() || base.openai.ttsVoice,
        ttsStyle: String((cfg.openai && cfg.openai.ttsStyle) || base.openai.ttsStyle).trim() || base.openai.ttsStyle
      },
      deepseek: {
        enabled: !!(cfg.deepseek && cfg.deepseek.enabled),
        apiKey: deepSeekKey,
        baseUrl: String((cfg.deepseek && cfg.deepseek.baseUrl) || base.deepseek.baseUrl).trim() || base.deepseek.baseUrl,
        model: String((cfg.deepseek && cfg.deepseek.model) || base.deepseek.model).trim() || base.deepseek.model
      }
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      /* Round-trip verify */
      const verify = localStorage.getItem(STORAGE_KEY);
      if (!verify) throw new Error('localStorage write did not stick');
      const parsed = JSON.parse(verify);
      next._persisted = true;
      next._openAiSaved = hasKey(parsed.openai);
      next._deepSeekSaved = hasKey(parsed.deepseek);
      return next;
    } catch (err) {
      console.warn('Could not save AI Trainer BYOK settings:', err);
      next._persisted = false;
      next._persistError = err.message || String(err);
      next._openAiSaved = hasKey(next.openai);
      next._deepSeekSaved = hasKey(next.deepseek);
      return next;
    }
  }

  function clearKeys() {
    const cfg = loadConfig();
    return saveConfig({
      enabled: false,
      quorum: false,
      openai: Object.assign({}, cfg.openai, { apiKey: '', enabled: false }),
      deepseek: Object.assign({}, cfg.deepseek, { apiKey: '', enabled: false })
    }, { clearOpenAiKey: true, clearDeepSeekKey: true });
  }

  function activeProviders(cfg) {
    const c = cfg || loadConfig();
    if (!c.enabled) return [];
    const list = [];
    /* DeepSeek first — preferred coach / script writer */
    if (c.deepseek.enabled && c.deepseek.apiKey) {
      list.push({ id: 'deepseek', ...c.deepseek, label: PROVIDERS.deepseek.label });
    }
    if (c.openai.enabled && c.openai.apiKey) {
      list.push({ id: 'openai', ...c.openai, label: PROVIDERS.openai.label });
    }
    return list;
  }

  function deepseekProvider(cfg) {
    const c = cfg || loadConfig();
    if (!(c.enabled && c.deepseek && c.deepseek.enabled && c.deepseek.apiKey)) return null;
    return { id: 'deepseek', ...c.deepseek, label: PROVIDERS.deepseek.label };
  }

  function openaiProvider(cfg) {
    const c = cfg || loadConfig();
    if (!(c.openai && c.openai.enabled && c.openai.apiKey)) return null;
    return { id: 'openai', ...c.openai, label: PROVIDERS.openai.label };
  }

  function isReady(cfg) {
    return activeProviders(cfg).length > 0;
  }

  function isCoachReady(cfg) {
    return !!deepseekProvider(cfg) || !!openaiProvider(cfg);
  }

  function isTtsReady(cfg) {
    return !!openaiProvider(cfg);
  }

  async function chatCompletions(provider, messages, signal, opts) {
    const base = String(provider.baseUrl || '').replace(/\/+$/, '');
    const url = `${base}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.2,
        max_tokens: (opts && opts.maxTokens) || 900,
        messages
      })
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { /* non-JSON */ }
    if (!res.ok) {
      const msg = (data && (data.error && data.error.message || data.message)) || text || res.statusText;
      throw new Error(`${provider.label || provider.id}: ${msg}`);
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!content) throw new Error(`${provider.label || provider.id}: empty response`);
    return String(content).trim();
  }

  function systemPrompt(contextText) {
    return [
      'You are the VCF-9 AI Trainer — a short Q&A coach inside a VMware Cloud Foundation 9 Architect study app.',
      '',
      'STYLE (hard rules):',
      '- Default: 2–5 short sentences, or a tight bullet list. Match the question size — a definition gets a definition, not a lecture.',
      '- If the learner asks for short / brief / yes-no, stay under ~60 words and stop.',
      '- Do NOT re-explain a term already covered in this chat unless they ask to expand.',
      '- Do NOT end with quizzes, self-checks, “want to practice?”, or offers to continue unless they ask.',
      '- Do NOT add “Architect decision rule”, “Why it matters”, Rainpole walkthroughs, or 9.1 notes unless asked or directly needed to answer.',
      '- Prefer plain text. No markdown tables. Minimal bold.',
      '',
      'FACTS:',
      '- You are only called when local course lookup did not find a clear answer. Stay brief; do not pad.',
      '- Prefer the CURRENT CONTEXT and Broadcom-aligned product facts.',
      '- Never invent Rainpole BRs, NFRs, IDs, or numbers not in context. Say: Not stated in course materials — treat as assumption to validate.',
      '- 9.1 is informational only when relevant; do not invalidate a valid baseline answer solely due to 9.1.',
      '- Do not invent exam keys. Do not claim to unlock Course Next — grading is local.',
      '- For drawings: name fact-sheet objects and say what/why briefly.',
      '',
      'CURRENT CONTEXT:',
      contextText || '(no page context)'
    ].join('\n');
  }

  function historyMessages(history) {
    const list = Array.isArray(history) ? history : [];
    const out = [];
    list.slice(-10).forEach(item => {
      if (!item || !item.text) return;
      const role = item.role === 'assistant' ? 'assistant' : 'user';
      const text = String(item.text).trim().slice(0, 2500);
      if (!text) return;
      out.push({ role, content: text });
    });
    return out;
  }

  function normalizeLookup(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9+/.\s-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function firstSentences(text, max) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    const parts = clean.split(/(?<=[.!?])\s+/);
    return parts.slice(0, max || 2).join(' ').trim();
  }

  function extractLookupTerms(question) {
    const q = String(question || '').trim();
    const lower = q.toLowerCase();
    const terms = [];
    const patterns = [
      /\b(?:what(?:'s| is| does)|whats)\s+(?:the\s+)?(?:term\s+)?([a-z0-9][a-z0-9+/.\s-]{1,40}?)\s+(?:mean|stand for)\b/i,
      /\b(?:what does|whats)\s+([a-z0-9][a-z0-9+/.\s-]{1,40}?)\s+stand for\b/i,
      /\b(?:define|meaning of|explain)\s+(?:the\s+)?([a-z0-9][a-z0-9+/.\s-]{1,48})/i,
      /\bin (?:the )?(?:vcf|vmware|course|architect)[^?]*\b(?:what is|whats|what'?s)\s+(?:the\s+)?([a-z0-9][a-z0-9+/.\s-]{1,40})\b/i,
      /\b(?:what is|whats|what'?s)\s+(?:the\s+)?([a-z0-9][a-z0-9+/.\s-]{1,48})\??$/i,
      /\b([A-Z]{2,12})\b/,
      /\b([a-z]{2,12})\s+is a\b/i
    ];
    patterns.forEach(re => {
      const m = q.match(re);
      if (m && m[1]) terms.push(normalizeLookup(m[1]));
    });
    /* Also keep compact tokens from short questions */
    if (lower.length <= 48) {
      const stripped = normalizeLookup(q)
        .replace(/\b(what|whats|is|are|does|do|the|a|an|mean|means|stand|for|term|in|vcf|context|please|tell|me|about|of|define|explain)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (stripped) terms.push(stripped);
    }
    return [...new Set(terms.filter(t => t && t.length >= 2 && t.length <= 48))];
  }

  function isDefinitionalQuestion(question) {
    const q = normalizeLookup(question);
    if (!q) return false;
    if (/\b(compare|difference|vs|versus|why should|how would|walk me|design for|classify this|scenario)\b/.test(q)) {
      return false;
    }
    return (
      /\b(what is|whats|what does|stand for|mean|means|define|meaning of|explain)\b/.test(q)
      || /\bis a (classification|framework|method|lens|model)\b/.test(q)
      || (q.length <= 36 && /^[a-z0-9+/.\s-]{2,36}$/.test(q))
    );
  }

  function scoreNameMatch(term, name) {
    const t = normalizeLookup(term);
    const n = normalizeLookup(name);
    if (!t || !n) return 0;
    if (t === n) return 100;
    if (n.startsWith(t + ' ') || n.endsWith(' ' + t) || n.includes(' ' + t + ' ')) return 92;
    if (n.includes(t) && t.length >= 3) return 80;
    /* acronym from leading capitals / first letters of words */
    const acronym = String(name).match(/\b[A-Z]{2,12}\b/);
    if (acronym && normalizeLookup(acronym[0]) === t) return 98;
    const initials = String(name).split(/\s+/).map(w => w[0] || '').join('').toLowerCase();
    if (t.length >= 3 && initials === t) return 90;
    return 0;
  }

  function collectLocalCandidates() {
    const items = [];
    if (!window.DataLoader || typeof DataLoader.getModules !== 'function') return items;
    const modules = DataLoader.getModules() || [];
    modules.forEach(m => {
      (m.components || []).forEach(c => {
        items.push({
          kind: 'component',
          module: `Module ${m.number}: ${m.title}`,
          name: c.name,
          text: [c.what, c.how].filter(Boolean).join(' '),
          short: c.what
        });
      });
      (m.keyFacts || []).forEach(f => {
        items.push({
          kind: 'fact',
          module: `Module ${m.number}: ${m.title}`,
          name: f.text.slice(0, 80),
          text: f.text,
          short: f.text
        });
      });
      if (m.study && m.study.highlights) {
        m.study.highlights.forEach(h => {
          items.push({
            kind: 'highlight',
            module: `Module ${m.number}: ${m.title}`,
            name: h.title,
            text: h.text,
            short: firstSentences(h.text, 2)
          });
        });
      }
      if (m.course && m.course.sections) {
        m.course.sections.forEach(s => {
          items.push({
            kind: 'section',
            module: `Module ${m.number}: ${m.title}`,
            name: s.title,
            text: s.body || '',
            short: firstSentences(s.body, 2)
          });
        });
      }
      if (m.lesson && m.lesson.what) {
        items.push({
          kind: 'lesson',
          module: `Module ${m.number}: ${m.title}`,
          name: m.title,
          text: [m.lesson.what, m.lesson.how].filter(Boolean).join(' '),
          short: m.lesson.what
        });
      }
    });
    if (typeof DataLoader.getFigures === 'function') {
      (DataLoader.getFigures() || []).forEach(fig => {
        (fig.objects || []).forEach(o => {
          items.push({
            kind: 'figure',
            module: fig.title,
            name: o.name,
            text: [o.what, o.why].filter(Boolean).join(' '),
            short: o.what
          });
        });
      });
    }
    return items;
  }

  function formatLocalAnswer(hit, question) {
    const q = normalizeLookup(question);
    const name = hit.name || '';
    const body = firstSentences(hit.short || hit.text, 2);
    if (!body) return null;

    if (/\bstand for\b/.test(q) || /\bmean\b/.test(q)) {
      const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const equals = String(hit.text || '').match(new RegExp(`${escaped}\\s+equals\\s+([^.]+)\\.?`, 'i'));
      if (equals) return `${name} stands for ${equals[1].trim()}.`;
      /* Common course acronyms when the hit is the named component */
      if (/RCAR/i.test(name) || /^rcar$/i.test(normalizeLookup(name))) {
        return 'RCAR stands for Requirements, Constraints, Assumptions, and Risks.';
      }
      if (/AMPRS/i.test(name) || /^amprs$/i.test(normalizeLookup(name))) {
        return 'AMPRS stands for Availability, Manageability, Performance, Recoverability, and Security.';
      }
    }

    if (/\bis a (classification|framework|method|lens)/.test(q)) {
      const yes = /classification|framework|method|lens|scheme/i.test(hit.text || hit.short || hit.name || '');
      if (yes) {
        const core = hit.kind === 'fact' && /\bequals\b/i.test(hit.text || '')
          ? firstSentences((hit.short || hit.text || '').replace(/^[^.]+\bequals\b/i, '').trim(), 1)
          : firstSentences(hit.short || hit.text, 1);
        const label = /RCAR/i.test(hit.name) || /rcar/.test(q) ? 'RCAR'
          : /AMPRS/i.test(hit.name) || /amprs/.test(q) ? 'AMPRS'
          : (hit.name || 'That');
        if (core && !/\bequals\b/i.test(hit.text || '')) {
          return `Yes. ${core}`;
        }
        return `Yes — ${label} is a classification method (Requirements, Constraints, Assumptions, Risks).`;
      }
    }

    if (hit.kind === 'fact') return body;
    if (hit.kind === 'component') {
      return `${name}: ${body}`;
    }
    return `${name} — ${body}`;
  }

  /**
   * Local-first coach: answer from authored course data when confidence is high.
   * Returns null when the question needs generative help (burns tokens).
   */
  function answerLocally(question, contextText) {
    const q = String(question || '').trim();
    if (!q) return null;

    if (/^(keep|make).{0,24}(short|brief)|^(be|stay)\s+(short|brief)|shorter answers|short answers please/i.test(q)
        && q.length < 100) {
      return {
        text: 'Got it — short answers from here.',
        confidence: 100,
        source: 'preference'
      };
    }

    if (!isDefinitionalQuestion(q) && !/\bis a (classification|framework|method)/i.test(q)) {
      return null;
    }

    const terms = extractLookupTerms(q);
    if (!terms.length) return null;

    const candidates = collectLocalCandidates();
    if (!candidates.length) return null;

    const contextBoost = normalizeLookup(contextText || '');
    const confirmQ = /\bis a (classification|framework|method|lens)/i.test(q);
    let best = null;

    candidates.forEach(item => {
      let score = 0;
      terms.forEach(term => {
        score = Math.max(score, scoreNameMatch(term, item.name));
        const nText = normalizeLookup(item.text);
        if (term.length >= 4 && nText.startsWith(term + ' equals')) score = Math.max(score, 96);
        if (term.length >= 4 && nText.includes(term + ' equals')) score = Math.max(score, 90);
        if (term.length >= 4 && new RegExp(`\\b${term}\\b`).test(nText) && item.kind === 'fact') {
          score = Math.max(score, 70);
        }
      });
      if (confirmQ && /classification|framework|scheme|method|lens/i.test(item.text || item.name || '')) {
        score += 8;
        if (item.kind === 'component') score += 12;
      }
      if (contextBoost && normalizeLookup(item.module).split(' ').some(w => contextBoost.includes(w) && w.length > 4)) {
        score += 4;
      }
      if (item.kind === 'component') score += 2;
      if (score > 0 && (!best || score > best.score)) {
        best = { item, score };
      }
    });

    /* High bar: only burn zero tokens when we clearly matched authored content */
    if (!best || best.score < 86) return null;

    const text = formatLocalAnswer(best.item, q);
    if (!text) return null;

    return {
      text,
      confidence: best.score,
      source: best.item.kind,
      module: best.item.module
    };
  }

  async function ask(question, contextText, opts) {
    let q = String(question || '').trim();
    if (!q) throw new Error('Ask a question first.');

    let forceAi = false;
    if (/^(ask ai:|use ai:)\s*/i.test(q)) {
      forceAi = true;
      q = q.replace(/^(ask ai:|use ai:)\s*/i, '').trim();
      if (!q) throw new Error('Ask a question after “ask ai:”.');
    }

    if (!forceAi && !(opts && opts.forceAi)) {
      const local = answerLocally(q, contextText);
      if (local) {
        return {
          mode: 'local',
          answers: [{
            provider: 'local',
            label: 'Course materials',
            text: local.text
          }],
          note: local.module ? `Local · ${local.module}` : 'Local · no API tokens used'
        };
      }
    }

    const cfg = loadConfig();
    /* Coach = DeepSeek only. OpenAI is TTS — use OpenAI chat only if DeepSeek is unavailable. */
    const deepseek = deepseekProvider(cfg);
    const openai = openaiProvider(cfg);
    const coach = deepseek || openai;
    if (!coach) {
      throw new Error('No clear local answer, and AI Trainer is not ready. Enable DeepSeek under AI Trainer, or rephrase using a course term.');
    }

    const prior = historyMessages(opts && opts.history);
    /* Drop a trailing duplicate of this user turn if the UI already appended it. */
    const histQ = String(question || '').trim();
    if (prior.length && prior[prior.length - 1].role === 'user'
        && (prior[prior.length - 1].content === q || prior[prior.length - 1].content === histQ)) {
      prior.pop();
    }

    const messages = [
      { role: 'system', content: systemPrompt(contextText) },
      ...prior,
      { role: 'user', content: q }
    ];

    const signal = opts && opts.signal;
    const answer = await chatCompletions(coach, messages, signal, { maxTokens: 450 });
    return {
      mode: 'single',
      answers: [{ provider: coach.id, label: coach.label, text: answer }],
      note: (deepseek ? null : 'DeepSeek unavailable — used OpenAI chat as emergency coach. Prefer DeepSeek for AI Trainer.')
    };
  }

  function normalizeForCompare(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400);
  }

  async function probeOpenAiTts(provider, signal) {
    const base = String(provider.baseUrl || '').replace(/\/+$/, '');
    const url = `${base}/audio/speech`;
    const model = provider.ttsModel || DEFAULT_TTS_MODEL;
    const voice = provider.ttsVoice || DEFAULT_TTS_VOICE;
    const body = {
      model: model === 'tts-1' ? 'tts-1' : model,
      voice,
      input: 'OK'
    };
    if (body.model !== 'tts-1') body.instructions = 'Speak clearly and briefly.';

    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(errText || res.statusText);
    }
    const buf = await res.arrayBuffer();
    if (!buf || !buf.byteLength) throw new Error('Empty audio response');
    return {
      model: body.model,
      voice,
      bytes: buf.byteLength
    };
  }

  function deepSeekApiRoot(provider) {
    let base = String(
      (provider && provider.baseUrl) || PROVIDERS.deepseek.defaultBase
    ).replace(/\/+$/, '');
    if (/\/v1$/i.test(base)) base = base.replace(/\/v1$/i, '');
    return base || PROVIDERS.deepseek.defaultBase;
  }

  /**
   * DeepSeek exposes remaining balance only (not lifetime spent).
   * GET /user/balance → total / granted / topped_up.
   */
  async function fetchDeepSeekBalance(providerOrCfg, signal) {
    const provider = providerOrCfg && providerOrCfg.apiKey
      ? providerOrCfg
      : deepseekProvider(providerOrCfg || loadConfig());
    if (!provider || !String(provider.apiKey || '').trim()) {
      throw new Error('DeepSeek key not ready');
    }
    const url = `${deepSeekApiRoot(provider)}/user/balance`;
    const res = await fetch(url, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${provider.apiKey}`
      }
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { /* non-JSON */ }
    if (!res.ok) {
      const msg = (data && (data.error && data.error.message || data.message)) || text || res.statusText;
      throw new Error(msg || res.statusText);
    }
    const infos = (data && data.balance_infos) || [];
    const usd = infos.find(i => String(i.currency || '').toUpperCase() === 'USD') || infos[0] || {};
    const currency = String(usd.currency || 'USD').toUpperCase();
    return {
      isAvailable: !!(data && data.is_available),
      currency,
      total: String(usd.total_balance != null ? usd.total_balance : '0'),
      granted: String(usd.granted_balance != null ? usd.granted_balance : '0'),
      toppedUp: String(usd.topped_up_balance != null ? usd.topped_up_balance : '0'),
      fetchedAt: Date.now()
    };
  }

  function formatDeepSeekBalance(bal) {
    if (!bal) return 'Balance unavailable';
    const sym = bal.currency === 'CNY' ? '¥' : '$';
    const avail = bal.isAvailable ? 'usable' : 'not usable for API calls';
    return `${sym}${bal.total} ${bal.currency} remaining (${avail}) · topped-up ${sym}${bal.toppedUp} · granted ${sym}${bal.granted}`;
  }

  async function testConnection(cfg) {
    const c = cfg || loadConfig();
    const results = [];
    const deepseek = deepseekProvider(c);
    const openai = openaiProvider(c);

    if (!deepseek && !openai) {
      return {
        ok: false,
        results: [],
        message: 'No keys ready. DeepSeek = AI Trainer (optional). OpenAI = TTS (optional). Course works without either.'
      };
    }

    if (deepseek) {
      try {
        const text = await chatCompletions(deepseek, [
          { role: 'system', content: 'Reply with exactly: OK' },
          { role: 'user', content: 'Connection test for VCF-9 AI Trainer (DeepSeek coach).' }
        ], null, { maxTokens: 16 });
        results.push({
          provider: 'deepseek',
          label: 'DeepSeek (AI Trainer)',
          ok: true,
          detail: text.slice(0, 120)
        });
      } catch (err) {
        results.push({
          provider: 'deepseek',
          label: 'DeepSeek (AI Trainer)',
          ok: false,
          detail: err.message || String(err)
        });
      }
      try {
        const balance = await fetchDeepSeekBalance(deepseek);
        results.push({
          provider: 'deepseek-balance',
          label: 'DeepSeek balance',
          ok: balance.isAvailable,
          detail: formatDeepSeekBalance(balance) + ' — API reports remaining only (not lifetime spent).',
          balance
        });
      } catch (err) {
        results.push({
          provider: 'deepseek-balance',
          label: 'DeepSeek balance',
          ok: false,
          detail: err.message || String(err)
        });
      }
    }

    if (openai) {
      try {
        const probe = await probeOpenAiTts(openai);
        results.push({
          provider: 'openai-tts',
          label: 'OpenAI (TTS)',
          ok: true,
          detail: `TTS OK — voice ${probe.voice} / model ${probe.model} (${probe.bytes} bytes). If credit runs out, Listen falls back to device voice.`
        });
      } catch (err) {
        const msg = err.message || String(err);
        const quota = /insufficient_quota|billing|exceeded.*quota|credit/i.test(msg);
        const hint = /NetworkError|Failed to fetch|Load failed|CORS/i.test(msg)
          ? ' Browser could not reach OpenAI (network/CORS/ad-block). DeepSeek coach still works; Listen may fall back to device voice.'
          : quota
            ? ' OpenAI credit/quota issue — Listen falls back to device voice; course still works.'
            : '';
        results.push({
          provider: 'openai-tts',
          label: 'OpenAI (TTS)',
          ok: false,
          detail: msg + hint
        });
      }
    }

    /* Do not chat-test OpenAI — it is TTS-only in this app. */

    if (
      deepseek && openai &&
      keyFingerprint(deepseek.apiKey) === keyFingerprint(openai.apiKey) &&
      String(deepseek.apiKey).trim() === String(openai.apiKey).trim()
    ) {
      results.push({
        provider: 'warn',
        label: 'Key check',
        ok: false,
        detail: 'DeepSeek and OpenAI appear to be the same key. Use each provider’s own key.'
      });
    }

    const coachOk = results.some(r => r.provider === 'deepseek' && r.ok);
    const ttsOk = results.some(r => r.provider === 'openai-tts' && r.ok);
    const balRow = results.find(r => r.provider === 'deepseek-balance' && r.balance);
    let message;
    if (coachOk && ttsOk) message = 'Ready — DeepSeek AI Trainer OK · OpenAI TTS OK.';
    else if (coachOk && !ttsOk) message = 'DeepSeek AI Trainer OK. OpenAI TTS failed — course still works; Listen can use device voice.';
    else if (!coachOk && ttsOk) message = 'OpenAI TTS OK. DeepSeek AI Trainer failed — course still works; coach panel needs DeepSeek.';
    else message = 'Neither optional provider passed. Course still works without them.';
    if (balRow && balRow.balance) message += ` · ${formatDeepSeekBalance(balRow.balance)}`;

    return {
      ok: coachOk || ttsOk,
      results,
      message,
      balance: balRow ? balRow.balance : null
    };
  }

  /* ---------------------------------------------------------------- script cache */

  function readScriptCache() {
    try {
      const raw = localStorage.getItem(SCRIPT_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function writeScriptCache(map) {
    try {
      const keys = Object.keys(map);
      if (keys.length > 80) {
        keys.slice(0, keys.length - 80).forEach(k => { delete map[k]; });
      }
      localStorage.setItem(SCRIPT_CACHE_KEY, JSON.stringify(map));
    } catch (err) { /* quota */ }
  }

  function hashText(s) {
    let h = 0;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return String(h);
  }

  function speechSystemPrompt() {
    return [
      'You write short spoken lesson scripts for a VMware Cloud Foundation Architect course.',
      'Output plain speech only — no markdown, no bullet characters, no stage directions.',
      'Length: about 60–90 seconds when read aloud (roughly 130–180 words).',
      'Structure: what this is → what it does → why Rainpole / the architect cares → one common trap.',
      'Use ONLY facts in the provided section text. Never invent Rainpole BRs, NFRs, IDs, or numbers.',
      'If something is marked not stated, say it is not stated and must be validated — do not invent it.',
      'Never reveal quiz or knowledge-check answer keys or option letters.',
      '9.1 notes are informational awareness only.',
      'Tone: clear human instructor, plain English, suitable for a warm Southern/Texas narrator.'
    ].join('\n');
  }

  async function transformForSpeech(sourceText, meta, signal) {
    const cleaned = String(sourceText || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) throw new Error('Nothing to transform for speech.');

    const cacheId = `${(meta && meta.id) || 'page'}:${hashText(cleaned)}`;
    const cache = readScriptCache();
    if (cache[cacheId] && cache[cacheId].script) {
      return { script: cache[cacheId].script, engine: 'cache', cacheId };
    }

    const deepseek = deepseekProvider();
    if (!deepseek) {
      /* No DeepSeek — light local trim so OpenAI can still narrate. */
      const trimmed = cleaned.length > 1200 ? `${cleaned.slice(0, 1197)}…` : cleaned;
      return { script: trimmed, engine: 'local-trim', cacheId };
    }

    const title = (meta && meta.title) || 'Course section';
    const script = await chatCompletions(deepseek, [
      { role: 'system', content: speechSystemPrompt() },
      {
        role: 'user',
        content: [
          `Section title: ${title}`,
          meta && meta.moduleTitle ? `Module: ${meta.moduleTitle}` : '',
          '',
          'SOURCE (only use this):',
          cleaned
        ].filter(Boolean).join('\n')
      }
    ], signal);

    const out = String(script || '').replace(/\s+/g, ' ').trim();
    if (!out) throw new Error('DeepSeek returned an empty spoken script.');
    cache[cacheId] = { script: out, at: Date.now() };
    writeScriptCache(cache);
    return { script: out, engine: 'deepseek', cacheId };
  }

  /* ---------------------------------------------------------------- audio / TTS */

  let audioEl = null;
  let audioUrl = null;
  let speakAbort = null;
  let speaking = false;
  let onSpeakEnd = null;

  function stopSpeech(opts) {
    const silent = !!(opts && opts.silent);
    if (speakAbort) {
      try { speakAbort.abort(); } catch (err) { /* ignore */ }
      speakAbort = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (err) { /* ignore */ }
    }
    if (audioEl) {
      try { audioEl.pause(); } catch (err) { /* ignore */ }
      audioEl = null;
    }
    if (audioUrl) {
      try { URL.revokeObjectURL(audioUrl); } catch (err) { /* ignore */ }
      audioUrl = null;
    }
    const was = speaking;
    speaking = false;
    if (was && !silent && typeof onSpeakEnd === 'function') {
      const cb = onSpeakEnd;
      onSpeakEnd = null;
      try { cb(); } catch (err) { /* ignore */ }
    } else {
      onSpeakEnd = null;
    }
  }

  function isSpeaking() { return speaking; }

  function speakBrowser(text) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
        reject(new Error('Browser speech is not available on this device.'));
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.onend = () => resolve({ engine: 'browser' });
      u.onerror = (ev) => reject(new Error((ev && ev.error) || 'Speech failed'));
      window.speechSynthesis.speak(u);
    });
  }

  async function speakOpenAI(provider, text, signal) {
    const base = String(provider.baseUrl || '').replace(/\/+$/, '');
    const url = `${base}/audio/speech`;
    const voice = provider.ttsVoice || DEFAULT_TTS_VOICE;
    const style = provider.ttsStyle || DEFAULT_TTS_STYLE;
    const primaryModel = provider.ttsModel || DEFAULT_TTS_MODEL;
    const models = primaryModel === 'tts-1' ? ['tts-1'] : [primaryModel, 'tts-1'];

    let lastErr = null;
    for (const model of models) {
      const body = {
        model,
        voice,
        input: String(text || '').slice(0, model === 'tts-1' ? 4096 : 2000)
      };
      if (model !== 'tts-1') body.instructions = style;

      try {
        const res = await fetch(url, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${provider.apiKey}`
          },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          lastErr = new Error(`OpenAI TTS (${model}): ${errText || res.statusText}`);
          continue;
        }
        const blob = await res.blob();
        audioUrl = URL.createObjectURL(blob);
        audioEl = new Audio(audioUrl);
        await new Promise((resolve, reject) => {
          audioEl.onended = () => resolve();
          audioEl.onerror = () => reject(new Error('OpenAI TTS playback failed'));
          audioEl.play().catch(reject);
        });
        return { engine: 'openai-tts', model, voice };
      } catch (err) {
        if (signal && signal.aborted) throw err;
        lastErr = err;
      }
    }
    throw lastErr || new Error('OpenAI TTS failed');
  }

  async function playNarration(text, opts) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) throw new Error('Nothing to read.');

    stopSpeech({ silent: true });
    speaking = true;
    onSpeakEnd = opts && opts.onEnd;
    speakAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const openai = openaiProvider();
    try {
      let result;
      if (openai) {
        try {
          result = await speakOpenAI(openai, cleaned, speakAbort && speakAbort.signal);
        } catch (err) {
          if (speakAbort && speakAbort.signal && speakAbort.signal.aborted) throw err;
          result = await speakBrowser(cleaned);
          result.fallbackFrom = 'openai-tts';
          result.fallbackReason = err.message || String(err);
        }
      } else {
        result = await speakBrowser(cleaned);
      }
      speaking = false;
      if (typeof onSpeakEnd === 'function') {
        const cb = onSpeakEnd;
        onSpeakEnd = null;
        cb();
      }
      return result;
    } catch (err) {
      speaking = false;
      onSpeakEnd = null;
      throw err;
    }
  }

  /** Raw listen (no DeepSeek rewrite). */
  async function speakText(text, opts) {
    return playNarration(text, opts);
  }

  /**
   * Preferred Course path: DeepSeek spoken script → OpenAI Southern/Texas TTS.
   * meta: { id, title, moduleTitle }
   */
  async function speakLesson(sourceText, meta, opts) {
    speakAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = speakAbort.signal;
    const transformed = await transformForSpeech(sourceText, meta || {}, signal);
    const result = await playNarration(transformed.script, opts);
    result.scriptEngine = transformed.engine;
    result.cacheId = transformed.cacheId;
    result.script = transformed.script;
    return result;
  }

  function audioStatus(cfg) {
    const c = cfg || loadConfig();
    const ds = !!deepseekProvider(c);
    const oai = !!openaiProvider(c);
    if (ds && oai) {
      return 'Script: DeepSeek · Voice: OpenAI (Southern/Texas). Cached replays are free.';
    }
    if (oai && !ds) {
      return 'OpenAI TTS ready (Southern/Texas). Add DeepSeek for teacher-style scripts.';
    }
    if (ds && !oai) {
      return 'DeepSeek ready for scripts/coach. Add OpenAI for natural Southern/Texas voice.';
    }
    return 'Basic device voice only. Add DeepSeek (script/coach) and OpenAI (TTS) under AI Trainer.';
  }

  return {
    PROVIDERS,
    loadConfig,
    saveConfig,
    clearKeys,
    hasKey,
    keyFingerprint,
    defaultConfig,
    activeProviders,
    deepseekProvider,
    openaiProvider,
    isReady,
    isCoachReady,
    isTtsReady,
    ask,
    answerLocally,
    fetchDeepSeekBalance,
    formatDeepSeekBalance,
    testConnection,
    transformForSpeech,
    speakText,
    speakLesson,
    stopSpeech,
    isSpeaking,
    audioStatus,
    DEFAULT_TTS_VOICE,
    DEFAULT_TTS_MODEL,
    DEFAULT_TTS_STYLE,
    STORAGE_KEY
  };
})();
