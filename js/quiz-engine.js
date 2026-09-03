/* ==========================================================================
   quiz-engine.js — SM-2 spaced repetition scheduler + exam generator.

   Per-question record shape (localStorage key "vcf9.progress"):
     { easeFactor, interval, nextReviewDate, repetitions, lastAnswer, lapses,
       attempts, correct, lastSeen }

   Public API (window.QuizEngine):
     getNextQuizQuestion(moduleFilter?)
     recordAnswer(questionId, correct)
     getProgress()
     generateExam(count = 40)
     getExamHistory() / saveExamResult(result)
     getDueCount(moduleFilter?) / getRecord(id) / isMastered(id)
     resetProgress()
   ========================================================================== */

window.QuizEngine = (function () {
  'use strict';

  const PROGRESS_KEY = 'vcf9.progress';
  const EXAMS_KEY = 'vcf9.exams';
  const OWNED_KEYS = [PROGRESS_KEY, EXAMS_KEY, 'vcf9.examSession'];

  const MIN_EASE = 1.3;
  const DEFAULT_EASE = 2.5;

  /* A question counts as mastered once it has survived three successful
     reviews and its next review is at least three weeks out. */
  const MASTERY_REPS = 3;
  const MASTERY_INTERVAL = 21;

  /* --------------------------------------------------------------- storage */

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn(`Could not read ${key} from localStorage:`, err);
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn(`Could not write ${key} to localStorage:`, err);
      return false;
    }
  }

  let records = readJson(PROGRESS_KEY, {}) || {};

  function persist() { writeJson(PROGRESS_KEY, records); }

  /* ------------------------------------------------------------------ dates */

  /* Schedules are day-granular; storing plain YYYY-MM-DD keeps comparisons
     timezone-stable across devices syncing the same profile. */
  function dayKey(date) {
    const d = date || new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function addDays(days, from) {
    const d = from ? new Date(from) : new Date();
    d.setDate(d.getDate() + days);
    return dayKey(d);
  }

  function daysBetween(fromKey, toKey) {
    const a = Date.parse(`${fromKey}T00:00:00`);
    const b = Date.parse(`${toKey}T00:00:00`);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.round((b - a) / 86400000);
  }

  function isDue(rec, today) {
    return !rec.nextReviewDate || rec.nextReviewDate <= (today || dayKey());
  }

  /* ---------------------------------------------------------------- SM-2 */

  function newRecord() {
    return {
      easeFactor: DEFAULT_EASE,
      interval: 0,
      nextReviewDate: dayKey(),
      repetitions: 0,
      lastAnswer: null,
      lapses: 0,
      attempts: 0,
      correct: 0,
      lastSeen: null
    };
  }

  /* Classic SM-2: quality 0-5, with correct mapped to 4 and wrong to 1. */
  function applySM2(rec, quality) {
    if (quality >= 3) {
      if (rec.repetitions === 0) rec.interval = 1;
      else if (rec.repetitions === 1) rec.interval = 6;
      else rec.interval = Math.max(1, Math.round(rec.interval * rec.easeFactor));
      rec.repetitions += 1;
    } else {
      rec.repetitions = 0;
      rec.interval = 1;
      rec.lapses += 1;
    }

    const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    rec.easeFactor = Math.max(MIN_EASE, Math.round((rec.easeFactor + delta) * 100) / 100);
    rec.nextReviewDate = addDays(rec.interval);
    return rec;
  }

  function recordAnswer(questionId, correct) {
    if (!questionId) return null;

    const rec = Object.assign(newRecord(), records[questionId] || {});
    applySM2(rec, correct ? 4 : 1);

    rec.lastAnswer = !!correct;
    rec.attempts += 1;
    if (correct) rec.correct += 1;
    rec.lastSeen = new Date().toISOString();

    records[questionId] = rec;
    persist();
    return rec;
  }

  function getRecord(id) { return records[id] ? Object.assign({}, records[id]) : null; }

  function stateOf(rec) {
    if (!rec || !rec.attempts) return 'new';
    if (rec.repetitions >= MASTERY_REPS && rec.interval >= MASTERY_INTERVAL) return 'mastered';
    return 'learning';
  }

  function isMastered(id) { return stateOf(records[id]) === 'mastered'; }

  /* ------------------------------------------------------------ question set */

  function allQuestions() {
    return (window.DataLoader && window.DataLoader.getQuestions()) || [];
  }

  function pool(moduleFilter) {
    const qs = allQuestions();
    return moduleFilter ? qs.filter(q => q.moduleId === moduleFilter) : qs;
  }

  /* ------------------------------------------------------------- scheduling */

  /* Priority order: most-overdue reviews, then unseen questions from the
     weakest module, then whatever review is closest to falling due. */
  function getNextQuizQuestion(moduleFilter) {
    const candidates = pool(moduleFilter);
    if (!candidates.length) return null;

    const today = dayKey();
    const seen = [];
    const unseen = [];

    candidates.forEach(q => {
      const rec = records[q.id];
      if (!rec || !rec.attempts) unseen.push(q);
      else seen.push({ q, rec });
    });

    const overdue = seen
      .filter(({ rec }) => isDue(rec, today))
      .sort((a, b) => {
        const lag = daysBetween(a.rec.nextReviewDate, today) - daysBetween(b.rec.nextReviewDate, today);
        if (lag !== 0) return -lag;                          // more overdue first
        return a.rec.easeFactor - b.rec.easeFactor;          // then hardest
      });

    if (overdue.length) return overdue[0].q;

    if (unseen.length) {
      const weakness = moduleWeakness();
      unseen.sort((a, b) => (weakness[b.moduleId] || 0) - (weakness[a.moduleId] || 0));
      return unseen[0];
    }

    seen.sort((a, b) => {
      if (a.rec.nextReviewDate === b.rec.nextReviewDate) return a.rec.easeFactor - b.rec.easeFactor;
      return a.rec.nextReviewDate < b.rec.nextReviewDate ? -1 : 1;
    });
    return seen.length ? seen[0].q : null;
  }

  /* 0 = fully mastered, 1 = untouched. Used to bias new questions and exams. */
  function moduleWeakness() {
    const totals = {};
    allQuestions().forEach(q => {
      const key = q.moduleId || 'unassigned';
      if (!totals[key]) totals[key] = { total: 0, score: 0 };
      totals[key].total += 1;
      const state = stateOf(records[q.id]);
      totals[key].score += state === 'mastered' ? 1 : state === 'learning' ? 0.5 : 0;
    });

    const out = {};
    Object.keys(totals).forEach(key => {
      const { total, score } = totals[key];
      out[key] = total ? 1 - score / total : 1;
    });
    return out;
  }

  function getDueCount(moduleFilter) {
    const today = dayKey();
    return pool(moduleFilter).filter(q => {
      const rec = records[q.id];
      return rec && rec.attempts ? isDue(rec, today) : false;
    }).length;
  }

  /* ---------------------------------------------------------------- progress */

  function getProgress() {
    const qs = allQuestions();
    const today = dayKey();
    const byModule = {};
    let mastered = 0;
    let learning = 0;
    let fresh = 0;
    let dueToday = 0;

    (window.DataLoader ? window.DataLoader.getModules() : []).forEach(m => {
      byModule[m.id] = { total: 0, mastered: 0, learning: 0, new: 0, dueToday: 0, mastery: 0 };
    });

    qs.forEach(q => {
      const key = q.moduleId || 'unassigned';
      if (!byModule[key]) byModule[key] = { total: 0, mastered: 0, learning: 0, new: 0, dueToday: 0, mastery: 0 };
      const bucket = byModule[key];
      bucket.total += 1;

      const rec = records[q.id];
      const state = stateOf(rec);

      if (state === 'mastered') { mastered += 1; bucket.mastered += 1; }
      else if (state === 'learning') { learning += 1; bucket.learning += 1; }
      else { fresh += 1; bucket.new += 1; }

      if (rec && rec.attempts && isDue(rec, today)) { dueToday += 1; bucket.dueToday += 1; }
    });

    Object.keys(byModule).forEach(key => {
      const b = byModule[key];
      b.mastery = b.total ? Math.round(((b.mastered + b.learning * 0.5) / b.total) * 100) : 0;
    });

    const totalQuestions = qs.length;
    return {
      totalQuestions,
      mastered,
      learning,
      new: fresh,
      dueToday,
      answered: totalQuestions - fresh,
      masteryPct: totalQuestions ? Math.round(((mastered + learning * 0.5) / totalQuestions) * 100) : 0,
      byModule
    };
  }

  /* -------------------------------------------------------------------- exam */

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* Allocate slots per module in proportion to its question count, nudged
     towards the modules the learner is weakest in. */
  function generateExam(count) {
    const target = Math.max(1, count || 40);
    const qs = allQuestions();
    if (!qs.length) return [];

    const groups = new Map();
    qs.forEach(q => {
      const key = q.moduleId || 'unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(q);
    });

    const weakness = moduleWeakness();
    const keys = [...groups.keys()];
    const weights = keys.map(k => groups.get(k).length * (1 + (weakness[k] || 0) * 0.5));
    const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

    const picked = [];
    keys.forEach((key, i) => {
      const share = Math.min(groups.get(key).length, Math.round((weights[i] / weightSum) * target));
      shuffle(groups.get(key)).slice(0, share).forEach(q => picked.push(q.id));
    });

    /* Rounding can under- or over-fill; top up from the remaining pool. */
    if (picked.length < target) {
      const chosen = new Set(picked);
      shuffle(qs.filter(q => !chosen.has(q.id)))
        .slice(0, target - picked.length)
        .forEach(q => picked.push(q.id));
    }

    return shuffle(picked).slice(0, Math.min(target, qs.length));
  }

  function getExamHistory() {
    const list = readJson(EXAMS_KEY, []) || [];
    return Array.isArray(list) ? list.slice().sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
  }

  function saveExamResult(result) {
    const list = readJson(EXAMS_KEY, []) || [];
    const entry = {
      id: `exam-${Date.now()}`,
      score: Number(result && result.score) || 0,
      total: Number(result && result.total) || 0,
      date: (result && result.date) || new Date().toISOString(),
      durationSec: (result && result.durationSec) || null,
      wrongIds: (result && result.wrongIds) || []
    };
    entry.percent = entry.total ? Math.round((entry.score / entry.total) * 100) : 0;
    list.push(entry);
    writeJson(EXAMS_KEY, list.slice(-100));
    return entry;
  }

  function resetProgress() {
    records = {};
    OWNED_KEYS.forEach(key => {
      try { localStorage.removeItem(key); } catch (err) { /* storage disabled */ }
    });
  }

  return {
    getNextQuizQuestion,
    recordAnswer,
    getProgress,
    generateExam,
    getExamHistory,
    saveExamResult,
    getDueCount,
    getRecord,
    isMastered,
    resetProgress,
    /* exposed for the progress view and tests */
    _stateOf: stateOf,
    _applySM2: applySM2,
    _newRecord: newRecord,
    _dayKey: dayKey
  };
})();
