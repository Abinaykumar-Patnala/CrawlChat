import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const local = 'http://127.0.0.1:8765';
const approved = new Set([local, 'https://example.com']);
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const here = path => fileURLToPath(new URL(path, import.meta.url));
const fixture = new Map([['/', 'index.html'], ['/hours.html', 'hours.html'],
  ['/events.html', 'events.html'], ['/robots.txt', 'robots.txt']]);
const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, {'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'});
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
http.createServer(async (req, res) => {
  const file = fixture.get(req.url);
  if (!file) return send(res, 404, {error: 'Page not found'});
  send(res, 200, await readFile(here('site/' + file)), file.endsWith('.txt') ? 'text/plain' : 'text/html');
}).listen(8765, '127.0.0.1');

async function interpret(prompt) {
  const match = prompt.match(/https?:\/\/[^\s<>"']+/i);
  const raw = match?.[0].replace(/[.,!?;)]+$/, '') ?? (/\bdemo(?: site)?\b/i.test(prompt) ? local : '');
  const url = new URL(raw);
  if (!approved.has(url.origin) || url.username || url.password) throw Error('Use the demo site or https://example.com.');
  url.hash = '';
  let plan = {action: /\b(crawl|summari[sz]e|extract|scan|collect|list|visit|show|read|fetch)\b/i.test(prompt) ? 'crawl' : 'unsupported',
    maxPages: Number(prompt.match(/\b([1-5])\s+pages?\b/i)?.[1] || 3)};
  let mode = 'local intent parser';
  if (process.env.OPENAI_API_KEY) {
    try {
      const reply = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(6000),
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY},
        body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          response_format: {type: 'json_object'}, messages: [
            {role: 'system', content: 'Return JSON with action crawl or unsupported and maxPages integer 1 to 5, default 3. Interpret website extraction and summarization as crawl.'},
            {role: 'user', content: prompt}]})
      });
      if (!reply.ok) throw Error();
      const candidate = JSON.parse((await reply.json()).choices[0].message.content);
      if (!['crawl', 'unsupported'].includes(candidate.action) || !Number.isInteger(candidate.maxPages) ||
          candidate.maxPages < 1 || candidate.maxPages > 5) throw Error();
      plan = candidate;
      mode = 'OpenAI';
    } catch {
      mode = 'local intent parser (AI unavailable)';
    }
  }
  if (plan.action !== 'crawl') throw Error('Ask me to crawl, summarize, or extract information from a website.');
  return {url: url.href, maxPages: plan.maxPages, mode};
}

let active = false;
http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') return send(res, 200, await readFile(here('public/index.html')), 'text/html; charset=utf-8');
  if (req.method !== 'POST' || req.url !== '/api/chat') return send(res, 404, {error: 'Route not found.'});
  if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, {error: 'Expected JSON.'});
  if (active) return send(res, 429, {error: 'A crawl is already running.'});
  active = true;
  let disconnected = false;
  let child;
  res.on('close', () => { if (!res.writableEnded) { disconnected = true; child?.kill(); } });
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) {
        send(res, 413, {error: 'Request is too large.'});
        return;
      }
    }
    const {prompt} = JSON.parse(body);
    if (typeof prompt !== 'string' || prompt.length > 2000 || !prompt.trim()) throw Error('Enter a request of up to 2,000 characters.');
    const task = await interpret(prompt);
    if (disconnected) return;
    const result = await new Promise(resolve => {
      child = execFile(python, [here('crawler.py'), task.url, String(task.maxPages)],
        {shell: false, timeout: 16000, maxBuffer: 256000,
          env: Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]))},
        (error, stdout, stderr) => {
          const execution = {tool: 'Python crawler CLI', pid: child.pid ?? null,
            exitCode: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
            signal: error?.signal ?? null, stderr: stderr.slice(0, 1000), stdoutBytes: Buffer.byteLength(stdout)};
          let data;
          try {
            data = JSON.parse(stdout);
            if (!['success', 'partial', 'failed'].includes(data.status) || !Array.isArray(data.pages)) throw Error();
          } catch {
            data = {status: 'failed', pagesVisited: 0, pages: [], errors: [{error: error?.killed ? 'Crawler timed out or was cancelled.' : 'Crawler did not produce a valid result.'}]};
          }
          resolve({...data, execution, intentMode: task.mode});
        });
    });
    if (!disconnected) {
      const summary = result.pages.length
        ? 'Read ' + result.pagesVisited + ' page(s). ' + result.pages.map(page => [page.title, page.highlights[0]].filter(Boolean).join(' — ')).join(' ')
        : 'Crawl failed. ' + (result.errors[0]?.error || '');
      send(res, 200, {summary, ...result});
    }
  } catch (error) {
    if (!disconnected) send(res, 400, {error: error.message === 'Invalid URL' ? 'Include a website URL or ask to crawl the demo site.' : error.message});
  } finally {
    active = false;
  }
}).listen(3000, '127.0.0.1', () => console.log('CrawlChat at http://127.0.0.1:3000'));
