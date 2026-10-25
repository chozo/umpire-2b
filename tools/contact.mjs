// 撮った画像を1枚に並べる（確認用）。使い方: node tools/contact.mjs out.png 列数 画像...
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const [out, cols, ...files] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${path.basename(path.dirname(f))}/${path.basename(f)}</figcaption></figure>`).join('');
const html = `<style>body{margin:0;background:#111;color:#ccc;font:11px sans-serif}div{display:grid;grid-template-columns:repeat(${cols},220px);gap:4px}img{width:220px;display:block}figure{margin:0}</style><div>${imgs}</div>`;
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 224 * Number(cols), height: 400 } });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
