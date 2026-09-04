/* ==========================================================================
   app.js — hash router, view rendering and interaction wiring.

   Routes: #home  #study  #study/<modId>  #course/<modId>  #quiz  #exam  #delta  #progress
   ========================================================================== */

(function () {
  'use strict';

  const THEME_KEY = 'vcf9.theme';
  const FILTER_KEY = 'vcf9.quizFilter';
  const HOWTO_SEEN_KEY = 'vcf9.howtoSeen';
  const FONT_KEY = 'vcf9.fontScale';
  const FONT_MIN = 0.85;
  const FONT_MAX = 1.4;
  const FONT_STEP = 0.1;

  const EXAM_QUESTIONS = 40;
  const EXAM_MINUTES = 60;
  const PASS_PCT = 85;

  const view = document.getElementById('view');
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const navToggle = document.getElementById('navToggle');
  const themeToggle = document.getElementById('themeToggle');
  const fontDecrease = document.getElementById('fontDecrease');
  const fontIncrease = document.getElementById('fontIncrease');
  const fontScaleLabel = document.getElementById('fontScaleLabel');
  const listenToggle = document.getElementById('listenToggle');

  let quiz = null;   // { filter, question, answered, chosen, correct, asked }
  let exam = null;   // { phase, ids, answers, index, endsAt, timerId, startedAt, result }
  let course = null; // { moduleId, index, cleared, figCleared, spiralCleared, check, figCheck, spiralCheck }
  let aiChat = [];   // { role, text, meta }
  let aiBusy = false;

  function isHowToSeen() {
    try { return localStorage.getItem(HOWTO_SEEN_KEY) === '1'; } catch (err) { return false; }
  }

  function markHowToSeen() {
    try { localStorage.setItem(HOWTO_SEEN_KEY, '1'); } catch (err) { /* storage disabled */ }
  }

  function continueFromHowTo() {
    markHowToSeen();
    location.hash = '#study';
  }

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

  /* VMware Architect item helpers — single-best or exact-set multi-select. */
  function isMultiItem(q) {
    return !!(q && (q.multiSelect || (Array.isArray(q.answers) && q.answers.length > 1)));
  }

  function correctAnswers(q) {
    if (!q) return [];
    if (Array.isArray(q.answers) && q.answers.length) {
      return [...new Set(q.answers.map(Number))].sort((a, b) => a - b);
    }
    return Number.isInteger(q.answer) ? [q.answer] : [];
  }

  function sameAnswerSet(chosen, expected) {
    const a = Array.isArray(chosen) ? chosen.map(Number).filter(Number.isInteger) : [];
    const b = Array.isArray(expected) ? expected.map(Number).filter(Number.isInteger) : [];
    if (a.length !== b.length) return false;
    const as = [...a].sort((x, y) => x - y);
    const bs = [...b].sort((x, y) => x - y);
    return as.every((v, i) => v === bs[i]);
  }

  function lettersOf(indexes) {
    return (indexes || []).map(letter).join(', ');
  }

  function multiHint(q) {
    if (!isMultiItem(q)) return '';
    const n = q.selectCount || correctAnswers(q).length;
    return n > 1
      ? `Select ${n} that apply (exact set — no partial credit).`
      : 'Select all that apply (exact set — no partial credit).';
  }

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
  /* Font scale + Listen (AI TTS when OpenAI BYOK, else browser speech)      */
  /* ====================================================================== */

  function clampFont(n) {
    const x = Math.round((Number(n) || 1) * 100) / 100;
    return Math.min(FONT_MAX, Math.max(FONT_MIN, x));
  }

  function applyFontScale(scale) {
    const next = clampFont(scale);
    document.documentElement.style.setProperty('--text-scale', String(next));
    if (fontScaleLabel) fontScaleLabel.textContent = `${Math.round(next * 100)}%`;
    if (fontDecrease) fontDecrease.disabled = next <= FONT_MIN + 0.001;
    if (fontIncrease) fontIncrease.disabled = next >= FONT_MAX - 0.001;
    return next;
  }

  function initFontScale() {
    let stored = null;
    try { stored = localStorage.getItem(FONT_KEY); } catch (err) { /* storage disabled */ }
    applyFontScale(stored ? Number(stored) : 1);
  }

  function bumpFont(delta) {
    const cur = Number(getComputedStyle(document.documentElement).getPropertyValue('--text-scale')) || 1;
    const next = applyFontScale(cur + delta);
    try { localStorage.setItem(FONT_KEY, String(next)); } catch (err) { /* storage disabled */ }
  }

  if (fontDecrease) fontDecrease.addEventListener('click', () => bumpFont(-FONT_STEP));
  if (fontIncrease) fontIncrease.addEventListener('click', () => bumpFont(FONT_STEP));

  function setListenUi(playing) {
    if (!listenToggle) return;
    listenToggle.classList.toggle('is-playing', !!playing);
    listenToggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
    listenToggle.setAttribute('aria-label', playing ? 'Stop listening' : 'Listen to this page');
    listenToggle.title = playing ? 'Stop' : 'Listen to this page';
    listenToggle.textContent = playing ? '■' : '▶';
  }

  function stopPageAudio() {
    audioPlaylist = null;
    if (window.AITrainer) AITrainer.stopSpeech();
    setListenUi(false);
    document.querySelectorAll('[data-action="section-listen"]').forEach(btn => {
      btn.textContent = 'Listen to section';
      btn.setAttribute('aria-pressed', 'false');
    });
    document.querySelectorAll('[data-action="module-listen"]').forEach(btn => {
      btn.textContent = 'Play module';
      btn.setAttribute('aria-pressed', 'false');
    });
  }

  function pageListenText() {
    const root = view.cloneNode(true);
    root.querySelectorAll('button, .options, .kc-block, .course-nav, .navigator, .exam-bar, script, style, .section-audio-bar').forEach(el => el.remove());
    return (root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function sectionListenText(section, moduleTitleText) {
    if (!section) return '';
    const bits = [
      moduleTitleText || '',
      section.title || '',
      section.body || '',
      section.rainpoleEvidence ? `Rainpole evidence: ${section.rainpoleEvidence}` : '',
      section.gapNote ? `Not stated: ${section.gapNote}` : '',
      section.note91 ? `9.1 informational: ${section.note91}` : ''
    ];
    return bits.filter(Boolean).join('. ').replace(/\s+/g, ' ').trim();
  }

  async function startListen(text, meta) {
    if (!window.AITrainer) {
      window.alert('Audio is unavailable in this build.');
      return;
    }
    const payload = String(text || '').trim();
    if (!payload) {
      window.alert('Nothing to read on this page yet.');
      return;
    }
    const wasPlaylist = audioPlaylist;
    if (!wasPlaylist) stopPageAudio();
    else if (window.AITrainer) AITrainer.stopSpeech({ silent: true });
    setListenUi(true);
    try {
      const useLesson = !!(meta && AITrainer.speakLesson);
      if (useLesson) {
        await AITrainer.speakLesson(payload, meta, {
          onEnd: () => {
            if (audioPlaylist && audioPlaylist.moduleId === (meta && meta.moduleId)) {
              advanceAudioPlaylist();
            } else {
              setListenUi(false);
            }
          }
        });
      } else {
        await AITrainer.speakText(payload, {
          onEnd: () => {
            if (audioPlaylist) advanceAudioPlaylist();
            else setListenUi(false);
          }
        });
      }
    } catch (err) {
      setListenUi(false);
      audioPlaylist = null;
      if (!(err && (err.name === 'AbortError' || /abort/i.test(err.message || '')))) {
        window.alert(err.message || 'Could not start audio.');
      }
    }
  }

  let audioPlaylist = null; // { moduleId, index }

  async function advanceAudioPlaylist() {
    if (!audioPlaylist || !course) {
      setListenUi(false);
      return;
    }
    const m = DataLoader.getModule(audioPlaylist.moduleId);
    if (!m || !m.course || !m.course.sections.length) {
      audioPlaylist = null;
      setListenUi(false);
      return;
    }
    const next = audioPlaylist.index + 1;
    if (next >= m.course.sections.length) {
      audioPlaylist = null;
      setListenUi(false);
      return;
    }
    audioPlaylist.index = next;
    course.index = next;
    course.check = null;
    course.figCheck = null;
    course.spiralCheck = null;
    renderCourse(m.id);
    const section = m.course.sections[next];
    const text = sectionListenText(section, m.title);
    await startListen(text, {
      id: section.id,
      title: section.title,
      moduleTitle: m.title,
      moduleId: m.id
    });
  }

  async function playModuleAudio() {
    if (!course) return;
    if (audioPlaylist && window.AITrainer && AITrainer.isSpeaking()) {
      stopPageAudio();
      return;
    }
    const m = DataLoader.getModule(course.moduleId);
    if (!m || !m.course) return;
    audioPlaylist = { moduleId: m.id, index: course.index };
    const section = m.course.sections[course.index];
    const text = sectionListenText(section, m.title);
    await startListen(text, {
      id: section.id,
      title: section.title,
      moduleTitle: m.title,
      moduleId: m.id
    });
  }

  async function togglePageListen() {
    if (window.AITrainer && AITrainer.isSpeaking && AITrainer.isSpeaking()) {
      stopPageAudio();
      return;
    }
    const { section, param } = parseHash();
    if (section === 'course' && param) {
      const m = DataLoader.getModule(param);
      const s = m && m.course && m.course.sections[course && course.moduleId === param ? course.index : 0];
      if (s) {
        await startListen(sectionListenText(s, m.title), {
          id: s.id,
          title: s.title,
          moduleTitle: m.title,
          moduleId: m.id
        });
        return;
      }
    }
    await startListen(pageListenText(), { id: `page:${section || 'home'}`, title: section || 'Page' });
  }

  if (listenToggle) listenToggle.addEventListener('click', () => { togglePageListen(); });

  function audioEngineHint() {
    if (window.AITrainer && AITrainer.audioStatus) return AITrainer.audioStatus();
    return 'Add DeepSeek (script/coach) and OpenAI (Southern/Texas TTS) under AI Trainer.';
  }

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
    const active = section === 'course' ? 'study' : (section || 'home');
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
    const aiStat = document.getElementById('sidebarAiStat');
    const aiVal = document.getElementById('sidebarAi');
    if (aiStat && aiVal && window.AITrainer) {
      const cfg = AITrainer.loadConfig();
      const ready = AITrainer.isReady(cfg);
      aiStat.hidden = false;
      aiVal.textContent = cfg.enabled && ready ? 'On' : (cfg.enabled ? 'Keys?' : 'Off');
    }
  }

  /* ====================================================================== */
  /* HowTo                                                                  */
  /* ====================================================================== */

  function renderHowTo() {
    const seen = isHowToSeen();
    view.innerHTML = `
      ${pageHead('HowTo', 'Rainpole lab + how this trainer works', 'Read this once (or skip if you already have). You are solving the Rainpole Financial Services architect lab with Broadcom-aligned method — not memorizing letter answers.')}

      <section class="section howto-section howto-lab">
        <h3>The lab you must solve: Rainpole (RFS)</h3>
        <p>Modules are chapters of <strong>one customer design</strong>. Current-state drawings show <em>where they are</em>. Business initiatives and design decisions show <em>what they want to achieve</em>. Your job is to classify evidence (RCAR), separate FR from measurable NFR, and defend every decision with traceability + AMPRS.</p>
        <p class="hint">Rainpole detail in the kit is thin in places. Work with what is stated. If a BR/NFR is missing, label it as an assumption to validate — do not invent customer facts. Optional BYOK AI coach is your ask channel when stuck; it must obey the same rule.</p>
      </section>

      <section class="section howto-section">
        <h3>Requirements spine (exam skill)</h3>
        <ol class="howto-list">
          <li><strong>Business intent</strong> — initiatives / outcomes Rainpole wants.</li>
          <li><strong>Functional requirements</strong> — what the platform must do.</li>
          <li><strong>Non-functional requirements</strong> — how well (number, %, time, RTO/RPO).</li>
          <li><strong>RCAR</strong> — Requirements, Constraints (where they are), Assumptions, Risks.</li>
          <li><strong>Design decision</strong> — recommendation, rejected alternative, AMPRS, cite IDs.</li>
        </ol>
        <p class="hint">Quiz and Exam measure this skill on the course baseline. The live Broadcom exam may use a different scenario — Rainpole is practice for the method.</p>
      </section>

      <section class="section howto-section">
        <h3>Teaching methods in use</h3>
        <ul class="howto-list">
          <li><strong>Advance organizer</strong> — Study clip first, then full Course.</li>
          <li><strong>What / How / Why</strong> — Broadcom-aligned component meaning, not letter memorization.</li>
          <li><strong>Every section tested</strong> — if you cannot say what a term is or what it does, that section is not done. Next stays locked until the check passes.</li>
          <li><strong>Spiral recall</strong> — later modules resurface earlier terms (e.g. vMotion) where the topic fits, so learning stacks instead of evaporating.</li>
          <li><strong>Drawing literacy</strong> — every labeled object taught, then checked.</li>
          <li><strong>Blocking knowledge checks</strong> — wrong → reinforce → retry; Next locked until correct.</li>
          <li><strong>Rainpole evidence callouts</strong> — long Course sections highlight key lab facts you must use.</li>
          <li><strong>9.1 Delta is informational</strong> — awareness only; you are not dinged for a valid 9.0/course-baseline answer solely because 9.1 later changed something.</li>
          <li><strong>Text size</strong> — A− / A+ in the top bar (saved on this device).</li>
          <li><strong>Listen / AI audio</strong> — DeepSeek writes a short teacher script; OpenAI speaks it in a clear <strong>Southern / Texas</strong> instructor voice. Course has Listen to section and Play module. Without keys, the device voice is used.</li>
        </ul>
      </section>

      <section class="section howto-section">
        <h3>VMware / Broadcom exam item formats — locked</h3>
        <p>This trainer follows <strong>VMware Architect question methods only</strong>. Trivia letter drills are out of scope.</p>
        <ul class="howto-list">
          <li><strong>Single-best-answer MCQ</strong> — one correct choice among plausible distractors (Course checks + Quiz/Exam).</li>
          <li><strong>Multiple selection</strong> — “select two / all that apply”; every correct option must be chosen and no extras (exact set).</li>
          <li><strong>Scenario / design-decision stems</strong> — requirements + constraints; pick the best design move. This is the beloved Architect format and the default we write toward.</li>
          <li><strong>Exhibit / diagram literacy</strong> — read a topology or workbook figure, then decide. Drawing checks train that habit.</li>
        </ul>
        <p class="hint">VCAP-level build-list / matching / drag-drop may appear on advanced exams; we prioritize scenario MCQ + multi-select because that is what VCP Architect scoring and ILT remediation both reward.</p>
      </section>

      <section class="section howto-section">
        <h3>Path</h3>
        <ol class="howto-list">
          <li><a href="#home">Home</a> — brand entry.</li>
          <li><strong>HowTo</strong> — this page (skip once seen).</li>
          <li><a href="#study">Study</a> — module tiles = map; open each module’s Course and read the long sections.</li>
          <li><a href="#quiz">Quiz</a> / <a href="#exam">Exam</a> — retrieval and gate.</li>
          <li><a href="#delta">9.1 Delta</a> — informational updates.</li>
          <li><a href="#ai">AI Trainer</a> — optional bring-your-own API key coach.</li>
        </ol>
      </section>

      <section class="section howto-section howto-ai">
        <h3>Optional AI trainer (bring your own API keys)</h3>
        <p><strong>DeepSeek</strong> = coach + spoken lesson scripts. <strong>OpenAI</strong> = Southern/Texas TTS voice only. No keys required for Study/Course/Quiz/Exam.</p>
        <div class="cta-row">
          <a class="btn" href="#ai">Configure AI Trainer</a>
        </div>
      </section>

      <div class="cta-row howto-cta">
        <button type="button" class="btn btn-primary" data-action="howto-continue">${seen ? 'Continue to course' : 'Got it — enter the course'}</button>
        ${seen ? '' : '<button type="button" class="btn" data-action="howto-skip">Skip HowTo</button>'}
      </div>`;
  }

  /* ====================================================================== */
  /* Landing                                                                */
  /* ====================================================================== */

  function renderHome() {
    document.body.classList.add('is-landing');
    const seen = isHowToSeen();
    const primaryHref = seen ? '#study' : '#howto';
    const primaryLabel = seen ? 'Enter the course' : 'Start with HowTo';
    view.innerHTML = `
      <section class="landing" aria-label="VCF-9 AI Trainer">
        <div class="landing-hero">
          <img
            class="landing-art"
            src="assets/landing-hero-cloud-automation.jpg"
            alt="Cloud automation fabric — private cloud control plane and orchestrated infrastructure"
            width="1600"
            height="1066"
            decoding="async"
            fetchpriority="high">
          <div class="landing-veil" aria-hidden="true"></div>
          <div class="landing-copy">
            <p class="landing-brand">VCF-9 AI Trainer</p>
            <h2 class="landing-title">Design with evidence.<br>Prove it as you go.</h2>
            <p class="landing-lede">Self-paced Rainpole architect lab: study the drawings, read each Course section, pass blocking checks, and keep every decision tied to conceptual evidence. Optional AI Trainer is bring-your-own API key — the course works fully without one.</p>
            <div class="landing-actions">
              <a class="btn btn-primary btn-lg" href="${primaryHref}">${primaryLabel}</a>
              ${seen ? '<a class="btn btn-lg" href="#howto">Revisit HowTo</a>' : ''}
            </div>
          </div>
        </div>
      </section>`;
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
          <span class="module-no">Module ${esc(m.number)}${m.delta91 ? ' · 9.1 notes' : ''}</span>
          <h3>${esc(m.title)}</h3>
          ${m.rainpoleJob ? `<p class="module-rainpole"><span class="fig-label">Rainpole job</span> ${esc(m.rainpoleJob)}</p>` : ''}
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
      ${pageHead('Study', 'Rainpole modules', 'Tiles are the map. Open each module, then read the Course long sections — those call out the Rainpole evidence you must use. 9.1 Delta is informational only.')}
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

      ${m.rainpoleJob ? `
        <aside class="rainpole-callout" role="note">
          <h4>Rainpole job this module</h4>
          <p>${esc(m.rainpoleJob)}</p>
        </aside>` : ''}

      ${m.requirementsSpine ? `
        <aside class="rainpole-callout is-spine" role="note">
          <h4>Requirements spine</h4>
          <p>${esc(m.requirementsSpine)}</p>
        </aside>` : ''}

      <div class="learn-path" role="note">
        <strong>How this works:</strong>
        This Study clip is the primer — what to hang onto.
        Then open <em>Course</em> and read each long section. Mid-section checks block Next until correct. Key Rainpole details are called out in Course — do not skip them.
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
      course = { moduleId: modId, index: 0, cleared: {}, figCleared: {}, spiralCleared: {}, check: null, figCheck: null, spiralCheck: null };
    }
    if (!course.cleared) course.cleared = {};
    if (!course.figCleared) course.figCleared = {};
    if (!course.spiralCleared) course.spiralCleared = {};
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

    const figure = section.figureId ? DataLoader.getFigure(section.figureId) : null;
    const figureHtml = figure ? renderFigureBlock(section, figure) : '';
    const evidenceHtml = renderRainpoleCallouts(section);
    const checkBlockHtml = figure ? renderFigureChecks(section, figure) : renderTextKnowledgeCheck(section);
    const spiralHtml = primaryCheckCleared(section) ? renderSpiralRecall(modId, section) : '';

    const blocked = !sectionCheckCleared(section);
    const isLast = idx === sections.length - 1;
    const nextDisabled = blocked ? 'disabled' : '';

    view.innerHTML = `
      <a class="backlink" href="#study/${encodeURIComponent(m.id)}">← Study clip</a>
      ${pageHead(`Module ${m.number != null ? m.number : m.id} · Course`, m.title, `Section ${idx + 1} of ${sections.length}`)}

      <div class="course-progress" aria-hidden="true">
        <div class="course-progress-bar" style="width:${Math.round(((idx + 1) / sections.length) * 100)}%"></div>
      </div>

      <div class="section-audio-bar">
        <button type="button" class="btn btn-sm" data-action="section-listen" aria-pressed="false">Listen to section</button>
        <button type="button" class="btn btn-sm" data-action="module-listen" aria-pressed="false">Play module</button>
        <button type="button" class="btn btn-sm" data-action="audio-stop">Stop</button>
        <p class="hint">${esc(audioEngineHint())}</p>
      </div>

      <article class="course-stage">
        <h3 class="course-section-title">${esc(section.title)}</h3>
        ${callbackBlock}
        <div class="course-body">${paras}</div>
        ${evidenceHtml}
        ${figureHtml}
        ${checkBlockHtml}
        ${spiralHtml}
      </article>

      <div class="course-nav">
        <button type="button" class="btn" data-action="course-prev" ${idx === 0 ? 'disabled' : ''}>Previous</button>
        <span class="course-pos">${idx + 1} / ${sections.length}</span>
        ${isLast
          ? (blocked
              ? `<button type="button" class="btn btn-primary" disabled>Pass check to finish</button>`
              : `<a class="btn btn-primary" href="#quiz/${encodeURIComponent(m.id)}">Done — Quiz</a>`)
          : `<button type="button" class="btn btn-primary" data-action="course-next" ${nextDisabled}>Next section</button>`}
      </div>
      <p class="hint course-hint">Every section tests what/how. Later modules add spiral recall of earlier terms. Wrong → reinforce → retry; Next stays locked until correct.</p>`;
  }

  function renderRainpoleCallouts(section) {
    const bits = [];
    if (section.rainpoleEvidence) {
      bits.push(`
        <aside class="rainpole-callout" role="note">
          <h4>Rainpole evidence — use this</h4>
          <p>${esc(section.rainpoleEvidence)}</p>
        </aside>`);
    }
    if (section.gapNote) {
      bits.push(`
        <aside class="rainpole-callout is-gap" role="note">
          <h4>Not stated in course materials</h4>
          <p>${esc(section.gapNote)}</p>
        </aside>`);
    }
    if (section.informational91 || section.note91) {
      bits.push(`
        <aside class="rainpole-callout is-91" role="note">
          <h4>9.1 update — informational</h4>
          <p>${esc(section.note91 || 'Awareness only. Rainpole lab and Course checks use the course baseline. A valid 9.0-era answer is not wrong solely because 9.1 later changed something.')}</p>
        </aside>`);
    }
    return bits.join('');
  }

  function renderFigureBlock(section, figure) {
    const objects = (figure.objects || []).map(o => `
      <article class="fig-object" id="obj-${esc(o.id)}">
        <h4>${esc(o.name)}</h4>
        <p><span class="fig-label">What</span> ${esc(o.what)}</p>
        <p><span class="fig-label">Why</span> ${esc(o.why)}</p>
      </article>`).join('');

    return `
      <section class="fig-block" aria-label="Course drawing">
        <div class="fig-head">
          <span class="kc-badge">Course drawing</span>
          <span class="kc-note">${esc(figure.subtitle || 'Study every labeled object')}</span>
        </div>
        <figure class="fig-frame">
          <img src="${esc(figure.image)}" alt="${esc(figure.title)}" loading="eager" decoding="async">
          <figcaption>${esc(figure.title)}${figure.sourceSlide ? ` · workshop slide ${figure.sourceSlide}` : ''}</figcaption>
        </figure>
        ${figure.primer ? `<p class="fig-primer">${esc(figure.primer)}</p>` : ''}
        <h4 class="fig-objects-title">Objects in this drawing <span class="section-count">${figure.objects.length}</span></h4>
        <div class="fig-objects">${objects}</div>
      </section>`;
  }

  function figProgress(section, figure) {
    const clearedMap = (course.figCleared && course.figCleared[section.id]) || {};
    const checks = figure.checks || [];
    const done = checks.filter(c => clearedMap[c.id]).length;
    return { checks, clearedMap, done, total: checks.length, allDone: checks.length > 0 && done === checks.length };
  }

  function activeFigureCheck(section, figure) {
    const { checks, clearedMap } = figProgress(section, figure);
    return checks.find(c => !clearedMap[c.id]) || null;
  }

  function renderFigureChecks(section, figure) {
    const prog = figProgress(section, figure);
    if (!prog.total) return '';

    if (prog.allDone) {
      return `
        <section class="kc-block" aria-label="Drawing knowledge checks">
          <div class="kc-head">
            <span class="kc-badge">Drawing checks</span>
            <span class="kc-note">All ${prog.total} passed — you may continue</span>
          </div>
          <div class="kc-feedback is-ok">
            <h4>Drawing literacy locked in</h4>
            <p>You answered every check for this figure correctly. Revisit the object cards anytime if a later question cites this drawing.</p>
          </div>
        </section>`;
    }

    const kc = activeFigureCheck(section, figure);
    const checkState = (course.figCheck && course.figCheck.sectionId === section.id && course.figCheck.checkId === kc.id)
      ? course.figCheck : null;

    const opts = kc.options.map((opt, i) => {
      let klass = 'option kc-option';
      let mark = '';
      if (checkState && checkState.chosen === i) {
        if (i === kc.answer) { klass += ' is-correct'; mark = '✓'; }
        else { klass += ' is-wrong'; mark = '✕'; }
      }
      return `
        <button type="button" class="${klass}" data-action="fig-check" data-index="${i}"
          ${checkState ? 'disabled' : ''}>
          <span class="option-key">${letter(i)}</span>
          <span class="option-text">${esc(opt)}</span>
          ${mark ? `<span class="option-mark">${mark}</span>` : ''}
        </button>`;
    }).join('');

    let feedback = '';
    if (checkState && checkState.chosen === kc.answer) {
      feedback = `
        <div class="kc-feedback is-ok">
          <h4>Correct — object understanding confirmed</h4>
          <p>${esc(kc.explanation || 'Continue to the next drawing check.')}</p>
        </div>`;
    } else if (checkState && checkState.chosen >= 0 && checkState.chosen !== kc.answer) {
      feedback = `
        <div class="kc-feedback is-bad">
          <h4>Not yet — re-read the drawing, then retry</h4>
          <p class="kc-reinforce">${esc(kc.reinforce || 'Use the object cards above. Local fact sheet grades this check — not the AI coach.')}</p>
          <button type="button" class="btn btn-sm btn-primary" data-action="fig-check-retry">Try again</button>
        </div>`;
    }

    const related = (kc.objectIds || [])
      .map(id => (figure.objects || []).find(o => o.id === id))
      .filter(Boolean);

    return `
      <section class="kc-block" aria-label="Drawing knowledge check">
        <div class="kc-head">
          <span class="kc-badge">Drawing check ${prog.done + 1} of ${prog.total}</span>
          <span class="kc-note">Must answer correctly before Next</span>
        </div>
        <p class="kc-stem">${esc(kc.stem)}</p>
        ${related.length ? `<p class="hint">Look at: ${related.map(o => esc(o.name)).join(' · ')}</p>` : ''}
        <div class="options kc-options">${opts}</div>
        ${feedback}
      </section>`;
  }

  function renderTextKnowledgeCheck(section) {
    const kc = section.knowledgeCheck;
    if (!kc) return '';
    const cleared = !!course.cleared[section.id];
    const checkState = (course.check && course.check.sectionId === section.id) ? course.check : null;
    const multi = isMultiItem(kc);
    const expected = correctAnswers(kc);
    const chosenSet = checkState
      ? (Array.isArray(checkState.chosen) ? checkState.chosen : [checkState.chosen])
      : (Array.isArray(course.pendingMulti) && course.pendingSectionId === section.id ? course.pendingMulti : []);

    const opts = kc.options.map((opt, i) => {
      let klass = 'option kc-option';
      let mark = '';
      if (cleared || (checkState && sameAnswerSet(chosenSet, expected))) {
        if (expected.includes(i)) { klass += ' is-correct'; mark = '✓'; }
        else if (chosenSet.includes(i)) { klass += ' is-wrong'; mark = '✕'; }
      } else if (checkState && !sameAnswerSet(chosenSet, expected)) {
        if (chosenSet.includes(i) && !expected.includes(i)) { klass += ' is-wrong'; mark = '✕'; }
        else if (expected.includes(i) && chosenSet.includes(i)) { klass += ' is-wrong'; } /* showed wrong set */
        else if (chosenSet.includes(i)) { klass += ' is-selected'; }
      } else if (!cleared && !checkState && chosenSet.includes(i)) {
        klass += ' is-selected';
      }
      const action = multi ? 'course-toggle' : 'course-check';
      const disabled = cleared || checkState ? 'disabled' : '';
      return `
        <button type="button" class="${klass}" data-action="${action}" data-index="${i}" ${disabled}>
          <span class="option-key">${letter(i)}</span>
          <span class="option-text">${esc(opt)}</span>
          ${mark ? `<span class="option-mark">${mark}</span>` : ''}
        </button>`;
    }).join('');

    let feedback = '';
    if (cleared || (checkState && sameAnswerSet(chosenSet, expected))) {
      feedback = `
        <div class="kc-feedback is-ok">
          <h4>Correct — concept locked in</h4>
          <p>${esc(kc.explanation || 'You can move on.')}</p>
        </div>`;
    } else if (checkState && !sameAnswerSet(chosenSet, expected)) {
      feedback = `
        <div class="kc-feedback is-bad">
          <h4>Not yet — reinforce, then retry</h4>
          <p class="kc-reinforce">${esc(kc.reinforce || 'Re-read this section and the Study clip callout above, then try again.')}</p>
          <button type="button" class="btn btn-sm btn-primary" data-action="course-check-retry">Try again</button>
        </div>`;
    }

    const submitRow = (!cleared && !checkState && multi)
      ? `<div class="qfoot"><button type="button" class="btn btn-sm btn-primary" data-action="course-submit-multi" ${chosenSet.length ? '' : 'disabled'}>Check answer</button></div>`
      : '';

    return `
      <section class="kc-block" aria-label="Knowledge check">
        <div class="kc-head">
          <span class="kc-badge">${multi ? 'Knowledge check · multi-select' : 'Knowledge check'}</span>
          <span class="kc-note">${cleared ? 'Passed — you may continue' : 'Must answer correctly before Next'}</span>
        </div>
        <p class="kc-stem">${esc(kc.stem)}</p>
        ${multi ? `<p class="hint q-multi-hint">${esc(multiHint(kc))}</p>` : ''}
        <div class="options kc-options">${opts}</div>
        ${submitRow}
        ${feedback}
      </section>`;
  }

  function primaryCheckCleared(section) {
    if (!course || !section) return true;
    if (section.figureId) {
      const figure = DataLoader.getFigure(section.figureId);
      if (figure && figure.checks && figure.checks.length) {
        return figProgress(section, figure).allDone;
      }
    }
    if (!section.knowledgeCheck) return true;
    return !!course.cleared[section.id];
  }

  function sectionCheckCleared(section) {
    if (!primaryCheckCleared(section)) return false;
    const spiral = DataLoader.pickSpiralRecall(course.moduleId, section);
    if (!spiral) return true;
    return !!course.spiralCleared[section.id];
  }

  function canAdvanceCourse() {
    if (!course) return false;
    const m = DataLoader.getModule(course.moduleId);
    if (!m || !m.course) return false;
    return sectionCheckCleared(m.course.sections[course.index]);
  }

  function rememberIntroducedTerms(section) {
    const kc = section && section.knowledgeCheck;
    if (!kc || !kc.terms || !kc.terms.length) return;
    try {
      const raw = localStorage.getItem('vcf9.introducedTerms');
      const map = raw ? JSON.parse(raw) : {};
      const bucket = map[course.moduleId] || [];
      kc.terms.forEach(t => {
        if (t && !bucket.includes(t)) bucket.push(t);
      });
      map[course.moduleId] = bucket;
      localStorage.setItem('vcf9.introducedTerms', JSON.stringify(map));
    } catch (err) { /* ignore */ }
  }

  function renderSpiralRecall(modId, section) {
    const spiral = DataLoader.pickSpiralRecall(modId, section);
    if (!spiral) return '';
    const cleared = !!course.spiralCleared[section.id];
    const checkState = (course.spiralCheck && course.spiralCheck.sectionId === section.id)
      ? course.spiralCheck : null;
    const termLabel = (spiral.terms && spiral.terms[0]) || 'earlier term';

    const opts = spiral.options.map((opt, i) => {
      let klass = 'option kc-option';
      let mark = '';
      if (checkState && checkState.chosen === i) {
        if (i === spiral.answer) { klass += ' is-correct'; mark = '✓'; }
        else { klass += ' is-wrong'; mark = '✕'; }
      } else if (cleared && i === spiral.answer) {
        klass += ' is-correct'; mark = '✓';
      }
      return `
        <button type="button" class="${klass}" data-action="course-spiral" data-index="${i}"
          ${cleared || checkState ? 'disabled' : ''}>
          <span class="option-key">${letter(i)}</span>
          <span class="option-text">${esc(opt)}</span>
          ${mark ? `<span class="option-mark">${mark}</span>` : ''}
        </button>`;
    }).join('');

    let feedback = '';
    if (cleared || (checkState && checkState.chosen === spiral.answer)) {
      feedback = `
        <div class="kc-feedback is-ok">
          <h4>Spiral locked — earlier learning still holds</h4>
          <p>${esc(spiral.explanation || 'You can move on.')}</p>
        </div>`;
    } else if (checkState && checkState.chosen >= 0 && checkState.chosen !== spiral.answer) {
      feedback = `
        <div class="kc-feedback is-bad">
          <h4>Not yet — this term was taught earlier</h4>
          <p class="kc-reinforce">${esc(spiral.reinforce || 'Revisit the earlier Course section, then retry.')}</p>
          <button type="button" class="btn btn-sm btn-primary" data-action="course-spiral-retry">Try again</button>
        </div>`;
    }

    return `
      <section class="kc-block kc-spiral" aria-label="Spiral recall">
        <div class="kc-head">
          <span class="kc-badge">Spiral recall · ${esc(termLabel)}</span>
          <span class="kc-note">${cleared ? 'Passed' : 'Earlier term — must answer before Next'}</span>
        </div>
        <p class="kc-stem">${esc(spiral.stem)}</p>
        <div class="options kc-options">${opts}</div>
        ${feedback}
      </section>`;
  }

  function answerCourseCheck(index) {
    if (!course) return;
    const m = DataLoader.getModule(course.moduleId);
    if (!m) return;
    const section = m.course.sections[course.index];
    const kc = section && section.knowledgeCheck;
    if (!kc || course.cleared[section.id]) return;
    if (course.check && course.check.sectionId === section.id) return;
    if (isMultiItem(kc)) {
      toggleCourseOption(index);
      return;
    }

    course.check = { sectionId: section.id, chosen: index };
    if (index === kc.answer) {
      course.cleared[section.id] = true;
      rememberIntroducedTerms(section);
    }
    renderCourse(course.moduleId);
  }

  function toggleCourseOption(index) {
    if (!course) return;
    const m = DataLoader.getModule(course.moduleId);
    if (!m) return;
    const section = m.course.sections[course.index];
    const kc = section && section.knowledgeCheck;
    if (!kc || !isMultiItem(kc) || course.cleared[section.id]) return;
    if (course.check && course.check.sectionId === section.id) return;
    if (course.pendingSectionId !== section.id) {
      course.pendingSectionId = section.id;
      course.pendingMulti = [];
    }
    const set = new Set(course.pendingMulti || []);
    if (set.has(index)) set.delete(index);
    else set.add(index);
    course.pendingMulti = [...set].sort((a, b) => a - b);
    renderCourse(course.moduleId);
  }

  function submitCourseMulti() {
    if (!course) return;
    const m = DataLoader.getModule(course.moduleId);
    if (!m) return;
    const section = m.course.sections[course.index];
    const kc = section && section.knowledgeCheck;
    if (!kc || !isMultiItem(kc) || course.cleared[section.id]) return;
    if (course.check && course.check.sectionId === section.id) return;
    const chosen = Array.isArray(course.pendingMulti) ? course.pendingMulti : [];
    if (!chosen.length) return;
    course.check = { sectionId: section.id, chosen };
    if (sameAnswerSet(chosen, correctAnswers(kc))) {
      course.cleared[section.id] = true;
      rememberIntroducedTerms(section);
      course.pendingMulti = [];
      course.pendingSectionId = null;
    }
    renderCourse(course.moduleId);
  }

  function retryCourseCheck() {
    if (!course) return;
    course.check = null;
    course.pendingMulti = [];
    course.pendingSectionId = null;
    renderCourse(course.moduleId);
  }

  function answerSpiralCheck(index) {
    if (!course) return;
    const m = DataLoader.getModule(course.moduleId);
    if (!m) return;
    const section = m.course.sections[course.index];
    if (!primaryCheckCleared(section)) return;
    const spiral = DataLoader.pickSpiralRecall(course.moduleId, section);
    if (!spiral || course.spiralCleared[section.id]) return;
    if (course.spiralCheck && course.spiralCheck.sectionId === section.id) return;

    course.spiralCheck = { sectionId: section.id, chosen: index };
    if (index === spiral.answer) course.spiralCleared[section.id] = true;
    renderCourse(course.moduleId);
  }

  function retrySpiralCheck() {
    if (!course) return;
    course.spiralCheck = null;
    renderCourse(course.moduleId);
  }

  function answerFigureCheck(index) {
    if (!course) return;
    const m = DataLoader.getModule(course.moduleId);
    if (!m) return;
    const section = m.course.sections[course.index];
    const figure = section && section.figureId ? DataLoader.getFigure(section.figureId) : null;
    if (!figure) return;
    const kc = activeFigureCheck(section, figure);
    if (!kc) return;
    if (course.figCheck && course.figCheck.sectionId === section.id && course.figCheck.checkId === kc.id) return;

    course.figCheck = { sectionId: section.id, checkId: kc.id, chosen: index };
    if (index === kc.answer) {
      if (!course.figCleared[section.id]) course.figCleared[section.id] = {};
      course.figCleared[section.id][kc.id] = true;
      course.figCheck = null;
    }
    renderCourse(course.moduleId);
  }

  function retryFigureCheck() {
    if (!course) return;
    course.figCheck = null;
    renderCourse(course.moduleId);
  }

  function advanceCourse() {
    if (!course || !canAdvanceCourse()) return false;
    const m = DataLoader.getModule(course.moduleId);
    if (!m || !m.course) return false;
    const max = m.course.sections.length - 1;
    if (course.index < max) {
      course.index += 1;
      course.check = null;
      course.figCheck = null;
      course.spiralCheck = null;
      stopPageAudio();
      renderCourse(course.moduleId);
      return true;
    }
    location.hash = `#quiz/${encodeURIComponent(m.id)}`;
    return true;
  }

  /* ====================================================================== */
  /* AI Trainer config                                                      */
  /* ====================================================================== */

  function renderAI() {
    if (!window.AITrainer) {
      view.innerHTML = pageHead('AI Trainer', 'Unavailable', '') + emptyState('ai-trainer.js failed to load.');
      return;
    }
    const cfg = AITrainer.loadConfig();
    const ready = AITrainer.isReady(cfg);
    const status = AITrainer.audioStatus ? AITrainer.audioStatus(cfg) : '';
    const dsSaved = AITrainer.hasKey(cfg.deepseek);
    const oaiSaved = AITrainer.hasKey(cfg.openai);
    const dsFp = dsSaved ? AITrainer.keyFingerprint(cfg.deepseek.apiKey) : '';
    const oaiFp = oaiSaved ? AITrainer.keyFingerprint(cfg.openai.apiKey) : '';
    view.innerHTML = `
      ${pageHead('AI Trainer', 'Bring your own API keys', 'DeepSeek = coach + spoken scripts. OpenAI = Southern/Texas TTS voice. Course works without keys; coach does not grade or unlock Next.')}

      <section class="section">
        <h3>How it works</h3>
        <ul class="howto-list">
          <li><strong>DeepSeek</strong> — AI Trainer coach (Q&amp;A panel) and Course <em>spoken lesson scripts</em> (text only).</li>
          <li><strong>OpenAI</strong> — text-to-speech only. Warm, clear <strong>Southern / Texas</strong> instructor voice via <code>gpt-4o-mini-tts</code>.</li>
          <li><strong>Saved on this device</strong> — keys stay in <code>localStorage</code> (<code>vcf9.aiTrainer</code>). Leave a key field blank on Save to keep the stored key.</li>
          <li><strong>Cost</strong> — pennies per section for OpenAI TTS; DeepSeek scripts are cheap; cached section replays are free.</li>
          <li><strong>No keys</strong> — Study/Course/Quiz/Exam still work; Listen falls back to the device voice.</li>
        </ul>
        <p class="hint">${esc(status)}</p>
        <p class="hint" id="aiPersistSummary">Stored keys: DeepSeek ${dsSaved ? `yes (${esc(dsFp)})` : 'no'} · OpenAI ${oaiSaved ? `yes (${esc(oaiFp)})` : 'no'}</p>
      </section>

      <section class="section card ai-config">
        <h3>Configuration</h3>
        <label class="ai-toggle">
          <input type="checkbox" id="aiEnabled" ${cfg.enabled ? 'checked' : ''}>
          <span>Enable AI Trainer (coach panel + DeepSeek scripts)</span>
        </label>
        <label class="ai-toggle">
          <input type="checkbox" id="aiQuorum" ${cfg.quorum ? 'checked' : ''}>
          <span>Quorum mode (ask both chat gateways — optional; coach still prefers DeepSeek first)</span>
        </label>

        <div class="ai-provider">
          <h4>DeepSeek — coach + spoken scripts</h4>
          <p class="hint">Preferred AI Trainer. Writes teacher-style section scripts for audio. Does not generate voice.${dsSaved ? ` <strong>Key saved</strong> (${esc(dsFp)}).` : ''}</p>
          <label class="ai-toggle"><input type="checkbox" id="aiDeepSeekOn" ${cfg.deepseek.enabled ? 'checked' : ''}> Use DeepSeek</label>
          <label class="field-label">API key<input type="password" id="aiDeepSeekKey" autocomplete="off" spellcheck="false" value="" placeholder="${dsSaved ? 'Leave blank to keep saved key' : 'sk-…'}" data-has-saved="${dsSaved ? '1' : '0'}"></label>
          <label class="field-label">Chat model<input type="text" id="aiDeepSeekModel" value="${esc(cfg.deepseek.model)}"></label>
          <label class="field-label">Base URL<input type="text" id="aiDeepSeekBase" value="${esc(cfg.deepseek.baseUrl)}"></label>
        </div>

        <div class="ai-provider">
          <h4>OpenAI — Southern / Texas TTS voice</h4>
          <p class="hint">Voice only. Not used for the coach when DeepSeek is available.${oaiSaved ? ` <strong>Key saved</strong> (${esc(oaiFp)}).` : ''}</p>
          <label class="ai-toggle"><input type="checkbox" id="aiOpenAiOn" ${cfg.openai.enabled ? 'checked' : ''}> Use OpenAI TTS</label>
          <label class="field-label">API key<input type="password" id="aiOpenAiKey" autocomplete="off" spellcheck="false" value="" placeholder="${oaiSaved ? 'Leave blank to keep saved key' : 'sk-…'}" data-has-saved="${oaiSaved ? '1' : '0'}"></label>
          <label class="field-label">Chat model (optional / quorum only)<input type="text" id="aiOpenAiModel" value="${esc(cfg.openai.model)}"></label>
          <label class="field-label">TTS model<input type="text" id="aiOpenAiTtsModel" value="${esc(cfg.openai.ttsModel || 'gpt-4o-mini-tts')}" placeholder="gpt-4o-mini-tts"></label>
          <label class="field-label">TTS voice id<input type="text" id="aiOpenAiTtsVoice" value="${esc(cfg.openai.ttsVoice || 'coral')}" placeholder="coral"></label>
          <label class="field-label">TTS style instructions<textarea id="aiOpenAiTtsStyle" rows="3">${esc(cfg.openai.ttsStyle || '')}</textarea></label>
          <label class="field-label">Base URL<input type="text" id="aiOpenAiBase" value="${esc(cfg.openai.baseUrl)}"></label>
        </div>

        <div class="cta-row">
          <button type="button" class="btn btn-primary" data-action="ai-save">Save settings</button>
          <button type="button" class="btn" data-action="ai-test">Test connection</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="ai-clear">Clear keys</button>
        </div>
        <p class="hint" id="aiConfigStatus">${ready
          ? 'Ready — saved keys load automatically on this device.'
          : 'Not ready — enable AI Trainer and save DeepSeek (coach/script) and/or OpenAI (TTS) keys.'}</p>
        <div id="aiTestOut" class="ai-test-out" hidden></div>
      </section>

      <section class="section">
        <h3>Privacy</h3>
        <p class="hint">Keys never leave this browser except when calling your chosen API. Coach questions go to DeepSeek (and OpenAI only if quorum). Spoken scripts go to DeepSeek; audio bytes come from OpenAI TTS. Progress reset does not clear keys.</p>
      </section>`;
  }

  function readAIForm() {
    return {
      enabled: !!(document.getElementById('aiEnabled') || {}).checked,
      quorum: !!(document.getElementById('aiQuorum') || {}).checked,
      openai: {
        enabled: !!(document.getElementById('aiOpenAiOn') || {}).checked,
        apiKey: (document.getElementById('aiOpenAiKey') || {}).value || '',
        model: (document.getElementById('aiOpenAiModel') || {}).value || '',
        baseUrl: (document.getElementById('aiOpenAiBase') || {}).value || '',
        ttsModel: (document.getElementById('aiOpenAiTtsModel') || {}).value || '',
        ttsVoice: (document.getElementById('aiOpenAiTtsVoice') || {}).value || '',
        ttsStyle: (document.getElementById('aiOpenAiTtsStyle') || {}).value || ''
      },
      deepseek: {
        enabled: !!(document.getElementById('aiDeepSeekOn') || {}).checked,
        apiKey: (document.getElementById('aiDeepSeekKey') || {}).value || '',
        model: (document.getElementById('aiDeepSeekModel') || {}).value || '',
        baseUrl: (document.getElementById('aiDeepSeekBase') || {}).value || ''
      }
    };
  }

  function saveAIFromForm() {
    const cfg = AITrainer.saveConfig(readAIForm());
    const status = document.getElementById('aiConfigStatus');
    if (status) {
      if (cfg._persisted === false) {
        status.textContent = `Could not save BYOK settings: ${cfg._persistError || 'storage blocked'}. Check private browsing / storage permissions.`;
      } else {
        const bits = [];
        if (cfg._deepSeekSaved) bits.push(`DeepSeek ${AITrainer.keyFingerprint(cfg.deepseek.apiKey)}`);
        if (cfg._openAiSaved) bits.push(`OpenAI ${AITrainer.keyFingerprint(cfg.openai.apiKey)}`);
        status.textContent = bits.length
          ? `Saved on this device — ${bits.join(' · ')}. Blank key fields keep existing keys.`
          : 'Saved on this device — no API keys stored yet.';
      }
    }
    const summary = document.getElementById('aiPersistSummary');
    if (summary) {
      summary.textContent = `Stored keys: DeepSeek ${cfg._deepSeekSaved ? `yes (${AITrainer.keyFingerprint(cfg.deepseek.apiKey)})` : 'no'} · OpenAI ${cfg._openAiSaved ? `yes (${AITrainer.keyFingerprint(cfg.openai.apiKey)})` : 'no'}`;
    }
    refreshSidebarStats();
    syncAiCoach();
    return cfg;
  }

  async function testAIFromForm() {
    const cfg = saveAIFromForm();
    const out = document.getElementById('aiTestOut');
    if (out) {
      out.hidden = false;
      out.innerHTML = '<p class="hint">Testing…</p>';
    }
    const result = await AITrainer.testConnection(cfg);
    if (out) {
      out.innerHTML = `
        <p><strong>${esc(result.message)}</strong></p>
        <ul>${result.results.map(r =>
          `<li class="${r.ok ? 'is-ok' : 'is-bad'}"><strong>${esc(r.label)}</strong>: ${esc(r.detail)}</li>`
        ).join('')}</ul>`;
    }
  }

  /* ====================================================================== */
  /* AI coach panel                                                         */
  /* ====================================================================== */

  function buildAiContext() {
    const { section, param } = parseHash();
    const lines = [`Route: #${section}${param ? '/' + param : ''}`];
    if (section === 'course' && course) {
      const m = DataLoader.getModule(course.moduleId);
      const s = m && m.course && m.course.sections[course.index];
      if (m) {
        lines.push(`Module ${m.number}: ${m.title}`);
        if (m.rainpoleJob) lines.push('Rainpole job: ' + m.rainpoleJob);
        if (m.requirementsSpine) lines.push('Requirements spine: ' + m.requirementsSpine);
      }
      if (s) {
        lines.push(`Course section: ${s.title}`);
        lines.push(`Section body: ${(s.body || '').slice(0, 1200)}`);
        if (s.rainpoleEvidence) lines.push('Rainpole evidence: ' + s.rainpoleEvidence);
        if (s.gapNote) lines.push('Gap note: ' + s.gapNote);
        if (s.informational91 || s.note91) lines.push('9.1 informational: ' + (s.note91 || 'yes'));
        if (s.figureId) {
          const fig = DataLoader.getFigure(s.figureId);
          if (fig) {
            lines.push(`Drawing: ${fig.title}`);
            lines.push(`Primer: ${fig.primer || ''}`);
            lines.push('Objects:');
            (fig.objects || []).forEach(o => lines.push(`- ${o.name}: WHAT ${o.what} WHY ${o.why}`));
            lines.push('Facts: ' + (fig.facts || []).join(' | '));
          }
        }
      }
    } else if (section === 'study' && param) {
      const m = DataLoader.getModule(param);
      if (m) {
        lines.push(`Module ${m.number}: ${m.title}`);
        lines.push(m.summary || '');
        if (m.study && m.study.primer) lines.push('Study primer: ' + m.study.primer);
      }
    } else if (section === 'quiz' && quiz && quiz.question) {
      lines.push('Current quiz stem: ' + quiz.question.stem);
    }
    return lines.filter(Boolean).join('\n');
  }

  function syncAiCoach() {
    const panel = document.getElementById('aiCoach');
    if (!panel || !window.AITrainer) return;
    const cfg = AITrainer.loadConfig();
    const show = !!(cfg.enabled && AITrainer.isReady(cfg));
    const { section } = parseHash();
    const onContent = ['study', 'course', 'quiz', 'exam', 'delta', 'howto'].includes(section);
    panel.hidden = !(show && onContent);
    document.body.classList.toggle('ai-coach-open', !panel.hidden && !panel.classList.contains('is-collapsed'));
    const status = document.getElementById('aiCoachStatus');
    if (status) {
      const names = AITrainer.activeProviders(cfg).map(p => p.label).join(' + ');
      status.textContent = cfg.quorum && AITrainer.activeProviders(cfg).length > 1 ? `Quorum · ${names}` : names || 'BYOK';
    }
    renderAiCoachLog();
  }

  function renderAiCoachLog() {
    const log = document.getElementById('aiCoachLog');
    if (!log) return;
    if (!aiChat.length) {
      log.innerHTML = '<p class="hint">Ask about the current section or drawing. Answers use your BYOK gateway.</p>';
      return;
    }
    log.innerHTML = aiChat.map(m => `
      <div class="ai-msg is-${esc(m.role)}">
        <strong>${m.role === 'user' ? 'You' : 'Trainer'}</strong>
        <div class="ai-msg-body">${esc(m.text).replace(/\n/g, '<br>')}</div>
        ${m.meta ? `<div class="hint">${esc(m.meta)}</div>` : ''}
      </div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  async function submitAiCoachQuestion(question) {
    if (aiBusy || !window.AITrainer) return;
    const q = String(question || '').trim();
    if (!q) return;
    aiBusy = true;
    aiChat.push({ role: 'user', text: q });
    renderAiCoachLog();
    const send = document.getElementById('aiCoachSend');
    if (send) send.disabled = true;
    try {
      const result = await AITrainer.ask(q, buildAiContext());
      if (result.mode === 'quorum') {
        result.answers.forEach(a => {
          aiChat.push({
            role: 'assistant',
            text: a.text,
            meta: `${a.label}${result.agree ? ' · agrees with peer' : ' · compare with peer'}`
          });
        });
        if (result.errors && result.errors.length) {
          aiChat.push({ role: 'assistant', text: 'Some providers failed:\n' + result.errors.join('\n'), meta: 'quorum' });
        }
      } else {
        const a = result.answers[0];
        aiChat.push({ role: 'assistant', text: a.text, meta: a.label });
      }
    } catch (err) {
      aiChat.push({ role: 'assistant', text: err.message || String(err), meta: 'error' });
    } finally {
      aiBusy = false;
      if (send) send.disabled = false;
      renderAiCoachLog();
    }
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

    if (!quiz.question) {
      quiz.question = QuizEngine.getNextQuizQuestion(filter || undefined);
      quiz.chosen = isMultiItem(quiz.question) ? [] : -1;
    }

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
    const multi = isMultiItem(q);
    const expected = correctAnswers(q);
    const chosenSet = multi
      ? (Array.isArray(quiz.chosen) ? quiz.chosen : [])
      : (quiz.chosen >= 0 ? [quiz.chosen] : []);

    const opts = q.options.map((text, i) => {
      let klass = 'option';
      let mark = '';
      if (quiz.answered) {
        const should = expected.includes(i);
        const picked = chosenSet.includes(i);
        if (should) { klass += ' is-correct'; mark = '✓'; }
        else if (picked) { klass += ' is-wrong'; mark = '✕'; }
      } else if (multi && chosenSet.includes(i)) {
        klass += ' is-selected';
      }
      return `
        <button type="button" class="${klass}" data-action="${multi ? 'quiz-toggle' : 'quiz-answer'}" data-index="${i}" ${quiz.answered ? 'disabled' : ''}>
          <span class="option-key">${letter(i)}</span>
          <span class="option-text">${esc(text)}</span>
          ${mark ? `<span class="option-mark">${mark}</span>` : ''}
        </button>`;
    }).join('');

    const wasRight = quiz.answered && sameAnswerSet(chosenSet, expected);
    const typeLabel = multi ? 'multi-select' : esc(q.type);

    return `
      <div class="qcard">
        <div class="qcard-head">
          ${q.moduleId ? `<span class="chip">${esc(moduleTitle(q.moduleId))}</span>` : ''}
          <span class="chip">${typeLabel}</span>
          <span class="badge badge-soft">${state}</span>
          ${q.delta91 ? badge91 : ''}
        </div>

        <p class="qstem">${esc(q.stem)}</p>
        ${multi ? `<p class="hint q-multi-hint">${esc(multiHint(q))}</p>` : ''}
        <div class="options">${opts}</div>

        ${quiz.answered ? `
          <div class="explain ${wasRight ? 'is-correct' : 'is-wrong'}">
            <h4>${wasRight ? 'Correct — for the right reason?' : `Incorrect — correct ${multi ? 'set is' : 'answer is'} ${lettersOf(expected)}`}</h4>
            <p>${esc(q.explanation || 'No explanation was provided for this question.')}</p>
            <p class="hint">${wasRight
              ? 'Can you restate the decision rule without looking? If not, return to Study before the next question.'
              : 'Do not memorize the letter. Open Study, re-learn the What/How/Why, then retry.'}</p>
            ${q.note91 || q.informational91 ? `<p class="hint note91">${esc(q.note91 || '9.1 update — informational. Baseline course answers remain valid unless the stem asks “as of 9.1”.')}</p>` : ''}
          </div>
          <div class="qfoot">
            <button type="button" class="btn btn-primary" data-action="quiz-next">Next question</button>
            <span class="hint">Press <kbd>Enter</kbd> for the next question</span>
          </div>` : `
          <div class="qfoot">
            ${multi
              ? `<button type="button" class="btn btn-primary" data-action="quiz-submit-multi" ${chosenSet.length ? '' : 'disabled'}>Check answer</button>
                 <span class="hint">Toggle options with <kbd>1</kbd>–<kbd>${q.options.length}</kbd>, then Check</span>`
              : `<span class="hint">Press <kbd>1</kbd>–<kbd>${q.options.length}</kbd> to answer</span>`}
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
    if (isMultiItem(q)) {
      toggleQuizOption(index);
      return;
    }

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

  function toggleQuizOption(index) {
    if (!quiz || !quiz.question || quiz.answered) return;
    if (!Array.isArray(quiz.chosen)) quiz.chosen = [];
    const set = new Set(quiz.chosen);
    if (set.has(index)) set.delete(index);
    else set.add(index);
    quiz.chosen = [...set].sort((a, b) => a - b);
    repaintQuizCard();
  }

  function submitQuizMulti() {
    if (!quiz || !quiz.question || quiz.answered) return;
    const q = quiz.question;
    if (!isMultiItem(q)) return;
    const chosen = Array.isArray(quiz.chosen) ? quiz.chosen : [];
    if (!chosen.length) return;
    const correct = sameAnswerSet(chosen, correctAnswers(q));
    quiz.answered = true;
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
    quiz.question = QuizEngine.getNextQuizQuestion(quiz.filter || undefined);
    quiz.chosen = isMultiItem(quiz.question) ? [] : -1;
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
            <li>Item types follow VMware Architect methods: single-best-answer and multi-select (exact set).</li>
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
    const answered = exam.answers.filter(a => a !== null && !(Array.isArray(a) && !a.length)).length;
    const remaining = (exam.endsAt - Date.now()) / 1000;
    const multi = isMultiItem(q);
    const selected = exam.answers[exam.index];
    const selectedSet = Array.isArray(selected) ? selected : (selected === null || selected === undefined ? [] : [selected]);

    const navigator = exam.ids.map((id, i) => {
      const klass = ['nav-num'];
      const ans = exam.answers[i];
      const has = ans !== null && !(Array.isArray(ans) && !ans.length);
      if (has) klass.push('is-answered');
      if (i === exam.index) klass.push('is-current');
      return `<button type="button" class="${klass.join(' ')}" data-action="exam-goto" data-index="${i}"
                aria-label="Question ${i + 1}${has ? ', answered' : ', unanswered'}">${i + 1}</button>`;
    }).join('');

    const opts = q ? q.options.map((text, i) => `
      <button type="button" class="option ${selectedSet.includes(i) ? 'is-selected' : ''}"
              data-action="${multi ? 'exam-toggle' : 'exam-answer'}" data-index="${i}">
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
            ${multi ? '<span class="chip">multi-select</span>' : ''}
            ${q.delta91 ? badge91 : ''}
          </div>
          <p class="qstem">${esc(q.stem)}</p>
          ${multi ? `<p class="hint q-multi-hint">${esc(multiHint(q))}</p>` : ''}
          <div class="options">${opts}</div>
          <div class="qfoot">
            <span class="hint">${multi
              ? `Toggle with <kbd>1</kbd>–<kbd>${q.options.length}</kbd>; selection is saved automatically`
              : `Press <kbd>1</kbd>–<kbd>${q.options.length}</kbd> to answer, <kbd>Enter</kbd> for next`}</span>
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
    const q = DataLoader.getQuestion(exam.ids[exam.index]);
    if (isMultiItem(q)) {
      toggleExamOption(index);
      return;
    }
    exam.answers[exam.index] = index;
    patchExamSelectionUI();
  }

  function toggleExamOption(index) {
    if (!exam || exam.phase !== 'running') return;
    const cur = exam.answers[exam.index];
    const set = new Set(Array.isArray(cur) ? cur : []);
    if (set.has(index)) set.delete(index);
    else set.add(index);
    const next = [...set].sort((a, b) => a - b);
    exam.answers[exam.index] = next.length ? next : null;
    patchExamSelectionUI();
  }

  function patchExamSelectionUI() {
    const q = DataLoader.getQuestion(exam.ids[exam.index]);
    const selected = exam.answers[exam.index];
    const selectedSet = Array.isArray(selected) ? selected : (selected === null || selected === undefined ? [] : [selected]);

    view.querySelectorAll('.options .option').forEach((btn, i) => {
      btn.classList.toggle('is-selected', selectedSet.includes(i));
    });

    const has = selected !== null && !(Array.isArray(selected) && !selected.length);
    const navBtn = view.querySelectorAll('.nav-num')[exam.index];
    if (navBtn) {
      navBtn.classList.toggle('is-answered', has);
      navBtn.setAttribute('aria-label', `Question ${exam.index + 1}${has ? ', answered' : ', unanswered'}`);
    }

    const answered = exam.answers.filter(a => a !== null && !(Array.isArray(a) && !a.length)).length;
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

    const unanswered = exam.answers.filter(a => a === null || (Array.isArray(a) && !a.length)).length;
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
      const expected = correctAnswers(q);
      const chosenSet = Array.isArray(chosen) ? chosen : (chosen === null || chosen === undefined ? [] : [chosen]);
      const answered = chosen !== null && !(Array.isArray(chosen) && !chosen.length);
      const correct = answered && sameAnswerSet(chosenSet, expected);
      if (correct) score += 1;
      else wrongIds.push(id);
      /* Skipped questions are not graded into the review schedule. */
      if (answered) QuizEngine.recordAnswer(id, correct);
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
      const chosenRaw = exam.ids.indexOf(id) >= 0 ? exam.answers[exam.ids.indexOf(id)] : null;
      const expected = correctAnswers(q);
      const chosenSet = Array.isArray(chosenRaw) ? chosenRaw : (chosenRaw === null || chosenRaw === undefined ? [] : [chosenRaw]);
      const chosen = !chosenSet.length
        ? '<em>not answered</em>'
        : chosenSet.map(ci => `${letter(ci)} — ${esc(q.options[ci])}`).join('<br>');
      const correctHtml = expected.map(ci => `${letter(ci)} — ${esc(q.options[ci])}`).join('<br>');

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
                <p>${correctHtml}</p>
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
      ${pageHead('9.1 Delta', 'Informational updates', `${total} changes across ${areas.length} areas. This page is awareness only — scoring and the Rainpole lab use the course baseline. You are not dinged for a valid 9.0-era answer solely because 9.1 later changed something.`)}
      <div class="notice delta-info-banner">
        <h3>Informational — not a scoring trap</h3>
        <p>Use Delta to stay current. Course checks, Quiz, and Exam grade Rainpole / course-baseline design answers unless a question explicitly asks “as of 9.1”.</p>
      </div>
      ${areas.map(group => `
        <section class="section">
          <h3>${esc(group.area)}<span class="section-count">${group.items.length}</span></h3>
          ${group.items.map(item => `
            <div class="delta-item">
              <h4>${esc(item.title)} ${badge91} <span class="badge badge-soft">Informational</span></h4>
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
      section: section || 'home',
      param: rest.length ? decodeURIComponent(rest.join('/')) : ''
    };
  }

  function route() {
    const { section, param } = parseHash();

    stopPageAudio();

    /* Leaving the exam mid-run must not leave a timer ticking. */
    if (section !== 'exam') stopExamTimer();

    document.body.classList.toggle('is-landing', section === 'home' || section === '');

    setActiveNav(section === '' ? 'home' : section);
    refreshSidebarStats();

    switch (section) {
      case 'howto':
        renderHowTo();
        break;
      case 'home':
      case '':
        renderHome();
        break;
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
      case 'ai':
        renderAI();
        break;
      case 'progress':
        renderProgress();
        break;
      default:
        location.replace('#home');
        return;
    }

    view.scrollTop = 0;
    window.scrollTo(0, 0);
    syncAiCoach();
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
      case 'howto-continue':
      case 'howto-skip':
        continueFromHowTo();
        break;
      case 'quiz-answer': answerQuiz(index); break;
      case 'quiz-toggle': toggleQuizOption(index); break;
      case 'quiz-submit-multi': submitQuizMulti(); break;
      case 'quiz-next':   nextQuizQuestion(); break;
      case 'exam-toggle': toggleExamOption(index); break;
      case 'course-prev':
        if (course) {
          course.index = Math.max(0, course.index - 1);
          course.check = null;
          course.figCheck = null;
          course.spiralCheck = null;
          stopPageAudio();
          renderCourse(course.moduleId);
        }
        break;
      case 'course-next':
        advanceCourse();
        break;
      case 'course-check':
        answerCourseCheck(index);
        break;
      case 'course-toggle':
        toggleCourseOption(index);
        break;
      case 'course-submit-multi':
        submitCourseMulti();
        break;
      case 'course-check-retry':
        retryCourseCheck();
        break;
      case 'course-spiral':
        answerSpiralCheck(index);
        break;
      case 'course-spiral-retry':
        retrySpiralCheck();
        break;
      case 'section-listen': {
        if (window.AITrainer && AITrainer.isSpeaking && AITrainer.isSpeaking() && !audioPlaylist) {
          stopPageAudio();
          break;
        }
        audioPlaylist = null;
        const mListen = course && DataLoader.getModule(course.moduleId);
        const sListen = mListen && mListen.course && mListen.course.sections[course.index];
        const text = sectionListenText(sListen, mListen && mListen.title);
        startListen(text, {
          id: sListen && sListen.id,
          title: sListen && sListen.title,
          moduleTitle: mListen && mListen.title,
          moduleId: mListen && mListen.id
        }).then(() => {
          const btn = view.querySelector('[data-action="section-listen"]');
          if (btn && window.AITrainer && AITrainer.isSpeaking && AITrainer.isSpeaking()) {
            btn.textContent = 'Stop audio';
            btn.setAttribute('aria-pressed', 'true');
          }
        });
        break;
      }
      case 'module-listen':
        playModuleAudio();
        break;
      case 'audio-stop':
        stopPageAudio();
        break;
      case 'fig-check':
        answerFigureCheck(index);
        break;
      case 'fig-check-retry':
        retryFigureCheck();
        break;
      case 'ai-save':
        saveAIFromForm();
        break;
      case 'ai-test':
        testAIFromForm();
        break;
      case 'ai-clear':
        if (window.confirm('Clear saved AI Trainer keys and disable the coach on this device?')) {
          AITrainer.clearKeys ? AITrainer.clearKeys() : AITrainer.saveConfig(AITrainer.defaultConfig(), { clearOpenAiKey: true, clearDeepSeekKey: true });
          renderAI();
          refreshSidebarStats();
          syncAiCoach();
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
      if (section !== 'home') { location.hash = '#home'; }
      return;
    }

    /* 1-4 answer, Enter advances. */
    if (/^[1-9]$/.test(event.key)) {
      const idx = Number(event.key) - 1;
      if (section === 'quiz' && quiz && quiz.question && !quiz.answered && idx < quiz.question.options.length) {
        event.preventDefault();
        answerQuiz(idx);
      } else if (section === 'course' && course) {
        const m = DataLoader.getModule(course.moduleId);
        const s = m && m.course && m.course.sections[course.index];
        if (s && s.figureId) {
          const fig = DataLoader.getFigure(s.figureId);
          const kc = fig && activeFigureCheck(s, fig);
          if (kc && !(course.figCheck && course.figCheck.checkId === kc.id) && idx < kc.options.length) {
            event.preventDefault();
            answerFigureCheck(idx);
          }
        } else {
          const kc = s && s.knowledgeCheck;
          if (kc && !course.cleared[s.id] && !(course.check && course.check.sectionId === s.id) && idx < kc.options.length) {
            event.preventDefault();
            answerCourseCheck(idx);
          }
        }
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
      if (section === 'quiz' && quiz) {
        if (quiz.answered) {
          event.preventDefault();
          nextQuizQuestion();
        } else if (isMultiItem(quiz.question) && Array.isArray(quiz.chosen) && quiz.chosen.length) {
          event.preventDefault();
          submitQuizMulti();
        }
      } else if (section === 'course' && course) {
        if (!canAdvanceCourse()) return;
        event.preventDefault();
        advanceCourse();
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
  initFontScale();

  const coachForm = document.getElementById('aiCoachForm');
  if (coachForm) {
    coachForm.addEventListener('submit', event => {
      event.preventDefault();
      const input = document.getElementById('aiCoachInput');
      const q = input ? input.value : '';
      if (input) input.value = '';
      submitAiCoachQuestion(q);
    });
  }
  const coachCollapse = document.getElementById('aiCoachCollapse');
  if (coachCollapse) {
    coachCollapse.addEventListener('click', () => {
      const panel = document.getElementById('aiCoach');
      if (!panel) return;
      panel.classList.toggle('is-collapsed');
      document.body.classList.toggle('ai-coach-open', !panel.hidden && !panel.classList.contains('is-collapsed'));
      coachCollapse.textContent = panel.classList.contains('is-collapsed') ? '+' : '–';
    });
  }

  DataLoader.load()
    .then(() => {
      if (!location.hash) location.replace('#home');
      route();
      syncAiCoach();
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
