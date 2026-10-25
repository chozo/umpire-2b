// 1プレー（盗塁）の「正解」を決める。画面の動き・音・リプレイはすべてここで作った時刻と位置から作る。
// 判定: 走者の足がベースに触れた時刻 tArrive と、ボールを持ったグラブが走者に触れた時刻 tTag の差
//   margin = tArrive - tTag。正ならタッチが先（アウト）、負なら足が先（セーフ）。同時にはしない。

import {
  BAG_FACE_S,
  BAG_S,
  BATTERY,
  F,
  COVER_RUN,
  FIELDERS,
  GAME,
  HAND_FRONT,
  MOUND_HEIGHT,
  RUNNER,
  SHOE_FRONT,
  STAGE,
  TAG,
  U,
  difficulty,
  pathToWorld,
  type CoverId,
  type Vec3,
} from './config';

// 投手のリリース位置（actors.ts の投球フォームと合わせる）
export const PITCHER_BASE: Vec3 = { x: 0, y: MOUND_HEIGHT, z: -18.29 };
export const PITCH_RELEASE: Vec3 = { x: -0.35, y: MOUND_HEIGHT + 1.62, z: -18.29 + 1.25 };
// 捕手が投球を捕る位置（捕手は z = 0.8 で投手の方を向いてしゃがむ）
export const CATCHER_BASE: Vec3 = { x: 0, y: 0, z: 0.8 };
export const CATCHER_MITT: Vec3 = { x: -0.15, y: 0.72, z: 0.35 };
// 捕手が投げるときの立ち位置（一歩前へ）
export const CATCHER_THROW_BASE: Vec3 = { x: 0, y: 0, z: 0.4 };

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = () => number;
const range = (rng: Rng, [a, b]: [number, number]) => a + (b - a) * rng();
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (u: number) => {
  const k = clamp(u, 0, 1);
  return k * k * (3 - 2 * k);
};

// ---- 走者 ----

export type Plant = {
  s: number; // 足の中心（走路に沿った距離）
  l: number; // 足の中心（外野側への距離）
  foot: 'L' | 'R';
  len: number; // この一歩の歩幅
  bodyS: number; // 着地の瞬間の腰の位置
  liftS: number; // 足が離れるときの腰の位置
  t: number; // 着地の時刻
};

export type RunnerPlan = {
  V: number;
  tau: number;
  s0: number; // リード（腰の位置）
  l0: number;
  tStart: number; // 走り出す時刻
  sSlide: number; // 滑り始める腰の位置
  tSlide: number;
  vSlide: number;
  sTouch: number; // ベースに触れる瞬間の腰の位置
  tArrive: number;
  vArrive: number;
  afterDecel: number; // ベースに触れてからの減速（足か手がベースで止まる）
  head: boolean; // ヘッドスライディング（手でベースに触れる）。false なら足から滑る（左足で触れる）
  evade: boolean; // タッチをかわす（頭から飛び込みながら内野側へずれ、右手でベースの内野側の角に触れる。head も true）
  // ベースに触れる体の先（足から: 左の足首、ヘッドスライディング: 左手の中心）: 腰からの前の距離・横位置・高さ
  reach: number;
  leadL: number;
  leadY: number;
  sLeadTouch: number; // ベースに触れるときの、触れる体の先の位置（靴の先か指先がベースの面）
  plants: Plant[];
  stance: { L: { s: number; l: number }; R: { s: number; l: number } };
};

export const ANKLE_H = 0.08;
const FOOT_HALF_W = 0.11;
// スライディングで前に伸ばす足（左足）の横位置。腰より内野側
export const LEAD_FOOT_L = RUNNER.laneL - 0.12;

function accelS(r: { V: number; tau: number }, tau: number) {
  if (tau <= 0) return 0;
  return r.V * (tau - r.tau * (1 - Math.exp(-tau / r.tau)));
}
function accelV(r: { V: number; tau: number }, tau: number) {
  if (tau <= 0) return 0;
  return r.V * (1 - Math.exp(-tau / r.tau));
}

// 腰の位置（走路に沿った距離）
export function runnerS(r: RunnerPlan, t: number) {
  if (t <= r.tStart) return r.s0;
  if (t <= r.tSlide) return r.s0 + accelS(r, t - r.tStart);
  if (t <= r.tArrive) {
    const tau = t - r.tSlide;
    return r.sSlide + r.vSlide * tau - 0.5 * RUNNER.slideDecel * tau * tau;
  }
  const d = Math.min(t - r.tArrive, r.vArrive / r.afterDecel);
  return r.sTouch + r.vArrive * d - 0.5 * r.afterDecel * d * d;
}

// 腰が s に来る時刻（走っている間だけ使う）
export function runnerTimeAtS(r: Pick<RunnerPlan, 'V' | 'tau' | 's0' | 'tStart'>, s: number) {
  if (s <= r.s0) return r.tStart;
  let lo = 0;
  let hi = 12;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (r.s0 + accelS(r, mid) < s) lo = mid;
    else hi = mid;
  }
  return r.tStart + (lo + hi) / 2;
}

// 腰の横位置
export function runnerL(r: RunnerPlan, s: number) {
  return r.l0 + (RUNNER.laneL - r.l0) * smooth((s - r.s0) / 5);
}

// スライディングの姿勢になっている割合（0 = 走る姿勢、1 = 滑る姿勢）
export function slideAmount(r: RunnerPlan, t: number) {
  return smooth((t - r.tSlide) / RUNNER.slideDrop);
}

// 滑っている間の腰の横位置。タッチをかわす走者は、滑り始めてから内野側へずれる
export function slideL(r: RunnerPlan, t: number) {
  if (!r.evade) return RUNNER.laneL;
  return RUNNER.laneL + (RUNNER.evadeL - RUNNER.laneL) * smooth((t - r.tSlide) / RUNNER.evadeVeer);
}

// 滑っている間の、ベースに触れる体の先（足から: 前に伸ばした左足の足首、ヘッドスライディング: 前に伸ばした左手、
// かわす走者: 伸ばした右手）。ベースに触れたあとはベースの面で止まる
export function leadPoint(r: RunnerPlan, t: number): Vec3 {
  const s = Math.min(runnerS(r, t) + r.reach, r.sLeadTouch);
  const l = r.evade ? slideL(r, t) + (r.leadL - RUNNER.evadeL) : r.leadL;
  return pathToWorld(s, l, r.leadY);
}

// ベースに触れる体の先の先端（靴の先か指先）
export function leadFront(r: RunnerPlan, t: number): Vec3 {
  const a = leadPoint(r, t);
  if (r.head) return { x: a.x + F.x * HAND_FRONT, y: a.y + 0.05, z: a.z + F.z * HAND_FRONT }; // 待つグラブは指先の前の地面すれすれ
  return { x: a.x + F.x * SHOE_FRONT, y: 0.13, z: a.z + F.z * SHOE_FRONT };
}

function stepLen(d: number) {
  return 0.9 + 1.25 * clamp(d / 10, 0, 1);
}

export function makeRunner(V: number, s0: number, tStart: number, touchTime: number, head = false, evade = false): RunnerPlan {
  if (evade) head = true;
  const tau = RUNNER.accelTau;
  const base = { V, tau, s0, tStart };
  const reach = evade ? RUNNER.evadeReach : head ? RUNNER.headReach : RUNNER.slideReach;
  const sLeadTouch = BAG_FACE_S - (head ? HAND_FRONT : SHOE_FRONT);
  const sTouch = sLeadTouch - reach;
  const a = RUNNER.slideDecel;
  // 滑り始める位置: そこでの速さで、touchTime 秒後にちょうどベースに触れるように（繰り返して合わせる）
  let sSlide = sTouch - V * touchTime;
  let tSlide = tStart;
  let vSlide = V;
  for (let i = 0; i < 8; i++) {
    tSlide = runnerTimeAtS(base, sSlide);
    vSlide = accelV(base, tSlide - tStart);
    sSlide = sTouch - (vSlide * touchTime - 0.5 * a * touchTime * touchTime);
  }
  tSlide = runnerTimeAtS(base, sSlide);
  vSlide = accelV(base, tSlide - tStart);
  // 滑った距離がぴったり sTouch になる時刻（2次方程式）
  const ds = sTouch - sSlide;
  const disc = Math.max(0, vSlide * vSlide - 2 * a * ds);
  const tt = (vSlide - Math.sqrt(disc)) / a;
  const tArrive = tSlide + tt;
  const vArrive = vSlide - a * tt;
  const r: RunnerPlan = {
    V,
    tau,
    s0,
    l0: 0.35,
    tStart,
    sSlide,
    tSlide,
    vSlide,
    sTouch,
    tArrive,
    vArrive,
    // ベースに触れてから腰が進む距離（かわす走者はベースの角をつかんで止まるので短い）
    afterDecel: (vArrive * vArrive) / (2 * (evade ? RUNNER.evadeAfter : RUNNER.slideAfter)),
    head,
    evade,
    reach,
    leadL: evade ? RUNNER.evadeHandL : head ? RUNNER.laneL + RUNNER.headHandL : LEAD_FOOT_L,
    leadY: head ? RUNNER.headHandY : RUNNER.slideAnkleY,
    sLeadTouch,
    plants: [],
    stance: { L: { s: s0 - 0.42, l: 0.35 }, R: { s: s0 + 0.42, l: 0.35 } },
  };
  // 走る足の着地点: 最初の一歩は左足のクロスオーバー。滑り始めの少し先まで並べる
  let p = s0 + 0.55;
  let foot: 'L' | 'R' = 'L';
  let len = 0.97;
  for (let k = 0; k < 40; k++) {
    const bodyS = p - RUNNER.footAheadFrac * len;
    const bl = runnerL(r, bodyS);
    r.plants.push({
      s: p,
      l: bl + (foot === 'L' ? -FOOT_HALF_W : FOOT_HALF_W),
      foot,
      len,
      bodyS,
      liftS: p + RUNNER.liftFrac * len,
      t: runnerTimeAtS(base, bodyS),
    });
    if (bodyS > sSlide) break;
    len = stepLen(p - s0);
    p += len;
    foot = foot === 'L' ? 'R' : 'L';
  }
  return r;
}

// ---- 投球・送球 ----

export type Throw = { R: Vec3; C: Vec3; tRelease: number; tCatch: number };
export const GRAVITY = 9.8;

export function throwPos(th: Throw, t: number, g = GRAVITY): Vec3 {
  const T = th.tCatch - th.tRelease;
  const tau = clamp(t - th.tRelease, 0, T);
  const u = tau / T;
  return {
    x: th.R.x + (th.C.x - th.R.x) * u,
    y: th.R.y + (th.C.y - th.R.y) * u + 0.5 * g * tau * (T - tau),
    z: th.R.z + (th.C.z - th.R.z) * u,
  };
}

// ---- 1プレー ----

export type Category = 'clear' | 'medium' | 'close';

// タッチの仕方: sweep = 捕ってからグラブを走者の脚へ下ろす / wait = グラブを足の前に置き、足が滑り込んでくる /
// chase = グラブをベースの前に置いて待つが、走者がかわすので追いかけて右腕に触れる
export type TagStyle = 'sweep' | 'wait' | 'chase';

export type TagPlan = {
  t: number;
  style: TagStyle;
  P: Vec3; // タッチの瞬間に触れる点（グラブの手の位置）
  P0?: Vec3; // chase: 最初にグラブを置いて待つ点（ベースの前の走路の上）
  tReact?: number; // chase: 追い始める時刻
};

export type CoverPlan = {
  id: CoverId;
  P0: Vec3; // 定位置
  tGo: number; // ベースへ走り出す時刻
  tSet: number; // ベースに着く時刻
  dist: number; // 走る距離
  v: number; // 一定の速さ
};

// ベースに入る野手が、走り出してから進んだ距離（加速・一定・減速。速さは途切れない）
export function coverDist(fp: CoverPlan, t: number) {
  const { accel: ta, decel: td } = COVER_RUN;
  const T = fp.tSet - fp.tGo;
  const v = fp.v;
  const u = clamp(t - fp.tGo, 0, T);
  if (u < ta) return (0.5 * v * u * u) / ta;
  if (u < T - td) return v * (u - ta / 2);
  const w = T - u;
  return fp.dist - (0.5 * v * w * w) / td;
}

export type Play = {
  index: number;
  cover: CoverId;
  margin: number;
  out: boolean;
  category: Category;
  close: boolean;
  wide: boolean; // 送球がそれた
  tMove: number; // 投手が動き出す
  tPitch: number; // 投球のリリース
  tCatcher: number; // 捕手が捕る
  pitchFrom: Vec3;
  runner: RunnerPlan;
  th: Throw;
  tag: TagPlan;
  fp: CoverPlan;
  tCatch: number; // ベースに入った野手が捕る
  tTag: number;
  tArrive: number;
  requestRoll: number;
};

export const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);
// yaw の向き: 前 = (sin, 0, cos)、右 = (-cos, 0, sin)
export const fwdOf = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
export const rightOf = (yaw: number) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });

// 投げる手（右手）のリリース位置。投げる人の向きと立ち位置に対する位置（右・上・前）
export const RELEASE_LOCAL = { x: 0.24, y: 1.72, z: 0.42 };

export function localToWorld(base: Vec3, yaw: number, l: { x: number; y: number; z: number }): Vec3 {
  const f = fwdOf(yaw);
  const r = rightOf(yaw);
  return { x: base.x + r.x * l.x + f.x * l.z, y: base.y + l.y, z: base.z + r.z * l.x + f.z * l.z };
}

// スイープのタッチで触れる点: 足から滑るときは前に伸ばした左足のすね（足首から腰の方へ少し戻った上の面）、
// ヘッドスライディングは前に伸ばした左腕（手から肩の方へ戻った上の面）
export function sweepPoint(r: RunnerPlan, t: number): Vec3 {
  const a = leadPoint(r, t);
  const ps = runnerS(r, t);
  if (r.evade) {
    // かわす走者: 伸ばした右腕（右手から右肩の方へ戻った上の面）
    const sh = pathToWorld(ps + 0.44, slideL(r, t) + 0.19, RUNNER.headShoulderY);
    const dx = sh.x - a.x;
    const dz = sh.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    const k = RUNNER.evadeTagK;
    return { x: a.x + (dx / d) * k, y: a.y + ((sh.y - a.y) / d) * k + 0.06, z: a.z + (dz / d) * k };
  }
  if (r.head) {
    const sh = pathToWorld(ps + 0.44, r.leadL - 0.02, RUNNER.headShoulderY);
    const dx = sh.x - a.x;
    const dz = sh.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    // 手から肩の方へ k（肘の少し先の上腕）。手に近すぎると、振り下ろすグラブと腕が手を隠す
    const k = RUNNER.headTagK;
    return { x: a.x + (dx / d) * k, y: a.y + ((sh.y - a.y) / d) * k + 0.06, z: a.z + (dz / d) * k };
  }
  const hip = pathToWorld(ps, LEAD_FOOT_L + 0.04, RUNNER.slidePelvisY - 0.05);
  const dx = hip.x - a.x;
  const dz = hip.z - a.z;
  const d = Math.hypot(dx, dz) || 1;
  const k = 0.17;
  const rise = ((hip.y - a.y) / d) * k;
  return { x: a.x + (dx / d) * k, y: a.y + rise + 0.062, z: a.z + (dz / d) * k };
}

// タッチの瞬間までのグラブの目標（sweep は走者と一緒に動く脚の上の点、wait は止まった点）
export function tagTarget(p: Play, t: number): Vec3 {
  return p.tag.style === 'wait' ? p.tag.P : sweepPoint(p.runner, t);
}

// correct: このゲームでここまでに正しく判定できた数。際どさの範囲と割合が決まる（config.ts の LEVELS）
export function pickMargin(
  rng: Rng,
  index: number,
  forced?: Partial<{ margin: number; category: Category; out: boolean }>,
  correct = index,
) {
  const d = difficulty(correct);
  if (forced?.margin !== undefined) {
    const m = forced.margin;
    const a = Math.abs(m);
    return { margin: m, closeMax: d.closeMax, category: (a <= d.closeMax ? 'close' : a < d.mediumMax ? 'medium' : 'clear') as Category };
  }
  let out = rng() < 0.5;
  if (forced?.out !== undefined) out = forced.out;
  let category: Category;
  if (forced?.category) category = forced.category;
  else if (index < STAGE.tutorial) category = 'clear';
  else {
    const r = rng();
    category = r < d.pClose ? 'close' : r < d.pClose + d.pMedium ? 'medium' : 'clear';
  }
  let mag: number;
  if (category === 'close') mag = d.closeMin + (d.closeMax - d.closeMin) * rng();
  else if (category === 'medium') mag = d.mediumMin + (d.mediumMax - d.mediumMin) * rng();
  else if (index < STAGE.tutorial) mag = 0.3 + 0.2 * rng();
  else mag = d.clearMin + d.clearWidth * rng();
  return { margin: out ? mag : -mag, closeMax: d.closeMax, category };
}

export type Force = Partial<{
  margin: number;
  category: Category;
  out: boolean;
  cover: CoverId;
  wide: boolean;
  style: TagStyle;
  head: boolean; // ヘッドスライディング
  evade: boolean; // タッチをかわす
}>;

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ベースに入った野手の、送球を受ける構えの足と腰（世界座標）。走者の滑ってくる走路の外野側・ベースの先に立つ
export const RECEIVE = {
  lFoot: pathToWorld(BAG_S - 0.02, 0.46, ANKLE_H),
  rFoot: pathToWorld(BAG_S + 0.58, -0.02, ANKLE_H),
  pelvis: pathToWorld(BAG_S + 0.3, 0.3, 0.9),
};

export function generatePlay(rng: Rng, index: number, force: Force = {}, correct = index): Play {
  const { margin, category, closeMax } = pickMargin(rng, index, force, correct);
  const tMove = GAME.tMove;
  const pitchFrom: Vec3 = { ...PITCH_RELEASE };
  const pitchDist = dist3(pitchFrom, CATCHER_MITT);
  const wideStage = index >= STAGE.wideThrow;

  // タッチをかわす走者（いまは RUNNER.evadeRate = 0 で出さない。出さないときは乱数を使わず、ほかのプレーの作り方を変えない）。
  // プレーごとに一度だけ決める。時間の条件が合わないときは、かわさないプレーにする
  const evadeWanted = force.evade ?? (RUNNER.evadeRate > 0 && index >= STAGE.evade && rng() < RUNNER.evadeRate);
  for (let attempt = 0; attempt < 4000; attempt++) {
    const relax = Math.floor(attempt / 800); // 見つからないときは条件をゆるめる
    const evade = evadeWanted && (force.evade === true || attempt < 2400);
    const cover: CoverId = force.cover ?? (rng() < 0.55 ? 'SS' : '2B');
    const wide = force.wide ?? (wideStage && rng() < 0.4);
    // 走者
    // 見つからないときは、走者のスタートを遅く・足を遅くする（大きな差のアウトのため）
    const V = range(rng, [RUNNER.topSpeed[0] - 0.25 * relax, RUNNER.topSpeed[1]]);
    const s0 = range(rng, RUNNER.lead);
    const jump = range(rng, [RUNNER.jump[0], RUNNER.jump[1] + 0.06 * relax]);
    // 大きな差でアウトになるプレーは、早めに滑り込む（タッチの瞬間にはスライディングの姿勢になっている）
    let touchTime = range(rng, RUNNER.slideTouchTime);
    if (margin > 0) touchTime = Math.max(touchTime, margin + RUNNER.slideDrop + 0.14);
    if (touchTime > 1.05) continue;
    // 20人目からは、ヘッドスライディングもする
    const head = evade || (force.head ?? (index >= STAGE.headSlide && rng() < RUNNER.headRate));
    const runner = makeRunner(V, s0, tMove + jump, touchTime, head, evade);
    const tArrive = runner.tArrive;
    const tTag = tArrive - margin;
    if (tTag < runner.tSlide + RUNNER.slideDrop + 0.08) continue;

    // 送球を受ける位置（ベースの本塁側の、野手の前）
    const toHome = { x: -RECEIVE.pelvis.x, z: -RECEIVE.pelvis.z };
    const dh = Math.hypot(toHome.x, toHome.z);
    const hx = toHome.x / dh;
    const hz = toHome.z / dh;
    const lat = wide ? (rng() < 0.5 ? -1 : 1) * range(rng, [0.55, 1.1]) : range(rng, [-0.3, 0.3]);
    const fwd = range(rng, [0.35, 0.55]);
    const cy = wide ? (rng() < 0.5 ? range(rng, [0.25, 0.5]) : range(rng, [1.6, 2.0])) : range(rng, [0.7, 1.45]);
    const C: Vec3 = {
      x: RECEIVE.pelvis.x + hx * fwd - hz * lat,
      y: cy,
      z: RECEIVE.pelvis.z + hz * fwd + hx * lat,
    };

    // タッチ: 捕ってからグラブを運ぶ時間
    const sweepP = sweepPoint(runner, tTag);
    const waitP = leadFront(runner, tTag);
    let style: TagStyle = 'sweep';
    let P = sweepP;
    const durMin = TAG.minDur + dist3(C, sweepP) / TAG.sweepSpeed + (wide ? 0.08 : 0);
    let extra = range(rng, TAG.extra);
    // 際どい・中くらいのプレーは、捕ってすぐ振り下ろすタッチにする（待てるほどの余裕を見せない）
    if (category !== 'clear') extra = Math.min(extra, Math.max(0, TAG.waitFrom - 0.04 - durMin));
    let dur = durMin + extra;
    // アウトで捕ってからタッチまで長いときは、グラブを足の前に置いて待つ。
    // 待っているところへ滑り込むのは見るからにアウトなので、待つタッチは差の大きい（clear）アウトだけに使う
    const canWait = margin > 0 && category === 'clear';
    if (force.style === 'wait' && canWait) {
      style = 'wait';
      P = waitP;
      dur = Math.max(dur, TAG.waitFrom + range(rng, [0, 0.25]));
    } else if (force.style !== 'sweep' && canWait && dur >= TAG.waitFrom) {
      style = 'wait';
      P = waitP;
    }
    if (force.style === 'wait' && style !== 'wait') continue;
    // タッチをかわす走者: 野手は早めに捕ってベースの前にグラブを置き、走者がずれたら追いかける（差はどの大きさでもよい）
    let G0: Vec3 | undefined;
    let tReact: number | undefined;
    if (evade) {
      style = 'chase';
      P = sweepPoint(runner, tTag);
      dur = range(rng, TAG.chaseDur);
      G0 = pathToWorld(BAG_FACE_S - 0.3, RUNNER.laneL - 0.05, 0.16);
      tReact = Math.max(tTag - dur + TAG.chaseSet, runner.tSlide + TAG.chaseReact);
      if (tTag - tReact < TAG.chaseMin) continue;
    }
    const tCatch = tTag - dur;
    // 送球
    const vt = range(rng, BATTERY.throwSpeed);
    // 投げる向き: 捕球点へ
    const faceThrow = yawOf(C.x - CATCHER_THROW_BASE.x, C.z - CATCHER_THROW_BASE.z);
    const R = localToWorld(CATCHER_THROW_BASE, faceThrow, RELEASE_LOCAL);
    const T = dist3(R, C) / vt;
    const tRelease = tCatch - T;
    // 投球: 投手が動いてから投げるまで（delivery）と、捕手が捕ってから投げるまで（exchange）の和が決まる
    const vp = range(rng, BATTERY.pitchSpeed);
    const Tp = pitchDist / vp;
    const need = tRelease - tMove - Tp;
    const exMin = BATTERY.exchange[0];
    const exMax = BATTERY.exchange[1] + 0.1 * relax;
    const dlMin = BATTERY.delivery[0] - 0.05 * relax;
    const dlMax = BATTERY.delivery[1] + 0.1 * relax;
    if (need < exMin + dlMin || need > exMax + dlMax) continue;
    const lo = Math.max(dlMin, need - exMax);
    const hi = Math.min(dlMax, need - exMin);
    const delivery = lo + (hi - lo) * rng();
    const tPitch = tMove + delivery;
    const tCatcher = tPitch + Tp;
    // ベースに入る野手が、捕るより前に着ける
    const P0: Vec3 = { x: FIELDERS[cover].pos.x, y: 0, z: FIELDERS[cover].pos.z };
    const tGo = tPitch + COVER_RUN.go;
    const runD = Math.hypot(RECEIVE.pelvis.x - P0.x, RECEIVE.pelvis.z - P0.z);
    const ramp = (COVER_RUN.accel + COVER_RUN.decel) / 2;
    let vRun = runD / (tCatch - COVER_RUN.setBefore - tGo - ramp);
    if (vRun <= 0 || vRun > COVER_RUN.speed[1]) continue;
    vRun = Math.max(vRun, COVER_RUN.speed[0]);
    const tSet = tGo + runD / vRun + ramp;
    return {
      index,
      cover,
      margin,
      out: margin > 0,
      category,
      // 際どいかどうかは差の大きさで決める（待つタッチは clear だけなので、際どいことはない。かわす走者を追うタッチは際どいこともある）
      close: style !== 'wait' && Math.abs(margin) <= closeMax,
      wide,
      tMove,
      tPitch,
      tCatcher,
      pitchFrom,
      runner,
      th: { R, C, tRelease, tCatch },
      tag: { t: tTag, style, P, P0: G0, tReact },
      fp: { id: cover, P0, tGo, tSet, dist: runD, v: vRun },
      tCatch,
      tTag,
      tArrive,
      requestRoll: rng(),
    };
  }
  throw new Error('generatePlay: no solution');
}

// 投球（投手 → 捕手）
export function pitchPos(p: Play, t: number): Vec3 {
  const T = p.tCatcher - p.tPitch;
  const u = clamp((t - p.tPitch) / T, 0, 1);
  const M = CATCHER_MITT;
  const tau = u * T;
  return {
    x: p.pitchFrom.x + (M.x - p.pitchFrom.x) * u,
    y: p.pitchFrom.y + (M.y - p.pitchFrom.y) * u + 0.5 * GRAVITY * 0.5 * tau * (T - tau),
    z: p.pitchFrom.z + (M.z - p.pitchFrom.z) * u,
  };
}

// ボールの位置と、誰が持っているか
export type BallState = { pos: Vec3; phase: 'held' | 'pitch' | 'catcher' | 'throw' | 'caught' };
export function ballAt(p: Play, t: number): BallState {
  if (t < p.tPitch) return { pos: p.pitchFrom, phase: 'held' };
  if (t < p.tCatcher) return { pos: pitchPos(p, t), phase: 'pitch' };
  if (t < p.th.tRelease) return { pos: CATCHER_MITT, phase: 'catcher' };
  if (t < p.th.tCatch) return { pos: throwPos(p.th, t), phase: 'throw' };
  return { pos: p.th.C, phase: 'caught' };
}

// 着地点（世界座標）
export function plantWorld(pl: Plant): Vec3 {
  return pathToWorld(pl.s, pl.l, ANKLE_H);
}

export { U };
