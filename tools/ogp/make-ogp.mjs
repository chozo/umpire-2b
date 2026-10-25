// OGP画像（public/ogp.png、1200×630）を作る。使い方: 開発サーバー（npm run dev）を起動して npm run ogp
// 際どいアウトのプレーを決まった乱数で作り、「タッチの瞬間」と「上下2画面のリプレイ」を撮って、文字と並べる
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const URL = process.env.URL ?? 'http://localhost:5290/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEED = Number(process.env.SEED ?? 7);
const INDEX = Number(process.env.INDEX ?? 12);
const MARGIN = Number(process.env.MARGIN ?? 0.03); // 正ならアウト（タッチが先）
const TMP = path.join(DIR, 'out');
fs.mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=metal', '--enable-gpu'] });
const errors = [];

// 1. ゲーム画面を撮る（縦 9:16）
const page = await browser.newPage({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${URL}?seed=${SEED}`);
await page.waitForFunction(() => window.__game);
await page.evaluate(([i, m]) => {
  const g = window.__game;
  g.manual(true);
  g.start();
  g.setIndex(i);
  g.replay({ margin: m });
}, [INDEX, MARGIN]);
const st = () => page.evaluate(() => window.__game.state());
const step = (sec) => page.evaluate((s) => window.__game.step(1 / 60, Math.max(1, Math.round(s * 60))), sec);
const view = page.locator('#view');

let s = await st();
const p = s.play;
// タッチの瞬間（足はまだベースの手前）。得点表示などは消して撮る
await step(p.tTag - s.t + 0.004);
await page.addStyleTag({ content: '#hud,#timer,#hint{visibility:hidden!important}', });
await view.screenshot({ path: `${TMP}/live.png` });
await page.evaluate(() => document.querySelectorAll('style').forEach((x) => x.textContent?.includes('#hud,#timer') && x.remove()));

// アウトとコール → リクエスト → リプレイの上下2画面で、両方の印が出るまで進める
await step(Math.max(p.tTag, p.tArrive) - (await st()).t + 0.3);
await page.evaluate(() => window.__game.call('out'));
let stamps = 0;
for (let i = 0; i < 4000 && stamps < 2; i++) {
  const ev = await page.evaluate(() => window.__game.drainEvents());
  stamps += ev.filter((e) => e.type === 'stamp').length;
  await step(1 / 30);
}
if (stamps < 2) throw new Error('リプレイの印が出なかった（リクエストにならないプレーかもしれない）');
await step(0.4);
await view.screenshot({ path: `${TMP}/replay.png` });
await page.close();

// 2. 台紙に並べる
const b64 = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await card.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; position: relative;
    font-family: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
    background: #0f1a2e; color: #fff; }
  .bg { position: absolute; inset: 0; background: url(${b64(`${TMP}/live.png`)}) center 62% / cover; filter: blur(14px) brightness(.45); transform: scale(1.1); }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10,18,34,.96) 0%, rgba(10,18,34,.82) 46%, rgba(10,18,34,.15) 100%); }
  .text { position: absolute; left: 64px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
  .kicker { font-size: 24px; font-weight: 800; letter-spacing: .22em; color: #ffd24a; }
  h1 { font-size: 104px; line-height: 1.08; font-weight: 900; margin: 14px 0 26px; text-shadow: 0 4px 0 rgba(0,0,0,.35); }
  .lead { font-size: 38px; font-weight: 800; line-height: 1.4; }
  .lead b { color: #ff6b5a; } .lead i { font-style: normal; color: #5ad1ff; }
  .url { margin-top: 34px; font-size: 26px; font-weight: 700; color: rgba(255,255,255,.75); letter-spacing: .02em; }
  .shot { position: absolute; top: 62px; height: 506px; aspect-ratio: 9/16; border-radius: 18px; overflow: hidden;
    box-shadow: 0 18px 40px rgba(0,0,0,.55); border: 4px solid rgba(255,255,255,.9); }
  .shot img { width: 100%; height: 100%; display: block; }
  .a { left: 618px; transform: rotate(-3deg); }
  .b { left: 910px; transform: rotate(3deg); top: 56px; }
  .tag { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); white-space: nowrap; font-size: 22px; font-weight: 800;
    background: rgba(10,18,34,.85); padding: 4px 14px; border-radius: 99px; }
</style></head><body>
  <div class="bg"></div><div class="shade"></div>
  <div class="text">
    <div class="kicker">SECOND BASE UMPIRE</div>
    <h1>二塁塁審<br>ジャッジ</h1>
    <p class="lead"><i>足</i>が先か、<b>タッチ</b>が先か。<br>キミの目でコールせよ。</p>
    <p class="url">game.chozo.net/umpire-2b</p>
  </div>
  <div class="shot a"><img src="${b64(`${TMP}/live.png`)}"><div class="tag">塁審の目線</div></div>
  <div class="shot b"><img src="${b64(`${TMP}/replay.png`)}"><div class="tag">リプレイ検証</div></div>
</body></html>`);
await card.waitForLoadState('load');
await card.screenshot({ path: path.join(ROOT, 'public/ogp.png') });
await browser.close();
console.log('public/ogp.png を作りました', errors.length ? errors : '');
