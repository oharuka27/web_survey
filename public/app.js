const app = document.querySelector('#app');
const colors = ['#398776', '#80b6a0', '#e5b66f', '#d98770', '#8c94bf', '#8cbfc9', '#baa687'];
const submitLabel = '回答を送信する <span>→</span>';
const noteIncomplete = 'すべての質問に回答すると送信できます';
const noteComplete = '回答内容を確認して送信してください';
const networkError = '送信できませんでした。通信を確認して、もう一度お試しください。';
let submitting = false;

// Escape text before placing it in HTML templates.
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error('取得できませんでした');
  return r.json();
}

function chart(counts, total) {
  let start = 0;
  const stops = counts.map((n, i) => {
    const end = start + (total ? n / total * 100 : 0);
    const stop = `${colors[i]} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  const background = total ? `conic-gradient(${stops.join(',')})` : '#edf0eb';
  return `
    <div class="donut" style="background:${background}">
      <div><strong>${total}</strong><span>${total ? '回答' : '回答待ち'}</span></div>
    </div>`;
}

function legendItem(option, count, total, color) {
  const percent = total ? Math.round(count / total * 100) : 0;
  return `
    <li>
      <span class="dot" style="background:${color}"></span>
      <span>${esc(option)}</span>
      <b>${percent}<small>%</small></b>
      <span class="count">${count}人</span>
    </li>`;
}

function results(data) {
  document.querySelector('#total').textContent = data.total;
  document.querySelector('#charts').innerHTML = data.questions.map((q, i) => `
    <article class="result-card">
      <div class="card-title"><span class="qnum">Q${i + 1}</span><h2>${esc(q.title)}</h2></div>
      <div class="chart-content">
        ${chart(data.counts[i], data.total)}
        <ul class="legend">${q.options.map((o, j) => legendItem(o, data.counts[i][j], data.total, colors[j])).join('')}</ul>
      </div>
    </article>`).join('');
}

function dashboard(survey) {
  app.innerHTML = `
    <section class="heading">
      <div>
        <p class="eyebrow">LIVING SURVEY / RESULTS</p>
        <h1>みんなの暮らし、<br class="mobile">のぞいてみよう。</h1>
        <p class="sub">近畿地方の住まいと暮らしに関するアンケート</p>
      </div>
      <div class="live" id="live" role="status"><i></i> ライブ集計中</div>
    </section>
    <div class="dashboard">
      <aside class="join-card">
        <span class="tag">スマホでかんたん回答</span>
        <h2>あなたの声を<br>聞かせてください。</h2>
        <p>QRコードを読み取って<br>4つの質問に答えるだけ。</p>
        <div class="qr"><img src="/api/qr" alt="アンケート回答画面のQRコード" width="190" height="190"></div>
        <p class="scan-note">スマホのカメラで読み取り</p>
        <a class="answer-link" href="/vote">この端末で回答する <span>↗</span></a>
        <div class="participation"><span>現在の回答数</span><div><strong id="total">0</strong> 人</div></div>
        <div class="join-bottom">約30秒・匿名で回答できます</div>
      </aside>
      <section class="results-area">
        <div class="section-label"><h2>アンケート集計結果</h2><span>3秒ごとに自動更新</span></div>
        <div id="charts" class="charts"></div>
        <p class="fine-print">各グラフは単一回答の集計です。割合は四捨五入して表示しています。</p>
      </section>
    </div>`;
  results(survey);

  // Update the status live region only when the connection state changes, so screen readers are not re-announced every poll.
  let online = true;
  const setOnline = ok => {
    if (ok === online) return;
    online = ok;
    const live = document.querySelector('#live');
    if (ok) live.innerHTML = '<i></i> ライブ集計中';
    else live.textContent = '接続を確認中・自動再試行します';
  };

  // Poll only while the tab is visible to avoid needless requests from background tabs.
  let timer;
  const poll = async () => {
    timer = undefined;
    try {
      results(await getJSON('/api/survey'));
      setOnline(true);
    } catch {
      setOnline(false);
    }
    if (!document.hidden) timer = setTimeout(poll, 3000);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(timer);
      timer = undefined;
    } else if (!timer) {
      poll();
    }
  });
  timer = setTimeout(poll, 3000);
}

function thanks() {
  app.innerHTML = `
    <section class="thankyou">
      <div class="success-icon">✓</div>
      <p class="eyebrow">THANK YOU</p>
      <h1>ご回答ありがとうございます。</h1>
      <p>あなたの回答を受け付けました。<br>集計結果に反映されています。</p>
      <a class="primary" href="/">みんなの回答を見る →</a>
    </section>`;
}

function getToken() {
  let token;
  try { token = localStorage.getItem('survey-token'); } catch {}
  if (!token) {
    // getRandomValues also works on plain-HTTP LAN testing, where crypto.randomUUID is unavailable.
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('survey-token', token); } catch {}
  }
  return token;
}

function questionFieldset(q, i) {
  const options = q.options.map((o, j) => `
    <label><input type="radio" name="q${i}" value="${j}" required><span>${esc(o)}</span></label>`).join('');
  return `
    <fieldset>
      <legend><span class="qnum">Q${i + 1}</span> ${esc(q.title)}<span class="required">必須</span></legend>
      <div class="options">${options}</div>
    </fieldset>`;
}

function vote({ questions }) {
  try { if (localStorage.getItem('survey-complete')) return thanks(); } catch {}
  const n = questions.length;
  app.classList.add('vote-page');
  app.innerHTML = `
    <section class="heading">
      <div>
        <p class="eyebrow">LIVING SURVEY / QUESTIONNAIRE</p>
        <h1>あなたの暮らしを<br>教えてください。</h1>
        <p class="sub">全${n}問・約30秒。お名前の入力は不要です。</p>
      </div>
    </section>
    <div class="progress-label"><span>回答の進み具合</span><strong id="progress-text">0 / ${n}</strong></div>
    <progress id="progress" max="${n}" value="0"></progress>
    <form>
      ${questions.map(questionFieldset).join('')}
      <p id="error" role="alert"></p>
      <button class="primary" type="submit" disabled>${submitLabel}</button>
      <p id="submit-note" class="submit-note">${noteIncomplete}</p>
    </form>`;

  const form = app.querySelector('form');
  const button = form.querySelector('button');
  const error = document.querySelector('#error');
  const token = getToken();

  form.addEventListener('change', () => {
    const count = form.querySelectorAll('input:checked').length;
    document.querySelector('#progress').value = count;
    document.querySelector('#progress-text').textContent = `${count} / ${n}`;
    button.disabled = count !== n || submitting;
    document.querySelector('#submit-note').textContent = count === n ? noteComplete : noteIncomplete;
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (submitting || !form.reportValidity()) return;
    submitting = true;
    button.disabled = true;
    button.textContent = '送信中…';
    error.textContent = '';
    try {
      const data = new FormData(form);
      const answers = questions.map((_, i) => Number(data.get(`q${i}`)));
      const r = await fetch('/api/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, token }),
      });
      if (r.status === 429) throw new Error('送信が集中しています。1分ほど待ってからもう一度お試しください。');
      if (!r.ok) throw new Error(networkError);
      try { localStorage.setItem('survey-complete', '1'); } catch {}
      thanks();
    } catch (err) {
      // fetch rejects with TypeError on network failure; our own errors carry a user-facing message.
      error.textContent = err instanceof TypeError ? networkError : err.message;
      submitting = false;
      button.disabled = false;
      button.innerHTML = submitLabel;
    }
  });
}

async function init() {
  try {
    if (location.pathname.replace(/\/$/, '') === '/vote') vote(await getJSON('/api/questions'));
    else dashboard(await getJSON('/api/survey'));
  } catch {
    app.innerHTML = '<p role="alert">読み込めませんでした。通信を確認してページを再読み込みしてください。</p>';
  }
}

init();
