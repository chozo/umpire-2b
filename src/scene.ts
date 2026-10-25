import * as THREE from 'three';
import {
  BAG_HEIGHT,
  BAG_SIZE,
  BASE_DIST,
  F,
  MOUND,
  MOUND_HEIGHT,
  SECOND_BASE,
  U,
  lineToWorld,
  type Vec3,
} from './config';
import { yawOf } from './play';
import type { Dugout } from './actors';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const crowdTex = () =>
  canvasTexture(512, 128, (g) => {
    g.fillStyle = '#4b5361';
    g.fillRect(0, 0, 512, 128);
    const cols = ['#e9e3d6', '#c43d3d', '#2d4f9a', '#f0c23b', '#ffffff', '#30343c', '#7a8899', '#1d2a4f'];
    for (let i = 0; i < 7000; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.fillRect(Math.random() * 512, Math.random() * 128, 2, 3);
    }
    // 通路
    g.fillStyle = 'rgba(40,44,52,0.9)';
    for (let y = 30; y < 128; y += 32) g.fillRect(0, y, 512, 2);
  });

export function buildStadium(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  scene.background = canvasTexture(4, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#3f7fd0');
    grd.addColorStop(0.55, '#9cc8ef');
    grd.addColorStop(1, '#dcebf5');
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 256);
  });
  scene.fog = new THREE.Fog(0xcfe2f0, 80, 260);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a6b2a, 1.35));
  const sun = new THREE.DirectionalLight(0xfff3df, 2.5);
  // 影は二塁ベースのまわりを細かく（スライディングとタッチが分かるように）
  const focus = { x: SECOND_BASE.x + 2, z: SECOND_BASE.z + 2 };
  sun.position.set(focus.x - 10, 24, focus.z + 12);
  sun.target.position.set(focus.x, 0, focus.z);
  sun.castShadow = true;
  const big = renderer.capabilities.maxTextureSize >= 4096;
  sun.shadow.mapSize.set(big ? 2048 : 1024, big ? 2048 : 1024);
  const sc = sun.shadow.camera;
  sc.left = -13;
  sc.right = 13;
  sc.top = 13;
  sc.bottom = -13;
  sc.near = 5;
  sc.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // 芝（縞模様）
  const grassTex = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#3f8a37';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#4a9a40';
    g.fillRect(0, 0, 64, 32);
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(1, 40);
  grassTex.magFilter = THREE.NearestFilter;
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.rotation.z = Math.PI / 4;
  grass.receiveShadow = true;
  scene.add(grass);

  const dirtTex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#b07a4a';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(140,92,52,0.35)' : 'rgba(205,150,100,0.3)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  });
  dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping;
  dirtTex.repeat.set(30, 30);
  const dirt = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 });
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  // 内野の土（扇形）と内野の芝
  flat(new THREE.CircleGeometry(29, 72), dirt, MOUND.x, MOUND.z, 0.004);
  const infieldGrass = new THREE.MeshStandardMaterial({ color: 0x4a9a40, roughness: 1 });
  const d = BASE_DIST / Math.SQRT2;
  const diamond = new THREE.Shape();
  diamond.moveTo(0, 2.8);
  diamond.lineTo(d - 2.8, d);
  diamond.lineTo(0, 2 * d - 2.8);
  diamond.lineTo(-(d - 2.8), d);
  diamond.closePath();
  const dm = new THREE.Mesh(new THREE.ShapeGeometry(diamond), infieldGrass);
  dm.rotation.x = -Math.PI / 2;
  dm.position.y = 0.008;
  dm.receiveShadow = true;
  scene.add(dm);
  // 本塁・一塁まわりの土、一塁線の走路
  flat(new THREE.CircleGeometry(3.96, 48), dirt, 0, -0.2, 0.012);
  const b1 = lineToWorld(BASE_DIST, 0);
  flat(new THREE.CircleGeometry(3.2, 40), dirt, b1.x, b1.z, 0.012);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.9, BASE_DIST), dirt);
  lane.rotation.order = 'YXZ';
  lane.rotation.set(-Math.PI / 2, yawOf(U.x, U.z), 0);
  const lc = lineToWorld(BASE_DIST / 2, -0.45);
  lane.position.set(lc.x, 0.01, lc.z);
  lane.receiveShadow = true;
  scene.add(lane);
  // マウンド
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.74, MOUND_HEIGHT, 48), dirt);
  mound.position.set(MOUND.x, MOUND_HEIGHT / 2, MOUND.z);
  mound.receiveShadow = true;
  scene.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.03, 0.15), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  rubber.position.set(MOUND.x, MOUND_HEIGHT + 0.01, MOUND.z);
  scene.add(rubber);

  // チョークの線
  const chalk = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.9 });
  const line = (a: Vec3, b: Vec3, w = 0.07) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), chalk);
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2, Math.atan2(-(b.x - a.x), -(b.z - a.z)), 0);
    m.position.set((a.x + b.x) / 2, 0.016, (a.z + b.z) / 2);
    m.receiveShadow = true;
    scene.add(m);
  };
  for (const s of [1, -1]) {
    line({ x: s * 0.9, y: 0, z: -0.9 }, { x: s * 100, y: 0, z: -100 });
    const xi = s * 0.37;
    const xo = s * 1.59;
    line({ x: xi, y: 0, z: -1.15 }, { x: xi, y: 0, z: 0.68 }, 0.05);
    line({ x: xo, y: 0, z: -1.15 }, { x: xo, y: 0, z: 0.68 }, 0.05);
    line({ x: xi, y: 0, z: -1.15 }, { x: xo, y: 0, z: -1.15 }, 0.05);
    line({ x: xi, y: 0, z: 0.68 }, { x: xo, y: 0, z: 0.68 }, 0.05);
  }
  // 走路（スリーフットライン）
  line(lineToWorld(BASE_DIST / 2, -0.91), lineToWorld(BASE_DIST, -0.91));
  line(lineToWorld(BASE_DIST / 2, -0.91), lineToWorld(BASE_DIST / 2, 0));

  // ベース
  const bagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
  const bag = (c: Vec3, yaw: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(BAG_SIZE, BAG_HEIGHT, BAG_SIZE), bagMat);
    m.position.set(c.x, BAG_HEIGHT / 2, c.z);
    m.rotation.y = yaw;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const b1c = lineToWorld(BASE_DIST - BAG_SIZE / 2, BAG_SIZE / 2);
  bag(b1c, yawOf(U.x, U.z));
  bag({ x: SECOND_BASE.x, y: 0, z: SECOND_BASE.z }, Math.PI / 4);
  bag({ x: -b1c.x, y: 0, z: b1c.z }, Math.PI / 4);
  // 二塁ベースまわりの土（スライディングの跡がつくところ）
  flat(new THREE.CircleGeometry(3.4, 40), dirt, SECOND_BASE.x, SECOND_BASE.z, 0.013);
  const plate = new THREE.Shape();
  [
    [-0.216, 0],
    [0.216, 0],
    [0.216, 0.216],
    [0, 0.432],
    [-0.216, 0.216],
  ].forEach(([x, z], i) => (i === 0 ? plate.moveTo(x, -z + 0.216) : plate.lineTo(x, -z + 0.216)));
  plate.closePath();
  const pm = new THREE.Mesh(new THREE.ExtrudeGeometry(plate, { depth: 0.02, bevelEnabled: false }), bagMat);
  pm.rotation.x = -Math.PI / 2;
  pm.position.set(0, 0, -0.216);
  pm.receiveShadow = true;
  scene.add(pm);

  // 外野フェンスとスタンド
  const fenceR = 112;
  const fence = new THREE.Mesh(
    new THREE.CylinderGeometry(fenceR, fenceR, 4, 96, 1, true, Math.PI * 0.75, Math.PI * 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1f5a3a, side: THREE.BackSide }),
  );
  fence.position.set(0, 2, 0);
  scene.add(fence);
  const ct = crowdTex();
  ct.wrapS = THREE.RepeatWrapping;
  ct.repeat.set(8, 1);
  const outStands = new THREE.Mesh(
    new THREE.CylinderGeometry(fenceR + 40, fenceR + 2, 26, 96, 1, true, Math.PI * 0.72, Math.PI * 0.56),
    new THREE.MeshStandardMaterial({ map: ct, side: THREE.BackSide, roughness: 1 }),
  );
  outStands.position.set(0, 17, 0);
  scene.add(outStands);

  // 内野スタンド: 一塁側 → 本塁の後ろ → 三塁側
  const path: { x: number; z: number; nx: number; nz: number }[] = [];
  const wallL = -19;
  for (let s = 92; s >= 8; s -= 4) {
    const p = lineToWorld(s, wallL);
    path.push({ x: p.x, z: p.z, nx: -F.x, nz: -F.z });
  }
  const start = lineToWorld(8, wallL);
  const R = Math.hypot(start.x, start.z);
  const a0 = Math.atan2(start.z, start.x);
  for (let i = 1; i < 16; i++) {
    const a = a0 + ((Math.PI - 2 * a0) * i) / 16;
    path.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, nx: Math.cos(a), nz: Math.sin(a) });
  }
  for (let s = 8; s <= 92; s += 4) {
    const p = lineToWorld(s, wallL);
    path.push({ x: -p.x, z: p.z, nx: F.x, nz: -F.z });
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const wpos: number[] = [];
  let acc = 0;
  path.forEach((p, i) => {
    if (i > 0) acc += Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z);
    const u = acc / 16;
    pos.push(p.x, 1.4, p.z, p.x + p.nx * 30, 17, p.z + p.nz * 30);
    uv.push(u, 1, u, 0);
    wpos.push(p.x, 0, p.z, p.x, 1.4, p.z);
  });
  const idx: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sg.setIndex(idx);
  sg.computeVertexNormals();
  const ct2 = crowdTex();
  ct2.wrapS = THREE.RepeatWrapping;
  scene.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: ct2, roughness: 1, side: THREE.DoubleSide })));
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  wg.setIndex(idx);
  wg.computeVertexNormals();
  scene.add(new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x1f4a6a, roughness: 0.9, side: THREE.DoubleSide })));
  // バックネット
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(R - 0.5, R - 0.5, 9, 32, 1, true, Math.PI * 0.5 - (Math.PI / 2 - a0) * 0.7, (Math.PI / 2 - a0) * 1.4),
    new THREE.MeshBasicMaterial({ color: 0x223040, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  net.rotation.y = 0;
  net.position.set(0, 5.9, 0);
  scene.add(net);

  // ベンチ（一塁側 = 守備側、三塁側 = 攻撃側）
  const dugouts = {
    home: buildDugout(scene, 1),
    away: buildDugout(scene, -1),
  };
  return { sun, dugouts };
}

function buildDugout(scene: THREE.Scene, side: 1 | -1): Dugout {
  // side = 1: 一塁側。前面はフェア側を向く
  const c = lineToWorld(16, -16.2);
  const pos = { x: c.x * side, y: 0, z: c.z };
  const fw = { x: F.x * side, z: F.z };
  const yaw = yawOf(fw.x, fw.z);
  const g = new THREE.Group();
  g.position.set(pos.x, 0, pos.z);
  g.rotation.y = yaw;
  scene.add(g);
  const W = 12;
  const D = 2.6;
  const wall = new THREE.MeshStandardMaterial({ color: 0x2a3442, roughness: 0.9 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x1f2a38, roughness: 0.8 });
  const floorM = new THREE.MeshStandardMaterial({ color: 0x55606e, roughness: 1 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
    return b;
  };
  box(W, 0.02, D, 0, 0.01, -D / 2, floorM);
  box(W, 2.4, 0.2, 0, 1.2, -D, wall); // 奥の壁
  box(0.2, 2.4, D, -W / 2, 1.2, -D / 2, wall);
  box(0.2, 2.4, D, W / 2, 1.2, -D / 2, wall);
  box(W + 0.4, 0.15, D + 0.4, 0, 2.45, -D / 2 + 0.1, roofM);
  // 前の手すり（真ん中は出入り口）
  const rail = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.5 });
  box(W / 2 - 0.9, 0.06, 0.06, -(W / 4 + 0.45), 1.0, 0.0, rail);
  box(W / 2 - 0.9, 0.06, 0.06, W / 4 + 0.45, 1.0, 0.0, rail);
  box(W / 2 - 0.9, 0.5, 0.05, -(W / 4 + 0.45), 0.25, 0.0, wall);
  box(W / 2 - 0.9, 0.5, 0.05, W / 4 + 0.45, 0.25, 0.0, wall);
  // ベンチ
  box(W - 1, 0.45, 0.45, 0, 0.225, -D + 0.45, new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 }));
  const back = { x: pos.x - fw.x * (D - 0.75), y: 0, z: pos.z - fw.z * (D - 0.75) };
  return { pos, yaw, back };
}

// ---- ボール ----
export class BallView {
  readonly mesh: THREE.Mesh;
  constructor(scene: THREE.Scene) {
    const tex = canvasTexture(128, 64, (g) => {
      g.fillStyle = '#fbfaf4';
      g.fillRect(0, 0, 128, 64);
      g.strokeStyle = '#c8323a';
      g.lineWidth = 3;
      g.beginPath();
      for (let x = 0; x <= 128; x += 2) {
        const y = 32 + Math.sin((x / 128) * Math.PI * 4) * 16;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    });
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.037, 20, 14),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.5 }),
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  // 遠くても見えるよう、カメラから遠いほど少し大きく描く（近くでは実寸）
  place(p: { x: number; y: number; z: number }, cam: THREE.Camera, boost = true) {
    this.mesh.position.set(p.x, p.y, p.z);
    const d = cam.position.distanceTo(this.mesh.position);
    this.mesh.scale.setScalar(boost ? Math.min(3.5, Math.max(1, d / 9)) : 1);
    this.mesh.rotation.x += 0.4;
  }
}

// リプレイで出来事の瞬間に出す輪
export class Marker {
  readonly sprite: THREE.Sprite;
  private k = 1;
  constructor(scene: THREE.Scene, color: string) {
    const tex = canvasTexture(128, 128, (g) => {
      g.strokeStyle = color;
      g.lineWidth = 10;
      g.beginPath();
      g.arc(64, 64, 52, 0, Math.PI * 2);
      g.stroke();
    });
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    this.sprite.renderOrder = 40;
    this.sprite.visible = false;
    scene.add(this.sprite);
  }
  show(p: { x: number; y: number; z: number }, size: number) {
    this.sprite.position.set(p.x, p.y, p.z);
    this.sprite.scale.setScalar(size);
    this.sprite.visible = true;
    this.k = 0;
  }
  hide() {
    this.sprite.visible = false;
  }
  tick(dt: number) {
    if (!this.sprite.visible) return;
    this.k = Math.min(1, this.k + dt * 3);
    (this.sprite.material as THREE.SpriteMaterial).opacity = 0.35 + 0.65 * (1 - this.k * 0.5);
  }
}

// リクエストの仕草の軌跡（両手で描く四角）。太く見えるよう管で描く
export class Trail {
  private mesh: THREE.Mesh | null = null;
  private mat: THREE.MeshBasicMaterial;
  private scene: THREE.Scene;
  constructor(scene: THREE.Scene, color = 0xffe14d) {
    this.scene = scene;
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
  }
  clear() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }
  // 左手の軌跡を逆順に、右手の軌跡をそのままつなげて一本の線にする
  set(left: THREE.Vector3[], right: THREE.Vector3[]) {
    const pts = [...left.slice().reverse(), ...right];
    this.clear();
    if (pts.length < 2) return;
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 1e-4) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    if (path.curves.length === 0) return;
    this.mesh = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(4, path.curves.length * 2), 0.014, 6, false), this.mat);
    this.mesh.renderOrder = 30;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  setOpacity(o: number) {
    this.mat.opacity = o;
    if (this.mesh) this.mesh.visible = o > 0.01;
  }
}
