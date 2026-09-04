/* ==========================================================================
   ai-trainer.js — optional bring-your-own-key AI coach (OpenAI / DeepSeek).

   The core course never depends on this module. No keys → app still works.
   Keys stay in localStorage on this device only.
   ========================================================================== */

window.AITrainer = (function () {
  'use strict';

  const STORAGE_KEY = 'vcf9.aiTrainer';

  const PROVIDERS = {
    openai: {
      id: 'openai',
      label: 'OpenAI',
      defaultBase: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini'
    },
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek',
      defaultBase: 'https://api.deepseek.com',
      defaultModel: 'deepseek-chat'
    }
  };

  const defaultConfig = () => ({
    enabled: false,
    quorum: false,
    openai: { enabled: true, apiKey: '', baseUrl: PROVIDERS.openai.defaultBase, model: PROVIDERS.openai.defaultModel },
    deepseek: { enabled: false, apiKey: '', baseUrl: PROVIDERS.deepseek.defaultBase, model: PROVIDERS.deepseek.defaultModel }
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

  function saveConfig(cfg) {
    const next = {
      enabled: !!cfg.enabled,
      quorum: !!cfg.quorum,
      openai: {
        enabled: !!(cfg.openai && cfg.openai.enabled),
        apiKey: String((cfg.openai && cfg.openai.apiKey) || '').trim(),
        baseUrl: String((cfg.openai && cfg.openai.baseUrl) || PROVIDERS.openai.defaultBase).trim() || PROVIDERS.openai.defaultBase,
        model: String((cfg.openai && cfg.openai.model) || PROVIDERS.openai.defaultModel).trim() || PROVIDERS.openai.defaultModel
      },
      deepseek: {
        enabled: !!(cfg.deepseek && cfg.deepseek.enabled),
        apiKey: String((cfg.deepseek && cfg.deepseek.apiKey) || '').trim(),
        baseUrl: String((cfg.deepseek && cfg.deepseek.baseUrl) || PROVIDERS.deepseek.defaultBase).trim() || PROVIDERS.deepseek.defaultBase,
        model: String((cfg.deepseek && cfg.deepseek.model) || PROVIDERS.deepseek.defaultModel).trim() || PROVIDERS.deepseek.defaultModel
      }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function activeProviders(cfg) {
    const c = cfg || loadConfig();
    if (!c.enabled) return [];
    const list = [];
    if (c.openai.enabled && c.openai.apiKey) list.push({ id: 'openai', ...c.openai, label: PROVIDERS.openai.label });
    if (c.deepseek.enabled && c.deepseek.apiKey) list.push({ id: 'deepseek', ...c.deepseek, label: PROVIDERS.deepseek.label });
    return list;
  }

  function isReady(cfg) {
    return activeProviders(cfg).length > 0;
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
      'Answer only from the provided course context when possible. If context is missing, say what is missing.',
      'Be concise, architect-focused, and reinforce decision rules (conceptual model / RCAR / AMPRS).',
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
      throw new Error('AI Trainer is not ready. Add a bring-your-own API key under AI Trainer and enable at least one provider.');
    }

    const messages = [
      { role: 'system', content: systemPrompt(contextText) },
      { role: 'user', content: String(question || '').trim() }
    ];
    if (!messages[1].content) throw new Error('Ask a question first.');

    const useQuorum = !!(cfg.quorum && providers.length > 1);
    const signal = opts && opts.signal;

    if (!useQuorum) {
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
      return { ok: false, results: [], message: 'Enable AI Trainer and add at least one API key.' };
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
    const ok = results.some(r => r.ok);
    return {
      ok,
      results,
      message: ok ? 'At least one provider responded.' : 'No provider responded successfully.'
    };
  }

  return {
    PROVIDERS,
    loadConfig,
    saveConfig,
    activeProviders,
    isReady,
    ask,
    testConnection,
    defaultConfig
  };
})();
