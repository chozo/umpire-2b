import { describe, expect, it } from 'vitest';
import { BAG_FACE_S, BATTERY, COVER_RUN, HAND_FRONT, LEVELS, RUNNER, SHOE_FRONT, STAGE, TAG, difficulty, worldToPath } from '../src/config';
import {
  ballAt,
  coverDist,
  generatePlay,
  leadFront,
  leadPoint,
  mulberry32,
  runnerS,
  sweepPoint,
  tagTarget,
  throwPos,
  type Play,
} from '../src/play';

// ベースに触れる体の先端（靴の先か指先）の、ベースの面に対する位置（正ならベースの面を越えている）
const shoeS = (p: Play, t: number) => worldToPath(leadPoint(p.runner, t)).s + (p.runner.head ? HAND_FRONT : SHOE_FRONT) - BAG_FACE_S;

describe('generatePlay', () => {
  it('多くの乱数で必ずプレーを作れて、条件を満たす', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed);
      for (let i = 0; i < 40; i++) {
        const p = generatePlay(rng, i, {}, i);
        // 判定と差が一致し、同時はない
        expect(p.out).toBe(p.margin > 0);
        expect(Math.abs(p.margin)).toBeGreaterThanOrEqual(0.001);
        expect(p.tArrive - p.tTag).toBeCloseTo(p.margin, 9);
        // 順番: 動き出し → 投げる → 捕手が捕る → 投げる → 捕る → タッチ
        expect(p.tPitch).toBeGreaterThan(p.tMove);
        expect(p.tCatcher).toBeGreaterThan(p.tPitch);
        expect(p.th.tRelease).toBeGreaterThan(p.tCatcher + BATTERY.exchange[0] - 1e-9);
        expect(p.th.tCatch).toBeGreaterThan(p.th.tRelease);
        expect(p.tTag).toBeGreaterThanOrEqual(p.tCatch + TAG.minDur);
        // ベースに入る野手は捕るより前に着いている
        expect(p.fp.tSet).toBeLessThan(p.tCatch - 0.29);
        // タッチの瞬間、走者はスライディングの姿勢になっている
        expect(p.tTag).toBeGreaterThan(p.runner.tSlide + RUNNER.slideDrop);
        // 練習のプレーは明らかな差
        if (i < STAGE.tutorial) expect(Math.abs(p.margin)).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it('盗塁の時間（投手が動いてからベースまで）は 3.1〜4.3 秒、ポップタイムは 1.5〜2.2 秒', () => {
    const rng = mulberry32(3);
    for (let k = 0; k < 300; k++) {
      const p = generatePlay(rng, 3 + (k % 30));
      const t = p.tArrive - p.tMove;
      expect(t).toBeGreaterThan(3.1);
      expect(t).toBeLessThan(4.3);
      const pop = p.th.tCatch - p.tCatcher;
      expect(pop).toBeGreaterThan(1.5);
      expect(pop).toBeLessThan(2.2);
    }
  });

  it('足（ヘッドスライディングは手）: ベースに触れる瞬間に靴の先（指先）がベースの面にあり、その前は届いていない。触れた後は面で止まる', () => {
    const rng = mulberry32(7);
    for (let k = 0; k < 200; k++) {
      const p = generatePlay(rng, 5 + (k % 40));
      expect(shoeS(p, p.tArrive)).toBeCloseTo(0, 9);
      expect(shoeS(p, p.tArrive - 0.001)).toBeLessThan(0);
      expect(shoeS(p, p.tArrive + 0.3)).toBeCloseTo(0, 9);
      // 腰は滑りながら減速し、触れた後すぐ止まる
      expect(runnerS(p.runner, p.tArrive + 1)).toBeCloseTo(p.runner.sTouch + (p.runner.evade ? RUNNER.evadeAfter : RUNNER.slideAfter), 6);
      expect(p.runner.vArrive).toBeGreaterThan(2.5);
      expect(p.runner.vArrive).toBeLessThan(p.runner.vSlide);
    }
  });

  it('タッチ: 触れる点は、タッチの瞬間の脚・腕（sweep）か靴の先・指先（wait）', () => {
    const rng = mulberry32(11);
    let waits = 0;
    let sweeps = 0;
    for (let k = 0; k < 300; k++) {
      const p = generatePlay(rng, 3 + (k % 30));
      const want = p.tag.style === 'wait' ? leadFront(p.runner, p.tTag) : sweepPoint(p.runner, p.tTag);
      expect(p.tag.P.x).toBeCloseTo(want.x, 9);
      expect(p.tag.P.z).toBeCloseTo(want.z, 9);
      expect(tagTarget(p, p.tTag).x).toBeCloseTo(p.tag.P.x, 9);
      if (p.tag.style === 'wait') {
        waits++;
        // 待つのはアウトのときだけ。待っている点に靴の先はまだ届いていない
        expect(p.out).toBe(true);
        const before = leadFront(p.runner, p.tTag - 0.02);
        expect(worldToPath(before).s).toBeLessThan(worldToPath(p.tag.P).s);
      } else sweeps++;
    }
    expect(waits).toBeGreaterThan(10);
    expect(sweeps).toBeGreaterThan(100);
  });

  it('送球は捕球点に届き、ボールは順番どおり', () => {
    const p = generatePlay(mulberry32(5), 10);
    const end = throwPos(p.th, p.th.tCatch);
    expect(end.x).toBeCloseTo(p.th.C.x, 9);
    expect(end.y).toBeCloseTo(p.th.C.y, 9);
    expect(ballAt(p, p.tPitch - 0.1).phase).toBe('held');
    expect(ballAt(p, (p.tPitch + p.tCatcher) / 2).phase).toBe('pitch');
    expect(ballAt(p, p.tCatcher + 0.1).phase).toBe('catcher');
    expect(ballAt(p, (p.th.tRelease + p.th.tCatch) / 2).phase).toBe('throw');
    expect(ballAt(p, p.tTag).phase).toBe('caught');
  });

  it('指定した差・ベースに入る野手・タッチの仕方で作れる', () => {
    const rng = mulberry32(9);
    for (const m of [0.5, -0.5, 0.3, -0.3, 0.001, -0.001]) {
      const p = generatePlay(rng, 0, { margin: m });
      expect(p.margin).toBe(m);
    }
    expect(generatePlay(rng, 10, { cover: '2B' }).cover).toBe('2B');
    expect(generatePlay(rng, 10, { cover: 'SS' }).cover).toBe('SS');
    expect(generatePlay(rng, 10, { margin: 0.2, style: 'wait' }).tag.style).toBe('wait');
    expect(generatePlay(rng, 10, { margin: 0.2, style: 'sweep' }).tag.style).toBe('sweep');
    expect(generatePlay(rng, 20, { wide: true }).wide).toBe(true);
  });

  it('ヘッドスライディングは 20 人目から、ほどよい割合で。手でベースに触れる', () => {
    const rng = mulberry32(21);
    let heads = 0;
    let n = 0;
    for (let k = 0; k < 400; k++) {
      const i = k % 40;
      const p = generatePlay(rng, i, {}, i);
      if (i < STAGE.headSlide) expect(p.runner.head).toBe(false);
      else {
        n++;
        if (p.runner.head) heads++;
      }
    }
    expect(heads / n).toBeGreaterThan(RUNNER.headRate - 0.12);
    expect(heads / n).toBeLessThan(RUNNER.headRate + 0.12);
    const p = generatePlay(rng, 25, { head: true });
    expect(p.runner.head).toBe(true);
    expect(p.runner.leadY).toBe(RUNNER.headHandY);
    expect(generatePlay(rng, 25, { head: false }).runner.head).toBe(false);
  });

  it('タッチをかわす走者は出さない（evadeRate = 0）。確認用に指定すれば、右手でベースの内野側の角に触れ、野手が追いかけて右腕に触れるプレーを作れる', () => {
    const rng = mulberry32(31);
    expect(RUNNER.evadeRate).toBe(0);
    for (let k = 0; k < 300; k++) expect(generatePlay(rng, k % 60, {}, 45).runner.evade).toBe(false);
    for (const margin of [0.03, -0.03, 0.15, -0.15]) {
      const p = generatePlay(rng, 40, { evade: true, margin }, 45);
      expect(p.runner.evade).toBe(true);
      expect(p.runner.head).toBe(true);
      expect(p.tag.style).toBe('chase');
      const a = worldToPath(leadPoint(p.runner, p.tArrive));
      expect(a.l).toBeGreaterThan(-0.19);
      expect(a.l).toBeLessThan(0);
      expect(p.tag.tReact!).toBeGreaterThanOrEqual(p.tCatch + TAG.chaseSet - 1e-9);
      expect(p.tag.tReact!).toBeGreaterThanOrEqual(p.runner.tSlide + TAG.chaseReact - 1e-9);
      expect(p.tTag - p.tag.tReact!).toBeGreaterThanOrEqual(TAG.chaseMin - 1e-9);
      expect(tagTarget(p, p.tTag).x).toBeCloseTo(p.tag.P.x, 9);
    }
  });

  it('送球がそれるのは 16 人目から', () => {
    const rng = mulberry32(21);
    for (let k = 0; k < 200; k++) expect(generatePlay(rng, k % STAGE.wideThrow).wide).toBe(false);
    let n = 0;
    for (let k = 0; k < 200; k++) if (generatePlay(rng, STAGE.wideThrow + k).wide) n++;
    expect(n).toBeGreaterThan(40);
  });

  it('ベースに入る野手の走り: 速さは途切れず、速すぎず、捕る前に着く', () => {
    const rng = mulberry32(77);
    for (let k = 0; k < 300; k++) {
      const p = generatePlay(rng, 3 + (k % 30));
      const fp = p.fp;
      expect(fp.v).toBeLessThanOrEqual(COVER_RUN.speed[1] + 1e-9);
      expect(coverDist(fp, fp.tGo)).toBeCloseTo(0, 9);
      expect(coverDist(fp, fp.tSet)).toBeCloseTo(fp.dist, 9);
      expect(fp.tSet).toBeLessThanOrEqual(p.tCatch - COVER_RUN.setBefore + 1e-9);
      // 1/120 秒ごとの速さ: 一定の速さを超えず、1コマで急に変わらない
      let prev = 0;
      for (let t = fp.tGo; t <= fp.tSet; t += 1 / 120) {
        const v = (coverDist(fp, t + 1 / 240) - coverDist(fp, t - 1 / 240)) * 120;
        expect(v).toBeLessThanOrEqual(fp.v + 1e-6);
        expect(Math.abs(v - prev)).toBeLessThan(0.25);
        prev = v;
      }
    }
  });

  it('グラブを置いて待つタッチは差の大きいアウトだけで、際どいプレーにならない', () => {
    let waits = 0;
    let closeOuts = 0;
    for (const correct of [0, 20, 50]) {
      const rng = mulberry32(300 + correct);
      for (let k = 0; k < 1500; k++) {
        const p = generatePlay(rng, STAGE.tutorial + (k % 30), {}, correct);
        if (p.tag.style === 'wait') {
          waits++;
          expect(p.category).toBe('clear');
          expect(p.close).toBe(false);
        }
        if (p.category !== 'clear' && !p.runner.evade) {
          // 際どい・中くらいは捕ってすぐ振り下ろす（タッチをかわす走者を追うタッチは除く）
          expect(p.tag.style).toBe('sweep');
          // 余分な間は、待つタッチになる長さに届かない（遠くで捕ったときは運ぶのにかかる時間だけ）
          const C = p.th.C;
          const P = p.tag.P;
          const durMin = TAG.minDur + Math.hypot(C.x - P.x, C.y - P.y, C.z - P.z) / TAG.sweepSpeed + (p.wide ? 0.08 : 0);
          expect(p.tTag - p.tCatch).toBeLessThan(Math.max(TAG.waitFrom, durMin + 1e-9));
          if (p.close && p.out) closeOuts++;
        }
      }
    }
    expect(waits).toBeGreaterThan(50);
    expect(closeOuts).toBeGreaterThan(200);
  });

  it('正解数の段階ごとに、際どい差の範囲と割合が表どおり', () => {
    for (const lv of LEVELS) {
      for (const correct of [lv.min, lv.min + 5]) {
        const rng = mulberry32(1000 + correct);
        let n = 0;
        let nClear = 0;
        let total = 0;
        const d = difficulty(correct);
        // 割合は ±0.05 で比べる（2000 プレーなら、偶然のずれは ±0.011 くらい）
        for (let k = 0; k < 2000; k++) {
          const p = generatePlay(rng, STAGE.tutorial + (k % 30), {}, correct);
          const a = Math.abs(p.margin);
          total++;
          // いちばん小さい差でも 1コマ（1/60 秒）くらい
          expect(a).toBeGreaterThanOrEqual(0.0165);
          expect(a).toBeGreaterThanOrEqual(lv.close[0] - 1e-12);
          expect(p.close).toBe(a <= lv.close[1]);
          if (p.close) n++;
          if (p.category === 'clear') {
            nClear++;
            expect(a).toBeGreaterThanOrEqual(d.clearMin - 1e-12);
          }
          if (!p.close) expect(a).toBeLessThanOrEqual(d.clearMin + d.clearWidth + 1e-12);
        }
        expect(n / total).toBeGreaterThan(lv.rate - 0.05);
        expect(n / total).toBeLessThan(lv.rate + 0.05);
        // はっきりしたプレーも、どの段階でも出る（残りの割合）
        const clearRate = 1 - lv.rate - lv.medium;
        expect(nClear / total).toBeGreaterThan(clearRate - 0.05);
        expect(nClear / total).toBeLessThan(clearRate + 0.05);
        expect(clearRate).toBeGreaterThanOrEqual(0.2 - 1e-9);
      }
    }
  });
});
