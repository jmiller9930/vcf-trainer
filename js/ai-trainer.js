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

  async function chatCompletions(provider, messages, signal) {
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
      'You are the VCF-9 AI Trainer coach for a self-paced VMware Cloud Foundation 9 Architect study app.',
      'The learner is solving the Rainpole (RFS) architect lab. Prefer course context and Broadcom-aligned product facts.',
      'Answer only from the provided course context when possible. If context is missing, say what is missing.',
      'Never invent Rainpole business requirements, NFRs, IDs, or numbers not present in the context. Say: Not stated in course materials — treat as assumption to validate.',
      'Be concise, architect-focused, and reinforce decision rules (conceptual model / RCAR / FR vs NFR / AMPRS).',
      '9.1 changes are informational: state the course baseline first, then note 9.1 as an informational update. Do not mark a valid 9.0-era answer as wrong solely due to 9.1.',
      'Do not invent exam answer keys. Do not claim to unlock Course Next — grading is local fact-sheet based.',
      'If the learner is looking at a drawing, name objects from the fact sheet and explain what/why.',
      '',
      'CURRENT CONTEXT:',
      contextText || '(no page context)'
    ].join('\n');
  }

  async function ask(question, contextText, opts) {
    const cfg = loadConfig();
    const providers = activeProviders(cfg);
    if (!providers.length) {
      throw new Error('AI Trainer is not ready. Add a DeepSeek key (preferred coach) under AI Trainer and enable AI Trainer.');
    }

    const messages = [
      { role: 'system', content: systemPrompt(contextText) },
      { role: 'user', content: String(question || '').trim() }
    ];
    if (!messages[1].content) throw new Error('Ask a question first.');

    const useQuorum = !!(cfg.quorum && providers.length > 1);
    const signal = opts && opts.signal;

    if (!useQuorum) {
      /* Prefer DeepSeek for coach when present (first in activeProviders). */
      const answer = await chatCompletions(providers[0], messages, signal);
      return { mode: 'single', answers: [{ provider: providers[0].id, label: providers[0].label, text: answer }] };
    }

    const settled = await Promise.allSettled(
      providers.map(p => chatCompletions(p, messages, signal).then(text => ({
        provider: p.id,
        label: p.label,
        text
      })))
    );

    const answers = [];
    const errors = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') answers.push(s.value);
      else errors.push(`${providers[i].label}: ${s.reason && s.reason.message ? s.reason.message : s.reason}`);
    });
    if (!answers.length) throw new Error(errors.join(' | ') || 'All providers failed.');

    return {
      mode: 'quorum',
      answers,
      errors,
      agree: answers.length > 1 && normalizeForCompare(answers[0].text) === normalizeForCompare(answers[1].text)
    };
  }

  function normalizeForCompare(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400);
  }

  async function testConnection(cfg) {
    const c = cfg || loadConfig();
    const providers = activeProviders(c);
    if (!providers.length) {
      return { ok: false, results: [], message: 'Enable AI Trainer and add at least one API key (DeepSeek for coach; OpenAI for TTS).' };
    }
    const results = [];
    for (const p of providers) {
      try {
        const text = await chatCompletions(p, [
          { role: 'system', content: 'Reply with exactly: OK' },
          { role: 'user', content: 'Connection test for VCF-9 AI Trainer.' }
        ]);
        results.push({ provider: p.id, label: p.label, ok: true, detail: text.slice(0, 120) });
      } catch (err) {
        results.push({ provider: p.id, label: p.label, ok: false, detail: err.message || String(err) });
      }
    }
    const openai = openaiProvider(c);
    if (openai) {
      results.push({
        provider: 'openai-tts',
        label: 'OpenAI TTS',
        ok: true,
        detail: `Configured voice ${openai.ttsVoice || DEFAULT_TTS_VOICE} / model ${openai.ttsModel || DEFAULT_TTS_MODEL} (Southern/Texas style). Chat test above verifies the key.`
      });
    }
    const ok = results.some(r => r.ok && r.provider !== 'openai-tts') || results.some(r => r.ok);
    return {
      ok: results.some(r => r.ok && r.provider !== 'openai-tts'),
      results,
      message: ok ? 'At least one chat provider responded. OpenAI key is used for Southern/Texas TTS.' : 'No provider responded successfully.'
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
