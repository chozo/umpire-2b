// 確認用: ベースに入る野手の動きを 1/120 秒ごとに測り、区間（走る・捕る・タッチ・タッチの後）ごとに
// 腰の速さ、地面についた足の滑り、グラブの速さ、関節の加速度の最大を出す。瞬間移動や足の滑りを見つける。
// 使い方: node tools/motion.mjs '[{"cover":"2B","margin":0.03}, ...]'（npm run dev を起動した状態で）
//   JUMPS=0.06 … 1コマで 6cm 以上動いた関節を出す（走っている間は 25cm 以上だけ）
//   SLIDE=1.5  … 地面についた足が 1.5m/s 以上で動いたコマを出す
import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 300, height: 400 } });
await page.goto(`${process.env.URL ?? 'http://localhost:5290/'}?seed=4`);
await page.waitForFunction(() => window.__game);
await page.evaluate(() => { window.__game.manual(true); window.__game.start(); });
const cases = JSON.parse(process.argv[2] ?? '[]');
for (const force of cases) {
  const res = await page.evaluate((f) => {
    const g = window.__game;
    g.replay(f);
    const p = g.state().play;
    const rows = [];
    const dt = 1 / 120;
    while (g.state().t < p.tTag + 0.9) {
      g.step(dt, 1);
      const s = g.state();
      const j = g.cast['fielders'][s.play.cover].j;
      rows.push({ t: s.t, ...Object.fromEntries(Object.entries(j).map(([k, v]) => [k, [v.x, v.y, v.z]])) });
    }
    return { p: { tGo: p.tPitch - 0.05, tCatcher: p.tCatcher, tCatch: p.tCatch, tTag: p.tTag, style: p.style, cover: p.cover, wide: p.wide, margin: p.margin }, rows };
  }, force);
  const { p, rows } = res;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const dh = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  console.log('\n==', JSON.stringify(force), JSON.stringify(p));
  // 区間ごとの最大値: 腰（左右の股関節の中点）の水平の速さ、足首の速さ（地面にあるとき）、手の速さ、関節の1コマの跳び
  const seg = (t) => (t < p.tGo ? 'ready' : t < p.tCatch - 0.4 ? 'run/wait' : t < p.tCatch ? 'catch' : t < p.tTag ? 'tag' : 'after');
  const stats = {};
  for (let i = 2; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i], a0 = rows[i - 2];
    const k = seg(b.t);
    const S = (stats[k] ??= { hip: 0, skate: 0, hand: 0, acc: 0, accAt: 0, jump: '', jumpV: 0 });
    const hipA = a.lHip.map((v, n) => (v + a.rHip[n]) / 2), hipB = b.lHip.map((v, n) => (v + b.rHip[n]) / 2);
    S.hip = Math.max(S.hip, dh(hipA, hipB) * 120);
    for (const f of ['lAnkle', 'rAnkle']) if (a[f][1] < 0.085 && b[f][1] < 0.085) {
      const v = dh(a[f], b[f]) * 120;
      S.skate = Math.max(S.skate, v);
      if (process.env.SLIDE && v > Number(process.env.SLIDE)) console.log('  滑り', b.t.toFixed(3), f, v.toFixed(2), 'y', b[f][1].toFixed(3), '腰', (dh(hipA, hipB) * 120).toFixed(2));
    }
    S.hand = Math.max(S.hand, d(a.lHand, b.lHand) * 120);
    for (const key of Object.keys(b)) {
      if (key === 't') continue;
      const v1 = d(a0[key], a[key]) * 120, v2 = d(a[key], b[key]) * 120;
      const acc = Math.abs(v2 - v1) * 120;
      if (acc > S.acc) { S.acc = acc; S.accAt = `${key}@${b.t.toFixed(3)}`; }
    }
  }
  // 1コマで 5cm 以上（6m/s 以上）動いた関節（走っている間の手足は除く）
  if (process.env.JUMPS) for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const big = Object.keys(b).filter((key) => key !== 't' && d(a[key], b[key]) > Number(process.env.JUMPS)).map((key) => `${key}:${(d(a[key], b[key]) * 100).toFixed(0)}cm`);
    if (big.length && (seg(b.t) !== 'run/wait' || big.some((x) => parseInt(x.split(':')[1]) > 25))) console.log('  跳び', b.t.toFixed(3), seg(b.t), big.join(' '));
  }
  for (const [k, S] of Object.entries(stats)) console.log(k.padEnd(9), `腰 ${S.hip.toFixed(1)}m/s  地面の足の滑り ${S.skate.toFixed(2)}m/s  グラブ ${S.hand.toFixed(1)}m/s  最大の加速度 ${S.acc.toFixed(0)}m/s² (${S.accAt})`);
}
await browser.close();
