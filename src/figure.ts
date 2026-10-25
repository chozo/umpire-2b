import * as THREE from 'three';

// ローポリの人形。手足の先（足首・手）の位置を世界座標で指定し、膝と肘は2関節のIKで決める。
// これで「足がベースに触れる瞬間」「グラブが捕球点にある瞬間」を、計算どおりの位置に描ける。

const V = THREE.Vector3;
type V3 = THREE.Vector3;
const UP = new V(0, 1, 0);

export const THIGH = 0.45;
export const SHIN = 0.45;
export const UPPER_ARM = 0.29;
export const FOREARM = 0.29;
export const SPINE = 0.48;
export const SHOULDER_W = 0.19;
export const HIP_W = 0.1;

export type Look = {
  jersey: number;
  pants: number;
  cap: number;
  socks: number;
  shoes?: number; // 靴の色（省略すると黒）
  skin?: number;
  glove?: 'L' | 'R' | null;
  helmet?: boolean;
  number?: string;
  kind?: 'player' | 'umpire' | 'manager';
};

export type RigPose = {
  pelvis: V3;
  yaw: number;
  lean: number; // 前かがみ（rad）
  side: number; // 横への傾き（右が正）
  twist: number; // 肩の向き（腰に対して、左回りが正）
  headYaw: number;
  headPitch: number;
  lFoot: V3; // 足首
  rFoot: V3;
  lFootYaw: number;
  rFootYaw: number;
  lToe: number; // つま先の上下（下げると正）
  rToe: number;
  lHand: V3;
  rHand: V3;
  lElbowPole: V3 | null; // 肘の向き（向かせたい方向。null なら後ろ下）
  rElbowPole: V3 | null;
  bat: V3 | null; // バットの向き（null なら持たない）
  gloveDir: V3 | null; // グラブの面の向き
  kneeDown?: number; // 膝の向き: 0 = 前（既定）、1 = 下（腹ばいのとき）
};

export function newPose(): RigPose {
  return {
    pelvis: new V(0, 0.95, 0),
    yaw: 0,
    lean: 0,
    side: 0,
    twist: 0,
    headYaw: 0,
    headPitch: 0,
    lFoot: new V(0.12, 0.08, 0),
    rFoot: new V(-0.12, 0.08, 0),
    lFootYaw: NaN,
    rFootYaw: NaN,
    lToe: 0,
    rToe: 0,
    lHand: new V(0.25, 0.85, 0),
    rHand: new V(-0.25, 0.85, 0),
    lElbowPole: null,
    rElbowPole: null,
    bat: null,
    gloveDir: null,
  };
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, rough = 0.7) {
  const key = `${color}:${rough}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function capsule(r: number, len: number) {
  const key = `c:${r}:${len}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CapsuleGeometry(r, len, 4, 10);
    geoCache.set(key, g);
  }
  return g;
}

// 2関節のIK: root から target へ、長さ a・b の骨。pole の方向へ曲げる
const _d = new V();
const _b = new V();
export function solveIK(root: V3, target: V3, a: number, b: number, pole: V3, outMid: V3, outEnd: V3) {
  _d.subVectors(target, root);
  let dist = _d.length();
  if (dist < 1e-6) {
    _d.set(0, -1, 0);
    dist = 1e-6;
  }
  _d.divideScalar(dist);
  dist = Math.min(Math.max(dist, Math.abs(a - b) + 1e-3), a + b - 1e-4);
  outEnd.copy(root).addScaledVector(_d, dist);
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _b.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1).addScaledVector(_d, -_d.z);
  _b.normalize();
  outMid.copy(root).addScaledVector(_d, cosA * a).addScaledVector(_b, sinA * a);
}

const Y = new V(0, 1, 0);
function placeBetween(m: THREE.Object3D, a: V3, b: V3) {
  m.position.addVectors(a, b).multiplyScalar(0.5);
  _d.subVectors(b, a).normalize();
  m.quaternion.setFromUnitVectors(Y, _d);
}

const tmpM = new THREE.Matrix4();

export class Figure {
  readonly group = new THREE.Group();
  private pelvisM: THREE.Mesh;
  private torso: THREE.Mesh;
  private head = new THREE.Group();
  private limbs: Record<string, THREE.Mesh> = {};
  private lHandM: THREE.Object3D;
  private rHandM: THREE.Object3D;
  private lFootM: THREE.Mesh;
  private rFootM: THREE.Mesh;
  private batM: THREE.Mesh | null = null;
  readonly glove: THREE.Object3D | null = null;
  readonly look: Look;
  // 最後に計算した関節（世界座標）
  readonly j = {
    chest: new V(),
    lSh: new V(),
    rSh: new V(),
    lEl: new V(),
    rEl: new V(),
    lHand: new V(),
    rHand: new V(),
    lHip: new V(),
    rHip: new V(),
    lKnee: new V(),
    rKnee: new V(),
    lAnkle: new V(),
    rAnkle: new V(),
    head: new V(),
  };

  constructor(look: Look) {
    this.look = look;
    const skin = mat(look.skin ?? 0xd9a27a);
    const jersey = mat(look.jersey, 0.75);
    const pants = mat(look.pants, 0.75);
    const capM = mat(look.cap, 0.55);
    const socks = mat(look.socks, 0.7);
    const shoe = mat(look.shoes ?? 0x1a1a1a, 0.5);

    const add = (m: THREE.Mesh) => {
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    this.pelvisM = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), pants));
    this.torso = add(new THREE.Mesh(capsule(0.165, 0.3), jersey));
    this.torso.scale.set(1.18, 1, 0.78);
    if (look.number) {
      // 背番号
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = '#' + look.cap.toString(16).padStart(6, '0');
      g.font = 'bold 44px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(look.number, 32, 34);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      num.position.set(0, 0.05, -0.13);
      num.rotation.y = Math.PI;
      this.torso.add(num);
    }

    // 頭と帽子（ヘルメット）
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
    headMesh.scale.set(0.9, 1.05, 0.95);
    headMesh.castShadow = true;
    const neck = new THREE.Mesh(capsule(0.05, 0.06), skin);
    neck.position.y = -0.14;
    this.head.add(headMesh, neck);
    if (look.kind === 'umpire') {
      const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.113, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capM);
      capTop.position.y = 0.03;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 16, 1, false, -Math.PI / 2, Math.PI), capM);
      brim.position.set(0, 0.03, 0.07);
      this.head.add(capTop, brim);
    } else if (look.helmet) {
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.128, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), capM);
      helm.position.y = 0.0;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), capM);
      brim.position.set(0, 0.015, 0.09);
      const flap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), capM);
      flap.scale.set(0.5, 1, 1);
      flap.position.set(0.11, -0.04, 0);
      this.head.add(helm, brim, flap);
    } else {
      const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.114, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capM);
      capTop.position.y = 0.03;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), capM);
      brim.position.set(0, 0.03, 0.08);
      brim.scale.set(1, 1, 1.2);
      this.head.add(capTop, brim);
    }
    this.group.add(this.head);

    const sleeve = look.kind === 'umpire' ? jersey : jersey;
    this.limbs.lUp = add(new THREE.Mesh(capsule(0.055, UPPER_ARM), sleeve));
    this.limbs.rUp = add(new THREE.Mesh(capsule(0.055, UPPER_ARM), sleeve));
    this.limbs.lLo = add(new THREE.Mesh(capsule(0.045, FOREARM), look.kind === 'manager' ? jersey : skin));
    this.limbs.rLo = add(new THREE.Mesh(capsule(0.045, FOREARM), look.kind === 'manager' ? jersey : skin));
    this.limbs.lTh = add(new THREE.Mesh(capsule(0.075, THIGH), pants));
    this.limbs.rTh = add(new THREE.Mesh(capsule(0.075, THIGH), pants));
    this.limbs.lSh = add(new THREE.Mesh(capsule(0.058, SHIN), socks));
    this.limbs.rSh = add(new THREE.Mesh(capsule(0.058, SHIN), socks));
    const footGeo = new THREE.BoxGeometry(0.1, 0.07, 0.27);
    this.lFootM = add(new THREE.Mesh(footGeo, shoe));
    this.rFootM = add(new THREE.Mesh(footGeo, shoe));

    // 部位の名前（確認用: 何が何を隠しているかを調べる）
    for (const [k, m] of Object.entries(this.limbs)) m.name = k;
    this.pelvisM.name = 'pelvis';
    this.torso.name = 'torso';
    this.head.name = 'head';
    this.lFootM.name = 'lFoot';
    this.rFootM.name = 'rFoot';
    const handGeo = new THREE.SphereGeometry(0.048, 10, 8);
    const makeGlove = () => {
      const g = new THREE.Group();
      const leather = mat(0x8a4b1f, 0.6);
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), leather);
      body.scale.set(0.95, 1.15, 0.5);
      body.castShadow = true;
      const pocket = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), mat(0x5a2c0e, 0.7));
      pocket.scale.set(1, 1.1, 0.35);
      pocket.position.z = 0.045;
      g.add(body, pocket);
      return g;
    };
    if (look.glove === 'L') {
      this.lHandM = makeGlove();
      (this as { glove: THREE.Object3D | null }).glove = this.lHandM;
      this.group.add(this.lHandM);
    } else {
      this.lHandM = add(new THREE.Mesh(handGeo, skin));
    }
    this.lHandM.name = 'lHand';
    if (look.glove === 'R') {
      this.rHandM = makeGlove();
      (this as { glove: THREE.Object3D | null }).glove = this.rHandM;
      this.group.add(this.rHandM);
    } else {
      this.rHandM = add(new THREE.Mesh(handGeo, skin));
    }
    this.rHandM.name = 'rHand';
  }

  setBat(on: boolean) {
    if (on && !this.batM) {
      const g = new THREE.CylinderGeometry(0.033, 0.017, 0.84, 10);
      g.translate(0, 0.42 - 0.08, 0); // グリップを手の位置に
      this.batM = new THREE.Mesh(g, mat(0xd8b27a, 0.5));
      this.batM.castShadow = true;
      this.group.add(this.batM);
    }
    if (this.batM) this.batM.visible = on;
  }

  // 肩の位置だけ先に知りたいとき（一塁手の伸びの計算用）
  shoulder(p: RigPose, side: 'L' | 'R', out: V3) {
    const { spine, rS, chest } = this.frame(p);
    return out
      .copy(chest)
      .addScaledVector(rS, side === 'R' ? SHOULDER_W : -SHOULDER_W)
      .addScaledVector(spine, -0.04);
  }

  private _fw = new V();
  private _rt = new V();
  private _sp = new V();
  private _rs = new V();
  private _ch = new V();
  private frame(p: RigPose) {
    const fw = this._fw.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const rt = this._rt.set(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
    const spine = this._sp.copy(UP).multiplyScalar(Math.cos(p.lean)).addScaledVector(fw, Math.sin(p.lean));
    spine.multiplyScalar(Math.cos(p.side)).addScaledVector(rt, Math.sin(p.side)).normalize();
    const rS = this._rs.copy(rt).applyAxisAngle(spine, p.twist);
    rS.addScaledVector(spine, -rS.dot(spine)).normalize();
    const chest = this._ch.copy(p.pelvis).addScaledVector(spine, SPINE);
    return { fw, rt, spine, rS, chest };
  }

  apply(p: RigPose) {
    const j = this.j;
    const { fw, rt, spine, rS, chest } = this.frame(p);
    j.chest.copy(chest);
    j.lSh.copy(chest).addScaledVector(rS, -SHOULDER_W).addScaledVector(spine, -0.04);
    j.rSh.copy(chest).addScaledVector(rS, SHOULDER_W).addScaledVector(spine, -0.04);
    j.lHip.copy(p.pelvis).addScaledVector(rt, -HIP_W).addScaledVector(UP, -0.05);
    j.rHip.copy(p.pelvis).addScaledVector(rt, HIP_W).addScaledVector(UP, -0.05);

    // 胴体: 縦 = 背骨、横 = 肩
    const zAxis = new V().crossVectors(spine, rS).normalize(); // 前
    const xAxis = new V().crossVectors(spine, zAxis).normalize();
    tmpM.makeBasis(xAxis, spine, zAxis);
    this.torso.quaternion.setFromRotationMatrix(tmpM);
    this.torso.position.copy(p.pelvis).addScaledVector(spine, 0.27);
    // 腰
    const pz = fw.clone();
    const px = new V().crossVectors(UP, pz).normalize();
    tmpM.makeBasis(px, UP, pz);
    this.pelvisM.quaternion.setFromRotationMatrix(tmpM);
    this.pelvisM.position.copy(p.pelvis);
    // 頭
    j.head.copy(chest).addScaledVector(spine, 0.24);
    this.head.position.copy(j.head);
    this.head.rotation.set(0, 0, 0);
    this.head.quaternion.setFromRotationMatrix(tmpM.makeBasis(xAxis, spine, zAxis));
    this.head.rotateY(p.headYaw);
    this.head.rotateX(p.headPitch);

    // 脚（膝は前へ）
    const kd = p.kneeDown ?? 0;
    const kneePole = (yaw: number) => {
      const y = Number.isNaN(yaw) ? p.yaw : yaw;
      return new V(Math.sin(y) * (1 - kd), 0.15 - 1.15 * kd, Math.cos(y) * (1 - kd));
    };
    solveIK(j.lHip, p.lFoot, THIGH, SHIN, kneePole(p.lFootYaw), j.lKnee, j.lAnkle);
    solveIK(j.rHip, p.rFoot, THIGH, SHIN, kneePole(p.rFootYaw), j.rKnee, j.rAnkle);
    placeBetween(this.limbs.lTh, j.lHip, j.lKnee);
    placeBetween(this.limbs.lSh, j.lKnee, j.lAnkle);
    placeBetween(this.limbs.rTh, j.rHip, j.rKnee);
    placeBetween(this.limbs.rSh, j.rKnee, j.rAnkle);
    this.placeFoot(this.lFootM, j.lAnkle, Number.isNaN(p.lFootYaw) ? p.yaw : p.lFootYaw, p.lToe);
    this.placeFoot(this.rFootM, j.rAnkle, Number.isNaN(p.rFootYaw) ? p.yaw : p.rFootYaw, p.rToe);

    // 腕（肘は後ろ下・外へ）
    const defPole = (s: number) => new V().addScaledVector(fw, -0.6).addScaledVector(UP, -0.5).addScaledVector(rS, 0.35 * s);
    solveIK(j.lSh, p.lHand, UPPER_ARM, FOREARM, p.lElbowPole ?? defPole(-1), j.lEl, j.lHand);
    solveIK(j.rSh, p.rHand, UPPER_ARM, FOREARM, p.rElbowPole ?? defPole(1), j.rEl, j.rHand);
    placeBetween(this.limbs.lUp, j.lSh, j.lEl);
    placeBetween(this.limbs.lLo, j.lEl, j.lHand);
    placeBetween(this.limbs.rUp, j.rSh, j.rEl);
    placeBetween(this.limbs.rLo, j.rEl, j.rHand);
    this.lHandM.position.copy(j.lHand);
    this.rHandM.position.copy(j.rHand);
    if (this.glove) {
      // グラブの面（+z）を指定の向きへ。指定がなければ前腕の先の向き
      const dir = p.gloveDir ? p.gloveDir.clone() : new V().subVectors(this.glove === this.lHandM ? j.lHand : j.rHand, this.glove === this.lHandM ? j.lEl : j.rEl);
      dir.normalize();
      const upHint = Math.abs(dir.y) > 0.9 ? fw : UP;
      const gx = new V().crossVectors(upHint, dir).normalize();
      const gy = new V().crossVectors(dir, gx).normalize();
      this.glove.quaternion.setFromRotationMatrix(tmpM.makeBasis(gx, gy, dir));
      // ボールが網に収まって見えるよう、グラブ本体を手の位置より少し後ろへ
      this.glove.position.addScaledVector(dir, -0.07);
    }
    if (this.batM) {
      if (p.bat) {
        this.batM.visible = true;
        this.batM.position.addVectors(j.lHand, j.rHand).multiplyScalar(0.5);
        this.batM.quaternion.setFromUnitVectors(Y, p.bat.clone().normalize());
      } else this.batM.visible = false;
    }
  }

  private placeFoot(m: THREE.Mesh, ankle: V3, yaw: number, toe: number) {
    m.rotation.set(0, 0, 0);
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw;
    m.rotation.x = toe;
    const f = new V(0, -0.045, 0.07).applyEuler(m.rotation);
    m.position.copy(ankle).add(f);
  }

  setVisible(on: boolean) {
    this.group.visible = on;
  }
}

// ---- ローカル座標の姿勢（キーフレーム用） ----
// x = 右、y = 上、z = 前。足・手は立ち位置（地面）からの位置。
export type LocalPose = {
  p: [number, number, number]; // 腰
  lean: number;
  side: number;
  twist: number;
  hy: number; // 頭の向き
  hp: number;
  lf: [number, number, number];
  rf: [number, number, number];
  lh: [number, number, number];
  rh: [number, number, number];
  lfy?: number; // 足の向き（体の向きに対して）
  rfy?: number;
  bat?: [number, number, number];
  yo?: number; // 体の向き（立ち位置の向きに対して。左回りが正）
};

export function lerpLocal(a: LocalPose, b: LocalPose, u: number): LocalPose {
  const l = (x: number, y: number) => x + (y - x) * u;
  const l3 = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [
    l(x[0], y[0]),
    l(x[1], y[1]),
    l(x[2], y[2]),
  ];
  return {
    p: l3(a.p, b.p),
    lean: l(a.lean, b.lean),
    side: l(a.side, b.side),
    twist: l(a.twist, b.twist),
    hy: l(a.hy, b.hy),
    hp: l(a.hp, b.hp),
    lf: l3(a.lf, b.lf),
    rf: l3(a.rf, b.rf),
    lh: l3(a.lh, b.lh),
    rh: l3(a.rh, b.rh),
    lfy: l(a.lfy ?? 0, b.lfy ?? 0),
    rfy: l(a.rfy ?? 0, b.rfy ?? 0),
    bat: a.bat && b.bat ? l3(a.bat, b.bat) : (u < 0.5 ? a.bat : b.bat),
    yo: l(a.yo ?? 0, b.yo ?? 0),
  };
}

export function sampleKeys(keys: [number, LocalPose][], t: number): LocalPose {
  if (t <= keys[0][0]) return keys[0][1];
  const n = keys.length;
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i];
  const [t1, b] = keys[i + 1];
  const u = (t - t0) / (t1 - t0);
  return lerpLocal(a, b, u * u * (3 - 2 * u));
}

// 左右を入れ替える（左打者・左投げ）
export function mirrorLocal(a: LocalPose): LocalPose {
  const m = (v: [number, number, number]): [number, number, number] => [-v[0], v[1], v[2]];
  return {
    p: m(a.p),
    lean: a.lean,
    side: -a.side,
    twist: -a.twist,
    hy: -a.hy,
    hp: a.hp,
    lf: m(a.rf),
    rf: m(a.lf),
    lh: m(a.rh),
    rh: m(a.lh),
    lfy: -(a.rfy ?? 0),
    rfy: -(a.lfy ?? 0),
    bat: a.bat ? m(a.bat) : undefined,
    yo: -(a.yo ?? 0),
  };
}

// ローカル姿勢 → 世界座標の姿勢
export function localToRig(base: { x: number; y: number; z: number }, yaw: number, lp: LocalPose, out: RigPose) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = -Math.cos(yaw);
  const rz = Math.sin(yaw);
  const w = (v: [number, number, number], o: V3) => o.set(base.x + rx * v[0] + fx * v[2], base.y + v[1], base.z + rz * v[0] + fz * v[2]);
  w(lp.p, out.pelvis);
  out.yaw = yaw + (lp.yo ?? 0);
  out.lean = lp.lean;
  out.side = lp.side;
  out.twist = lp.twist;
  out.headYaw = lp.hy;
  out.headPitch = lp.hp;
  w(lp.lf, out.lFoot);
  w(lp.rf, out.rFoot);
  w(lp.lh, out.lHand);
  w(lp.rh, out.rHand);
  out.lFootYaw = out.yaw + (lp.lfy ?? 0);
  out.rFootYaw = out.yaw + (lp.rfy ?? 0);
  out.lToe = 0;
  out.rToe = 0;
  out.lElbowPole = null;
  out.rElbowPole = null;
  out.gloveDir = null;
  if (lp.bat) {
    out.bat = (out.bat ?? new V()).set(rx * lp.bat[0] + fx * lp.bat[2], lp.bat[1], rz * lp.bat[0] + fz * lp.bat[2]);
  } else out.bat = null;
  return out;
}
