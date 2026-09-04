/* ==========================================================================
   data-loader.js — fetches and caches the content JSON files.

   Public API (window.DataLoader):
     load()                      -> Promise<{ modules, questions, delta, errors }>
     getModules()                -> Module[]
     getModule(id)               -> Module | null
     getQuestions()              -> Question[]
     getQuestion(id)             -> Question | null
     getDelta()                  -> DeltaItem[]
     getDeltaByArea()            -> [{ area, items }]
     getQuestionsByModule(modId) -> Question[]
     getQuestionsByType(type)    -> Question[]
     getErrors()                 -> string[]
   ========================================================================== */

window.DataLoader = (function () {
  'use strict';

  const SOURCES = {
    modules:   'data/modules.json',
    questions: 'data/questions.json',
    delta:     'data/delta91.json'
  };

  const cache = { modules: [], questions: [], delta: [] };
  const errors = [];
  let loadPromise = null;

  /* ---------------------------------------------------------------- fetching */

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  /* The JSON files may be either a bare array or an object wrapping the array
     under a well-known key; accept both so content authoring stays flexible. */
  function unwrap(payload, keys) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object') {
      for (const key of keys) {
        if (Array.isArray(payload[key])) return payload[key];
      }
    }
    return [];
  }

  /* -------------------------------------------------------------- normalising */

  const str = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
  const arr = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

  function normaliseComponent(raw, modId, i) {
    return {
      id: str(raw.id) || `${modId}-c${i + 1}`,
      name: str(raw.name || raw.title || raw.component) || 'Component',
      what: str(raw.what),
      how: str(raw.how),
      why: str(raw.why),
      sourceTitle: str(raw.sourceTitle || (raw.source && raw.source.title) || 'Broadcom documentation'),
      sourceUrl: str(
        raw.sourceUrl ||
        raw.url ||
        (typeof raw.source === 'string' ? raw.source : raw.source && raw.source.url)
      ),
      examTip: str(raw.examTip || raw.exam_tip),
      delta91: !!(raw.delta91 || raw.is91 || raw.new91)
    };
  }

  function normaliseFact(raw) {
    if (typeof raw === 'string') return { text: raw.trim(), delta91: false };
    return {
      text: str(raw.text || raw.fact || raw.title),
      delta91: !!(raw.delta91 || raw.is91)
    };
  }

  function normaliseAttention(raw) {
    if (typeof raw === 'string') return { title: 'Watch out', text: raw.trim(), delta91: false };
    return {
      title: str(raw.title || raw.heading) || 'Watch out',
      text: str(raw.text || raw.detail || raw.body),
      delta91: !!(raw.delta91 || raw.is91)
    };
  }

  function normaliseTraceability(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map(t =>
        typeof t === 'string'
          ? { label: 'Traces to', value: t }
          : { label: str(t.label || t.type) || 'Traces to', value: str(t.value || t.id || t.text) }
      );
    }
    if (typeof raw === 'string') return [{ label: 'Traces to', value: raw }];
    return Object.keys(raw)
      .filter(k => str(raw[k]))
      .map(k => ({ label: k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()), value: str(raw[k]) }));
  }

  function normaliseDecision(raw, modId, i) {
    const amprsRaw = raw.amprs || raw.AMPRS || raw.amprsImpact || raw.impact;
    return {
      id: str(raw.id) || `${modId}-dd${i + 1}`,
      title: str(raw.title || raw.id || raw.decision || raw.name) || `Design decision ${i + 1}`,
      question: str(raw.question || raw.prompt),
      recommendation: str(raw.recommendation || raw.decision_text || raw.choice),
      confidence: str(raw.confidence),
      decisionRule: str(raw.decisionRule || raw.rule || raw.thinking),
      rationale: str(raw.rationale || raw.justification),
      alternative: str(raw.alternative || raw.alternatives),
      amprs: arr(amprsRaw).map(str).filter(Boolean),
      relatedComponents: arr(raw.relatedComponents || raw.components).map(str).filter(Boolean),
      traceability: normaliseTraceability(raw.traceability || raw.traces),
      delta91: !!(raw.delta91 || raw.is91)
    };
  }

  function normalise91Update(raw) {
    return {
      title: str(raw.title || raw.name),
      description: str(raw.description || raw.summary),
      impact: str(raw.impact || raw.detail)
    };
  }

  function moduleNumberFromId(id, fallback) {
    const match = String(id || '').match(/(\d+)/);
    return match ? Number(match[1]) : fallback;
  }

  function normaliseModule(raw, i) {
    const id = str(raw.id) || `mod${i + 1}`;
    return {
      id,
      number: raw.number != null ? raw.number : moduleNumberFromId(id, i + 1),
      title: str(raw.title || raw.name) || `Module ${i + 1}`,
      summary: str(raw.summary || raw.description),
      exam: str(raw.exam || raw.examSection),
      delta91: !!(raw.delta91 || raw.is91),
      components: arr(raw.components).map((c, ci) => normaliseComponent(c || {}, id, ci)),
      keyFacts: arr(raw.keyFacts || raw.facts).map(normaliseFact).filter(f => f.text),
      attention: arr(raw.attention || raw.attentionItems || raw.watchOut).map(normaliseAttention).filter(a => a.text),
      decisions: arr(raw.decisions || raw.designDecisions).map((d, di) => normaliseDecision(d || {}, id, di)),
      vcf91Updates: arr(raw.vcf91Updates || raw.updates91).map(normalise91Update).filter(u => u.title || u.description),
      lesson: (() => {
        const lesson = raw.lesson || raw.teach || {};
        const what = str(lesson.what || raw.what);
        const how = str(lesson.how || raw.how);
        const why = str(lesson.why || raw.why || lesson.bestPractice || raw.bestPractice);
        const goal = str(lesson.goal);
        return (what || how || why) ? { what, how, why, goal } : null;
      })(),
      checkYourself: arr(raw.checkYourself || raw.checks || raw.reconstruct).map(str).filter(Boolean),
      study: (() => {
        const study = raw.study || {};
        const highlights = arr(study.highlights).map((h, hi) => ({
          id: str(h.id) || `${id}-h${hi + 1}`,
          title: str(h.title || h.name) || `Highlight ${hi + 1}`,
          text: str(h.text || h.body || h.detail)
        })).filter(h => h.text);
        const primer = str(study.primer || study.summary || study.intro);
        return (primer || highlights.length) ? { primer, highlights } : null;
      })(),
      course: (() => {
        const course = raw.course || {};
        const sections = arr(course.sections).map((s, si) => ({
          id: str(s.id) || `${id}-s${si + 1}`,
          title: str(s.title || s.name) || `Section ${si + 1}`,
          body: str(s.body || s.text || s.content),
          highlightIds: arr(s.highlightIds || s.highlights || s.callbacks).map(str).filter(Boolean)
        })).filter(s => s.body || s.title);
        return sections.length ? { sections } : null;
      })()
    };
  }

  function normaliseQuestion(raw, i) {
    const options = arr(raw.options || raw.choices).map(o =>
      typeof o === 'string' ? o.trim() : str(o.text || o.label)
    );

    /* Answers may be an index, a letter, or the literal option text. */
    let answer = raw.correctIndex != null ? raw.correctIndex
      : raw.answer != null ? raw.answer
      : raw.correct != null ? raw.correct
      : raw.answerIndex;
    if (typeof answer === 'string') {
      const trimmed = answer.trim();
      if (/^[A-Za-z]$/.test(trimmed)) answer = trimmed.toUpperCase().charCodeAt(0) - 65;
      else {
        const found = options.findIndex(o => o === trimmed);
        answer = found >= 0 ? found : Number(trimmed);
      }
    }
    answer = Number(answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) answer = 0;

    return {
      id: str(raw.id) || `q${i + 1}`,
      moduleId: str(raw.moduleId || raw.module || raw.modId),
      type: str(raw.type || raw.category) || 'knowledge',
      difficulty: str(raw.difficulty) || 'medium',
      stem: str(raw.stem || raw.question || raw.text),
      options,
      answer,
      explanation: str(raw.explanation || raw.rationale),
      delta91: !!(raw.delta91 || raw.is91)
    };
  }

  function normaliseDeltaItem(raw, i) {
    return {
      id: str(raw.id) || `d${i + 1}`,
      area: str(raw.area || raw.category || raw.group) || 'General',
      title: str(raw.title || raw.name) || `Change ${i + 1}`,
      description: str(raw.description || raw.summary),
      detail: str(raw.detail || raw.details || raw.notes),
      modules: arr(raw.modules || raw.affectedModules || raw.moduleIds).map(str).filter(Boolean)
    };
  }

  /* Delta JSON may be grouped by area already: [{ area, items: [...] }]. */
  function flattenDelta(payload) {
    const top = unwrap(payload, ['delta', 'items', 'changes', 'areas']);
    const flat = [];
    top.forEach(entry => {
      if (entry && Array.isArray(entry.items)) {
        entry.items.forEach(item => flat.push(Object.assign({ area: entry.area || entry.name }, item)));
      } else if (entry) {
        flat.push(entry);
      }
    });
    return flat.map(normaliseDeltaItem);
  }

  /* ----------------------------------------------------------------- loading */

  function load() {
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      const [modulesRes, questionsRes, deltaRes] = await Promise.all([
        fetchJson(SOURCES.modules).catch(e => ({ __error: e })),
        fetchJson(SOURCES.questions).catch(e => ({ __error: e })),
        fetchJson(SOURCES.delta).catch(e => ({ __error: e }))
      ]);

      if (modulesRes && modulesRes.__error) {
        errors.push(`Could not load ${SOURCES.modules} (${modulesRes.__error.message})`);
      } else {
        cache.modules = unwrap(modulesRes, ['modules', 'items']).map(normaliseModule);
      }

      if (questionsRes && questionsRes.__error) {
        errors.push(`Could not load ${SOURCES.questions} (${questionsRes.__error.message})`);
      } else {
        cache.questions = unwrap(questionsRes, ['questions', 'items'])
          .map(normaliseQuestion)
          .filter(q => q.stem && q.options.length >= 2);
      }

      if (deltaRes && deltaRes.__error) {
        errors.push(`Could not load ${SOURCES.delta} (${deltaRes.__error.message})`);
      } else {
        cache.delta = flattenDelta(deltaRes);
      }

      /* Questions whose moduleId does not resolve are still usable, but they
         should not disappear from module-filtered views without a trace. */
      const known = new Set(cache.modules.map(m => m.id));
      const orphans = cache.questions.filter(q => q.moduleId && !known.has(q.moduleId));
      if (orphans.length) {
        console.warn('Questions reference unknown modules:', [...new Set(orphans.map(q => q.moduleId))]);
      }

      return { modules: cache.modules, questions: cache.questions, delta: cache.delta, errors };
    })();

    return loadPromise;
  }

  /* --------------------------------------------------------------- accessors */

  function getModules() { return cache.modules; }
  function getModule(id) { return cache.modules.find(m => m.id === id) || null; }
  function getQuestions() { return cache.questions; }
  function getQuestion(id) { return cache.questions.find(q => q.id === id) || null; }
  function getDelta() { return cache.delta; }
  function getQuestionsByModule(modId) {
    return modId ? cache.questions.filter(q => q.moduleId === modId) : cache.questions.slice();
  }
  function getQuestionsByType(type) {
    return type ? cache.questions.filter(q => q.type === type) : cache.questions.slice();
  }
  function getErrors() { return errors.slice(); }

  function getDeltaByArea() {
    const groups = new Map();
    cache.delta.forEach(item => {
      if (!groups.has(item.area)) groups.set(item.area, []);
      groups.get(item.area).push(item);
    });
    return [...groups.entries()].map(([area, items]) => ({ area, items }));
  }

  return {
    load,
    getModules,
    getModule,
    getQuestions,
    getQuestion,
    getDelta,
    getDeltaByArea,
    getQuestionsByModule,
    getQuestionsByType,
    getErrors
  };
})();
