const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
test('回答の検証・保存・重複防止・集計・QR生成', async () => {
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3199', DB_PATH: ':memory:', PUBLIC_URL: 'http://192.168.1.10:3199' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('server failed'); }), new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('startup timeout')), 10000); t.unref(); })]);
    const base = 'http://127.0.0.1:3199';
    const post = data => fetch(base + '/api/responses', { method: 'POST', body: JSON.stringify(data) });
    let data = await (await fetch(base + '/api/survey')).json();
    assert.equal(data.total, 0);
    assert.equal(data.questions.length, 4);
    assert.equal(data.voteURL, 'http://192.168.1.10:3199/vote');
    assert.equal((await post({ answers: [0, 1], token: 'test-token-123456' })).status, 400);
    assert.equal((await post({ answers: [7, 1, 0, 1], token: 'test-token-123456' })).status, 400);
    const response = { answers: [2, 1, 0, 1], token: 'test-token-123456' };
    assert.equal((await post(response)).status, 200);
    assert.equal((await post(response)).status, 200);
    data = await (await fetch(base + '/api/survey')).json();
    assert.equal(data.total, 1);
    assert.equal(data.counts[0][2], 1);
    assert.equal(data.counts[1][1], 1);
    assert.equal(data.counts[2][0], 1);
    assert.equal(data.counts[3][1], 1);
    const qr = await fetch(base + '/api/qr');
    assert.equal(qr.status, 200);
    assert.match(await qr.text(), /<svg/);
    assert.equal((await fetch(base + '/vote')).status, 200);
  } finally { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
});
