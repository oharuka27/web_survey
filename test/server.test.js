const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

test('Workers + D1: validation, persistence, aggregation, QR and assets', { timeout: 90000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'web-survey-test-'));
  const cli = 'node_modules/wrangler/bin/wrangler.js';
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  let child, output = '';
  try {
    execFileSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state], { env, stdio: 'pipe', timeout: 30000 });
    child = spawn(process.execPath, [cli, 'dev', '--port', '3199', '--inspector-port', '0', '--persist-to', state], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', c => { output += c; });
    child.stderr.on('data', c => { output += c; });
    const base = 'http://127.0.0.1:3199';
    let ready = false;
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { if ((await fetch(base + '/api/survey')).ok) { ready = true; break; } } catch {}
      await delay(100);
    }
    assert.ok(ready, output);
    const post = data => fetch(base + '/api/responses', { method: 'POST', body: JSON.stringify(data) });
    let data = await (await fetch(base + '/api/survey')).json();
    assert.equal(data.total, 0);
    assert.equal(data.questions.length, 4);
    assert.equal(data.voteURL, base + '/vote');
    for (const answers of [[0, 1], [7, 1, 0, 1], [0, -1, 0, 1], [0, 0, 2, 0], [0, 0, 0, 0.5], ['0', 0, 0, 0]]) {
      assert.equal((await post({ answers, token: 'test-token-123456' })).status, 400);
    }
    assert.equal((await post(null)).status, 400);
    assert.equal((await fetch(base + '/api/responses', { method: 'POST', body: '{' })).status, 400);
    assert.equal((await post({ answers: [0, 0, 0, 0], token: 'short' })).status, 400);
    assert.equal((await post({ padding: 'あ'.repeat(2000) })).status, 413);
    const response = { answers: [2, 1, 0, 1], token: 'test-token-123456' };
    const sent = await Promise.all([post(response), post(response), post(response)]);
    sent.forEach(r => assert.equal(r.status, 200));
    assert.equal((await post({ answers: [6, 4, 1, 0], token: 'test-token-654321' })).status, 200);
    const aggregate = await fetch(base + '/api/survey');
    assert.equal(aggregate.headers.get('cache-control'), 'no-store');
    data = await aggregate.json();
    assert.equal(data.total, 2);
    assert.deepEqual(data.counts, [[0, 0, 1, 0, 0, 0, 1], [0, 1, 0, 0, 1], [1, 1], [1, 1]]);
    const qr = await fetch(base + '/api/qr');
    assert.equal(qr.status, 200);
    assert.match(await qr.text(), /<svg/);
    for (const path of ['/', '/vote', '/vote/']) {
      const r = await fetch(base + path, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal(r.status, 200);
      assert.match(await r.text(), /<html lang="ja">/);
    }
    for (const path of ['/app.js', '/style.css']) assert.equal((await fetch(base + path)).status, 200);
    assert.equal((await fetch(base + '/api/missing')).status, 404);
    assert.equal((await fetch(base + '/missing')).status, 404);
    // Query the persisted local database through a separate Wrangler process.
    const saved = execFileSync(process.execPath, [cli, 'd1', 'execute', 'DB', '--local', '--persist-to', state, '--command', 'SELECT COUNT(*) AS total FROM responses', '--json'], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(JSON.parse(saved)[0].results[0].total, 2);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    rmSync(state, { recursive: true, force: true });
  }
});
