// 見た目の確認用: ベースに入る野手の動きを、走り出しからタッチの後まで一定の間隔で撮る。
// 使い方: node tools/coverseq.mjs <出力先> '<replay の指定(JSON)>' [間隔] [視点 ump|high|side]（npm run dev を起動した状態で）
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const URL = process.env.URL ?? 'http://localhost:5290/';
const [OUT = 'tools/out/coverseq', forceJson = '{"cover":"2B","margin":0.03}', every = '0.1', view = 'high'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 300), height: Number(process.env.H ?? 400) }, deviceScaleFactor: 1 });
await page.goto(`${URL}?seed=4`);
await page.waitForFunction(() => window.__game);
await page.evaluate((f) => {
  const g = window.__game;
  g.manual(true);
  g.start();
  g.replay(f);
}, JSON.parse(forceJson));
const p = (await page.evaluate(() => window.__game.state())).play;
const t0 = Number(process.env.FROM ?? p.tPitch - 0.15 - p.tCatch) + p.tCatch; // FROM: 捕る時刻からの秒
const t1 = p.tTag + 0.6;
let n = 0;
for (let tt = t0; tt <= t1; tt += Number(every)) {
  await page.evaluate((x) => {
    const g = window.__game;
    const k = Math.max(1, Math.round((x - g.state().t) * 120));
    g.step(1 / 120, k);
  }, tt);
  if (view !== 'ump') {
    // 二塁ベースのまわりを、本塁側の斜め上（high）か一塁側の横（side）から
    await page.evaluate((v) => {
      const g = window.__game;
      const cover = g.state().play.cover;
      // high: 本塁側の斜め上から、定位置と二塁ベースが両方入るように。side: 外野側の低い位置から
      const sx = cover === '2B' ? 1 : -1;
      if (v === 'high') g.peek([sx * 7, 7, -26], [sx * 3.5, 0.4, -36.5], 40);
      else if (v === 'follow') {
        // 野手を本塁側の斜め上から追う
        const c = g.cast.coverFig(g.state().play).j.chest;
        g.peek([c.x + sx * 1.5, 3.2, c.z + 5], [c.x, 0.7, c.z], 40);
      }
      else if (v === 'close') g.peek([-1.82, 0.9, -36.37], [0.16, 0.35, -38.63], 42); // 二塁ベースの内野側 3m の横から
      else g.peek([sx * 2, 1.4, -47], [sx * 3, 0.6, -37], 40);
    }, view);
  }
  const name = `${OUT}/${String(n++).padStart(2, '0')}.png`;
  await page.screenshot({ path: name });
}
console.log(JSON.stringify({ frames: n, tPitch: p.tPitch, tCatch: p.tCatch, tTag: p.tTag }));
await browser.close();
