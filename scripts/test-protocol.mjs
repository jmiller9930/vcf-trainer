#!/usr/bin/env node
/* Test protocol for VCF-9 AI Trainer — run from VCFTrainer/: node scripts/test-protocol.mjs */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const results = [];

function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ' — ' + detail : ''}`);
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function mime(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

async function fetchPath(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

function mainStaticChecks() {
  ok('index.html exists', exists('index.html'));
  ok('ai-trainer.js exists', exists('js/ai-trainer.js'));
  ok('HowTo nav present', fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('href="#howto"'));
  ok('AI Trainer nav present', fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('href="#ai"'));
  ok('HowTo is first nav item', /<ul class="nav">\s*<li><a class="nav-link" href="#howto"/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')));
  ok('Coach panel markup present', fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('id="aiCoach"'));
  ok('BYOK copy on landing', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('bring-your-own API key'));
  ok('renderHowTo present', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('function renderHowTo'));
  ok('renderFigureBlock present', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('function renderFigureBlock'));
  ok('renderAI present', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('function renderAI'));
  ok('SW caches ai-trainer.js', fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes('ai-trainer.js'));

  const figures = readJson('data/figures.json').figures;
  ok('figures.json has 5 drawings', figures.length === 5, `count=${figures.length}`);

  for (const fig of figures) {
    ok(`figure image exists: ${fig.id}`, exists(fig.image), fig.image);
    ok(`figure ${fig.id} has objects`, Array.isArray(fig.objects) && fig.objects.length > 0, `objects=${(fig.objects || []).length}`);
    ok(`figure ${fig.id} has checks`, Array.isArray(fig.checks) && fig.checks.length > 0, `checks=${(fig.checks || []).length}`);
    for (const c of fig.checks || []) {
      const valid = c.options && c.options.length >= 2 && Number.isInteger(c.answer) && c.answer >= 0 && c.answer < c.options.length;
      ok(`check ${c.id} answer in range`, valid, `answer=${c.answer}`);
    }
  }

  ok('HowTo continue/skip actions', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('howto-continue') && fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('HOWTO_SEEN_KEY'));
  ok('Rainpole callout renderer', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('renderRainpoleCallouts'));
  ok('Home CTA uses HowTo when unseen', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes("seen ? '#study' : '#howto'"));

  const modulesRaw = readJson('data/modules.json');
  const modules = Array.isArray(modulesRaw) ? modulesRaw : modulesRaw.modules;
  ok('modules loaded', modules.length === 9, `count=${modules.length}`);
  ok('all modules have rainpoleJob', modules.every(m => m.rainpoleJob), 'missing jobs');
  ok('mod3 has requirementsSpine', !!(modules.find(m => m.id === 'mod3') || {}).requirementsSpine);

  const figIds = new Set(figures.map(f => f.id));
  let figSections = 0;
  let broken = 0;
  let sectionTotal = 0;
  let sectionTested = 0;
  let bare = [];
  for (const m of modules) {
    for (const s of (m.course && m.course.sections) || []) {
      sectionTotal += 1;
      if (s.figureId) {
        figSections += 1;
        if (!figIds.has(s.figureId)) broken += 1;
      }
      const fig = figures.find(f => f.id === s.figureId);
      const hasFig = !!(fig && fig.checks && fig.checks.length);
      const kc = s.knowledgeCheck;
      if (hasFig || kc) sectionTested += 1;
      else bare.push(s.id);
      if (kc) {
        const valid = kc.options && kc.options.length >= 2 && Number.isInteger(kc.answer) && kc.answer >= 0 && kc.answer < kc.options.length;
        ok(`text check ${s.id}`, valid, valid ? '' : `bad answer ${kc.answer}`);
      }
    }
  }
  ok('course figure sections reference known figures', broken === 0, `sections=${figSections} broken=${broken}`);
  ok('every Course section is tested', sectionTested === sectionTotal && bare.length === 0, `tested=${sectionTested}/${sectionTotal} bare=${bare.slice(0, 5).join(',')}`);

  const appSrc = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  ok('spiral recall wired', appSrc.includes('renderSpiralRecall') && appSrc.includes('course-spiral'));
  ok('HowTo documents VMware MCQ formats', appSrc.includes('Single-best-answer MCQ') && appSrc.includes('Scenario / design-decision'));
  ok('HowTo mentions every section tested', appSrc.includes('Every section tested'));

  const dlSrc = fs.readFileSync(path.join(root, 'js/data-loader.js'), 'utf8');
  ok('data-loader exposes pickSpiralRecall', dlSrc.includes('pickSpiralRecall'));

  const quizSrc = fs.readFileSync(path.join(root, 'js/quiz-engine.js'), 'utf8');
  ok('quiz spiral boost present', quizSrc.includes('spiralScore') && quizSrc.includes('introducedTerms'));

  const questions = readJson('data/questions.json');
  const qlist = Array.isArray(questions) ? questions : questions.questions;
  ok('question bank non-empty', qlist.length > 50, `count=${qlist.length}`);
  let badQ = 0;
  for (const q of qlist) {
    const opts = q.options || q.choices || [];
    let ansList = Array.isArray(q.answers) ? q.answers : null;
    let ans = q.answer != null ? q.answer : q.correctIndex;
    if (typeof ans === 'string' && /^[A-Za-z]$/.test(ans)) ans = ans.toUpperCase().charCodeAt(0) - 65;
    if (ansList && ansList.length) {
      if (!(opts.length >= 2 && ansList.every(a => Number.isInteger(a) && a >= 0 && a < opts.length))) badQ += 1;
    } else if (!(opts.length >= 2 && Number.isInteger(ans) && ans >= 0 && ans < opts.length)) {
      badQ += 1;
    }
  }
  ok('questions have valid answers', badQ === 0, `bad=${badQ}`);
  const multiQs = qlist.filter(q => q.multiSelect || (Array.isArray(q.answers) && q.answers.length > 1));
  ok('multi-select bank present', multiQs.length >= 6, `count=${multiQs.length}`);
  let badMulti = 0;
  for (const q of multiQs) {
    const opts = q.options || [];
    const ans = q.answers || q.correctIndexes || [];
    if (!(Array.isArray(ans) && ans.length >= 2 && ans.every(a => Number.isInteger(a) && a >= 0 && a < opts.length))) badMulti += 1;
  }
  ok('multi-select answers valid', badMulti === 0, `bad=${badMulti}`);

  ok('landing hero exists', exists('assets/landing-hero-cloud-automation.jpg'));
  ok('HowTo locks VMware methods', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('VMware Architect question methods only'));
  ok('multi-select UI wired', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('submitQuizMulti') && fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('quiz-submit-multi'));
  ok('font size controls present', fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('fontIncrease') && fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('initFontScale'));
  ok('listen / TTS wired', fs.readFileSync(path.join(root, 'js/ai-trainer.js'), 'utf8').includes('speakText') && fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('listenToggle'));
  const aiSrc = fs.readFileSync(path.join(root, 'js/ai-trainer.js'), 'utf8');
  ok('DeepSeek scripts + OpenAI TTS split', aiSrc.includes('speakLesson') && aiSrc.includes('transformForSpeech') && aiSrc.includes('Southern'));
  ok('HowTo documents provider audio roles', fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('DeepSeek = AI Trainer') && fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('OpenAI = TTS'));
  ok('BYOK save keeps blank keys', aiSrc.includes('Leave blank to keep') || fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('Leave blank to keep saved key'));
  ok('BYOK saveConfig preserves prior keys', aiSrc.includes('clearOpenAiKey') && aiSrc.includes('hasKey(prev.openai)'));
  const appAi = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  ok('config labels DeepSeek AI Trainer and OpenAI TTS', appAi.includes('DeepSeek — AI Trainer') && appAi.includes('OpenAI — TTS voice only'));
  ok('quorum removed from AI config UI', !appAi.includes('id="aiQuorum"'));
  ok('SW network-first for app shell', fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes('network-first') || fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes('isAppShell'));
  ok('index cache-busts build', /VCF_BUILD\s*=\s*['"]\d+['"]/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')));
  ok('HowTo states AI/TTS optional', appAi.includes('Recommended, not required') && appAi.includes('howto-ai-save'));
  ok('coach stays short and keeps chat history', aiSrc.includes('Do NOT end with quizzes') && aiSrc.includes('historyMessages') && appAi.includes('history: aiChat.slice'));
  ok('coach answers locally before AI', aiSrc.includes('answerLocally') && aiSrc.includes("mode: 'local'") && aiSrc.includes('no API tokens used'));
  ok('DeepSeek balance probe wired', aiSrc.includes('fetchDeepSeekBalance') && aiSrc.includes('/user/balance') && fs.readFileSync(path.join(root,'js/app.js'),'utf8').includes('ai-balance'));
  ok('acronym bank + term checks', fs.existsSync(path.join(root, 'data/acronyms.json')) && fs.readFileSync(path.join(root, 'js/data-loader.js'), 'utf8').includes('attachTermChecks') && appAi.includes('course-term') && appAi.includes('expandAcronyms'));
  ok('SW caches acronyms.json', fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes('acronyms.json'));
}

async function mainHttpChecks() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(root, urlPath.replace(/^\//, ''));
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404); res.end('missing'); return;
    }
    res.writeHead(200, { 'Content-Type': mime(filePath) });
    res.end(fs.readFileSync(filePath));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const pages = [
      '/index.html',
      '/js/app.js',
      '/js/ai-trainer.js',
      '/js/data-loader.js',
      '/data/modules.json',
      '/data/figures.json',
      '/data/questions.json',
      '/data/acronyms.json',
      '/assets/landing-hero-cloud-automation.jpg',
      '/data/figures/fig-dc-topology.png'
    ];
    for (const p of pages) {
      const res = await fetchPath(port, p);
      ok(`HTTP 200 ${p}`, res.status === 200, `status=${res.status}`);
    }

    const index = await fetchPath(port, '/index.html');
    ok('index loads HowTo first in nav', (() => {
      const howtoNav = index.body.indexOf('href="#howto"');
      const homeNav = index.body.indexOf('data-section="home"');
      return howtoNav >= 0 && homeNav >= 0 && howtoNav < homeNav;
    })());
    ok('index loads ai-trainer.js', index.body.includes('js/ai-trainer.js'));

    const app = await fetchPath(port, '/js/app.js');
    ok('app routes howto+ai', app.body.includes("case 'howto'") && app.body.includes("case 'ai'"));
    ok('app figure checks wired', app.body.includes('answerFigureCheck') && app.body.includes('fig-check'));
  } finally {
    server.close();
  }
}

async function run() {
  console.log('VCF-9 AI Trainer — test protocol\n');
  mainStaticChecks();
  await mainHttpChecks();
  const failed = results.filter(r => !r.pass);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('Failed:');
    failed.forEach(f => console.log(` - ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  } else {
    console.log('All automated checks passed. Manual: open #howto, #home, Course drawing section, #ai BYOK.');
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
