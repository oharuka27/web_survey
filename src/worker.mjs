import QRCode from 'qrcode/lib/browser.js';

const questions = [
  { title: '近畿地方で住みたい府県は？', options: ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '三重県'] },
  { title: '世帯構成は？', options: ['1人', '2人', '3人', '4人', 'それ以上'] },
  { title: '子供はいますか？', options: ['いる', 'いない'] },
  { title: '自家用車はありますか？', options: ['ある', 'なし'] },
];
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function readBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = '', size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return null; }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally { reader.releaseLock(); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    try {
      if (request.method === 'GET' && pathname === '/api/survey') {
        // Totals are maintained by a trigger on responses, so this reads at most one row per choice.
        const { results } = await env.DB.prepare('SELECT question, choice, count FROM answer_counts').all();
        const counts = questions.map(q => q.options.map(() => 0));
        for (const row of results) counts[row.question][row.choice] = row.count;
        const total = counts[0].reduce((sum, n) => sum + n, 0);
        return json({ questions, counts, total, voteURL: new URL('/vote', env.PUBLIC_URL || url.origin).href });
      }
      if (request.method === 'GET' && pathname === '/api/qr') {
        const svg = await QRCode.toString(new URL('/vote', env.PUBLIC_URL || url.origin).href, {
          type: 'svg', margin: 2, color: { dark: '#183b37', light: '#ffffff' },
        });
        return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } });
      }
      if (request.method === 'POST' && pathname === '/api/responses') {
        // Requiring JSON forces a CORS preflight, so other sites cannot submit votes through visitors' browsers.
        if (!/^application\/json\s*(;|$)/i.test(request.headers.get('Content-Type') || '')) {
          return json({ error: '回答形式が正しくありません。' }, 415);
        }
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (env.VOTE_LIMITER && !(await env.VOTE_LIMITER.limit({ key: ip })).success) {
          return json({ error: '送信が多すぎます。しばらくしてからお試しください。' }, 429);
        }
        const body = await readBody(request);
        if (body === null) return json({ error: '送信内容が大きすぎます。' }, 413);
        let payload;
        try { payload = JSON.parse(body); } catch { return json({ error: '回答形式が正しくありません。' }, 400); }
        const { answers, token } = payload || {};
        if (!Array.isArray(answers) || answers.length !== 4 || !answers.every((a, i) => Number.isInteger(a) && a >= 0 && a < questions[i].options.length) || typeof token !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(token)) {
          return json({ error: 'すべての質問に回答してください。' }, 400);
        }
        await env.DB.prepare('INSERT INTO responses (token, answers) VALUES (?, ?) ON CONFLICT(token) DO NOTHING')
          .bind(token, JSON.stringify(answers)).run();
        return json({ success: true });
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && (pathname === '/vote' || pathname === '/vote/')) {
        url.pathname = '/';
        return env.ASSETS.fetch(new Request(url, request));
      }
      if (pathname.startsWith('/api/')) return json({ error: 'APIが見つからないか、メソッドが正しくありません。' }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: '処理に失敗しました。時間をおいてお試しください。' }, 500);
    }
  },
};
