// 見た目の確認用: タッチの前後の野手の姿勢を、塁審の目線と横・正面から撮る。
// 使い方: node tools/pose.mjs [出力先] （npm run dev を起動した状態で）
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const URL = process.env.URL ?? 'http://localhost:5290/';
const OUT = process.argv[2] ?? 'tools/out/pose';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 300, height: 400 }, deviceScaleFactor: 1 });
await page.goto(`${URL}?seed=4`);
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  window.__game.manual(true);
  window.__game.start();
});
const cases = [
  ['sweep-out', { margin: 0.03, cover: 'SS', style: 'sweep' }],
  ['sweep-safe', { margin: -0.03, cover: '2B', style: 'sweep' }],
  ['wait', { margin: 0.2, cover: 'SS', style: 'wait' }],
  ['wide-high', { margin: -0.05, cover: '2B', style: 'sweep', wide: true }],
];
for (const [name, force] of cases) {
  await page.evaluate((f) => window.__game.replay(f), force);
  const p = (await page.evaluate(() => window.__game.state())).play;
  for (const [k, time] of [['a-catch', p.tCatch], ['b-tag', p.tTag], ['c-after', p.tTag + 0.6]]) {
    await page.evaluate((tt) => {
      const g = window.__game;
      const n = Math.max(1, Math.round((tt - g.state().t) * 120));
      g.step(1 / 120, n);
    }, time);
    await page.screenshot({ path: `${OUT}/${name}-${k}-ump.png` });
    // 横（内野側から近く）と、外野側の斜め前から
    const pr = await page.evaluate(() => window.__game.probe());
    const g = pr.glove;
    await page.evaluate(([gx, gy, gz]) => window.__game.peek([gx - 2.2, 0.9, gz + 2.2], [gx, 0.6, gz], 45), g);
    await page.screenshot({ path: `${OUT}/${name}-${k}-side.png` });
    await page.evaluate(([gx, gy, gz]) => window.__game.peek([gx + 1.6, 1.0, gz - 2.6], [gx, 0.6, gz], 45), g);
    await page.screenshot({ path: `${OUT}/${name}-${k}-back.png` });
  }
}
await browser.close();
