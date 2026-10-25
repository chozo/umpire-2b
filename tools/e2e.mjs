// ブラウザでの通し確認（playwright-core + インストール済み Chrome）
// 使い方: npm run dev（別ターミナル）→ npm run e2e [URL]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5290/';
const OUT = 'tools/out/e2e';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed++;
};

async function open(viewport, seed = 11) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${URL}?seed=${seed}`);
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => window.__game.manual(true));
  const g = (fn, arg) => page.evaluate(fn, arg);
  const step = (sec, dt = 1 / 60) => g(([s, d]) => window.__game.step(d, Math.max(1, Math.round(s / d))), [sec, dt]);
  const state = () => g(() => window.__game.state());
  const until = async (cond, max = 30, dt = 1 / 30) => {
    for (let i = 0; i < max / dt; i++) {
      const s = await state();
      if (cond(s)) return s;
      await step(dt, dt);
    }
    throw new Error('until: timeout ' + JSON.stringify(await state()));
  };
  return { page, errors, g, step, state, until };
}

// 1プレーを進める。how: 'correct' | 'wrong' | 'none'
async function playOne(t, how) {
  const s0 = await t.until((s) => s.phase === 'play' && s.armed);
  const truth = s0.play.out ? 'out' : 'safe';
  if (how === 'correct') await t.g((c) => window.__game.call(c), truth);
  if (how === 'wrong') await t.g((c) => window.__game.call(c), truth === 'out' ? 'safe' : 'out');
  const s1 = await t.until((s) => s.records.length > s0.records.length, 5);
  const rec = s1.records[s1.records.length - 1];
  const seen = { request: false, r2: false, r3: false };
  // 次のプレー・結果画面まで進める（リプレイは最後まで見る）
  for (let i = 0; i < 2000; i++) {
    const s = await t.state();
    if (s.phase === 'request') seen.request = true;
    if (s.phase === 'replay' && s.replaySub === 'r2') seen.r2 = true;
    if (s.phase === 'replay' && s.replaySub === 'r3') {
      seen.r3 = true;
      await t.g(() => window.__game.advance());
    }
    if ((s.phase === 'play' && s.index > s0.index) || s.phase === 'result') break;
    await t.step(1 / 20, 1 / 20);
  }
  return { rec, play: s0.play, seen };
}

// --- 1. 正しくコールし続けると続き、際どいプレーはリクエスト → リプレイになる ---
{
  const t = await open({ width: 405, height: 720 });
  await t.page.screenshot({ path: `${OUT}/title.png` });
  await t.page.click('#btn-start');
  let close = 0;
  let requests = 0;
  const covers = new Set();
  const styles = new Set();
  for (let i = 0; i < 14; i++) {
    const { rec, play, seen } = await playOne(t, 'correct');
    if (!rec.correct) check(false, `第${i + 1}走者の正しいコールが不正解扱い`);
    if (i < 3 && Math.abs(play.margin) < 0.3) check(false, `練習のプレーが際どい (${play.margin})`);
    if (play.close) {
      close++;
      if (!seen.request || !seen.r2 || !seen.r3) check(false, `際どいプレーでリクエスト・リプレイが出ない ${JSON.stringify(seen)}`);
    }
    if (seen.request) requests++;
    covers.add(play.cover);
    styles.add(play.style);
  }
  const s = await t.state();
  check(s.misses === 0 && s.phase === 'play', `14人を正しくコールして続く（誤審 ${s.misses}）`);
  check(s.score > 14 * 100, `得点が入る（${s.score}）`);
  check(close >= 2, `際どいプレーが出る（${close}回）`);
  check(requests >= close, `リクエストが出る（${requests}回）`);
  check(covers.size === 2, `遊撃手と二塁手の両方がベースに入る（${[...covers].join(',')}）`);
  check(styles.size === 2, `振り下ろすタッチと、足の前で待つタッチの両方が出る（${[...styles].join(',')}）`);
  // 14 回正解のあと 3 回誤審 → 正解 14 回なので「審判見習い」（10〜19）
  for (let i = 0; i < 3; i++) await playOne(t, 'wrong');
  await t.until((s) => s.phase === 'result', 5);
  const rank14 = await t.page.textContent('#res-rank');
  check(rank14 === '審判見習い', `正解 14 回の称号は「審判見習い」（${rank14}）`);
  check(t.errors.length === 0, `エラーなし ${t.errors.join(' / ')}`);
  await t.page.close();
}

// --- 2. 誤審3回で失格 → もう一度 → タイトルへ ---
{
  const t = await open({ width: 405, height: 720 }, 23);
  await t.page.click('#btn-start');
  for (let i = 0; i < 3; i++) {
    const { rec, seen } = await playOne(t, 'wrong');
    check(!rec.correct && rec.requested, `誤審 ${i + 1} 回目はリクエストされる`);
    check(seen.r3, `誤審 ${i + 1} 回目でリプレイの結果が出る`);
  }
  let s = await t.until((s) => s.phase === 'result', 5);
  check(s.phase === 'result', '誤審3回で結果画面');
  const rank0 = await t.page.textContent('#res-rank');
  check(rank0 === '草野球の審判', `正解 0 回の称号は「草野球の審判」（${rank0}）`);
  const resText = await t.page.textContent('#result');
  check(!resText.includes('連続') && (await t.page.locator('#streak').count()) === 0, '連続正解の表示と「最大連続」がない');
  await t.page.waitForTimeout(400);
  await t.page.screenshot({ path: `${OUT}/result.png` });
  await t.page.click('#btn-retry');
  s = await t.state();
  check(s.phase === 'play' && s.misses === 0 && s.score === 0, 'もう一度で最初から');
  check(s.t < 0.05 && s.play.tMove > 1, `1プレー目は投手が投球に入る前から始まる（t=${s.t.toFixed(2)}）`);
  // 時間切れ
  await t.until((s) => s.armed);
  const lateOut = (await t.state()).play.out;
  await t.step(2.2, 1 / 30);
  s = await t.state();
  check(s.misses === 1 && s.records[0].call === null, '2秒以内にコールしないと誤審（時間切れ）');
  await t.until((s) => s.phase === 'verdict', 5);
  const lateTxt = await t.page.textContent('#verdict');
  check(lateTxt === `時間切れ正しくは「${lateOut ? 'アウト' : 'セーフ'}」`, `時間切れでも正しい判定を出す（${lateTxt}）`);
  // 2プレー目は走者が走り出す直前から始まる（投手の動き出しは映さない）
  s = await t.until((s) => s.phase === 'play' && s.index === 1, 20);
  check(Math.abs(s.t - (s.play.tStart - 0.3)) < 0.05 && s.t > 1, `2プレー目は走者が走り出す0.3秒前から始まる（t=${s.t.toFixed(2)}、走り出し ${s.play.tStart.toFixed(2)}）`);
  // 早すぎる入力は無視
  await t.until((s) => s.t > s.play.tPitch + 0.5, 10);
  await t.g(() => window.__game.call('out'));
  s = await t.state();
  check(s.phase === 'play' && s.records.length === 1, '両方が起きる前のコールは無視');
  await t.g(() => window.__game.toTitle());
  check((await t.state()).phase === 'title', 'タイトルへ戻る');
  check(t.errors.length === 0, `エラーなし ${t.errors.join(' / ')}`);
  await t.page.close();
}

// --- 2b. ボタンの並び（左 = セーフ、右 = アウト）とキー（F = セーフ、J = アウト） ---
{
  const t = await open({ width: 405, height: 720 }, 31);
  await t.page.click('#btn-start');
  const safe = await t.page.locator('#btn-safe').boundingBox();
  const out = await t.page.locator('#btn-out').boundingBox();
  check(safe.x < out.x, `セーフのボタンが左、アウトが右（${Math.round(safe.x)} / ${Math.round(out.x)}）`);
  for (const [key, want] of [['f', 'safe'], ['j', 'out']]) {
    const s0 = await t.until((s) => s.phase === 'play' && s.armed);
    await t.page.keyboard.press(key);
    const s1 = await t.until((s) => s.records.length > s0.records.length, 5);
    const call = s1.records[s1.records.length - 1].call;
    check(call === want, `${key.toUpperCase()} キーで「${want === 'safe' ? 'セーフ' : 'アウト'}」（${call}）`);
    for (let i = 0; i < 2000; i++) {
      const s = await t.state();
      if (s.phase === 'replay' && s.replaySub === 'r3') await t.g(() => window.__game.advance());
      if ((s.phase === 'play' && s.index > s0.index) || s.phase === 'result') break;
      await t.step(1 / 20, 1 / 20);
    }
  }
  // リクエストの場面でタップすると、スローを見せずに結果だけを出す
  {
    const s0 = await t.until((s) => s.phase === 'play' && s.armed);
    await t.g((c) => window.__game.call(c), s0.play.out ? 'safe' : 'out'); // わざと誤審してリクエストを出す
    await t.until((s) => s.phase === 'request', 5);
    await t.step(0.5, 1 / 60);
    await t.page.keyboard.press('Space');
    const s1 = await t.state();
    const vis = await t.page.locator('#replay-result').isVisible();
    check(s1.phase === 'replay' && s1.replaySub === 'r3' && vis, `リクエストの場面からスキップすると結果だけが出る（${s1.phase} ${s1.replaySub}）`);
    await t.step(0.6, 1 / 60);
    await t.g(() => window.__game.advance());
  }
  // 得点: 正解 100 点・際どい正解 300 点、早押しボーナス（0.7 秒以内 +20、1.0 秒以内 +10）
  for (const [delay, want] of [[0.5, 20], [0.85, 10], [1.2, 0]]) {
    const s0 = await t.until((s) => s.phase === 'play' && s.armed);
    await t.step(delay, 1 / 60);
    await t.g((c) => window.__game.call(c), s0.play.out ? 'out' : 'safe');
    const s1 = await t.until((s) => s.records.length > s0.records.length, 5);
    const r = s1.records[s1.records.length - 1];
    const base = s0.play.close ? 300 : 100;
    check(r.correct && r.base === base && r.bonus === want && r.points === base + want,
      `${delay} 秒後に正しくコール → ${base} ＋ ${want}（${r.base} ＋ ${r.bonus} = ${r.points}）`);
    for (let i = 0; i < 2000; i++) {
      const s = await t.state();
      if (s.phase === 'verdict' && !s0.play.close) {
        const txt = await t.page.textContent('#verdict');
        check(txt.startsWith('正解') && (want ? txt.includes(`100 ＋ ${want}（早押しボーナス）`) : txt.endsWith('100')), `判定の表示が球審ジャッジと同じ書き方（${txt}）`);
        await t.g(() => window.__game.advance());
      }
      if (s.phase === 'replay' && s.replaySub === 'r3') {
        const txt = await t.page.textContent('#replay-result .judge');
        check(txt.startsWith('ナイスジャッジ！') && txt.includes(want ? `300 ＋ ${want}（早押しボーナス）` : '300'), `際どいプレーの正解の表示（${txt}）`);
        await t.g(() => window.__game.advance());
      }
      if ((s.phase === 'play' && s.index > s0.index) || s.phase === 'result') break;
      await t.step(1 / 20, 1 / 20);
    }
  }
  await t.page.close();
}

// --- 2c. 塁審の目線: 最初のプレーは投手・打者・捕手が入る画角で投球を見せ、その後は走者の全身、
//         捕球の少し前からは捕球の場面（ベースに入った野手・グラブ・ベース・ボール）、足とタッチの少し前からは走者も画面に収まる。
//         捕球の瞬間は野手を大きく（狭い画角で）映す。画角は急に変わらない ---
{
  const t = await open({ width: 405, height: 720 }, 41);
  const res = await t.g(() => {
    const g = window.__game;
    g.start();
    const variants = [{}, { wide: true }, { style: 'wait', out: true, category: 'clear' }, { category: 'close' }, { cover: '2B', wide: true }, { cover: 'SS', style: 'wait', out: true, category: 'clear', wide: true }];
    const bad = [];
    let maxFov = 0, pitchFov = 99, jump = 0, catchFov = 0, turn = 0;
    for (let i = 0; i < 36; i++) {
      g.setIndex(i % 2 ? 20 : 0);
      g.replay(variants[(i >> 1) % variants.length]);
      const p = g.state().play;
      g.step(1 / 30, 1);
      // 向きの変化（1コマ）: 投球から走者へ移り終えてから、判定の後まで
      const tr = g.track();
      const lastT = Math.max(p.tTag, p.tArrive) + 0.3;
      for (let k = 1; k < tr.dir.length; k++) {
        const tk = tr.t0 + k * tr.dt;
        if (tk < tr.tBlend || tk > lastT) continue;
        const a = tr.dir[k - 1], b = tr.dir[k];
        turn = Math.max(turn, (Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)) * 180) / Math.PI);
      }
      let prev = null;
      while (g.state().t <= Math.max(p.tTag, p.tArrive) + 0.3 && g.state().phase === 'play') {
        const f = g.frameInfo();
        maxFov = Math.max(maxFov, f.fov);
        if (f.t < f.hold) pitchFov = Math.min(pitchFov, f.fov);
        if (f.t <= p.tCatch && f.t + 1 / 30 > p.tCatch) catchFov = Math.max(catchFov, f.fov);
        if (prev !== null) jump = Math.max(jump, Math.abs(f.fov - prev));
        prev = f.fov;
        const blending = f.t >= f.hold && f.t < f.hold + 0.6;
        for (const k of ['pitch', 'runner', 'glove', 'ball', 'fielder', 'bag']) {
          if (blending && k === 'runner') continue;
          const b = f[k];
          if (b.x1 >= b.x0 && (b.x0 < 0 || b.x1 > 1 || b.y0 < 0.1 || b.y1 > 1)) bad.push(`${i}:${k}@${(f.t - p.tCatch).toFixed(2)}`);
        }
        g.step(1 / 30, 1);
      }
    }
    return { bad, maxFov, pitchFov, jump, catchFov, turn };
  });
  check(res.bad.length === 0, `36 プレーで、投手〜捕手・走者の全身・タッチの場面が画面に収まる（はみ出し ${res.bad.length}：${res.bad.slice(0, 4).join(' ')}、最大の画角 ${res.maxFov.toFixed(0)}°）`);
  check(res.pitchFov < 35, `最初のプレーの投球は、投手と捕手が入る狭い画角で見せる（${res.pitchFov.toFixed(0)}°）`);
  // 捕球の画角は多くが下限の 32°。それた送球を高い位置で捕るときなどは広がる（tools/framing.mjs、180 プレーで最大 55°）
  check(res.catchFov < 58, `捕球の瞬間は野手を大きく映す（画角 最大 ${res.catchFov.toFixed(0)}°）`);
  // 目線を移すとき・寄せ直すときも、画角は1コマ 2°、向きは1コマ 2.5° くらいまで（tools/framing.mjs、180 プレー）
  check(res.jump < 2.5, `画角は1コマで急に変わらない（最大 ${res.jump.toFixed(1)}°）`);
  check(res.turn < 3, `向きは1コマで急に変わらない（最大 ${res.turn.toFixed(1)}°）`);
  check(t.errors.length === 0, `エラーなし ${t.errors.join(' / ')}`);
  await t.page.close();
}

// --- 3. 見た目と正解が一致する（足・タッチ・音） ---
{
  // 走路に沿った距離（一塁の角から二塁へ）と、ベースの一塁側の面・靴の先の長さ（src/config.ts と同じ値）
  const H = 27.43 / Math.SQRT2;
  const pathS = (v) => (v[0] - H) * -Math.SQRT1_2 + (v[2] + H) * -Math.SQRT1_2;
  const FACE = 27.43 - 0.381 / 2;
  const SHOE = 0.07 + 0.135;
  const HAND = 0.048; // 手の中心から指先まで（ヘッドスライディング）
  const t = await open({ width: 405, height: 720 }, 5);
  await t.page.click('#btn-start');
  for (const [m, c, st, hd] of [
    [0.012, 'SS', 'sweep'],
    [-0.008, '2B', 'sweep'],
    [0.15, 'SS', 'wait'],
    [-0.02, '2B', 'sweep'],
    [0.2, '2B', 'wait'],
    [0.012, 'SS', 'sweep', true],
    [-0.01, '2B', 'sweep', true],
    [0.2, 'SS', 'wait', true],
  ]) {
    const ev = hd === 'evade';
    await t.g((f) => window.__game.replay(f), ev ? { margin: m, cover: c, evade: true } : { margin: m, cover: c, style: st, head: !!hd });
    const s = await t.state();
    const p = s.play;
    const name = `${c}・${st}・差 ${m}${ev ? '・タッチをかわす' : hd ? '・ヘッドスライディング' : ''}`;
    const head = (await t.g(() => window.__game.probe())).head;
    check(p.style === st && p.cover === c && head === !!hd, `${name}: 指定どおりのプレー（${p.cover}・${p.style}${head ? '・ヘッドスライディング' : ''}）`);
    // ベースに触れる体の先端（描いた左足首＋靴、ヘッドスライディングは描いた左手＋指先、かわす走者は描いた右手＋指先）
    const tip = (now) => pathS(now.touch) + (head ? HAND : SHOE);
    // ちょうど time まで進める（1/240 秒ずつ進めて、最後に残りの時間だけ進める）
    const at = async (time) => {
      const left = time - (await t.state()).t;
      const n = Math.floor(left * 240);
      if (n > 0) await t.g((k) => window.__game.step(1 / 240, k), n);
      const rest = time - (await t.state()).t;
      if (rest > 0) await t.g((d) => window.__game.step(d, 1), rest);
      return t.g(() => window.__game.probe());
    };
    // 捕球の瞬間、ボールはグラブ
    const cc = await at(p.tCatch + 0.001);
    const dc = Math.hypot(cc.glove[0] - cc.ball[0], cc.glove[1] - cc.ball[1], cc.glove[2] - cc.ball[2]);
    check(dc < 0.01, `${name}: 捕球の瞬間、ボールはグラブの位置（ずれ ${(dc * 100).toFixed(1)}cm）`);
    // 時刻の早い順に確かめる（それぞれの 0.02 秒前と瞬間）
    const evs = [
      ['tag-before', p.tTag - 0.02],
      ['foot-before', p.tArrive - 0.02],
      ['tag', p.tTag + 0.0005],
      ['foot', p.tArrive + 0.0005],
    ].sort((a, b) => a[1] - b[1]);
    for (const [k, te] of evs) {
      const now = await at(te);
      if (k === 'foot-before') {
        const gap = FACE - tip(now);
        check(gap > 0.04, `${name}: ベースに触れる 0.02 秒前は${head ? '指先' : '靴の先'}がベースの手前（${(gap * 100).toFixed(1)}cm）`);
      } else if (k === 'tag-before' && p.style !== 'wait') {
        const above = now.glove[1] - now.tagTarget[1];
        check(above > 0.003, `${name}: タッチの 0.02 秒前、グラブは脚の上で触れていない（${(above * 100).toFixed(1)}cm 上）`);
      } else if (k === 'tag-before') {
        const gap = pathS(now.glove) - pathS(now.shoe);
        check(gap > 0.03, `${name}: タッチの 0.02 秒前、靴の先はまだグラブに届いていない（${(gap * 100).toFixed(1)}cm）`);
      } else if (k === 'foot') {
        const gap = FACE - tip(now);
        check(Math.abs(gap) < 0.006, `${name}: 触れた瞬間、${head ? '指先' : '靴の先'}はベースの面（${(gap * 100).toFixed(2)}cm）`);
      } else {
        const d = Math.hypot(now.glove[0] - p.tagP[0], now.glove[1] - p.tagP[1], now.glove[2] - p.tagP[2]);
        check(d < 0.02, `${name}: タッチの瞬間、グラブは触れる点にある（ずれ ${(d * 100).toFixed(1)}cm）`);
        const v = await t.g(() => window.__game.sight());
        const inView = (o) => !o.by && o.x > 0.1 && o.x < 0.9 && o.y > 0.2 && o.y < 0.85;
        check(inView(v.glove) && inView(v.foot), `${name}: タッチの瞬間、グラブと前の足は体に隠れず画面の中ほど（グラブ ${v.glove.by ?? '見える'} x${v.glove.x.toFixed(2)} y${v.glove.y.toFixed(2)}、足 ${v.foot.by ?? '見える'} x${v.foot.x.toFixed(2)} y${v.foot.y.toFixed(2)}）`);
      }
    }
    // 音: タッチと、ベースに触れる瞬間には音を鳴らさない（音で前後が分からないように）
    await at(Math.max(p.tTag, p.tArrive) + 0.3);
    const all = await t.g(() => window.__game.audioLog());
    const near = all.filter((e) => Math.abs(e.t - p.tTag) < 0.03 || Math.abs(e.t - p.tArrive) < 0.03);
    check(near.length === 0, `${name}: タッチ・ベースの瞬間に鳴る音はない（${near.map((e) => e.name).join(',') || 'なし'}）`);
    check(!all.some((e) => e.name === 'bag'), `${name}: プレー中にベースの特別な音は鳴らない`);
    const mitt = all.filter((e) => e.name === 'mitt').map((e) => e.t);
    check(mitt.some((x) => Math.abs(x - p.tCatch) < 0.003), `${name}: 二塁での捕球の音が捕球の時刻に鳴る`);
  }
  check(t.errors.length === 0, `エラーなし ${t.errors.join(' / ')}`);
  await t.page.close();
}

// --- 4. 画面サイズ: 小さいスマホ・PC で切れない ---
for (const vp of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  const t = await open(vp, 9);
  const box = await t.g(() => {
    const a = document.getElementById('app').getBoundingClientRect();
    const c = document.getElementById('controls').getBoundingClientRect();
    const st = document.getElementById('btn-start').getBoundingClientRect();
    return { a: [a.left, a.top, a.right, a.bottom], c: [c.top, c.bottom], st: [st.top, st.bottom] };
  });
  check(box.a[1] >= 0 && box.a[3] <= vp.height + 1 && box.c[1] <= vp.height + 1, `${vp.width}x${vp.height}: 画面に収まる`);
  check(box.st[1] < box.c[0], `${vp.width}x${vp.height}: 開始ボタンが判定ボタンに重ならない`);
  await t.page.screenshot({ path: `${OUT}/title-${vp.width}x${vp.height}.png` });
  await t.page.click('#btn-start');
  await t.g(() => window.__game.replay({ margin: 0.01, cover: 'SS' }));
  await t.until((s) => s.armed);
  await t.page.screenshot({ path: `${OUT}/play-${vp.width}x${vp.height}.png` });
  await t.g(() => window.__game.call('safe'));
  await t.until((s) => s.phase === 'replay' && s.replaySub === 'r3', 40, 1 / 20);
  await t.page.waitForTimeout(400);
  await t.page.screenshot({ path: `${OUT}/replay-${vp.width}x${vp.height}.png` });
  check(t.errors.length === 0, `${vp.width}x${vp.height}: エラーなし ${t.errors.join(' / ')}`);
  await t.page.close();
}

await browser.close();
console.log(failed ? `\n${failed} 件の失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
