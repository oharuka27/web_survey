const app = document.querySelector('#app');
const colors = ['#398776', '#80b6a0', '#e5b66f', '#d98770', '#8c94bf', '#8cbfc9', '#baa687'];
let survey, submitting = false;
async function getSurvey() { const r = await fetch('/api/survey'); if (!r.ok) throw new Error('取得できませんでした'); return r.json(); }
function chart(counts, total) {
  let start = 0;
  const stops = counts.map((n, i) => { const end = start + (total ? n / total * 100 : 0); const s = `${colors[i]} ${start}% ${end}%`; start = end; return s; });
  return `<div class="donut" style="background:${total ? `conic-gradient(${stops.join(',')})` : '#edf0eb'}"><div><strong>${total}</strong><span>${total ? '回答' : '回答待ち'}</span></div></div>`;
}
function results(data) {
  document.querySelector('#total').textContent = data.total;
  document.querySelector('#charts').innerHTML = data.questions.map((q, i) => `<article class="result-card"><div class="card-title"><span class="qnum">Q${i + 1}</span><h2>${q.title}</h2></div><div class="chart-content">${chart(data.counts[i], data.total)}<ul class="legend">${q.options.map((o, j) => `<li><span class="dot" style="background:${colors[j]}"></span><span>${o}</span><b>${data.total ? Math.round(data.counts[i][j] / data.total * 100) : 0}<small>%</small></b><span class="count">${data.counts[i][j]}人</span></li>`).join('')}</ul></div></article>`).join('');
}
function dashboard() {
  app.innerHTML = `<section class="heading"><div><p class="eyebrow">LIVING SURVEY / RESULTS</p><h1>みんなの暮らし、<br class="mobile">のぞいてみよう。</h1><p class="sub">近畿地方の住まいと暮らしに関するアンケート</p></div><div class="live" id="live" role="status"><i></i> ライブ集計中</div></section><div class="dashboard"><aside class="join-card"><span class="tag">スマホでかんたん回答</span><h2>あなたの声を<br>聞かせてください。</h2><p>QRコードを読み取って<br>4つの質問に答えるだけ。</p><div class="qr"><img src="/api/qr" alt="アンケート回答画面のQRコード" width="190" height="190"></div><p class="scan-note">スマホのカメラで読み取り</p><a class="answer-link" href="/vote">この端末で回答する <span>↗</span></a><div class="participation"><span>現在の回答数</span><div><strong id="total">0</strong> 人</div></div><div class="join-bottom">約30秒・匿名で回答できます</div></aside><section class="results-area"><div class="section-label"><h2>アンケート集計結果</h2><span>3秒ごとに自動更新</span></div><div id="charts" class="charts"></div><p class="fine-print">各グラフは単一回答の集計です。割合は四捨五入して表示しています。</p></section></div>`;
  results(survey);
  // Poll only while the tab is visible to avoid needless requests from background tabs.
  let timer;
  const poll = async () => { timer = undefined; try { results(await getSurvey()); document.querySelector('#live').innerHTML = '<i></i> ライブ集計中'; } catch { document.querySelector('#live').textContent = '接続を確認中・自動再試行します'; } if (!document.hidden) timer = setTimeout(poll, 3000); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = undefined; } else if (!timer) poll(); });
  timer = setTimeout(poll, 3000);
}
function thanks() { app.innerHTML = `<section class="thankyou"><div class="success-icon">✓</div><p class="eyebrow">THANK YOU</p><h1>ご回答ありがとうございます。</h1><p>あなたの回答を受け付けました。<br>集計結果に反映されています。</p><a class="primary" href="/">みんなの回答を見る →</a></section>`; }
function vote() {
  try { if (localStorage.getItem('survey-complete')) return thanks(); } catch {}
  app.classList.add('vote-page');
  app.innerHTML = `<section class="heading"><div><p class="eyebrow">LIVING SURVEY / QUESTIONNAIRE</p><h1>あなたの暮らしを<br>教えてください。</h1><p class="sub">全4問・約30秒。お名前の入力は不要です。</p></div></section><div class="progress-label"><span>回答の進み具合</span><strong id="progress-text">0 / 4</strong></div><progress id="progress" max="4" value="0"></progress><form>${survey.questions.map((q, i) => `<fieldset><legend><span class="qnum">Q${i + 1}</span> ${q.title}<span class="required">必須</span></legend><div class="options">${q.options.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}" required><span>${o}</span></label>`).join('')}</div></fieldset>`).join('')}<p id="error" role="alert"></p><button class="primary" type="submit" disabled>回答を送信する <span>→</span></button><p id="submit-note" class="submit-note">すべての質問に回答すると送信できます</p></form>`;
  const form = app.querySelector('form'), button = form.querySelector('button');
  form.addEventListener('change', () => { const count = form.querySelectorAll('input:checked').length; document.querySelector('#progress').value = count; document.querySelector('#progress-text').textContent = `${count} / 4`; button.disabled = count !== 4 || submitting; document.querySelector('#submit-note').textContent = count === 4 ? '回答内容を確認して送信してください' : 'すべての質問に回答すると送信できます'; });
  let token;
  try { token = localStorage.getItem('survey-token'); } catch {}
  if (!token) { token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2); try { localStorage.setItem('survey-token', token); } catch {} }
  form.addEventListener('submit', async e => { e.preventDefault(); if (submitting || !form.reportValidity()) return; submitting = true; button.disabled = true; button.textContent = '送信中…'; document.querySelector('#error').textContent = ''; try { const answers = survey.questions.map((_, i) => Number(new FormData(form).get(`q${i}`))); const r = await fetch('/api/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, token }) }); if (r.status === 429) throw new Error('送信が集中しています。1分ほど待ってからもう一度お試しください。'); if (!r.ok) throw new Error('送信できませんでした。通信を確認して、もう一度お試しください。'); try { localStorage.setItem('survey-complete', '1'); } catch {} thanks(); } catch (err) { document.querySelector('#error').textContent = err instanceof TypeError ? '送信できませんでした。通信を確認して、もう一度お試しください。' : err.message; submitting = false; button.disabled = false; button.textContent = '回答を送信する →'; } });
}
async function init() { try { survey = await getSurvey(); location.pathname.replace(/\/$/, '') === '/vote' ? vote() : dashboard(); } catch { app.innerHTML = '<p role="alert">読み込めませんでした。通信を確認してページを再読み込みしてください。</p>'; } }
init();
