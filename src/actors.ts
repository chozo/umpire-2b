import * as THREE from 'three';
import { BAG_FACE_S, F, FIELDERS, FIRST_BASE, RUNNER, SECOND_BASE, TAG, U, moundY, pathToWorld, worldToPath, type CoverId, type Vec3 } from './config';
import {
  FOREARM,
  Figure,
  UPPER_ARM,
  localToRig,
  newPose,
  sampleKeys,
  type LocalPose,
  type Look,
  type RigPose,
} from './figure';
import {
  ANKLE_H,
  CATCHER_BASE,
  CATCHER_THROW_BASE,
  PITCHER_BASE,
  RECEIVE,
  RELEASE_LOCAL,
  ballAt,
  coverDist,
  fwdOf,
  LEAD_FOOT_L,
  leadPoint,
  slideL,
  leadFront,
  rightOf,
  runnerL,
  runnerS,
  slideAmount,
  tagTarget,
  yawOf,
  type Play,
  type Plant,
} from './play';

const V = THREE.Vector3;
type V3 = THREE.Vector3;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (u: number) => {
  const k = clamp(u, 0, 1);
  return k * k * (3 - 2 * k);
};
const angLerp = (a: number, b: number, u: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * u;
};

// 世界座標の姿勢どうしを補間する
// figure.ts の既定の肘の向き（後ろ下・外）と同じ
function defaultPole(p: RigPose, side: 'l' | 'r') {
  const fw = fwdOf(p.yaw);
  const rt = rightOf(p.yaw);
  const s = side === 'l' ? -1 : 1;
  return new V(-0.6 * fw.x + 0.35 * s * rt.x, -0.5, -0.6 * fw.z + 0.35 * s * rt.z);
}
function lerpPole(a: RigPose, b: RigPose, side: 'l' | 'r', u: number) {
  const pa = side === 'l' ? a.lElbowPole : a.rElbowPole;
  const pb = side === 'l' ? b.lElbowPole : b.rElbowPole;
  if (!pa && !pb) return null;
  if (u <= 0) return pa;
  if (u >= 1) return pb;
  const va = (pa ?? defaultPole(a, side)).clone().normalize();
  const vb = (pb ?? defaultPole(b, side)).clone().normalize();
  return va.lerp(vb, u);
}

export function lerpRig(a: RigPose, b: RigPose, u: number, out: RigPose) {
  out.pelvis.lerpVectors(a.pelvis, b.pelvis, u);
  out.yaw = angLerp(a.yaw, b.yaw, u);
  out.lean = a.lean + (b.lean - a.lean) * u;
  out.side = a.side + (b.side - a.side) * u;
  out.twist = a.twist + (b.twist - a.twist) * u;
  out.headYaw = a.headYaw + (b.headYaw - a.headYaw) * u;
  out.headPitch = a.headPitch + (b.headPitch - a.headPitch) * u;
  out.lFoot.lerpVectors(a.lFoot, b.lFoot, u);
  out.rFoot.lerpVectors(a.rFoot, b.rFoot, u);
  out.lFootYaw = angLerp(Number.isNaN(a.lFootYaw) ? a.yaw : a.lFootYaw, Number.isNaN(b.lFootYaw) ? b.yaw : b.lFootYaw, u);
  out.rFootYaw = angLerp(Number.isNaN(a.rFootYaw) ? a.yaw : a.rFootYaw, Number.isNaN(b.rFootYaw) ? b.yaw : b.rFootYaw, u);
  out.lToe = a.lToe + (b.lToe - a.lToe) * u;
  out.rToe = a.rToe + (b.rToe - a.rToe) * u;
  out.lHand.lerpVectors(a.lHand, b.lHand, u);
  out.rHand.lerpVectors(a.rHand, b.rHand, u);
  // 肘の向き: 片方が null（既定の後ろ下・外）でも、既定の向きに直して補間する（途中で切り替わって跳ばない）
  out.lElbowPole = lerpPole(a, b, 'l', u);
  out.rElbowPole = lerpPole(a, b, 'r', u);
  out.bat = u < 0.5 ? a.bat : b.bat;
  out.gloveDir = a.gloveDir && b.gloveDir ? new V().lerpVectors(a.gloveDir, b.gloveDir, u) : u < 0.5 ? a.gloveDir : b.gloveDir;
  out.kneeDown = (a.kneeDown ?? 0) + ((b.kneeDown ?? 0) - (a.kneeDown ?? 0)) * u;
  return out;
}

// ---- チームの見た目 ----
export const HOME: Look = { jersey: 0xf2f1ea, pants: 0xf2f1ea, cap: 0x1d2a4f, socks: 0x1d2a4f, glove: 'L' };
export const AWAY: Look = { jersey: 0x8f97a4, pants: 0x8f97a4, cap: 0xb3262e, socks: 0xb3262e, helmet: true };
const UMP: Look = { jersey: 0x1c2333, pants: 0x5b616e, cap: 0x111827, socks: 0x111827, kind: 'umpire' };

// ---- キーフレーム（x = 右、y = 上、z = 前） ----
type P3 = [number, number, number];
const L = (o: Partial<LocalPose> & { p: P3; lf: P3; rf: P3; lh: P3; rh: P3 }): LocalPose => ({
  lean: 0,
  side: 0,
  twist: 0,
  hy: 0,
  hp: 0,
  ...o,
});

const STAND = L({ p: [0, 0.95, 0], lean: 0.05, lf: [-0.13, 0.08, 0], rf: [0.13, 0.08, 0], lh: [-0.24, 0.8, 0.06], rh: [0.24, 0.8, 0.06] });
const READY = L({
  p: [0, 0.8, 0],
  lean: 0.5,
  hp: -0.45,
  lf: [-0.33, 0.08, 0.05],
  rf: [0.33, 0.08, 0.05],
  lh: [-0.17, 0.6, 0.42],
  rh: [0.17, 0.6, 0.42],
});
// 走者のリード（投手の方を向いて腰を落とす）
const LEAD = L({
  p: [0, 0.78, 0],
  lean: 0.42,
  hp: -0.3,
  lf: [-0.42, 0.08, 0.02],
  rf: [0.42, 0.08, 0.02],
  lh: [-0.3, 0.62, 0.3],
  rh: [0.3, 0.62, 0.3],
});
const R = RELEASE_LOCAL;
const THROW_KEYS: [number, LocalPose][] = [
  [-0.32, L({ p: [0, 0.9, -0.1], lean: 0.15, twist: -0.9, hy: 0.6, lf: [-0.15, 0.08, 0.25], rf: [0.15, 0.08, -0.35], lh: [-0.05, 1.25, 0.25], rh: [0.05, 1.2, 0.2] })],
  [
    -0.13,
    L({ p: [0, 0.87, 0.12], lean: 0.05, side: 0.15, twist: -1.0, hy: 0.9, lf: [-0.1, 0.14, 0.72], rf: [0.12, 0.08, -0.35], lh: [-0.25, 1.35, 0.55], rh: [0.42, 1.55, -0.42] }),
  ],
  [0, L({ p: [0, 0.84, 0.3], lean: 0.45, side: -0.1, twist: 0.5, hy: -0.3, lf: [-0.12, 0.08, 0.75], rf: [0.15, 0.15, -0.3], lh: [-0.3, 0.95, 0.25], rh: [R.x, R.y, R.z] })],
  [0.22, L({ p: [0, 0.75, 0.45], lean: 0.85, twist: 0.7, hy: -0.5, lf: [-0.12, 0.08, 0.75], rf: [0.25, 0.32, -0.1], lh: [-0.35, 0.75, 0.3], rh: [-0.25, 0.7, 0.65] })],
  [0.75, L({ p: [0, 0.93, 0.45], lean: 0.1, lf: [-0.15, 0.08, 0.7], rf: [0.2, 0.08, 0.3], lh: [-0.24, 0.85, 0.5], rh: [0.24, 0.82, 0.5] })],
];

// 右投手のセットポジションからの投球（t = 0 がリリース）。立ち位置の向き = 本塁。
// 動き出し（-1.2）からリリースまでの時間は、プレーごとのクイックの速さに合わせて縮める
const PITCH_KEYS: [number, LocalPose][] = [
  [-1.2, L({ yo: -1.57, p: [0, 0.95, 0], lean: 0.05, hy: 1.4, lf: [0, 0.08, 0.22], rf: [0, 0.08, -0.15], lh: [0.24, 1.22, 0.02], rh: [0.24, 1.2, -0.02] })],
  [-0.6, L({ yo: -1.7, p: [0, 0.96, -0.05], lean: 0, hy: 1.5, lf: [0.05, 0.32, 0.08], rf: [0, 0.08, -0.15], lh: [0.24, 1.25, 0.0], rh: [0.24, 1.22, -0.04] })],
  [-0.22, L({ yo: -1.2, p: [0, 0.85, 0.35], lean: 0.05, twist: -0.6, hy: 1.1, lf: [-0.15, 0.04, 1.0], rf: [0, 0.08, -0.15], lh: [-0.1, 1.35, 0.9], rh: [0.55, 1.5, -0.45] })],
  [0, L({ p: [0, 0.8, 0.65], lean: 0.55, twist: 0.4, lf: [-0.18, 0.03, 1.05], rf: [0.12, 0.16, -0.1], lh: [-0.3, 1.0, 0.6], rh: [0.35, 1.62, 1.25] })],
  [0.3, L({ p: [0, 0.7, 0.85], lean: 0.9, twist: 0.6, hp: -0.4, lf: [-0.18, 0.03, 1.05], rf: [0.2, 0.3, 0.3], lh: [-0.35, 0.8, 0.6], rh: [-0.3, 0.6, 1.1] })],
  [0.8, L({ p: [0, 0.82, 1.0], lean: 0.4, hp: -0.4, lf: [-0.3, 0.03, 1.0], rf: [0.3, 0.03, 0.9], lh: [-0.18, 0.62, 1.4], rh: [0.18, 0.62, 1.4] })],
];

// 右打者の構え（立ち位置の向き = 本塁ベース側）。盗塁のプレーでは見送る
const BAT_STANCE = L({ p: [0.05, 0.9, -0.05], lean: 0.2, hy: 1.2, lf: [-0.32, 0.08, 0], rf: [0.3, 0.08, 0.02], lh: [0.12, 1.28, 0.15], rh: [0.15, 1.34, 0.12], bat: [0.35, 0.85, -0.3] });
const BAT_TAKE = L({ p: [0.12, 0.92, -0.02], lean: 0.12, hy: 1.0, lf: [-0.3, 0.08, 0], rf: [0.36, 0.08, 0.02], lh: [0.18, 1.3, 0.1], rh: [0.2, 1.36, 0.08], bat: [0.2, 0.95, -0.25] });

const CROUCH_C = L({ p: [0, 0.5, 0], lean: 0.3, lf: [-0.3, 0.08, 0.12], rf: [0.3, 0.08, 0.12], lh: [-0.15, 0.72, 0.45], rh: [0.2, 0.5, 0.25] });
const CROUCH_U = L({ p: [0, 0.75, 0], lean: 0.45, hp: -0.4, lf: [-0.3, 0.08, 0.0], rf: [0.3, 0.08, -0.05], lh: [-0.2, 0.55, 0.3], rh: [0.2, 0.55, 0.3] });
const SIT = L({ p: [0, 0.5, 0], lean: 0.12, lf: [-0.15, 0.08, 0.42], rf: [0.15, 0.08, 0.42], lh: [-0.16, 0.55, 0.32], rh: [0.16, 0.55, 0.32] });
const RAIL = L({ p: [0, 0.95, 0], lean: 0.2, lf: [-0.14, 0.08, -0.05], rf: [0.14, 0.08, 0.05], lh: [-0.22, 1.0, 0.38], rh: [0.22, 1.0, 0.38] });

// 監督のリクエスト（両手で四角＝モニターを描く）。c = 演出の経過時間
const REQ_KEYS: [number, LocalPose][] = [
  [0.9, STAND],
  [1.25, L({ p: [0, 0.95, 0], lean: 0.02, lf: [-0.14, 0.08, 0], rf: [0.14, 0.08, 0], lh: [-0.05, 1.6, 0.42], rh: [0.05, 1.6, 0.42] })],
  [1.55, L({ p: [0, 0.95, 0], lean: 0.02, lf: [-0.14, 0.08, 0], rf: [0.14, 0.08, 0], lh: [-0.36, 1.6, 0.4], rh: [0.36, 1.6, 0.4] })],
  [1.85, L({ p: [0, 0.95, 0], lean: 0.02, lf: [-0.14, 0.08, 0], rf: [0.14, 0.08, 0], lh: [-0.36, 1.17, 0.4], rh: [0.36, 1.17, 0.4] })],
  [2.15, L({ p: [0, 0.95, 0], lean: 0.02, lf: [-0.14, 0.08, 0], rf: [0.14, 0.08, 0], lh: [-0.05, 1.17, 0.42], rh: [0.05, 1.17, 0.42] })],
  [2.6, L({ p: [0, 0.95, 0], lean: 0.02, lf: [-0.14, 0.08, 0], rf: [0.14, 0.08, 0], lh: [-0.05, 1.17, 0.42], rh: [0.05, 1.17, 0.42] })],
  [3.0, STAND],
];
export const REQ_DRAW = { from: 1.25, to: 2.15, end: 3.0 };

// 走る姿勢（その場の足踏み。phase は歩幅に合わせて進める）
// 走る脚: phase = 進んだ距離 / 半歩（half）× π。1周（2π）で左右1歩ずつ進む。
// 地面についている半周は、足が地面に止まる（腰に対して腰の進む速さで後ろへ動く）。残りの半周で前へ振り出す
function stride(phase: number, half: number) {
  const c = (((phase / (2 * Math.PI)) % 1) + 1) % 1;
  const A = half / 2;
  if (c < 0.5) return { z: A * (1 - 4 * c), lift: 0 };
  const w = 2 * c - 1;
  return { z: -A + 2 * A * smooth(w), lift: Math.sin(Math.PI * w) };
}
function runLocal(phase: number, amp: number, half = 0.85): LocalPose {
  const c = Math.cos(phase);
  const l = stride(phase, half);
  const r = stride(phase + Math.PI, half);
  return L({
    p: [0, 0.92 - 0.04 * amp + 0.03 * amp * Math.abs(c), 0],
    lean: 0.15 + 0.2 * amp,
    // 振り出す足は、ゆっくりでも地面から上げる（引きずらない）
    lf: [-0.12, 0.08 + (0.07 + 0.15 * amp) * l.lift, l.z],
    rf: [0.12, 0.08 + (0.07 + 0.15 * amp) * r.lift, r.z],
    lh: [-0.2, 0.95, 0.12 - 0.3 * amp * c],
    rh: [0.2, 0.95, 0.12 + 0.3 * amp * c],
  });
}

const tmpA = newPose();
const tmpB = newPose();
const tmpC = newPose();

export type Dugout = { pos: Vec3; yaw: number; back: Vec3 };

// t が a → b で 0 → 1、b → c で 1 → 0 になる山
function bump(t: number, a: number, b: number, c: number) {
  if (t <= a || t >= c) return 0;
  return t < b ? smooth((t - a) / (b - a)) : 1 - smooth((t - b) / (c - b));
}

// 投球に合わせた小さなジャンプ（スプリットステップ）。腰の高さに足す
function splitStep(p: Play, t: number) {
  return 0.06 * bump(t, p.tCatcher - 0.12, p.tCatcher + 0.02, p.tCatcher + 0.18);
}

const YAW_F = yawOf(F.x, F.z); // 二塁へ向かう向き
const YAW_IN = yawOf(-U.x, -U.z); // 走路から内野（投手）の方
const v3 = (p: Vec3) => new V(p.x, p.y, p.z);

// 捕手の投げる向き（play.ts と同じ計算）
const faceThrowOf = (p: Play) => yawOf(p.th.C.x - CATCHER_THROW_BASE.x, p.th.C.z - CATCHER_THROW_BASE.z);

export class Cast {
  readonly runner: Figure;
  readonly batter: Figure;
  readonly pitcher: Figure;
  readonly catcher: Figure;
  readonly plateUmp: Figure;
  readonly firstBase: Figure;
  readonly thirdBase: Figure;
  readonly fielders: Record<CoverId, Figure>;
  readonly outfield: Figure[] = [];
  readonly managers: { home: Figure; away: Figure };
  readonly bench: Figure[] = [];
  private pose = newPose();
  dugouts: { home: Dugout; away: Dugout };

  constructor(scene: THREE.Scene, dugouts: { home: Dugout; away: Dugout }) {
    this.dugouts = dugouts;
    const add = (f: Figure) => {
      scene.add(f.group);
      return f;
    };
    // 走者の靴は赤。ベースの上で野手の黒い靴と見分けやすくする
    this.runner = add(new Figure({ ...AWAY, number: '1', shoes: 0xe0322f }));
    this.batter = add(new Figure({ ...AWAY, number: '7' }));
    this.batter.setBat(true);
    this.pitcher = add(new Figure({ ...HOME, number: '18' }));
    this.catcher = add(new Figure({ ...HOME, number: '27', helmet: true }));
    this.plateUmp = add(new Figure(UMP));
    this.firstBase = add(new Figure({ ...HOME, number: '3' }));
    this.thirdBase = add(new Figure({ ...HOME, number: '5' }));
    this.fielders = {
      SS: add(new Figure({ ...HOME, number: '6' })),
      '2B': add(new Figure({ ...HOME, number: '4' })),
    };
    for (const n of ['8', '9', '1']) this.outfield.push(add(new Figure({ ...HOME, number: n })));
    this.managers = {
      home: add(new Figure({ ...HOME, glove: null, number: '77', kind: 'manager' })),
      away: add(new Figure({ ...AWAY, helmet: false, glove: null, number: '88', kind: 'manager' })),
    };
    for (const side of ['home', 'away'] as const) {
      for (let i = 0; i < 4; i++) {
        const f = add(new Figure({ ...(side === 'home' ? HOME : AWAY), helmet: false, glove: null, number: String(10 + i * 3) }));
        this.bench.push(f);
        const d = dugouts[side];
        const along = rightOf(d.yaw);
        const k = (i - 1.5) * 1.6 + (i >= 2 ? 1.2 : -1.2);
        const base = { x: d.back.x + along.x * k, y: 0.0, z: d.back.z + along.z * k };
        f.apply(localToRig(base, d.yaw, i % 2 === 0 ? SIT : RAIL, newPose()));
        if (i % 2 === 1) {
          const fw = fwdOf(d.yaw);
          f.apply(localToRig({ x: d.pos.x + along.x * k - fw.x * 0.35, y: 0, z: d.pos.z + along.z * k - fw.z * 0.35 }, d.yaw, RAIL, newPose()));
        }
      }
    }
  }

  // ---- 1プレーの時刻 t の姿 ----
  update(p: Play, t: number) {
    this.updateRunner(p, t);
    this.updateBatter(p, t);
    this.updatePitcher(p, t);
    this.updateCatcherUmp(p, t);
    this.updateCover(p, t);
    this.updateInfield(p, t);
    this.updateOutfield(p, t);
    this.managerIdle();
  }

  coverFig(p: Play) {
    return this.fielders[p.cover];
  }

  // ボールを持っている手の位置。持っていなければ false
  heldBall(p: Play, t: number, out: V3): boolean {
    const st = ballAt(p, t);
    if (st.phase === 'held') {
      out.copy(this.pitcher.j.rHand);
      return true;
    }
    if (st.phase === 'catcher' && t > p.tCatcher + 0.12) {
      out.copy(this.catcher.j.rHand);
      return true;
    }
    if (st.phase === 'caught') {
      // 捕った後はグラブと一緒に動く（捕った瞬間の位置との差だけずらす）
      out.copy(this.coverFig(p).j.lHand).add(this.catchOffset);
      return true;
    }
    return false;
  }
  private catchOffset = new V();

  // ---- 走者 ----
  private updateRunner(p: Play, t: number) {
    const r = p.runner;
    const leadW = pathToWorld(r.s0, r.l0);
    if (t < r.tStart) {
      // リード: 投手の方を向いて構え、投手が動いたら少し体重を二塁側へ
      localToRig(leadW, YAW_IN, LEAD, this.pose);
      const lean = smooth((t - p.tMove) / 0.2);
      this.pose.pelvis.addScaledVector(v3({ x: F.x, y: 0, z: F.z }), 0.06 * lean);
    } else if (t < r.tSlide) {
      this.runPose(p, t, this.pose);
      if (t < r.tStart + 0.3) {
        // 走り出し: リードの構えから体を二塁へ向ける（クロスオーバー）
        localToRig(leadW, YAW_IN, LEAD, tmpB);
        lerpRig(tmpB, this.pose, smooth((t - r.tStart) / 0.3), this.pose);
      }
    } else {
      if (r.head) this.headSlidePose(p, t, this.pose);
      else this.slidePose(p, t, this.pose);
      const u = slideAmount(r, t);
      if (u < 1) {
        this.runPose(p, t, tmpA);
        lerpRig(tmpA, this.pose, u, this.pose);
        // ヘッドスライディングは、少し浮くように前へ飛び込んでから腹ばいになる
        if (r.head) this.pose.pelvis.y += 0.15 * Math.sin(Math.PI * Math.min(1, u * 1.25));
      }
    }
    this.runner.apply(this.pose);
    this.pose.kneeDown = 0;
  }

  // 走る姿勢（着地点に足を合わせる）
  private runPose(p: Play, t: number, out: RigPose) {
    const r = p.runner;
    const s = runnerS(r, t);
    const lb = runnerL(r, s);
    const plants = r.plants;
    let k = -1;
    for (let i = 0; i < plants.length; i++) if (plants[i].bodyS <= s) k = i;
    let frac = 0;
    if (k >= 0 && k + 1 < plants.length) frac = (s - plants[k].bodyS) / (plants[k + 1].bodyS - plants[k].bodyS);
    else if (k < 0) frac = (s - r.s0) / Math.max(1e-3, plants[0].bodyS - r.s0);
    const phase = k + clamp(frac, 0, 1);
    const bob = 0.035 * Math.cos(2 * Math.PI * (phase - Math.floor(phase)));
    const speedK = clamp((t - r.tStart) / 0.5, 0, 1);
    const yaw = YAW_F;
    const w = pathToWorld(s, lb, 0.9 + bob - 0.05 * speedK);
    out.pelvis.set(w.x, w.y, w.z);
    out.yaw = yaw;
    out.lean = 0.14 + 0.3 * speedK + (t < r.tStart + 0.6 ? 0.15 * (1 - (t - r.tStart) / 0.6) : 0);
    out.side = 0;
    out.headYaw = 0;
    out.headPitch = -0.1;
    this.footAt(p, s, 'L', out.lFoot);
    this.footAt(p, s, 'R', out.rFoot);
    out.lFootYaw = yaw;
    out.rFootYaw = yaw;
    out.lToe = 0;
    out.rToe = 0;
    // 腕振り（足と逆）。a = +1 で右腕が前
    const pk = plants[Math.max(0, Math.floor(phase))] ?? plants[0];
    const sign = pk.foot === 'L' ? 1 : -1;
    const a = sign * Math.cos(Math.PI * (phase - Math.floor(phase))) * speedK;
    out.twist = -0.12 * a;
    const fw = fwdOf(yaw);
    const rt = rightOf(yaw);
    const shY = out.pelvis.y + 0.5 * Math.cos(out.lean);
    const shF = 0.5 * Math.sin(out.lean);
    const hand = (side: number, swing: number, o: V3) => {
      const u = (swing + 1) / 2;
      const f = shF + (-0.2 + 0.45 * u);
      const y = shY - 0.42 + 0.34 * u * u;
      const sd = 0.2 - 0.04 * u;
      o.set(out.pelvis.x + rt.x * sd * side + fw.x * f, y, out.pelvis.z + rt.z * sd * side + fw.z * f);
    };
    hand(1, a, out.rHand);
    hand(-1, -a, out.lHand);
    out.lElbowPole = null;
    out.rElbowPole = null;
    out.bat = null;
    out.gloveDir = null;
    return out;
  }

  // ある足の位置（腰の位置 s のとき）
  private footAt(p: Play, s: number, foot: 'L' | 'R', o: V3) {
    const r = p.runner;
    const plants = r.plants;
    const st = r.stance[foot];
    const stanceW = pathToWorld(st.s, st.l, ANKLE_H);
    let prev: { w: Vec3; liftS: number } | null = null;
    let next: Plant | null = null;
    let landed: Plant | null = null;
    for (let i = 0; i < plants.length; i++) {
      const pl = plants[i];
      if (pl.foot !== foot) continue;
      if (pl.bodyS <= s) landed = pl;
      else {
        next = pl;
        break;
      }
    }
    if (landed) prev = { w: pathToWorld(landed.s, landed.l, ANKLE_H), liftS: landed.liftS };
    else {
      // まだ一度も着地していない: 構えの位置から（最初の一歩の足はすぐ離れる）
      const first = plants[0];
      const liftS = first.foot === foot ? r.s0 : first.bodyS + 0.15;
      prev = { w: stanceW, liftS };
    }
    if (!next || s <= prev.liftS) {
      o.set(prev.w.x, prev.w.y, prev.w.z);
      return;
    }
    const nw = pathToWorld(next.s, next.l, ANKLE_H);
    const u = clamp((s - prev.liftS) / (next.bodyS - prev.liftS), 0, 1);
    const e = smooth(u);
    const hu = Math.sin(Math.PI * Math.pow(u, 0.7));
    const h = (0.2 + 0.16 * clamp(next.len / 2, 0, 1)) * hu + 0.1 * hu ** 3;
    o.set(prev.w.x + (nw.x - prev.w.x) * e, prev.w.y + (nw.y - prev.w.y) * u + h, prev.w.z + (nw.z - prev.w.z) * e);
  }

  // スライディング（足から）。左足を前に伸ばし、右足は曲げて左膝の下へ。右の腰で滑る
  private slidePose(p: Play, t: number, out: RigPose) {
    const r = p.runner;
    const s = runnerS(r, t);
    const yaw = YAW_F;
    const fw = fwdOf(yaw);
    const rt = rightOf(yaw);
    const w = pathToWorld(s, RUNNER.laneL, RUNNER.slidePelvisY);
    out.pelvis.set(w.x, w.y, w.z);
    out.yaw = yaw;
    // ベースに触れた後は少し上体を起こす
    // （かわす走者は、ベースに伸ばした右手を頭で隠さないよう、触れた後も頭を上げない）
    const after = r.evade ? 0 : smooth((t - r.tArrive) / 0.5);
    out.lean = -1.05 + 0.35 * after;
    out.side = 0.22;
    out.twist = 0;
    out.headYaw = 0;
    out.headPitch = -0.75 + 0.3 * after;
    const a = leadPoint(r, t);
    out.lFoot.set(a.x, a.y, a.z);
    out.lFootYaw = yaw;
    out.lToe = 0;
    out.rFoot.set(w.x + fw.x * 0.42 - rt.x * 0.02, ANKLE_H, w.z + fw.z * 0.42 - rt.z * 0.02);
    out.rFootYaw = yaw - 1.0; // 膝を少し外（右）へ向ける
    out.rToe = 0;
    // 両手は上げる（ベースに突かないように）
    out.lHand.set(w.x - fw.x * 0.1 - rt.x * 0.3, 0.95, w.z - fw.z * 0.1 - rt.z * 0.3);
    out.rHand.set(w.x - fw.x * 0.12 + rt.x * 0.32, 0.92, w.z - fw.z * 0.12 + rt.z * 0.32);
    out.lElbowPole = new V(-rt.x, 0.2, -rt.z);
    out.rElbowPole = new V(rt.x, 0.2, rt.z);
    out.bat = null;
    out.gloveDir = null;
    return out;
  }

  // ヘッドスライディング。頭から飛び込み、胸を地面につけて腹ばいで滑る。両腕は肩から前へまっすぐ伸ばし、
  // 左手（両手）でベースに触れる。頭は両腕の間で前（ベース）を見る。両脚は後ろへ伸ばす
  private headSlidePose(p: Play, t: number, out: RigPose) {
    const r = p.runner;
    const s = runnerS(r, t);
    const yaw = YAW_F;
    const rt = rightOf(yaw);
    // かわす走者は、滑りながら内野側へずれる
    const bl = slideL(r, t);
    const w = pathToWorld(s, bl, RUNNER.headPelvisY);
    out.pelvis.set(w.x, w.y, w.z);
    out.yaw = yaw;
    // ベースに触れた後は、手がベースで止まって体が少し進む（肘が曲がる）。顔を上げて上体を少し起こす
    // （かわす走者は、ベースに伸ばした右手を頭で隠さないよう、触れた後も頭を上げない）
    const after = r.evade ? 0 : smooth((t - r.tArrive) / 0.5);
    out.lean = RUNNER.headLean - 0.1 * after;
    out.side = 0;
    out.twist = 0;
    out.headYaw = 0;
    out.headPitch = -1.15 - 0.15 * after;
    const a = leadPoint(r, t);
    if (r.evade) {
      // かわす走者: 右手をベースの内野側の角へ伸ばし、左手は体の前（内野側）へ伸ばす
      out.rHand.set(a.x, a.y, a.z);
      const lh = pathToWorld(Math.min(s + RUNNER.headReach - 0.04, BAG_FACE_S - 0.1), bl + RUNNER.headHandL, RUNNER.headHandY);
      out.lHand.set(lh.x, lh.y, lh.z);
    } else {
      out.lHand.set(a.x, a.y, a.z);
      const rh = pathToWorld(worldToPath(a).s, RUNNER.laneL - RUNNER.headHandL, RUNNER.headHandY);
      out.rHand.set(rh.x, rh.y, rh.z);
    }
    // 肘は少し外・上へ（伸ばした腕がわずかに曲がるとき）
    out.lElbowPole = new V(-rt.x, 0.4, -rt.z);
    out.rElbowPole = new V(rt.x, 0.4, rt.z);
    // 脚: 後ろへ伸ばし、膝は下（地面）へ。つま先は後ろ下へ向ける
    // 足首は腰から脚の長さの少し手前（膝がわずかに曲がって地面につく。地面には潜らない）
    const lf = pathToWorld(s - 0.895, bl - 0.13, 0.13);
    const rf = pathToWorld(s - 0.89, bl + 0.15, 0.14);
    out.lFoot.set(lf.x, lf.y, lf.z);
    out.rFoot.set(rf.x, rf.y, rf.z);
    out.lFootYaw = yaw + Math.PI;
    out.rFootYaw = yaw + Math.PI;
    out.lToe = 0.7;
    out.rToe = 0.7;
    out.kneeDown = 1;
    out.bat = null;
    out.gloveDir = null;
    return out;
  }

  // ---- 打者・投手・捕手・球審 ----
  private updateBatter(p: Play, t: number) {
    const startW = { x: -0.62, y: 0, z: 0.12 };
    const u = smooth((t - p.tCatcher + 0.15) / 0.35);
    localToRig(startW, Math.PI / 2, BAT_STANCE, tmpA);
    localToRig(startW, Math.PI / 2, BAT_TAKE, tmpB);
    lerpRig(tmpA, tmpB, u, this.pose);
    this.batter.setBat(true);
    this.batter.apply(this.pose);
  }

  private updatePitcher(p: Play, t: number) {
    // 動き出しからリリースまでの時間を、このプレーのクイックの速さに縮める
    const k = (p.tPitch - p.tMove) / 1.2;
    const tl = t - p.tPitch;
    const tk = tl < 0 ? tl / k : tl;
    localToRig(PITCHER_BASE, 0, sampleKeys(PITCH_KEYS, tk), this.pose);
    // 投げた後は二塁の方を振り返る
    if (t > p.tPitch + 0.8) {
      const lp2 = sampleKeys(PITCH_KEYS, 0.8);
      const f = fwdOf(0);
      const bx = PITCHER_BASE.x + f.x * 1.0;
      const bz = PITCHER_BASE.z + f.z * 1.0;
      const yaw = yawOf(SECOND_BASE.x - bx, SECOND_BASE.z - bz);
      localToRig({ x: bx, y: moundY(bx, bz), z: bz }, yaw, STAND, tmpA);
      localToRig(PITCHER_BASE, 0, lp2, tmpB);
      lerpRig(tmpB, tmpA, smooth((t - p.tPitch - 0.8) / 0.8), this.pose);
    }
    this.pitcher.apply(this.pose);
  }

  private updateCatcherUmp(p: Play, t: number) {
    const face = faceThrowOf(p);
    const tr = p.th.tRelease;
    const tG = tr + THROW_KEYS[0][0];
    if (t < p.tCatcher) {
      localToRig(CATCHER_BASE, Math.PI, CROUCH_C, this.pose);
    } else if (t < tG) {
      // 捕ってすぐ立ち上がり、投げる構えへ
      localToRig(CATCHER_BASE, Math.PI, CROUCH_C, tmpA);
      localToRig(CATCHER_THROW_BASE, face, THROW_KEYS[0][1], tmpB);
      lerpRig(tmpA, tmpB, smooth((t - p.tCatcher) / Math.max(0.05, tG - p.tCatcher)), this.pose);
    } else {
      localToRig(CATCHER_THROW_BASE, face, sampleKeys(THROW_KEYS, t - tr), this.pose);
    }
    this.catcher.apply(this.pose);
    // 球審: 送球のじゃまにならないよう、しゃがんだまま少し横へ
    const uBase = { x: 0.05, y: 0, z: 1.45 };
    localToRig(uBase, Math.PI, CROUCH_U, tmpA);
    localToRig({ x: -0.5, y: 0, z: 1.6 }, Math.PI * 0.95, STAND, tmpB);
    lerpRig(tmpA, tmpB, smooth((t - p.tCatcher - 0.3) / 0.6), this.pose);
    this.plateUmp.apply(this.pose);
  }

  // ---- 二塁に入る野手（捕ってタッチ） ----
  private updateCover(p: Play, t: number) {
    const f = this.coverFig(p);
    const fp = p.fp;
    const P0 = fp.P0;
    const yawHome = yawOf(-P0.x, -P0.z);
    const pose = this.pose;
    const recv = this.receivePose(f, p, tmpB);
    {
      const tc0 = p.tCatch - 0.4;
      const w = smooth((t - fp.tSet) / 0.25) * (1 - smooth((t - (tc0 - 0.2)) / 0.2));
      if (w > 0) {
        recv.pelvis.y += 0.02 * w * Math.sin(2 * Math.PI * 1.4 * (t - fp.tSet));
        recv.lHand.y += 0.015 * w * Math.sin(2 * Math.PI * 1.4 * (t - fp.tSet) - 0.6);
      }
    }
    if (t < fp.tGo) {
      localToRig(P0, yawHome, READY, pose);
      pose.pelvis.y += splitStep(p, t);
    } else if (t < fp.tSet) {
      // 止まる直前（残り約 1m）まで走る足の運びを続け、最後に一歩ずつ踏み込んで待つ構えになる
      const tStop = fp.tSet - 0.36;
      if (t < tStop) this.coverRun(p, t, pose);
      else {
        // 止まる: 体は待つ構えへ。足は走っていた位置から、待つ構えの位置へ一歩ずつ運ぶ（左足が先）
        this.coverRun(p, tStop, tmpA);
        const k = smooth((t - tStop) / 0.36);
        const lf0 = tmpA.lFoot.clone();
        const rf0 = tmpA.rFoot.clone();
        lerpRig(tmpA, recv, k, pose);
        const kl = smooth((t - tStop) / 0.24);
        const kr = smooth((t - tStop - 0.08) / 0.28);
        pose.lFoot.lerpVectors(lf0, recv.lFoot, kl);
        pose.rFoot.lerpVectors(rf0, recv.rFoot, kr);
        pose.lFoot.y += 0.1 * Math.sin(Math.PI * kl);
        pose.rFoot.y += 0.1 * Math.sin(Math.PI * kr);
      }
    } else if (t < p.tCatch) {
      copyPose(recv, pose);
    }
    if (t >= fp.tGo && t < p.tCatch) {
      // 送球に合わせてグラブを捕球点へ。走って着く前に始まることもある（そのときは走る姿勢から混ぜる）
      const t1 = p.tCatch - 0.4;
      const t2 = p.tCatch - 0.06;
      if (t >= t1) {
        const u = clamp((t - t1) / (t2 - t1), 0, 1);
        const c = this.catchPose(f, p, tmpA, u);
        const lf = pose.lFoot.clone();
        const rf = pose.rFoot.clone();
        lerpRig(pose, c, smooth(u), pose);
        // 足は先に運ぶ（着いていれば捕る構えの足そのもの）
        const kf = smooth(u * 2);
        pose.lFoot.lerpVectors(lf, c.lFoot, kf);
        pose.rFoot.lerpVectors(rf, c.rFoot, kf);
      }
    } else if (t >= p.tCatch) {
      this.tagPose(f, p, t, pose);
    }
    f.apply(pose);
    if (t <= p.tCatch) this.catchOffset.subVectors(v3(p.th.C), f.j.lHand);
  }

  // ベースへ走る（加速 → 一定の速さ → 減速。play.ts の coverDist）。足の運びは進んだ距離に合わせる
  private coverRun(p: Play, t: number, pose: RigPose) {
    const fp = p.fp;
    const P0 = fp.P0;
    const Q = { x: RECEIVE.pelvis.x, y: 0, z: RECEIVE.pelvis.z };
    const yawHome = yawOf(-P0.x, -P0.z);
    const yawRun = yawOf(Q.x - P0.x, Q.z - P0.z);
    const d = coverDist(fp, t);
    const u = d / fp.dist;
    const here = { x: P0.x + (Q.x - P0.x) * u, y: 0, z: P0.z + (Q.z - P0.z) * u };
    const spd = (coverDist(fp, t + 0.01) - coverDist(fp, t - 0.01)) / 0.02;
    const amp = clamp(spd / 6.5, 0, 1) ** 0.6;
    // 左足が地面について右足を振り出すところから始める（左足は半歩ぶん、構えの位置に置いたまま）
    const HALF = 0.85;
    localToRig(here, yawRun, runLocal((d / HALF) * Math.PI + Math.PI / 2, amp), pose);
    localToRig(P0, yawHome, READY, tmpC);
    // 体と腕は構えからつなぐ
    const k0 = smooth((t - fp.tGo) / 0.25);
    const lfRun = pose.lFoot.clone();
    const rfRun = pose.rFoot.clone();
    if (k0 < 1) lerpRig(tmpC, pose, k0, pose);
    // 最初の一歩: 右足は構えの位置から振り出す。左足は半歩のあいだ構えの位置に止まり、そのあと振り出す
    const kr = smooth(d / (HALF / 2));
    pose.rFoot.set(tmpC.rFoot.x + (rfRun.x - tmpC.rFoot.x) * kr, rfRun.y, tmpC.rFoot.z + (rfRun.z - tmpC.rFoot.z) * kr);
    if (d < HALF / 2) pose.lFoot.copy(tmpC.lFoot);
    else {
      const kl = smooth((d - HALF / 2) / HALF);
      pose.lFoot.set(tmpC.lFoot.x + (lfRun.x - tmpC.lFoot.x) * kl, lfRun.y, tmpC.lFoot.z + (lfRun.z - tmpC.lFoot.z) * kl);
    }
    return pose;
  }

  // ベースの先で送球を待つ構え
  private receivePose(f: Figure, p: Play, out: RigPose) {
    const yaw = yawOf(p.th.R.x - RECEIVE.pelvis.x, p.th.R.z - RECEIVE.pelvis.z);
    const fw = fwdOf(yaw);
    const rt = rightOf(yaw);
    out.pelvis.set(RECEIVE.pelvis.x, 0.82, RECEIVE.pelvis.z);
    out.yaw = yaw;
    out.lean = 0.3;
    out.side = 0;
    out.twist = 0;
    out.headYaw = 0;
    out.headPitch = -0.1;
    out.lFoot.copy(v3(RECEIVE.lFoot));
    out.rFoot.copy(v3(RECEIVE.rFoot));
    out.lFootYaw = yaw;
    out.rFootYaw = yaw;
    out.lToe = 0;
    out.rToe = 0;
    out.lHand.set(out.pelvis.x + fw.x * 0.45 - rt.x * 0.1, 1.25, out.pelvis.z + fw.z * 0.45 - rt.z * 0.1);
    out.rHand.set(out.pelvis.x + fw.x * 0.4 + rt.x * 0.12, 1.2, out.pelvis.z + fw.z * 0.4 + rt.z * 0.12);
    out.lElbowPole = new V(-rt.x, -0.5, -rt.z);
    out.rElbowPole = new V(rt.x, -0.5, rt.z);
    out.bat = null;
    out.gloveDir = new V(fw.x, 0.1, fw.z);
    void f;
    return out;
  }

  // 捕球するときの足: 捕球点が遠い（それた送球）ときは、両足をそちらへ寄せる
  private catchFeet(p: Play) {
    const C = p.th.C;
    const d = new V(C.x - RECEIVE.pelvis.x, 0, C.z - RECEIVE.pelvis.z);
    const over = Math.max(0, d.length() - 0.5);
    d.normalize().multiplyScalar(over);
    return { l: v3(RECEIVE.lFoot).add(d), r: v3(RECEIVE.rFoot).add(d) };
  }

  // 捕球: グラブを捕球点 C にぴったり合わせる
  private catchPose(f: Figure, p: Play, out: RigPose, u = 1) {
    const C = v3(p.th.C);
    const R0 = p.th.R;
    const yaw = yawOf(R0.x - RECEIVE.pelvis.x, R0.z - RECEIVE.pelvis.z);
    const cf = this.catchFeet(p);
    const kl = smooth(u * 1.4);
    const kr = smooth(u * 1.4 - 0.25);
    const lf = new V().lerpVectors(v3(RECEIVE.lFoot), cf.l, kl);
    const rf = new V().lerpVectors(v3(RECEIVE.rFoot), cf.r, kr);
    const dL = cf.l.distanceTo(v3(RECEIVE.lFoot));
    lf.y += Math.min(0.12, 0.1 * dL) * Math.sin(Math.PI * kl);
    rf.y += Math.min(0.12, 0.1 * dL) * Math.sin(Math.PI * kr);
    this.reach(f, out, lf, rf, C, yaw);
    out.gloveDir = new V(R0.x - C.x, (R0.y - C.y) * 0.3, R0.z - C.z).normalize();
    return out;
  }

  // タッチの構え: 触れる点 P の外野側・少し二塁寄りに、P の方を向いて立つ。足は肩幅より広く開く
  private tagStance(p: Play) {
    if (p.tag.style === 'sweep') {
      const P = p.tag.P;
      // 振り下ろすタッチ: ベースのすぐ先（二塁側）に、一塁の方を向いて立つ。足は走路と直角に開き、
      // 内側の足はベースの上、外側の足は外野側。触れる点へグラブを下ろす。
      // 内野側（塁審の側）は空けて、グラブと足が塁審から見えるようにする。走者の足はベースの面で止まり、
      // 曲げた右脚と体は一塁側にあるので、野手の足とは重ならない
      // ヘッドスライディングは、走者の手がベースの面まで来るので、ベースの先へ少し離れて立つ（脚で手を隠さない）
      const ps = worldToPath(P);
      const hd = p.runner.head;
      const sm = Math.max(BAG_FACE_S + (hd ? TAG.headStand[0] : 0.1), ps.s + 0.3);
      const a = v3(pathToWorld(sm, Math.max(ps.l + 0.17, hd ? TAG.headStand[1] : 0.1), ANKLE_H)); // 内側の足
      const b = v3(pathToWorld(sm + 0.12, Math.max(ps.l + 0.77, 0.7), ANKLE_H)); // 外側の足
      const mid = new V().addVectors(a, b).multiplyScalar(0.5);
      const yaw = yawOf(P.x - mid.x, P.z - mid.z);
      const rt = rightOf(yaw);
      const aRight = (a.x - mid.x) * rt.x + (a.z - mid.z) * rt.z > 0;
      return { l: aRight ? b : a, r: aRight ? a : b, yaw };
    }
    // 足の前で待つタッチ: 触れる点の外野側に立つ（走者が滑り続けるので離れて立ち、触れたら下がる）。
    // かわす走者を追うタッチは、最初にグラブを置く点の外野側に立つ
    // （かわす走者を追うタッチは、待つタッチと同じ位置: ベースの先の外野側に立つ）
    const P = p.tag.style === 'chase' ? v3(pathToWorld(BAG_FACE_S, LEAD_FOOT_L, 0.13)) : p.tag.P;
    const ds = 0.25; // P から二塁の方へ
    // P から外野の方へ（走者の体に足が重ならないように）。待つタッチは走者が滑り続けるので離れて立つ
    const dl = 0.8;
    const Q = { x: P.x + F.x * ds + U.x * dl, z: P.z + F.z * ds + U.z * dl };
    const yaw = yawOf(P.x - Q.x, P.z - Q.z);
    const fw = fwdOf(yaw);
    const rt = rightOf(yaw);
    const half = 0.38;
    const l = new V(Q.x - rt.x * half + fw.x * 0.1, ANKLE_H, Q.z - rt.z * half + fw.z * 0.1);
    const r = new V(Q.x + rt.x * half - fw.x * 0.08, ANKLE_H, Q.z + rt.z * half - fw.z * 0.08);
    return { l, r, yaw };
  }

  // 捕ってからタッチまで、タッチの後
  private tagPose(f: Figure, p: Play, t: number, out: RigPose) {
    const C = v3(p.th.C);
    const tc = p.tCatch;
    const tt = p.tTag;
    // 捕ったらすぐ、タッチの構えへ踏み出す（左足が先。踏み出す足は少し浮かせる）
    const st = this.tagStance(p);
    const cf = this.catchFeet(p);
    // 一歩の時間は運ぶ距離で決める（遠いほど長く、足を高く上げる）。タッチまでに間に合わないときは急ぐ
    const dL = cf.l.distanceTo(st.l);
    const dR = cf.r.distanceTo(st.r);
    const room = Math.max(0.12, tt - tc + 0.08);
    const durL = Math.min(0.16 + 0.22 * dL, room);
    const durR = Math.min(0.16 + 0.22 * dR, room);
    const k1 = smooth((t - tc) / durL);
    const k2 = smooth((t - tc - 0.06) / durR);
    const lf = new V().lerpVectors(cf.l, st.l, k1);
    const rf = new V().lerpVectors(cf.r, st.r, k2);
    lf.y += Math.min(0.14, 0.04 + 0.1 * dL) * Math.sin(Math.PI * k1);
    rf.y += Math.min(0.14, 0.04 + 0.1 * dR) * Math.sin(Math.PI * k2);
    // 足の前で待つタッチ: 触れたら、滑ってくる走者をよけて外野側へ下がる（右足が先）
    const wait = p.tag.style === 'wait';
    const away = new V(U.x, 0, U.z);
    if (wait && t > tt - 0.04) {
      // 一塁側の足（滑ってくる走者の曲げた右脚に近い方）から先に下がる。触れる直前から動き出す
      const lFirst = worldToPath(lf).s < worldToPath(rf).s;
      const e1 = smooth((t - tt + 0.04) / 0.2);
      const e2 = smooth((t - tt - 0.04) / 0.22);
      const [f1, f2] = lFirst ? [lf, rf] : [rf, lf];
      f1.addScaledVector(away, 0.9 * e1);
      f1.y += 0.1 * Math.sin(Math.PI * e1);
      f2.addScaledVector(away, 0.9 * e2);
      f2.y += 0.1 * Math.sin(Math.PI * e2);
    }
    // かわす走者を追うタッチ: 走者がずれ始めたら、内野側へ踏み込む
    const chase = p.tag.style === 'chase';
    const tr = p.tag.tReact ?? tt;
    if (chase && t > tr) {
      const k = smooth((t - tr) / Math.max(0.1, tt - tr + 0.1));
      lf.addScaledVector(away, -0.5 * k);
      rf.addScaledVector(away, -0.3 * k);
    }
    const hand = new V();
    let dir: V3;
    if (t <= tt && chase) {
      // グラブをベースの前に置いて待ち、走者がずれたら追いかけて右腕に触れる
      const target = v3(tagTarget(p, t));
      const G0 = v3(p.tag.P0!);
      if (t < tr) {
        const u = smooth((t - tc) / TAG.chaseSet);
        hand.lerpVectors(C, G0, u);
        hand.y += 0.25 * Math.sin(Math.PI * u) * (1 - u);
      } else {
        // 振り下ろすタッチと同じく、触れる直前は上から勢いよく下りる
        const u = clamp((t - tr) / (tt - tr), 0, 1);
        hand.lerpVectors(G0, target, Math.pow(u, 1.3));
        hand.y += 0.6 * u * (1 - u);
      }
      dir = new V(-F.x, -0.15, -F.z).normalize().lerp(new V(0, -1, 0), smooth((t - tr) / (tt - tr)) * 0.6).normalize();
    } else if (t <= tt) {
      const target = v3(tagTarget(p, t));
      if (wait) {
        // 足の前にグラブを置いて待つ（面は走者の方へ）
        const arrive = Math.max(tc + 0.12, tt - 0.12);
        const u = smooth((t - tc) / (arrive - tc));
        hand.lerpVectors(C, target, u);
        hand.y += 0.25 * Math.sin(Math.PI * u) * (1 - u);
        dir = new V(-F.x, -0.15, -F.z).normalize();
      } else {
        // 上から脚へ振り下ろす（触れる瞬間まで脚の上にある）
        const u = clamp((t - tc) / (tt - tc), 0, 1);
        const e = Math.pow(u, 1.3);
        hand.lerpVectors(C, target, e);
        hand.y += 0.9 * u * (1 - u); // 捕った位置からは連続に、触れる直前は上から下りる
        dir = new V(0, -1, 0).lerp(new V(-F.x, 0, -F.z), 0.25).normalize();
      }
    } else {
      // タッチの後: 少しの間は脚（靴）と一緒に動き、そのあと起き上がってグラブを上げ、ボールを見せる
      const stick = wait ? v3(leadFront(p.runner, Math.min(t, tt + 0.03))) : v3(tagTarget(p, Math.min(t, tt + 0.12)));
      const up = smooth((t - tt - 0.08) / 0.55);
      hand.copy(stick);
      hand.y += up * 1.0;
      const back = wait ? away : new V(st.l.x + st.r.x - 2 * stick.x, 0, st.l.z + st.r.z - 2 * stick.z).normalize();
      hand.addScaledVector(back, up * 0.3 + (wait ? 0.85 * smooth((t - tt) / 0.25) : 0));
      dir = wait ? new V(-F.x, -0.15, -F.z).normalize() : new V(0, -1, 0);
      dir.lerp(new V(-F.x, 0.6, -F.z), up).normalize();
    }
    const R0 = p.th.R;
    const yawRecv = yawOf(R0.x - RECEIVE.pelvis.x, R0.z - RECEIVE.pelvis.z);
    const yaw = angLerp(yawRecv, st.yaw, smooth((t - tc) / 0.25));
    // 体の目標: 捕球点からタッチの点へ時間で滑らかに移る（グラブの弧や振り下ろしの速さに体が振り回されない）。
    // タッチの瞬間はグラブと同じ点。タッチの後はグラブを追う
    let body = hand;
    if (t <= tt && chase) body = hand.clone();
    else if (t <= tt) {
      const target = v3(tagTarget(p, t));
      // グラブが下りるのに合わせて体も下ろす（グラブより先にかがまない）
      const u = clamp((t - tc) / Math.max(0.05, tt - tc), 0, 1);
      body = new V().lerpVectors(C, target, wait ? smooth(u) : Math.pow(u, 1.3));
    }
    this.reach(f, out, lf, rf, body, yaw, hand);
    out.gloveDir = dir;
    return out;
  }

  // 両足の位置と体の向きを決めて、左手（グラブ）を target に届かせる。右手はグラブに添える。
  // 腰の高さと前傾は目標の高さから決め、届かなければ「腰を落とす＋前に倒す＋寄せる」を少しずつ強める
  // （低い目標）。高い目標は伸び上がる。届かせ方が目標の位置に対して連続に変わるので、姿勢が飛ばない
  // body: 体（腰の高さ・前傾）を決める目標。hand: グラブの位置（省略すると body と同じ）。
  // 時間とともに滑らかに動く body を渡すと、グラブが速く動いても体は急に動かない
  private reach(f: Figure, out: RigPose, lf: V3, rf: V3, target: V3, yaw: number, hand: V3 = target) {
    out.yaw = yaw;
    out.lFoot.copy(lf);
    out.rFoot.copy(rf);
    out.lFootYaw = yaw + 0.45; // つま先と膝を外へ向ける
    out.rFootYaw = yaw - 0.45;
    out.lToe = 0;
    out.rToe = 0;
    out.twist = 0.15; // 肩をグラブの側へ少し回す
    out.side = -0.06;
    out.headYaw = 0;
    const ty = target.y;
    out.headPitch = -0.2 - 0.55 * clamp((0.95 - ty) / 0.75, 0, 1); // 低い目標ほど下を見る
    out.bat = null;
    const mid = new V((lf.x + rf.x) / 2, 0, (lf.z + rf.z) / 2);
    const dirT = new V(target.x - mid.x, 0, target.z - mid.z);
    const dh = dirT.length();
    if (dh > 1e-6) dirT.divideScalar(dh);
    const y0 = clamp(0.5 + 0.42 * ty, 0.52, 0.9);
    const lean0 = clamp(0.2 + 0.6 * (0.95 - ty), 0.12, 0.7);
    const shift0 = clamp(dh - 0.45, 0, 0.2);
    const high = ty > 1.45;
    const sh = new V();
    const set = (k: number) => {
      let y: number;
      let lean: number;
      if (high) {
        y = y0 + (1.0 - y0) * k;
        lean = lean0 * (1 - k);
      } else {
        // 低い目標: 腰を落とす（膝を曲げる）のを先に、前に倒すのは控えめに
        y = y0 + (0.4 - y0) * Math.min(1, k * 1.3);
        lean = lean0 + (1.05 - lean0) * k;
      }
      const shift = shift0 + 0.2 * k;
      out.pelvis.set(mid.x + dirT.x * shift, y, mid.z + dirT.z * shift);
      out.lean = lean;
      f.shoulder(out, 'L', sh);
      return sh.distanceTo(target);
    };
    const reachLen = 0.55;
    if (set(0) > reachLen) {
      // いちばん近づく k（高い目標では小さく、低い目標では 1）
      let kMin = 1;
      if (set(1) > reachLen) {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 24; i++) {
          const m1 = lo + (hi - lo) / 3;
          const m2 = hi - (hi - lo) / 3;
          if (set(m1) <= set(m2)) hi = m2;
          else lo = m1;
        }
        kMin = (lo + hi) / 2;
      }
      if (set(kMin) <= reachLen) {
        // 届く: 届くいちばん小さい k（腰を落とし過ぎない）
        let lo = 0;
        let hi = kMin;
        for (let i = 0; i < 16; i++) {
          const m = (lo + hi) / 2;
          if (set(m) <= reachLen) hi = m;
          else lo = m;
        }
        set(hi);
      } else set(kMin); // どの姿勢でも届かない（遠い・高い）: いちばん近づく姿勢。かがみ切らない
    }
    out.lHand.copy(hand);
    const fw = fwdOf(yaw);
    const rt = rightOf(yaw);
    // 右手はグラブの横に添える（両手で捕る・両手でタッチする）。届かないときは、届くところまで伸ばす（腕が伸び切って肘が裏返らない）
    out.rHand.set(hand.x + rt.x * 0.13 - fw.x * 0.03, hand.y + 0.06, hand.z + rt.z * 0.13 - fw.z * 0.03);
    f.shoulder(out, 'R', sh);
    const toR = new V().subVectors(out.rHand, sh);
    const maxR = (UPPER_ARM + FOREARM) * 0.92;
    if (toR.length() > maxR) out.rHand.copy(sh).addScaledVector(toR.normalize(), maxR);
    out.lElbowPole = new V(-rt.x, -0.5, -rt.z);
    out.rElbowPole = new V(rt.x, -0.5, rt.z);
  }

  // ---- ほかの野手 ----
  private updateInfield(p: Play, t: number) {
    // ベースに入らない方の野手は、二塁の後ろへカバーに走る
    const other: CoverId = p.cover === 'SS' ? '2B' : 'SS';
    const pos = FIELDERS[other].pos;
    const back = { x: SECOND_BASE.x + (other === 'SS' ? -3.5 : 3.5), z: SECOND_BASE.z - 6 };
    this.idleFielder(p, t, this.fielders[other], pos, back, true);
    // 一塁手は一塁ベースについて牽制に備える
    const fb = { x: FIRST_BASE.x - 0.4, z: FIRST_BASE.z - 0.5 };
    this.idleFielder(p, t, this.firstBase, fb, { x: fb.x - 2.5, z: fb.z - 1.5 }, false);
    this.idleFielder(p, t, this.thirdBase, { x: -19.5, z: -24.5 }, null, true);
  }

  private updateOutfield(p: Play, t: number) {
    const spots = [
      { x: -27, z: -62 },
      { x: 0, z: -76 },
      { x: 27, z: -62 },
    ];
    this.outfield.forEach((f, i) => {
      const s = spots[i];
      // 中堅手は二塁の方へ前進してカバーに入る
      const target = i === 1 ? { x: 0, z: -66 } : null;
      this.idleFielder(p, t, f, s, target, false);
    });
  }

  // プレーに関わらない野手: 投球に合わせて小さく跳んで構え、カバーへ動いてから、ボールを見る
  private idleFielder(p: Play, t: number, f: Figure, pos: { x: number; z: number }, target: { x: number; z: number } | null, hop: boolean) {
    const b = ballAt(p, t).pos;
    const yawHome = yawOf(-pos.x, -pos.z);
    const tGo = p.tCatcher + 0.1;
    const dx = target ? target.x - pos.x : 0;
    const dz = target ? target.z - pos.z : 0;
    const dist = Math.hypot(dx, dz);
    const dur = Math.max(0.5, dist / 5.5);
    const u = dist > 0.2 ? smooth((t - tGo) / dur) : 0;
    const here = { x: pos.x + dx * u, y: 0, z: pos.z + dz * u };
    const yawBall = t > p.tPitch ? yawOf(b.x - here.x, b.z - here.z) : yawHome;
    const moving = dist > 0.2 && t > tGo && t < tGo + dur;
    if (moving) {
      const k = (t - tGo) / dur;
      const amp = clamp(dist / 3, 0.3, 1) * Math.sin(Math.PI * clamp(k, 0, 1)) ** 0.5;
      const yaw = angLerp(yawHome, yawOf(dx, dz), smooth(k / 0.25));
      localToRig(here, yaw, runLocal(((dist * u) / 0.85) * Math.PI, amp), this.pose);
      if (k > 0.8) {
        localToRig(here, yawBall, STAND, tmpB);
        lerpRig(this.pose, tmpB, smooth((k - 0.8) / 0.2), this.pose);
      }
    } else {
      localToRig(here, yawHome, READY, tmpA);
      localToRig(here, yawBall, STAND, tmpB);
      const s0 = dist > 0.2 && t >= tGo + dur ? 1 : smooth((t - p.tCatcher - 0.3) / 0.6);
      lerpRig(tmpA, tmpB, s0, this.pose);
      if (hop) this.pose.pelvis.y += splitStep(p, t);
    }
    f.apply(this.pose);
  }

  // ---- 監督 ----
  managerIdle() {
    for (const side of ['home', 'away'] as const) {
      if (this.requesting === side) continue;
      const d = this.dugouts[side];
      const fw = fwdOf(d.yaw);
      localToRig({ x: d.pos.x - fw.x * 0.35, y: 0, z: d.pos.z - fw.z * 0.35 }, d.yaw, RAIL, this.pose);
      this.managers[side].apply(this.pose);
    }
  }
  requesting: 'home' | 'away' | null = null;

  // リクエストの仕草（c: 経過時間）。手の位置を返す（四角の軌跡を描くため）
  managerRequest(side: 'home' | 'away', c: number) {
    this.requesting = side;
    const d = this.dugouts[side];
    const fw = fwdOf(d.yaw);
    const u = smooth(c / 0.9);
    const from = { x: d.back.x, z: d.back.z };
    const to = { x: d.pos.x + fw.x * 1.2, z: d.pos.z + fw.z * 1.2 };
    const bx = from.x + (to.x - from.x) * u;
    const bz = from.z + (to.z - from.z) * u;
    if (c < 0.9) {
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      localToRig({ x: bx, y: 0, z: bz }, d.yaw, runLocal(((dist * u) / 0.7) * Math.PI, 0.45, 0.7), this.pose);
    } else localToRig({ x: bx, y: 0, z: bz }, d.yaw, sampleKeys(REQ_KEYS, c), this.pose);
    this.pose.lElbowPole = new V(-rightOf(d.yaw).x, -0.3, -rightOf(d.yaw).z);
    this.pose.rElbowPole = new V(rightOf(d.yaw).x, -0.3, rightOf(d.yaw).z);
    const m = this.managers[side];
    m.apply(this.pose);
    return { l: m.j.lHand.clone(), r: m.j.rHand.clone(), head: m.j.head.clone() };
  }
  endRequest() {
    this.requesting = null;
  }
}

function copyPose(a: RigPose, o: RigPose): RigPose {
  return lerpRig(a, a, 0, o);
}

