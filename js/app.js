/* ==========================================================================
   app.js — hash router, view rendering and interaction wiring.

   Routes: #study  #study/<modId>  #quiz  #quiz/<modId>  #exam  #delta  #progress
   ========================================================================== */

(function () {
  'use strict';

  const THEME_KEY = 'vcf9.theme';
  const FILTER_KEY = 'vcf9.quizFilter';

  const EXAM_QUESTIONS = 40;
  const EXAM_MINUTES = 60;
  const PASS_PCT = 85;

  const view = document.getElementById('view');
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const navToggle = document.getElementById('navToggle');
  const themeToggle = document.getElementById('themeToggle');

  let quiz = null;   // { filter, question, answered, chosen, correct, asked }
  let exam = null;   // { phase, ids, answers, index, endsAt, timerId, startedAt, result }
  let course = null; // { moduleId, index }

  /* ====================================================================== */
  /* Helpers                                                                */
  /* ====================================================================== */

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ESC[c]);
  }

  /* Only http(s) links are emitted, so a bad source URL cannot become a
     javascript: navigation. */
  function safeUrl(url) {
    const s = String(url || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  const badge91 = '<span class="badge badge-91">9.1 Update</span>';

  function pct(n) { return `${Math.round(n || 0)}%`; }

  function letter(i) { return String.fromCharCode(65 + i); }

  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function moduleTitle(modId) {
    const m = DataLoader.getModule(modId);
    return m ? m.title : modId;
  }

  function moduleLabel(m) {
    return `Module ${m.number} — ${m.title}`;
  }

  function bar(label, value, klass) {
    return `
      <div class="bar-row">
        <div class="bar-head"><strong>${esc(label)}</strong><span class="bar-pct">${pct(value)}</span></div>
        <div class="bar"><div class="bar-fill ${klass || ''}" style="width:${Math.max(0, Math.min(100, value))}%"></div></div>
      </div>`;
  }

  function ring(value, caption) {
    const r = 54;
    const circumference = 2 * Math.PI * r;
    const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100);
    return `
      <div class="ring" role="img" aria-label="${esc(caption)}: ${pct(value)}">
        <svg viewBox="0 0 132 132" width="132" height="132" aria-hidden="true">
          <circle class="ring-track" cx="66" cy="66" r="${r}"></circle>
          <circle class="ring-value" cx="66" cy="66" r="${r}"
                  stroke-dasharray="${circumference.toFixed(2)}"
                  stroke-dashoffset="${offset.toFixed(2)}"></circle>
        </svg>
        <div class="ring-label">
          <span class="ring-pct">${pct(value)}</span>
          <span class="ring-cap">${esc(caption)}</span>
        </div>
      </div>`;
  }

  function pageHead(eyebrow, title, lede) {
    return `
      <div class="page-head">
        ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}
        <h2>${esc(title)}</h2>
        ${lede ? `<p class="lede">${esc(lede)}</p>` : ''}
      </div>`;
  }

  function emptyState(message) {
    return `<div class="card empty">${esc(message)}</div>`;
  }

  function dataNotice() {
    const errors = DataLoader.getErrors();
    if (!errors.length) return '';
    return `
      <div class="notice">
        <h3>Content could not be loaded</h3>
        <p>The app is running, but some content files are missing or invalid:</p>
        <ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
        <p>If you opened <code>index.html</code> directly from disk, serve the folder over HTTP instead
        (for example <code>python3 -m http.server</code>) — browsers block <code>fetch</code> on
        <code>file://</code> URLs.</p>
      </div>`;
  }

  /* ====================================================================== */
  /* Theme                                                                  */
  /* ====================================================================== */

  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#070d18' : '#0f172a');
    themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  function initTheme() {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (err) { /* storage disabled */ }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored || (prefersDark ? 'dark' : 'light'));
  }

  themeToggle.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* storage disabled */ }
  });

  /* ====================================================================== */
  /* Sidebar                                                                */
  /* ====================================================================== */

  function isOverlayNav() { return window.matchMedia('(max-width: 1024px)').matches; }

  function setNav(open) {
    document.body.classList.toggle('nav-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    scrim.hidden = !open;
  }

  navToggle.addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
  scrim.addEventListener('click', () => setNav(false));

  /* The skip link must not put "#view" into the hash — that is the router's channel. */
  const skipLink = document.querySelector('.skip-link');
  if (skipLink) skipLink.addEventListener('click', event => {
    event.preventDefault();
    view.focus();
  });

  sidebar.addEventListener('click', event => {
    if (event.target.closest('.nav-link') && isOverlayNav()) setNav(false);
  });

  window.addEventListener('resize', () => {
    if (!isOverlayNav()) setNav(false);
  });

  function setActiveNav(section) {
    const active = section === 'course' ? 'study' : section;
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.section === active);
      if (link.dataset.section === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function refreshSidebarStats() {
    const p = QuizEngine.getProgress();
    document.getElementById('sidebarDue').textContent = String(p.dueToday);
    document.getElementById('sidebarMastery').textContent = pct(p.masteryPct);
  }

  /* ====================================================================== */
  /* Study views                                                            */
  /* ====================================================================== */

  function renderStudy() {
    const modules = DataLoader.getModules();
    const progress = QuizEngine.getProgress();

    if (!modules.length) {
      view.innerHTML = dataNotice() + pageHead('Study', 'Modules', '') + emptyState('No modules have been published yet.');
      return;
    }

    const cards = modules.map(m => {
      const stats = progress.byModule[m.id] || { total: 0, mastery: 0, dueToday: 0 };
      const qCount = stats.total;
      return `
        <a class="card module-card" href="#study/${encodeURIComponent(m.id)}">
          <span class="module-no">Module ${esc(m.number)}${m.delta91 ? ' · 9.1' : ''}</span>
          <h3>${esc(m.title)}</h3>
          <p class="module-summary">${esc(m.summary)}</p>
          <div class="module-meta">
            <span>${(m.study && m.study.highlights.length) || 0} study clips</span>
            <span>${(m.course && m.course.sections.length) || 0} course sections</span>
            <span>${qCount} questions</span>
            ${stats.dueToday ? `<span class="badge badge-soft">${stats.dueToday} due</span>` : ''}
          </div>
          ${bar('Mastery', stats.mastery, stats.mastery >= 80 ? 'is-ok' : '')}
        </a>`;
    }).join('');

    view.innerHTML = `
      ${dataNotice()}
      ${pageHead('Study', 'Modules', 'Each module starts with a short Study clip (what to watch for), then a full Course presentation that teaches the material and points back to those clips.')}
      <div class="card-grid">${cards}</div>`;
  }

  function highlightMap(m) {
    const map = {};
    ((m.study && m.study.highlights) || []).forEach(h => { map[h.id] = h; });
    return map;
  }

  function renderModule(modId) {
    const m = DataLoader.getModule(modId);
    if (!m) {
      view.innerHTML = `<a class="backlink" href="#study">← All modules</a>${emptyState(`Module "${modId}" was not found.`)}`;
      return;
    }

    const stats = QuizEngine.getProgress().byModule[m.id] || { total: 0, mastery: 0, dueToday: 0 };
    const study = m.study || { primer: m.summary, highlights: [] };
    const hasCourse = !!(m.course && m.course.sections.length);

    const highlightCards = (study.highlights || []).map((h, i) => `
      <article class="highlight-card">
        <span class="highlight-num">${i + 1}</span>
        <div>
          <h4>${esc(h.title)}</h4>
          <p>${esc(h.text)}</p>
        </div>
      </article>`).join('');

    view.innerHTML = `
      <a class="backlink" href="#study">← All modules</a>
      ${pageHead(`Module ${m.number} · Study clip`, m.title, m.summary)}

      <div class="learn-path" role="note">
        <strong>How this works:</strong>
        This Study clip is the primer — what to hang onto.
        Then open <em>Course</em> for the full presentation. The Course will point back to these clips as you go.
      </div>

      <div class="quiz-bar">
        <span class="score-pill">${pct(stats.mastery)} <span>mastery</span></span>
        <span class="score-pill">${stats.total} <span>questions</span></span>
        <span class="spacer"></span>
        ${hasCourse
          ? `<a class="btn btn-sm btn-primary" href="#course/${encodeURIComponent(m.id)}">Start Course</a>`
          : ''}
        <a class="btn btn-sm" href="#quiz/${encodeURIComponent(m.id)}">Quiz</a>
      </div>

      <section class="section">
        <h3>Primer</h3>
        <p class="primer-text">${esc(study.primer || m.summary)}</p>
      </section>

      ${(study.highlights || []).length ? `
        <section class="section">
          <h3>Watch for these<span class="section-count">${study.highlights.length}</span></h3>
          <p class="section-lead">Hang onto these while you take the Course. The presenter will call them back.</p>
          <div class="highlight-stack">${highlightCards}</div>
        </section>` : ''}

      ${m.checkYourself && m.checkYourself.length ? `
        <section class="section check-section">
          <h3>After the Course — check yourself<span class="section-count">${m.checkYourself.length}</span></h3>
          <p class="section-lead">Do these only after you finish the Course presentation.</p>
          <ol class="check-list">
            ${m.checkYourself.map(q => `<li>${esc(q)}</li>`).join('')}
          </ol>
        </section>` : ''}

      <div class="cta-row">
        ${hasCourse
          ? `<a class="btn btn-primary" href="#course/${encodeURIComponent(m.id)}">Start Course presentation</a>`
          : ''}
        <a class="btn" href="#quiz/${encodeURIComponent(m.id)}">Skip to Quiz</a>
      </div>`;
  }

  function renderCourse(modId) {
    const m = DataLoader.getModule(modId);
    if (!m || !m.course || !m.course.sections.length) {
      view.innerHTML = `
        <a class="backlink" href="#study/${encodeURIComponent(modId || '')}">← Study clip</a>
        ${emptyState('This module has no Course presentation yet.')}`;
      return;
    }

    if (!course || course.moduleId !== modId) {
      course = { moduleId: modId, index: 0 };
    }
    if (course.index < 0) course.index = 0;
    if (course.index >= m.course.sections.length) course.index = m.course.sections.length - 1;

    const sections = m.course.sections;
    const idx = course.index;
    const section = sections[idx];
    const map = highlightMap(m);
    const callbacks = (section.highlightIds || [])
      .map(id => map[id])
      .filter(Boolean);

    const paras = esc(section.body).split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

    const callbackBlock = callbacks.length
      ? `<aside class="course-callback" role="note">
           <h4>From the Study clip</h4>
           ${callbacks.map(h => `
             <div class="callback-item">
               <strong>${esc(h.title)}</strong>
               <p>${esc(h.text)}</p>
             </div>`).join('')}
         </aside>`
      : '';

    const isLast = idx === sections.length - 1;

    view.innerHTML = `
      <a class="backlink" href="#study/${encodeURIComponent(m.id)}">← Study clip</a>
      ${pageHead(`Module ${m.number} · Course`, m.title, `Section ${idx + 1} of ${sections.length}`)}

      <div class="course-progress" aria-hidden="true">
        <div class="course-progress-bar" style="width:${Math.round(((idx + 1) / sections.length) * 100)}%"></div>
      </div>

      <article class="course-stage">
        <h3 class="course-section-title">${esc(section.title)}</h3>
        ${callbackBlock}
        <div class="course-body">${paras}</div>
      </article>

      <div class="course-nav">
        <button type="button" class="btn" data-action="course-prev" ${idx === 0 ? 'disabled' : ''}>Previous</button>
        <span class="course-pos">${idx + 1} / ${sections.length}</span>
        ${isLast
          ? `<a class="btn btn-primary" href="#quiz/${encodeURIComponent(m.id)}">Done — Quiz</a>`
          : `<button type="button" class="btn btn-primary" data-action="course-next">Next section</button>`}
      </div>
      <p class="hint course-hint">One section at a time so you keep focus. Study clips appear when this section hits something you were told to watch for.</p>`;
  }

  /* ====================================================================== */
  /* Quiz                                                                   */
  /* ====================================================================== */

  function storedFilter() {
    try { return localStorage.getItem(FILTER_KEY) || ''; } catch (err) { return ''; }
  }

  function renderQuiz(modFilter) {
    const questions = DataLoader.getQuestions();
    const filter = modFilter != null ? modFilter : (quiz ? quiz.filter : storedFilter());

    if (!quiz || quiz.filter !== filter) {
      quiz = { filter, question: null, answered: false, chosen: -1, correct: 0, asked: 0 };
    }
    try { localStorage.setItem(FILTER_KEY, filter); } catch (err) { /* storage disabled */ }

    if (!questions.length) {
      view.innerHTML = dataNotice() + pageHead('Quiz', 'Adaptive quiz', '') + emptyState('No questions have been published yet.');
      return;
    }

    if (!quiz.question) quiz.question = QuizEngine.getNextQuizQuestion(filter || undefined);

    const modules = DataLoader.getModules();
    const options = modules
      .map(m => `<option value="${esc(m.id)}"${m.id === filter ? ' selected' : ''}>${esc(moduleLabel(m))}</option>`)
      .join('');

    const due = QuizEngine.getDueCount(filter || undefined);
    const accuracy = quiz.asked ? Math.round((quiz.correct / quiz.asked) * 100) : 0;

    view.innerHTML = `
      ${pageHead('Quiz', 'Adaptive quiz', 'Questions test whether you understand the mechanism and decision rule. Spaced repetition schedules weak items first — letter memorization will not survive a reworded scenario.')}

      <div class="quiz-bar">
        <label class="field">Module
          <select class="input" id="quizFilter">
            <option value=""${filter ? '' : ' selected'}>All modules</option>
            ${options}
          </select>
        </label>
        <span class="spacer"></span>
        <span class="score-pill" id="quizScore">${quiz.correct}/${quiz.asked} <span>this session${quiz.asked ? ` · ${accuracy}%` : ''}</span></span>
        <span class="score-pill" id="quizDue">${due} <span>due today</span></span>
      </div>

      <div id="quizSlot">${quizCard()}</div>`;

    const select = document.getElementById('quizFilter');
    if (select) select.addEventListener('change', e => {
      const value = e.target.value;
      location.hash = value ? `#quiz/${encodeURIComponent(value)}` : '#quiz';
    });
  }

  function quizCard() {
    if (!quiz.question) {
      return `
        <div class="card empty">
          <p>Nothing to review in this selection right now — every question is scheduled for a future date.</p>
          <p>Pick a different module, or start a mock exam.</p>
          <div class="btn-row"><a class="btn btn-primary" href="#exam">Go to mock exam</a></div>
        </div>`;
    }

    const q = quiz.question;
    const rec = QuizEngine.getRecord(q.id);
    const state = QuizEngine._stateOf(rec);

    const opts = q.options.map((text, i) => {
      let klass = 'option';
      let mark = '';
      if (quiz.answered) {
        if (i === q.answer) { klass += ' is-correct'; mark = '✓'; }
        else if (i === quiz.chosen) { klass += ' is-wrong'; mark = '✕'; }
      }
      return `
        <button type="button" class="${klass}" data-action="quiz-answer" data-index="${i}" ${quiz.answered ? 'disabled' : ''}>
          <span class="option-key">${letter(i)}</span>
          <span class="option-text">${esc(text)}</span>
          ${mark ? `<span class="option-mark">${mark}</span>` : ''}
        </button>`;
    }).join('');

    const wasRight = quiz.answered && quiz.chosen === q.answer;

    return `
      <div class="qcard">
        <div class="qcard-head">
          ${q.moduleId ? `<span class="chip">${esc(moduleTitle(q.moduleId))}</span>` : ''}
          <span class="chip">${esc(q.type)}</span>
          <span class="badge badge-soft">${state}</span>
          ${q.delta91 ? badge91 : ''}
        </div>

        <p class="qstem">${esc(q.stem)}</p>
        <div class="options">${opts}</div>

        ${quiz.answered ? `
          <div class="explain ${wasRight ? 'is-correct' : 'is-wrong'}">
            <h4>${wasRight ? 'Correct — for the right reason?' : `Incorrect — the answer is ${letter(q.answer)}`}</h4>
            <p>${esc(q.explanation || 'No explanation was provided for this question.')}</p>
            <p class="hint">${wasRight
              ? 'Can you restate the decision rule without looking? If not, return to Study before the next question.'
              : 'Do not memorize the letter. Open Study, re-learn the What/How/Why, then retry.'}</p>
          </div>
          <div class="qfoot">
            <button type="button" class="btn btn-primary" data-action="quiz-next">Next question</button>
            <span class="hint">Press <kbd>Enter</kbd> for the next question</span>
          </div>` : `
          <div class="qfoot">
            <span class="hint">Press <kbd>1</kbd>–<kbd>${q.options.length}</kbd> to answer</span>
          </div>`}
      </div>`;
  }

  /* The running score and due counter live outside the question card, so they
     are patched directly rather than waiting for the next full render. */
  function updateQuizBar() {
    const score = document.getElementById('quizScore');
    if (score) {
      const accuracy = quiz.asked ? Math.round((quiz.correct / quiz.asked) * 100) : 0;
      score.innerHTML = `${quiz.correct}/${quiz.asked} <span>this session${quiz.asked ? ` · ${accuracy}%` : ''}</span>`;
    }
    const due = document.getElementById('quizDue');
    if (due) due.innerHTML = `${QuizEngine.getDueCount(quiz.filter || undefined)} <span>due today</span>`;
  }

  function repaintQuizCard() {
    const slot = document.getElementById('quizSlot');
    if (slot) slot.innerHTML = quizCard();
  }

  function answerQuiz(index) {
    if (!quiz || !quiz.question || quiz.answered) return;

    const q = quiz.question;
    const correct = index === q.answer;

    quiz.answered = true;
    quiz.chosen = index;
    quiz.asked += 1;
    if (correct) quiz.correct += 1;

    QuizEngine.recordAnswer(q.id, correct);
    repaintQuizCard();
    updateQuizBar();
    refreshSidebarStats();

    const next = document.querySelector('[data-action="quiz-next"]');
    if (next) next.focus();
  }

  function nextQuizQuestion() {
    if (!quiz) return;
    quiz.answered = false;
    quiz.chosen = -1;
    quiz.question = QuizEngine.getNextQuizQuestion(quiz.filter || undefined);
    renderQuiz(quiz.filter);
  }

  /* ====================================================================== */
  /* Exam                                                                   */
  /* ====================================================================== */

  function stopExamTimer() {
    if (exam && exam.timerId) {
      clearInterval(exam.timerId);
      exam.timerId = null;
    }
  }

  function renderExam() {
    if (!exam || exam.phase === 'intro') return renderExamIntro();
    if (exam.phase === 'running') return renderExamRunner();
    return renderExamResults();
  }

  function renderExamIntro() {
    const total = DataLoader.getQuestions().length;
    const count = Math.min(EXAM_QUESTIONS, total);
    const history = QuizEngine.getExamHistory();
    const best = history.reduce((max, h) => Math.max(max, h.percent || 0), 0);

    view.innerHTML = `
      ${dataNotice()}
      ${pageHead('Exam', 'Mock exam', 'A timed, full-length rehearsal weighted across every module.')}

      ${total ? `
        <div class="card">
          <ul class="instructions">
            <li>${count} questions drawn across all modules, weighted towards your weaker areas.</li>
            <li>${EXAM_MINUTES} minute time limit — the exam submits automatically when time runs out.</li>
            <li>Pass mark is ${PASS_PCT}%.</li>
            <li>Use the navigator to jump between questions; unanswered items are scored as incorrect.</li>
            <li>Answers feed your spaced-repetition schedule, so wrong items resurface in the quiz.</li>
          </ul>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-action="exam-start">Start exam</button>
            ${best ? `<span class="score-pill">${best}% <span>personal best</span></span>` : ''}
          </div>
        </div>` : emptyState('No questions have been published yet.')}

      ${history.length ? `
        <section class="section">
          <h3>Recent attempts<span class="section-count">${history.length}</span></h3>
          ${examHistoryTable(history.slice(0, 5))}
        </section>` : ''}`;
  }

  function startExam() {
    const ids = QuizEngine.generateExam(EXAM_QUESTIONS);
    if (!ids.length) return;

    stopExamTimer();
    exam = {
      phase: 'running',
      ids,
      answers: new Array(ids.length).fill(null),
      index: 0,
      startedAt: Date.now(),
      endsAt: Date.now() + EXAM_MINUTES * 60000,
      timerId: null,
      result: null
    };

    renderExamRunner();
    exam.timerId = setInterval(tickExamTimer, 1000);
  }

  function tickExamTimer() {
    if (!exam || exam.phase !== 'running') return stopExamTimer();

    const remaining = (exam.endsAt - Date.now()) / 1000;
    const el = document.getElementById('examTimer');

    if (el) {
      el.textContent = formatClock(remaining);
      el.classList.toggle('is-warning', remaining <= 600 && remaining > 120);
      el.classList.toggle('is-critical', remaining <= 120);
    }

    if (remaining <= 0) submitExam(true);
  }

  function renderExamRunner() {
    const q = DataLoader.getQuestion(exam.ids[exam.index]);
    const answered = exam.answers.filter(a => a !== null).length;
    const remaining = (exam.endsAt - Date.now()) / 1000;

    const navigator = exam.ids.map((id, i) => {
      const klass = ['nav-num'];
      if (exam.answers[i] !== null) klass.push('is-answered');
      if (i === exam.index) klass.push('is-current');
      return `<button type="button" class="${klass.join(' ')}" data-action="exam-goto" data-index="${i}"
                aria-label="Question ${i + 1}${exam.answers[i] !== null ? ', answered' : ', unanswered'}">${i + 1}</button>`;
    }).join('');

    const opts = q ? q.options.map((text, i) => `
      <button type="button" class="option ${exam.answers[exam.index] === i ? 'is-selected' : ''}"
              data-action="exam-answer" data-index="${i}">
        <span class="option-key">${letter(i)}</span>
        <span class="option-text">${esc(text)}</span>
      </button>`).join('') : '';

    view.innerHTML = `
      <div class="exam-bar">
        <span class="timer" id="examTimer">${formatClock(remaining)}</span>
        <span class="score-pill" id="examAnswered">${answered}/${exam.ids.length} <span>answered</span></span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" data-action="exam-prev" ${exam.index === 0 ? 'disabled' : ''}>← Prev</button>
        <button type="button" class="btn btn-sm" data-action="exam-next" ${exam.index === exam.ids.length - 1 ? 'disabled' : ''}>Next →</button>
        <button type="button" class="btn btn-sm btn-primary" data-action="exam-submit">Submit</button>
      </div>

      ${q ? `
        <div class="qcard">
          <div class="qcard-head">
            <span class="chip">Question ${exam.index + 1} of ${exam.ids.length}</span>
            ${q.moduleId ? `<span class="chip">${esc(moduleTitle(q.moduleId))}</span>` : ''}
            ${q.delta91 ? badge91 : ''}
          </div>
          <p class="qstem">${esc(q.stem)}</p>
          <div class="options">${opts}</div>
          <div class="qfoot">
            <span class="hint">Press <kbd>1</kbd>–<kbd>${q.options.length}</kbd> to answer, <kbd>Enter</kbd> for next</span>
          </div>
        </div>` : emptyState('This question could not be loaded.')}

      <section class="section">
        <h3>Navigator<span class="section-count" id="examNavCount">${answered} answered</span></h3>
        <div class="navigator">${navigator}</div>
      </section>`;
  }

  /* Patched in place rather than re-rendered so the scroll position and the
     navigator's position under the thumb stay put on touch devices. */
  function answerExam(index) {
    if (!exam || exam.phase !== 'running') return;
    exam.answers[exam.index] = index;

    view.querySelectorAll('.options .option').forEach((btn, i) => {
      btn.classList.toggle('is-selected', i === index);
    });

    const navBtn = view.querySelectorAll('.nav-num')[exam.index];
    if (navBtn) {
      navBtn.classList.add('is-answered');
      navBtn.setAttribute('aria-label', `Question ${exam.index + 1}, answered`);
    }

    const answered = exam.answers.filter(a => a !== null).length;
    const counter = document.getElementById('examAnswered');
    if (counter) counter.innerHTML = `${answered}/${exam.ids.length} <span>answered</span>`;
    const navCount = document.getElementById('examNavCount');
    if (navCount) navCount.textContent = `${answered} answered`;
  }

  function gotoExamQuestion(index) {
    if (!exam || exam.phase !== 'running') return;
    exam.index = Math.max(0, Math.min(exam.ids.length - 1, index));
    renderExamRunner();
    window.scrollTo(0, 0);
  }

  function submitExam(auto) {
    if (!exam || exam.phase !== 'running') return;

    const unanswered = exam.answers.filter(a => a === null).length;
    if (!auto && unanswered > 0 &&
        !window.confirm(`${unanswered} question${unanswered === 1 ? '' : 's'} left unanswered. They will be marked incorrect. Submit anyway?`)) {
      return;
    }

    stopExamTimer();

    let score = 0;
    const wrongIds = [];
    exam.ids.forEach((id, i) => {
      const q = DataLoader.getQuestion(id);
      if (!q) return;
      const chosen = exam.answers[i];
      const correct = chosen === q.answer;
      if (correct) score += 1;
      else wrongIds.push(id);
      /* Skipped questions are not graded into the review schedule. */
      if (chosen !== null) QuizEngine.recordAnswer(id, correct);
    });

    const durationSec = Math.round((Date.now() - exam.startedAt) / 1000);
    exam.result = QuizEngine.saveExamResult({
      score,
      total: exam.ids.length,
      date: new Date().toISOString(),
      durationSec,
      wrongIds
    });
    exam.result.autoSubmitted = !!auto;
    exam.phase = 'results';

    refreshSidebarStats();
    renderExamResults();
    window.scrollTo(0, 0);
  }

  function renderExamResults() {
    const r = exam.result;
    const passed = r.percent >= PASS_PCT;

    const wrong = r.wrongIds.map((id, i) => {
      const q = DataLoader.getQuestion(id);
      if (!q) return '';
      const chosenIndex = exam.ids.indexOf(id) >= 0 ? exam.answers[exam.ids.indexOf(id)] : null;
      const chosen = chosenIndex === null || chosenIndex === undefined
        ? '<em>not answered</em>'
        : `${letter(chosenIndex)} — ${esc(q.options[chosenIndex])}`;

      return `
        <details class="disclosure"${i === 0 ? ' open' : ''}>
          <summary>
            <span class="summary-title">${esc(q.stem.slice(0, 110))}${q.stem.length > 110 ? '…' : ''}</span>
            ${q.moduleId ? `<span class="chip">${esc(moduleTitle(q.moduleId))}</span>` : ''}
          </summary>
          <div class="disclosure-body">
            <p class="qstem">${esc(q.stem)}</p>
            <div class="whw">
              <div class="whw-block" style="border-left-color:var(--bad)">
                <h4 style="color:var(--bad)">Your answer</h4>
                <p>${chosen}</p>
              </div>
              <div class="whw-block whw-how">
                <h4>Correct answer</h4>
                <p>${letter(q.answer)} — ${esc(q.options[q.answer])}</p>
              </div>
            </div>
            ${q.explanation ? `<div class="explain"><h4>Explanation</h4><p>${esc(q.explanation)}</p></div>` : ''}
            ${q.moduleId ? `<a class="btn btn-sm" href="#study/${encodeURIComponent(q.moduleId)}">Review module</a>` : ''}
          </div>
        </details>`;
    }).join('');

    view.innerHTML = `
      ${pageHead('Exam', 'Exam results', r.autoSubmitted ? 'Time expired — the exam was submitted automatically.' : '')}

      <div class="card result-hero">
        ${ring(r.percent, 'Score')}
        <div>
          <p class="verdict ${passed ? 'is-pass' : 'is-fail'}">${passed ? 'Pass' : 'Below pass mark'}</p>
          <p>${r.score} of ${r.total} correct · pass mark ${PASS_PCT}%</p>
          <p class="lede">Completed ${esc(formatDate(r.date))}${r.durationSec ? ` in ${formatClock(r.durationSec)}` : ''}</p>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-action="exam-retake">Take another exam</button>
            <a class="btn" href="#quiz">Drill weak areas</a>
          </div>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat is-mastered"><div class="stat-value">${r.score}</div><div class="stat-label">Correct</div></div>
        <div class="stat"><div class="stat-value">${r.total - r.score}</div><div class="stat-label">Incorrect</div></div>
        <div class="stat is-learning"><div class="stat-value">${r.percent}%</div><div class="stat-label">Score</div></div>
      </div>

      <section class="section">
        <h3>Review incorrect answers<span class="section-count">${r.wrongIds.length}</span></h3>
        ${r.wrongIds.length ? wrong : '<div class="card fact">Every question was correct — nothing to review.</div>'}
      </section>`;
  }

  function examHistoryTable(history) {
    return `
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Date</th><th>Score</th><th>Result</th><th>Duration</th></tr>
          </thead>
          <tbody>
            ${history.map(h => `
              <tr>
                <td>${esc(formatDate(h.date))}</td>
                <td class="num">${h.score}/${h.total} · ${h.percent}%</td>
                <td><span class="badge ${h.percent >= PASS_PCT ? 'badge-ok' : 'badge-bad'}">${h.percent >= PASS_PCT ? 'Pass' : 'Fail'}</span></td>
                <td class="num">${h.durationSec ? formatClock(h.durationSec) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  /* ====================================================================== */
  /* Delta                                                                  */
  /* ====================================================================== */

  function renderDelta() {
    const areas = DataLoader.getDeltaByArea();

    if (!areas.length) {
      view.innerHTML = dataNotice() + pageHead('9.1 Delta', 'What changed in VCF 9.1', '') + emptyState('No 9.1 delta items have been published yet.');
      return;
    }

    const total = areas.reduce((n, a) => n + a.items.length, 0);

    view.innerHTML = `
      ${dataNotice()}
      ${pageHead('9.1 Delta', 'What changed in VCF 9.1', `${total} changes across ${areas.length} areas, with links back to the modules they affect.`)}
      ${areas.map(group => `
        <section class="section">
          <h3>${esc(group.area)}<span class="section-count">${group.items.length}</span></h3>
          ${group.items.map(item => `
            <div class="delta-item">
              <h4>${esc(item.title)} ${badge91}</h4>
              ${item.description ? `<p>${esc(item.description)}</p>` : ''}
              ${item.detail ? `<p class="delta-detail">${esc(item.detail)}</p>` : ''}
              ${item.modules.length ? `
                <div class="delta-links">
                  ${item.modules.map(id =>
                    `<a href="#study/${encodeURIComponent(id)}">${esc(moduleTitle(id))}</a>`).join('')}
                </div>` : ''}
            </div>`).join('')}
        </section>`).join('')}`;
  }

  /* ====================================================================== */
  /* Progress                                                               */
  /* ====================================================================== */

  function renderProgress() {
    const p = QuizEngine.getProgress();
    const modules = DataLoader.getModules();
    const history = QuizEngine.getExamHistory();

    const moduleBars = modules.length
      ? modules.map(m => {
          const s = p.byModule[m.id] || { total: 0, mastery: 0, mastered: 0, learning: 0, new: 0 };
          return bar(
            `${moduleLabel(m)} — ${s.mastered}/${s.total} mastered`,
            s.mastery,
            s.mastery >= 80 ? 'is-ok' : ''
          );
        }).join('')
      : emptyState('No modules to report on yet.');

    view.innerHTML = `
      ${pageHead('Progress', 'Your readiness', 'Mastery counts a question as half-learned once answered, and fully mastered after three successful reviews spaced 21+ days out.')}

      <div class="card ring-wrap">
        ${ring(p.masteryPct, 'Mastery')}
        <div>
          <h3>${p.answered} of ${p.totalQuestions} questions seen</h3>
          <p class="lede">${p.dueToday
            ? `${p.dueToday} question${p.dueToday === 1 ? '' : 's'} due for review today.`
            : 'Nothing due for review today — good time for a mock exam.'}</p>
          <div class="btn-row">
            <a class="btn btn-primary" href="#quiz">Start quiz</a>
            <a class="btn" href="#exam">Mock exam</a>
          </div>
        </div>
      </div>

      <section class="section">
        <h3>Spaced repetition<span class="section-count">SM-2</span></h3>
        <div class="stat-grid">
          <div class="stat is-due"><div class="stat-value">${p.dueToday}</div><div class="stat-label">Due today</div></div>
          <div class="stat is-mastered"><div class="stat-value">${p.mastered}</div><div class="stat-label">Mastered</div></div>
          <div class="stat is-learning"><div class="stat-value">${p.learning}</div><div class="stat-label">Learning</div></div>
          <div class="stat is-new"><div class="stat-value">${p.new}</div><div class="stat-label">New</div></div>
        </div>
      </section>

      <section class="section">
        <h3>Mastery by module<span class="section-count">${modules.length}</span></h3>
        ${moduleBars}
      </section>

      <section class="section">
        <h3>Exam history<span class="section-count">${history.length}</span></h3>
        ${history.length ? examHistoryTable(history) : emptyState('No mock exams completed yet.')}
      </section>

      <section class="section">
        <h3>Danger zone</h3>
        <div class="card">
          <p>Clears every spaced-repetition record and exam result stored in this browser. Content is unaffected.</p>
          <div class="btn-row">
            <button type="button" class="btn btn-danger" data-action="progress-reset">Reset all progress</button>
          </div>
        </div>
      </section>`;
  }

  /* ====================================================================== */
  /* Router                                                                 */
  /* ====================================================================== */

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [section, ...rest] = raw.split('/');
    return {
      section: section || 'study',
      param: rest.length ? decodeURIComponent(rest.join('/')) : ''
    };
  }

  function route() {
    const { section, param } = parseHash();

    /* Leaving the exam mid-run must not leave a timer ticking. */
    if (section !== 'exam') stopExamTimer();

    setActiveNav(section);
    refreshSidebarStats();

    switch (section) {
      case 'study':
        param ? renderModule(param) : renderStudy();
        break;
      case 'course':
        param ? renderCourse(param) : location.replace('#study');
        break;
      case 'quiz':
        renderQuiz(param);
        break;
      case 'exam':
        if (exam && exam.phase === 'running') exam.timerId = exam.timerId || setInterval(tickExamTimer, 1000);
        renderExam();
        break;
      case 'delta':
        renderDelta();
        break;
      case 'progress':
        renderProgress();
        break;
      default:
        location.replace('#study');
        return;
    }

    view.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);

  /* ====================================================================== */
  /* Interaction wiring                                                     */
  /* ====================================================================== */

  view.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const index = Number(target.dataset.index);

    switch (target.dataset.action) {
      case 'quiz-answer': answerQuiz(index); break;
      case 'quiz-next':   nextQuizQuestion(); break;
      case 'course-prev':
        if (course) { course.index = Math.max(0, course.index - 1); renderCourse(course.moduleId); }
        break;
      case 'course-next':
        if (course) {
          const m = DataLoader.getModule(course.moduleId);
          const max = m && m.course ? m.course.sections.length - 1 : 0;
          course.index = Math.min(max, course.index + 1);
          renderCourse(course.moduleId);
        }
        break;
      case 'exam-start':  startExam(); break;
      case 'exam-answer': answerExam(index); break;
      case 'exam-goto':   gotoExamQuestion(index); break;
      case 'exam-prev':   gotoExamQuestion(exam.index - 1); break;
      case 'exam-next':   gotoExamQuestion(exam.index + 1); break;
      case 'exam-submit': submitExam(false); break;
      case 'exam-retake': exam = null; renderExamIntro(); break;
      case 'progress-reset':
        if (window.confirm('Reset all progress? Spaced-repetition schedules and exam history will be permanently deleted.')) {
          QuizEngine.resetProgress();
          quiz = null;
          exam = null;
          refreshSidebarStats();
          renderProgress();
        }
        break;
      default: break;
    }
  });

  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || event.target.isContentEditable) return;

    const { section } = parseHash();

    if (event.key === 'Escape') {
      if (document.body.classList.contains('nav-open')) { setNav(false); return; }
      if (section === 'study' && parseHash().param) { location.hash = '#study'; return; }
      if (section === 'course' && parseHash().param) {
        location.hash = `#study/${encodeURIComponent(parseHash().param)}`;
        return;
      }
      if (section !== 'study') { location.hash = '#study'; }
      return;
    }

    /* 1-4 answer, Enter advances. */
    if (/^[1-9]$/.test(event.key)) {
      const idx = Number(event.key) - 1;
      if (section === 'quiz' && quiz && quiz.question && !quiz.answered && idx < quiz.question.options.length) {
        event.preventDefault();
        answerQuiz(idx);
      } else if (section === 'exam' && exam && exam.phase === 'running') {
        const q = DataLoader.getQuestion(exam.ids[exam.index]);
        if (q && idx < q.options.length) {
          event.preventDefault();
          answerExam(idx);
        }
      }
      return;
    }

    if (event.key === 'Enter') {
      if (section === 'quiz' && quiz && quiz.answered) {
        event.preventDefault();
        nextQuizQuestion();
      } else if (section === 'course' && course) {
        event.preventDefault();
        const m = DataLoader.getModule(course.moduleId);
        const max = m && m.course ? m.course.sections.length - 1 : 0;
        if (course.index < max) {
          course.index += 1;
          renderCourse(course.moduleId);
        } else if (m) {
          location.hash = `#quiz/${encodeURIComponent(m.id)}`;
        }
      } else if (section === 'exam' && exam && exam.phase === 'running' && exam.index < exam.ids.length - 1) {
        event.preventDefault();
        gotoExamQuestion(exam.index + 1);
      }
    }
  });

  /* Pause is not supported mid-exam, but the clock must stay honest if the
     tab was suspended (iPad backgrounding). */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && exam && exam.phase === 'running') tickExamTimer();
  });

  /* ====================================================================== */
  /* Boot                                                                   */
  /* ====================================================================== */

  initTheme();

  DataLoader.load()
    .then(() => {
      if (!location.hash) location.replace('#study');
      route();
    })
    .catch(err => {
      console.error(err);
      view.innerHTML = `
        <div class="notice">
          <h3>Failed to start</h3>
          <p>${esc(err.message || String(err))}</p>
        </div>`;
    });
})();
