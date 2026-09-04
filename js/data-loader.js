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
    delta:     'data/delta91.json',
    figures:   'data/figures.json',
    acronyms:  'data/acronyms.json'
  };

  const cache = { modules: [], questions: [], delta: [], figures: [], acronyms: [] };
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
      rainpoleJob: str(raw.rainpoleJob || raw.labJob || raw.rfsJob),
      requirementsSpine: str(raw.requirementsSpine || raw.reqSpine),
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
        const sections = arr(course.sections).map((s, si) => {
          const kc = s.knowledgeCheck || s.check || s.quiz;
          let knowledgeCheck = null;
          if (kc && (kc.stem || kc.question)) {
            const options = arr(kc.options || kc.choices).map(o =>
              typeof o === 'string' ? o.trim() : str(o.text || o.label)
            ).filter(Boolean);
            let answer = kc.answer != null ? kc.answer
              : kc.correctIndex != null ? kc.correctIndex
              : kc.correct;
            if (typeof answer === 'string' && /^[A-Za-z]$/.test(answer.trim())) {
              answer = answer.trim().toUpperCase().charCodeAt(0) - 65;
            }
            answer = Number(answer);
            if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) answer = 0;
    knowledgeCheck = {
              stem: str(kc.stem || kc.question || kc.text),
              options,
              answer,
              answers: (() => {
                const multi = arr(kc.answers || kc.correctIndexes || kc.correctIndices)
                  .map(v => {
                    if (typeof v === 'string' && /^[A-Za-z]$/.test(v.trim())) {
                      return v.trim().toUpperCase().charCodeAt(0) - 65;
                    }
                    return Number(v);
                  })
                  .filter(n => Number.isInteger(n) && n >= 0 && n < options.length);
                if (multi.length) return [...new Set(multi)].sort((a, b) => a - b);
                return [answer];
              })(),
              multiSelect: !!(kc.multiSelect || kc.multi || (arr(kc.answers || kc.correctIndexes).length > 1)),
              selectCount: Number(kc.selectCount || kc.select || 0) || 0,
              explanation: str(kc.explanation || kc.rationale),
              reinforce: str(kc.reinforce || kc.remediation || kc.studyClip),
              sourceQuestionId: str(kc.sourceQuestionId || kc.questionId || ''),
              terms: arr(kc.terms || kc.term).map(str).filter(Boolean),
              spiral: kc.spiral !== false,
              informational91: !!(kc.informational91 || kc.delta91Informational)
            };
            if (knowledgeCheck.multiSelect && knowledgeCheck.answers.length < 2) {
              knowledgeCheck.multiSelect = false;
            }
            if (!knowledgeCheck.selectCount && knowledgeCheck.multiSelect) {
              knowledgeCheck.selectCount = knowledgeCheck.answers.length;
            }
            if (!knowledgeCheck.stem || options.length < 2) knowledgeCheck = null;
          }
          return {
            id: str(s.id) || `${id}-s${si + 1}`,
            title: str(s.title || s.name) || `Section ${si + 1}`,
            body: str(s.body || s.text || s.content),
            highlightIds: arr(s.highlightIds || s.highlights || s.callbacks).map(str).filter(Boolean),
            figureId: str(s.figureId || s.figure || ''),
            rainpoleEvidence: str(s.rainpoleEvidence || s.rfsEvidence || s.keyDetail),
            gapNote: str(s.gapNote || s.notStated),
            informational91: !!(s.informational91 || s.delta91Informational),
            note91: str(s.note91 || s.delta91Note),
            knowledgeCheck
          };
        }).filter(s => s.body || s.title || s.figureId);
        return sections.length ? { sections } : null;
      })()
    };
  }

  function normaliseFigureCheck(raw, figId, i) {
    const options = arr(raw.options || raw.choices).map(o =>
      typeof o === 'string' ? o.trim() : str(o.text || o.label)
    ).filter(Boolean);
    let answer = raw.answer != null ? raw.answer
      : raw.correctIndex != null ? raw.correctIndex
      : raw.correct;
    if (typeof answer === 'string' && /^[A-Za-z]$/.test(answer.trim())) {
      answer = answer.trim().toUpperCase().charCodeAt(0) - 65;
    }
    answer = Number(answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) answer = 0;
    return {
      id: str(raw.id) || `${figId}-kc${i + 1}`,
      stem: str(raw.stem || raw.question || raw.text),
      options,
      answer,
      explanation: str(raw.explanation || raw.rationale),
      reinforce: str(raw.reinforce || raw.remediation),
      objectIds: arr(raw.objectIds || raw.objects).map(str).filter(Boolean)
    };
  }

  function normaliseFigure(raw, i) {
    const id = str(raw.id) || `fig${i + 1}`;
    const checks = arr(raw.checks || raw.knowledgeChecks)
      .map((c, ci) => normaliseFigureCheck(c || {}, id, ci))
      .filter(c => c.stem && c.options.length >= 2);
    return {
      id,
      title: str(raw.title || raw.name) || id,
      subtitle: str(raw.subtitle),
      image: str(raw.image || raw.src || raw.url),
      sourceSlide: raw.sourceSlide != null ? Number(raw.sourceSlide) : null,
      moduleIds: arr(raw.moduleIds || raw.modules).map(str).filter(Boolean),
      primer: str(raw.primer || raw.summary || raw.intro),
      objects: arr(raw.objects).map((o, oi) => ({
        id: str(o.id) || `${id}-obj${oi + 1}`,
        name: str(o.name || o.title) || `Object ${oi + 1}`,
        what: str(o.what || o.text),
        why: str(o.why)
      })).filter(o => o.name),
      facts: arr(raw.facts).map(f => typeof f === 'string' ? f.trim() : str(f.text)).filter(Boolean),
      checks
    };
  }

  function normaliseQuestion(raw, i) {
    const options = arr(raw.options || raw.choices).map(o =>
      typeof o === 'string' ? o.trim() : str(o.text || o.label)
    );

    /* Answers may be an index, a letter, literal option text, or multi-select indexes. */
    let answers = arr(raw.answers || raw.correctIndexes || raw.correctIndices).map(v => {
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (/^[A-Za-z]$/.test(trimmed)) return trimmed.toUpperCase().charCodeAt(0) - 65;
        const found = options.findIndex(o => o === trimmed);
        return found >= 0 ? found : Number(trimmed);
      }
      return Number(v);
    }).filter(n => Number.isInteger(n) && n >= 0 && n < options.length);

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
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      answer = answers.length ? answers[0] : 0;
    }
    if (!answers.length) answers = [answer];
    answers = [...new Set(answers)].sort((a, b) => a - b);

    const multiSelect = !!(raw.multiSelect || raw.multi || answers.length > 1);
    const selectCount = Number(raw.selectCount || raw.select || 0) || (multiSelect ? answers.length : 0);

    const stem = str(raw.stem || raw.question || raw.text);
    const terms = arr(raw.terms || raw.term).map(str).filter(Boolean);
    return {
      id: str(raw.id) || `q${i + 1}`,
      moduleId: str(raw.moduleId || raw.module || raw.modId),
      type: str(raw.type || raw.category) || 'knowledge',
      difficulty: str(raw.difficulty) || 'medium',
      stem,
      options,
      answer: answers[0],
      answers,
      multiSelect: multiSelect && answers.length > 1,
      selectCount: multiSelect && answers.length > 1 ? selectCount : 0,
      explanation: str(raw.explanation || raw.rationale),
      terms,
      spiral: raw.spiral !== false,
      delta91: !!(raw.delta91 || raw.is91),
      informational91: !!(raw.informational91 || raw.delta91Informational || raw.delta91 || raw.is91),
      note91: str(raw.note91 || raw.delta91Note || ((raw.delta91 || raw.is91)
        ? '9.1 update — informational. A valid course-baseline (9.0-era / Rainpole lab) answer is not wrong solely because 9.1 later changed something, unless the question explicitly asks “as of 9.1”.'
        : ''))
    };
  }

  /* Spiral bank: earlier Course checks resurfaced later (term → module order). */
  function getModuleOrder(modId) {
    const idx = cache.modules.findIndex(m => m.id === modId);
    return idx >= 0 ? idx : 999;
  }

  function getSpiralBank() {
    const bank = [];
    cache.modules.forEach((mod, mi) => {
      ((mod.course && mod.course.sections) || []).forEach(s => {
        const pushKc = (kc, prefix) => {
          if (!kc || !kc.terms || !kc.terms.length) return;
          if (kc.informational91) return;
          bank.push({
            id: `${prefix}:${s.id}:${kc.acronym || kc.terms[0] || 'term'}`,
            sourceSectionId: s.id,
            moduleId: mod.id,
            moduleOrder: mi,
            terms: kc.terms.slice(),
            stem: kc.stem,
            options: kc.options.slice(),
            answer: kc.answer,
            explanation: kc.explanation || `Recall from earlier Course: ${kc.terms.join(', ')}.`,
            reinforce: kc.reinforce || 'Re-open the earlier Course section that introduced this term.'
          });
        };
        pushKc(s.termCheck, 'spiral-term');
        pushKc(s.knowledgeCheck, 'spiral');
      });
    });
    return bank;
  }

  /* Prefer a prior term that appears in the current section body; else first earlier. */
  function pickSpiralRecall(moduleId, section) {
    if (!section) return null;
    const order = getModuleOrder(moduleId);
    if (order <= 0) return null;
    const hay = `${section.title || ''} ${section.body || ''} ${section.rainpoleEvidence || ''}`.toLowerCase();
    const bank = getSpiralBank().filter(b => b.moduleOrder < order && b.sourceSectionId !== section.id);
    if (!bank.length) return null;
    const mentioned = bank.filter(b => b.terms.some(t => t && hay.includes(String(t).toLowerCase())));
    const pool = mentioned.length ? mentioned : bank;
    let h = 0;
    const key = `${moduleId}:${section.id}`;
    for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    const pick = pool[Math.abs(h) % pool.length];
    return pick ? Object.assign({}, pick, { id: `${section.id}::spiral` }) : null;
  }

  function normaliseDeltaItem(raw, i) {
    return {
      id: str(raw.id) || `d${i + 1}`,
      area: str(raw.area || raw.category || raw.group) || 'General',
      title: str(raw.title || raw.name) || `Change ${i + 1}`,
      description: str(raw.description || raw.summary),
      detail: str(raw.detail || raw.details || raw.notes),
      informational: true,
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
      const [modulesRes, questionsRes, deltaRes, figuresRes, acronymsRes] = await Promise.all([
        fetchJson(SOURCES.modules).catch(e => ({ __error: e })),
        fetchJson(SOURCES.questions).catch(e => ({ __error: e })),
        fetchJson(SOURCES.delta).catch(e => ({ __error: e })),
        fetchJson(SOURCES.figures).catch(e => ({ __error: e })),
        fetchJson(SOURCES.acronyms).catch(e => ({ __error: e }))
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

      if (figuresRes && figuresRes.__error) {
        errors.push(`Could not load ${SOURCES.figures} (${figuresRes.__error.message})`);
        cache.figures = [];
      } else {
        cache.figures = unwrap(figuresRes, ['figures', 'items', 'drawings'])
          .map(normaliseFigure)
          .filter(f => f.id && f.image);
      }

      if (acronymsRes && acronymsRes.__error) {
        errors.push(`Could not load ${SOURCES.acronyms} (${acronymsRes.__error.message})`);
        cache.acronyms = [];
      } else {
        cache.acronyms = normaliseAcronyms(acronymsRes);
      }

      attachTermChecks(cache.modules, cache.acronyms);
      cleanSpiralTerms(cache.modules);

      /* Questions whose moduleId does not resolve are still usable, but they
         should not disappear from module-filtered views without a trace. */
      const known = new Set(cache.modules.map(m => m.id));
      const orphans = cache.questions.filter(q => q.moduleId && !known.has(q.moduleId));
      if (orphans.length) {
        console.warn('Questions reference unknown modules:', [...new Set(orphans.map(q => q.moduleId))]);
      }

      const knownFigs = new Set(cache.figures.map(f => f.id));
      cache.modules.forEach(m => {
        (m.course && m.course.sections || []).forEach(s => {
          if (s.figureId && !knownFigs.has(s.figureId)) {
            console.warn('Course section references unknown figure:', s.id, s.figureId);
          }
        });
      });

      return {
        modules: cache.modules,
        questions: cache.questions,
        delta: cache.delta,
        figures: cache.figures,
        acronyms: cache.acronyms,
        errors
      };
    })();

    return loadPromise;
  }

  /* ----------------------------------------------------------- acronyms / terms */

  function normaliseAcronyms(payload) {
    const items = Array.isArray(payload)
      ? payload
      : (payload && Array.isArray(payload.items) ? payload.items : []);
    return items.map((raw, i) => {
      const acronym = str(raw.acronym || raw.id).toUpperCase();
      const options = arr(raw.options).map(o => typeof o === 'string' ? o.trim() : str(o)).filter(Boolean);
      let answer = Number(raw.answer);
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) answer = 0;
      return {
        id: str(raw.id) || `acro${i + 1}`,
        acronym,
        expansion: str(raw.expansion),
        meaning: str(raw.meaning),
        teachTitles: arr(raw.teachTitles).map(str).filter(Boolean),
        matchTitle: str(raw.matchTitle),
        matchBody: str(raw.matchBody),
        terms: arr(raw.terms).map(str).filter(Boolean),
        injectOnOverviewOnly: !!raw.injectOnOverviewOnly,
        options,
        answer
      };
    }).filter(a => a.acronym && a.expansion && a.options.length >= 2);
  }

  function buildTermCheck(item) {
    const label = item.acronym;
    return {
      id: item.id,
      acronym: item.acronym,
      expansion: item.expansion,
      stem: `What does ${label} stand for in this VCF architect course?`,
      options: item.options.slice(),
      answer: item.answer,
      answers: [item.answer],
      multiSelect: false,
      explanation: `${label} stands for ${item.expansion}. ${item.meaning || ''}`.trim(),
      reinforce: `Break the acronym out every time until it is automatic: ${label} = ${item.expansion}.`,
      terms: (item.terms && item.terms.length) ? item.terms.slice() : [item.acronym],
      spiral: true,
      isTermCheck: true
    };
  }

  function scoreAcronymForSection(item, section) {
    const title = str(section.title);
    const body = str(section.body);
    const id = str(section.id);
    let score = 0;

    if (item.teachTitles.some(t => t.toLowerCase() === title.toLowerCase())) score = Math.max(score, 100);
    if (item.teachTitles.some(t => title.toLowerCase().includes(t.toLowerCase()))) score = Math.max(score, 92);

    if (item.matchTitle) {
      try {
        if (new RegExp(item.matchTitle, 'i').test(title)) score = Math.max(score, 85);
      } catch (err) { /* bad regex */ }
    }

    if (item.acronym.length >= 2) {
      const acRe = new RegExp(`\\b${item.acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (acRe.test(title)) score = Math.max(score, 75);
    }

    if (item.id === 'dd' && (/-dd\d+/i.test(id) || /^DD[- ]?\d+/i.test(title) || /design decision/i.test(title))) {
      score = Math.max(score, 90);
    }

    if (item.injectOnOverviewOnly) {
      if (/overview/i.test(title) || /-s-overview$/i.test(id)) score = Math.max(score, 70);
      else score = Math.min(score, 40);
    }

    if (item.matchBody && score < 80) {
      try {
        if (new RegExp(item.matchBody, 'i').test(body)) score = Math.max(score, 55);
      } catch (err) { /* ignore */ }
    }

    /* Prefer teaching sections that already have a text KC */
    if (section.knowledgeCheck && score >= 55) score += 5;
    /* Avoid figure-only sections unless title strongly matches */
    if (section.figureId && !section.knowledgeCheck && score < 90) score = 0;

    return score;
  }

  function stemAlreadyTeachesAcronym(kc, item) {
    if (!kc || !kc.stem) return false;
    const s = kc.stem.toLowerCase();
    const ac = item.acronym.toLowerCase();
    return (
      (s.includes('stand for') || s.includes('acronym') || s.includes('stands for'))
      && s.includes(ac)
    ) || (kc.options || []).some(o => String(o).includes(item.expansion));
  }

  function attachTermChecks(modules, acronyms) {
    if (!acronyms || !acronyms.length) return;
    modules.forEach(m => {
      const sections = (m.course && m.course.sections) || [];
      sections.forEach(section => {
        let best = null;
        acronyms.forEach(item => {
          const score = scoreAcronymForSection(item, section);
          if (score >= 70 && (!best || score > best.score)) {
            best = { item, score };
          }
        });
        if (!best) return;
        if (stemAlreadyTeachesAcronym(section.knowledgeCheck, best.item)) {
          /* Ensure short spiral terms on the existing KC */
          const kc = section.knowledgeCheck;
          const want = best.item.terms && best.item.terms.length ? best.item.terms : [best.item.acronym];
          const merged = [...new Set([...(kc.terms || []), ...want])];
          kc.terms = merged.filter(t => t && !/\?$/.test(t) && t.length < 60);
          return;
        }
        section.termCheck = buildTermCheck(best.item);
        if (section.knowledgeCheck) {
          const kc = section.knowledgeCheck;
          const want = best.item.terms && best.item.terms.length ? best.item.terms : [best.item.acronym];
          const merged = [...new Set([...(kc.terms || []), ...want])];
          kc.terms = merged.filter(t => t && !/\?$/.test(t) && t.length < 60);
        }
      });
    });
  }

  function cleanSpiralTerms(modules) {
    modules.forEach(m => {
      ((m.course && m.course.sections) || []).forEach(section => {
        const kc = section.knowledgeCheck;
        if (!kc || !kc.terms) return;
        kc.terms = kc.terms
          .map(str)
          .filter(t => t && t.length < 48 && !/\?$/.test(t) && !/^Should /i.test(t) && !/^Which /i.test(t) && !/^How /i.test(t) && !/^What /i.test(t));
        if (section.termCheck && section.termCheck.terms) {
          kc.terms = [...new Set([...(kc.terms || []), ...section.termCheck.terms])];
        }
      });
    });
  }

  /**
   * Expand bare acronyms on first use: RCAR → RCAR (Requirements, …).
   * Skips tokens already followed by a parenthetical expansion.
   */
  function expandAcronyms(text, opts) {
    let out = String(text || '');
    if (!out || !cache.acronyms.length) return out;
    const all = !!(opts && opts.all);
    const seen = new Set();
    const sorted = cache.acronyms.slice().sort((a, b) => b.acronym.length - a.acronym.length);
    sorted.forEach(item => {
      const ac = item.acronym;
      const escAc = ac.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`${escAc}\\s*\\(`, 'i').test(out) && !all) {
        /* already expanded somewhere — still expand first bare if wanted */
      }
      const re = new RegExp(`\\b(${escAc})\\b(?!\\s*\\()`, all ? 'gi' : 'i');
      out = out.replace(re, (match) => {
        const key = match.toUpperCase();
        if (!all && seen.has(key)) return match;
        seen.add(key);
        return `${match} (${item.expansion})`;
      });
    });
    return out;
  }

  function getAcronyms() { return cache.acronyms; }
  function getAcronym(idOrAcronym) {
    const key = String(idOrAcronym || '').toLowerCase();
    return cache.acronyms.find(a => a.id === key || a.acronym.toLowerCase() === key) || null;
  }

  /* --------------------------------------------------------------- accessors */

  function getModules() { return cache.modules; }
  function getModule(id) { return cache.modules.find(m => m.id === id) || null; }
  function getQuestions() { return cache.questions; }
  function getQuestion(id) { return cache.questions.find(q => q.id === id) || null; }
  function getDelta() { return cache.delta; }
  function getFigures() { return cache.figures; }
  function getFigure(id) { return cache.figures.find(f => f.id === id) || null; }
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
    getFigures,
    getFigure,
    getQuestionsByModule,
    getQuestionsByType,
    getSpiralBank,
    pickSpiralRecall,
    getModuleOrder,
    getAcronyms,
    getAcronym,
    expandAcronyms,
    getErrors
  };
})();
