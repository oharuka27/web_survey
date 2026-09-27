const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const cli = 'node_modules/wrangler/bin/wrangler.js';
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const emptyCounts = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0], [0, 0]];
const expectedCounts = [[0, 0, 1, 0, 0, 0, 1], [0, 1, 0, 0, 1], [1, 1], [1, 1]];

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

// Tests in this suite share one Wrangler dev server and local D1, and run in order.
describe('Workers + D1', { timeout: 90000 }, () => {
  let state, child, base, output = '';
  const d1 = (command, options = {}) => execFileSync(process.execPath, [cli, 'd1', 'execute', 'DB', '--local', '--persist-to', state, '--command', command, ...(options.json ? ['--json'] : [])], { env, encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
  const post = (data, headers = { 'Content-Type': 'application/json' }) => fetch(base + '/api/responses', { method: 'POST', headers, body: typeof data === 'string' ? data : JSON.stringify(data) });
  const survey = async () => (await fetch(base + '/api/survey')).json();

  before(async () => {
    state = mkdtempSync(join(tmpdir(), 'web-survey-test-'));
    execFileSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state], { env, stdio: 'pipe', timeout: 30000 });
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [cli, 'dev', '--port', String(port), '--inspector-port', '0', '--persist-to', state], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', c => { output += c; });
    child.stderr.on('data', c => { output += c; });
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { if ((await fetch(base + '/api/survey')).ok) return; } catch {}
      await delay(100);
    }
    throw new Error(`Wrangler dev did not become ready:\n${output}`);
  });

  after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    if (state) rmSync(state, { recursive: true, force: true });
  });

  test('serves pages, assets, QR and questions', async () => {
    for (const path of ['/', '/vote', '/vote/']) {
      const r = await fetch(base + path, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal(r.status, 200);
      assert.match(await r.text(), /<html lang="ja">/);
    }
    for (const path of ['/app.js', '/style.css']) assert.equal((await fetch(base + path)).status, 200);
    const qr = await fetch(base + '/api/qr');
    assert.equal(qr.status, 200);
    assert.match(await qr.text(), /<svg/);
    const { questions } = await (await fetch(base + '/api/questions')).json();
    assert.equal(questions.length, 4);
    assert.equal((await fetch(base + '/api/missing')).status, 404);
    assert.equal((await fetch(base + '/missing')).status, 404);
  });

  test('starts with empty totals', async () => {
    const data = await survey();
    assert.equal(data.total, 0);
    assert.deepEqual(data.counts, emptyCounts);
  });

  test('rejects invalid submissions', async () => {
    for (const answers of [[0, 1], [7, 1, 0, 1], [0, -1, 0, 1], [0, 0, 2, 0], [0, 0, 0, 0.5], ['0', 0, 0, 0]]) {
      assert.equal((await post({ answers, token: 'test-token-123456' })).status, 400);
    }
    assert.equal((await post(null)).status, 400);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post({ answers: [0, 0, 0, 0], token: 'short' })).status, 400);
    assert.equal((await post({ padding: 'あ'.repeat(2000) })).status, 413);
  });

  test('rejects non-JSON content types (CSRF)', async () => {
    // Non-JSON content types would skip the CORS preflight, so they are rejected.
    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded']) {
      const headers = type ? { 'Content-Type': type } : {};
      assert.equal((await post({ answers: [0, 0, 0, 0], token: 'csrf-token-123456' }, headers)).status, 415);
    }
  });

  test('ignores duplicate tokens and aggregates answers', async () => {
    const response = { answers: [2, 1, 0, 1], token: 'test-token-123456' };
    const sent = await Promise.all([post(response), post(response), post(response)]);
    sent.forEach(r => assert.equal(r.status, 200));
    assert.equal((await post({ answers: [6, 4, 1, 0], token: 'test-token-654321' })).status, 200);
    const aggregate = await fetch(base + '/api/survey');
    assert.equal(aggregate.headers.get('cache-control'), 'no-store');
    const data = await aggregate.json();
    assert.equal(data.total, 2);
    assert.deepEqual(data.counts, expectedCounts);
  });

  test('persists responses in D1', () => {
    // Query the persisted local database through a separate Wrangler process.
    const saved = d1('SELECT COUNT(*) AS total FROM responses', { json: true });
    assert.equal(JSON.parse(saved)[0].results[0].total, 2);
  });

  test('ignores stale count rows', async () => {
    // Stale rows for removed questions/options must not break or skew aggregation.
    d1('INSERT INTO answer_counts (question, choice, count) VALUES (9, 0, 5), (0, 99, 5)');
    const r = await fetch(base + '/api/survey');
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.total, 2);
    assert.deepEqual(data.counts, expectedCounts);
  });

  // Keep last: it exhausts the per-IP limiter for the rest of the minute.
  test('rate limits submissions per IP', async () => {
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) limited = (await post({ answers: [0, 0, 0, 0], token: `limit-token-${1000000 + i}` })).status === 429;
    assert.ok(limited, 'expected 429 after exceeding the rate limit (30 per minute)');
  });
});
