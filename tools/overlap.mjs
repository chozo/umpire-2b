// 確認用: 捕ってからタッチの後まで、ベースに入った野手と走者の体がどれだけ近づくか（重なっていないか）を測る。
// 体を線分（胴・太もも・すね・上腕・前腕）と太さで表し、線分どうしの距離 − 太さの和 が負なら重なっている。
// 使い方: node tools/overlap.mjs '[{"cover":"2B","margin":0.03}, ...]'（npm run dev を起動した状態で）
import { chromium } from 'playwright-core';
const URL = process.env.URL ?? 'http://localhost:5290/';
const cases = JSON.parse(process.argv[2] ?? '[{"cover":"2B","margin":0.03}]');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await b.newPage({ viewport: { width: 300, height: 400 } });
await page.goto(`${URL}?seed=4`);
await page.waitForFunction(() => window.__game);
const segs = (j) => {
  const hip = j.lHip.map((v, i) => (v + j.rHip[i]) / 2);
  return [
    ['胴', hip, j.chest, 0.15],
    ['頭', j.head, j.head, 0.11],
    ['左もも', j.lHip, j.lKnee, 0.08],
    ['右もも', j.rHip, j.rKnee, 0.08],
    ['左すね', j.lKnee, j.lAnkle, 0.06],
    ['右すね', j.rKnee, j.rAnkle, 0.06],
    ['左上腕', j.lSh, j.lEl, 0.05],
    ['右上腕', j.rSh, j.rEl, 0.05],
  ];
};
const sub = (a, c) => a.map((v, i) => v - c[i]);
const dot = (a, c) => a.reduce((s, v, i) => s + v * c[i], 0);
// 線分どうしの最短距離（サンプリング）
const segDist = (p1, q1, p2, q2) => {
  let best = Infinity;
  for (let i = 0; i <= 8; i++) for (let k = 0; k <= 8; k++) {
    const a = p1.map((v, n) => v + (q1[n] - v) * (i / 8));
    const c = p2.map((v, n) => v + (q2[n] - v) * (k / 8));
    const d = Math.sqrt(dot(sub(a, c), sub(a, c)));
    if (d < best) best = d;
  }
  return best;
};
for (const force of cases) {
  const rows = await page.evaluate((f) => {
    const g = window.__game;
    g.manual(true);
    if (g.state().phase === 'title') g.start();
    g.replay(f);
    const p = g.state().play;
    const out = [];
    const arr = (j) => Object.fromEntries(Object.entries(j).map(([k, v]) => [k, [v.x, v.y, v.z]]));
    g.step(1 / 120, Math.round((p.tCatch - g.state().t) * 120));
    while (g.state().t < p.tTag + 0.8) {
      g.step(1 / 120, 2);
      out.push({ t: g.state().t - p.tTag, f: arr(g.cast.coverFig(p).j), r: arr(g.cast.runner.j) });
    }
    return out;
  }, force);
  let worst = { gap: Infinity };
  for (const row of rows) {
    for (const [na, a1, a2, ra] of segs(row.f)) for (const [nb, b1, b2, rb] of segs(row.r)) {
      const gap = segDist(a1, a2, b1, b2) - ra - rb;
      if (gap < worst.gap) worst = { gap, t: row.t, a: na, b: nb };
    }
  }
  const over = rows.filter((row) => segs(row.f).some(([, a1, a2, ra]) => segs(row.r).some(([, b1, b2, rb]) => segDist(a1, a2, b1, b2) - ra - rb < -0.03)));
  console.log(JSON.stringify(force), `いちばん近い: 野手の${worst.a}と走者の${worst.b} ${(worst.gap * 100).toFixed(0)}cm（タッチから ${worst.t.toFixed(2)}秒）`, `重なり(3cm超)のコマ: ${over.length}/${rows.length}`, over.length ? `${over[0].t.toFixed(2)}〜${over[over.length - 1].t.toFixed(2)}秒` : '');
}
await b.close();
