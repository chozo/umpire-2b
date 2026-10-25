// 確認用: 塁審の目線で、収めたい点が画面に収まっているかを、いろいろなプレーで測る。
// - 投球を見る間（最初のプレー）: 投手・打者・捕手
// - 走者を追う間: 走者の全身（目線が移る間は除く）。捕球の少し前からは野手・グラブ・ベース・ボール、足とタッチの少し前からは走者も
// 画面の位置は 0..1（上が0）。上は得点などの表示の下（0.1）から、ほかは 0..1 の内側なら収まっている。
// 使い方: node tools/framing.mjs [プレー数]（npm run dev を起動した状態で）
import { chromium } from 'playwright-core';
const URL = process.env.URL ?? 'http://localhost:5290/';
const N = Number(process.argv[2] ?? 120);
// CAM='{"judgeL":-5}' のように、塁審の目線の調整値を変えて測れる
const CAM = JSON.parse(process.env.CAM ?? '{}');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await b.newPage({ viewport: { width: 540, height: 960 } });
await page.goto(`${URL}?seed=7`);
await page.waitForFunction(() => window.__game);
const res = await page.evaluate(([N, CAM]) => {
  const g = window.__game;
  Object.assign(g.camera, CAM);
  g.manual(true);
  g.start();
  const out = [];
  const variants = [{}, { wide: true }, { style: 'wait', out: true, category: 'clear' }, { category: 'close' }, { cover: '2B', wide: true }, { cover: 'SS', wide: true }, { margin: 0.012, cover: 'SS', style: 'sweep' }, { margin: -0.008, cover: '2B', style: 'sweep' }, { margin: -0.02, cover: '2B', style: 'sweep' }];
  for (let i = 0; i < N; i++) {
    const pitchView = i % 2 === 0;
    g.setIndex(pitchView ? 0 : 20);
    g.replay(variants[(i >> 1) % variants.length]);
    const p = g.state().play;
    g.step(1 / 30, 1); // 1コマ目はまだ前の画面
    const last = Math.max(p.tTag, p.tArrive);
    const parts = ['pitch', 'runner', 'fielder', 'glove', 'bag', 'ball'];
    const worst = {};
    for (const k of parts) worst[k] = { x0: 9, x1: -9, y0: 9, y1: -9, at: 0 };
    // タッチと足の瞬間に、グラブと前の足が体に隠れていないか（隠れた回数）
    let hidden = 0;
    const moments = [p.tTag + 0.0005, p.tArrive + 0.0005].sort((a, b) => a - b);
    let catchFov = null;
    let judgeFov = null, fovMin = 99, fovMax = 0, prevFov = null, jump = 0, jumpAt = '';
    while (g.state().t <= last + 0.3 && g.state().phase === 'play') {
      const f = g.frameInfo();
      fovMin = Math.min(fovMin, f.fov);
      fovMax = Math.max(fovMax, f.fov);
      if (prevFov !== null && Math.abs(f.fov - prevFov) > jump) {
        jump = Math.abs(f.fov - prevFov);
        jumpAt = `捕球${(f.t - p.tCatch).toFixed(2)}s 止める${(f.t - g.track().tFreeze).toFixed(2)}s 移り始め${(f.t - g.track().tPan).toFixed(2)}s（${prevFov.toFixed(1)}→${f.fov.toFixed(1)}°）`;
      }
      prevFov = f.fov;
      const blending = f.t >= f.hold && f.t < f.hold + 0.6;
      if (judgeFov === null && f.t >= Math.min(p.tTag, p.tArrive)) judgeFov = f.fov;
      if (catchFov === null && f.t >= p.tCatch) catchFov = f.fov;
      for (const k of parts) {
        if (blending && k === 'runner') continue;
        const a = worst[k], c = f[k];
        if (c.x1 < c.x0) continue;
        const over = Math.max(-c.x0, c.x1 - 1, 0.1 - c.y0, c.y1 - 1);
        const prev = Math.max(-a.x0, a.x1 - 1, 0.1 - a.y0, a.y1 - 1);
        if (over > prev) Object.assign(a, c, { at: f.t - p.tCatch });
      }
      while (moments.length && g.state().t + 1 / 30 >= moments[0]) {
        g.step(moments.shift() - g.state().t, 1);
        const v = g.sight();
        if (v.glove.by || v.foot.by) hidden++;
      }
      g.step(1 / 30, 1);
    }
    // 向きの変化（1コマ、°）: 投球から走者へ移り終えてから、判定の後まで
    const tr = g.track();
    let turn = 0, turnAt = '';
    for (let k = 1; k < tr.dir.length; k++) {
      const t = tr.t0 + k * tr.dt;
      if (t < tr.tBlend || t > last + 0.3) continue;
      const a = tr.dir[k - 1], b2 = tr.dir[k];
      const ang = (Math.acos(Math.min(1, a.x * b2.x + a.y * b2.y + a.z * b2.z)) * 180) / Math.PI;
      if (ang > turn) {
        turn = ang;
        turnAt = t < tr.tLock ? '走者→捕球' : t < tr.tCatchEnd ? '捕球' : t < tr.tFreeze ? '捕球→タッチ' : 'タッチ';
      }
    }
    out.push({ turn, turnAt, catchFov, hidden, pitchView, wide: p.wide, style: p.style, cover: p.cover, margin: p.margin, worst, fovMin, fovMax, jump, jumpAt, judgeFov });
  }
  return out;
}, [N, CAM]);
let bad = 0;
for (const r of res) {
  const miss = [];
  for (const [k, a] of Object.entries(r.worst)) {
    if (a.x1 >= a.x0 && (a.x0 < 0 || a.x1 > 1 || a.y0 < 0.1 || a.y1 > 1))
      miss.push(`${k}(${a.x0.toFixed(2)}..${a.x1.toFixed(2)}, ${a.y0.toFixed(2)}..${a.y1.toFixed(2)} 捕球${a.at >= 0 ? '+' : ''}${a.at.toFixed(2)}s)`);
  }
  const head = `${r.pitchView ? '投球から' : '途中から'} ${r.cover} ${r.style} ${r.wide ? 'wide' : ''} m=${r.margin.toFixed(2)} 画角${r.fovMin.toFixed(0)}〜${r.fovMax.toFixed(0)}° 判定${r.judgeFov.toFixed(0)}°`;
  if (miss.length) {
    bad++;
    console.log(`${head}: ${miss.join(' ')}`);
  } else if (process.env.ALL) console.log(head);
}
const mx = res.map((r) => r.fovMax).sort((a, b) => a - b);
const bigJ = res.filter((r) => r.jump > 2.5);
for (const r of bigJ.slice(0, 8)) console.log(`画角の急な変化: ${r.pitchView ? '投球から' : '途中から'} ${r.cover} ${r.style} ${r.wide ? 'wide' : ''} ${r.jumpAt}`);
const jf = res.map((r) => r.judgeFov).sort((a, b) => a - b);
console.log(`タッチと足の瞬間にグラブか足が体に隠れた ${res.filter((r) => r.hidden).length}/${res.length} プレー`);
const cf = res.map((r) => r.catchFov).sort((a, b) => a - b);
console.log(`捕球の瞬間の画角 ${cf[0].toFixed(0)}〜${cf[cf.length - 1].toFixed(0)}°（中央値 ${cf[cf.length >> 1].toFixed(0)}°）`);
console.log(`判定の瞬間の画角 ${jf[0].toFixed(0)}〜${jf[jf.length - 1].toFixed(0)}°（中央値 ${jf[jf.length >> 1].toFixed(0)}°）`);
const tu = res.map((r) => r.turn).sort((a, b) => a - b);
const where = {};
for (const r of res) if (r.turn > tu[Math.floor(tu.length * 0.9)]) where[r.turnAt] = (where[r.turnAt] ?? 0) + 1;
console.log(`1コマの向きの変化 最大 ${tu[tu.length - 1].toFixed(2)}°（中央値 ${tu[tu.length >> 1].toFixed(2)}°。大きい1割の場面 ${JSON.stringify(where)}）`);
console.log(`はみ出し ${bad}/${res.length} プレー、判定までの最大の画角 ${mx[0].toFixed(0)}〜${mx[mx.length - 1].toFixed(0)}°（中央値 ${mx[mx.length >> 1].toFixed(0)}°）、1コマの画角の変化 最大 ${Math.max(...res.map((r) => r.jump)).toFixed(2)}°`);
await b.close();
