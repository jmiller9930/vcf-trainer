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

  const modulesRaw = readJson('data/modules.json');
  const modules = Array.isArray(modulesRaw) ? modulesRaw : modulesRaw.modules;
  ok('modules loaded', modules.length === 9, `count=${modules.length}`);

  const figIds = new Set(figures.map(f => f.id));
  let figSections = 0;
  let broken = 0;
  for (const m of modules) {
    for (const s of (m.course && m.course.sections) || []) {
      if (s.figureId) {
        figSections += 1;
        if (!figIds.has(s.figureId)) broken += 1;
      }
      const kc = s.knowledgeCheck;
      if (kc) {
        const valid = kc.options && kc.options.length >= 2 && Number.isInteger(kc.answer) && kc.answer >= 0 && kc.answer < kc.options.length;
        ok(`text check ${s.id}`, valid, valid ? '' : `bad answer ${kc.answer}`);
      }
    }
  }
  ok('course figure sections reference known figures', broken === 0, `sections=${figSections} broken=${broken}`);

  const questions = readJson('data/questions.json');
  const qlist = Array.isArray(questions) ? questions : questions.questions;
  ok('question bank non-empty', qlist.length > 50, `count=${qlist.length}`);
  let badQ = 0;
  for (const q of qlist) {
    const opts = q.options || q.choices || [];
    let ans = q.answer != null ? q.answer : q.correctIndex;
    if (typeof ans === 'string' && /^[A-Za-z]$/.test(ans)) ans = ans.toUpperCase().charCodeAt(0) - 65;
    if (!(opts.length >= 2 && Number.isInteger(ans) && ans >= 0 && ans < opts.length)) badQ += 1;
  }
  ok('questions have valid answers', badQ === 0, `bad=${badQ}`);

  ok('landing hero exists', exists('assets/landing-hero-cloud-automation.jpg'));
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
