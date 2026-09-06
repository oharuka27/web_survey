const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const QRCode = require('qrcode');
const PORT = Number(process.env.PORT || 3000);
const questions = [
  { title: '近畿地方で住みたい府県は？', options: ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '三重県'] },
  { title: '世帯構成は？', options: ['1人', '2人', '3人', '4人', 'それ以上'] },
  { title: '子供はいますか？', options: ['いる', 'いない'] },
  { title: '自家用車はありますか？', options: ['ある', 'なし'] },
];
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'data', 'survey.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, answers TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
let ip = 'localhost';
try { ip = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || ip; } catch {}
const baseURL = process.env.PUBLIC_URL || `http://${ip}:${PORT}`;
const voteURL = new URL('/vote', baseURL).href;
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/survey') {
      const rows = db.prepare('SELECT answers FROM responses').all();
      const counts = questions.map(q => q.options.map(() => 0));
      rows.forEach(row => JSON.parse(row.answers).forEach((a, i) => counts[i][a]++));
      return send(res, 200, { questions, counts, total: rows.length, voteURL });
    }
    if (req.method === 'GET' && pathname === '/api/qr') {
      const svg = await QRCode.toString(voteURL, { type: 'svg', margin: 2, color: { dark: '#183b37', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); return res.end(svg);
    }
    if (req.method === 'POST' && pathname === '/api/responses') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) return send(res, 413, { error: '送信内容が大きすぎます。' }); }
      let payload;
      try { payload = JSON.parse(body); } catch { return send(res, 400, { error: '回答形式が正しくありません。' }); }
      const { answers, token } = payload || {};
      if (!Array.isArray(answers) || answers.length !== 4 || !answers.every((a, i) => Number.isInteger(a) && a >= 0 && a < questions[i].options.length) || typeof token !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(token)) return send(res, 400, { error: 'すべての質問に回答してください。' });
      db.prepare('INSERT OR IGNORE INTO responses (token, answers) VALUES (?, ?)').run(token, JSON.stringify(answers));
      return send(res, 200, { success: true });
    }
    const files = { '/': 'index.html', '/vote': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
    if (req.method !== 'GET' || !files[pathname]) return send(res, 404, { error: 'ページが見つかりません。' });
    const file = files[pathname];
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', file)));
  } catch (error) { console.error(error); if (!res.headersSent) send(res, 500, { error: '処理に失敗しました。時間をおいてお試しください。' }); else res.end(); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`集計画面: http://localhost:${PORT}\nスマホ用: ${voteURL}`));
