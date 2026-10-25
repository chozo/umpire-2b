import * as THREE from 'three';
import { BAG_FACE_S, CAMERA, F, U, pathToWorld } from './config';
import { LEAD_FOOT_L, fwdOf, type Play } from './play';
import type { Dugout } from './actors';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (u: number) => {
  const k = clamp(u, 0, 1);
  return k * k * (3 - 2 * k);
};
const V = THREE.Vector3;

// 塁審の立ち位置: 投球は二塁の三塁側（内野の内側）から見て、捕手が捕ったら
// 走路の内野側（走路から約5.8m）へ動いて、足とタッチを横から見る
export function umpireSpots(p: Play) {
  const S0 = new V(CAMERA.start.x, CAMERA.eyeY, CAMERA.start.z);
  const s1 = pathToWorld(BAG_FACE_S + CAMERA.judgeS, CAMERA.judgeL, CAMERA.eyeY);
  // 判定のときに見る点（向きを計算するときの最初の目安）: ベースの面の少し手前の足の高さと、捕球点の間
  const foot = pathToWorld(BAG_FACE_S - 0.75, LEAD_FOOT_L, 0.1);
  const C = p.th.C;
  const J = new V(foot.x + (C.x - foot.x) * 0.15, 0.2 + 0.25 * C.y, foot.z + (C.z - foot.z) * 0.15);
  return { S0, S1: new V(s1.x, s1.y, s1.z), J };
}
export type Spots = ReturnType<typeof umpireSpots>;

// 塁審の位置（時刻 t）: 捕手が捕るころから判定位置へ動く
export function umpirePos(p: Play, t: number, spots: Spots, out = new V()) {
  return out.lerpVectors(spots.S0, spots.S1, smooth((t - p.tCatcher + 0.1) / 1.2));
}

// 点の集まりが画面の余白の内側に収まる向きと画角。点の真ん中へ向け、fovMin で入らなければ画角を広げる
const fitCam = new THREE.PerspectiveCamera();
const tmpP = new V();
export function fitView(from: THREE.Vector3, look0: THREE.Vector3, pts: THREE.Vector3[], aspect: number, fovMin: number, fovMax = CAMERA.fovMax) {
  const m = CAMERA.margin;
  const dist = Math.max(1, look0.distanceTo(from));
  const J = look0.clone();
  let fov = fovMin;
  if (!pts.length) return { look: J, fov };
  for (let it = 0; it < 6; it++) {
    fitCam.position.copy(from);
    fitCam.lookAt(J);
    fitCam.updateMatrixWorld(true);
    fitCam.matrixWorldInverse.copy(fitCam.matrixWorld).invert();
    // カメラの向きを基準にした各点の tan（右・上）。体の太さの分だけ広げる
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of pts) {
      tmpP.copy(q).applyMatrix4(fitCam.matrixWorldInverse);
      const d = Math.max(0.3, -tmpP.z);
      const pad = CAMERA.pad / d;
      x0 = Math.min(x0, tmpP.x / d - pad);
      x1 = Math.max(x1, tmpP.x / d + pad);
      y0 = Math.min(y0, tmpP.y / d - pad);
      y1 = Math.max(y1, tmpP.y / d + pad);
    }
    // 使える範囲（tan）: 左右は side、上は top（得点などの表示の下）、下は bottom の余白を除く
    const tv = Math.max(
      Math.tan(THREE.MathUtils.degToRad(fovMin / 2)),
      (x1 - x0) / (2 * aspect * (1 - 2 * m.side)),
      (y1 - y0) / (2 - 2 * m.top - 2 * m.bottom),
    );
    fov = Math.min(fovMax, THREE.MathUtils.radToDeg(2 * Math.atan(tv)));
    const T = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    // 点の真ん中が、使える範囲の真ん中に来るように向ける
    const sx = (x0 + x1) / 2;
    const sy = (y0 + y1) / 2 - (T * (1 - 2 * m.top) - T * (1 - 2 * m.bottom)) / 2;
    if (Math.abs(sx) < 1e-4 && Math.abs(sy) < 1e-4) break;
    const right = new V(1, 0, 0).applyQuaternion(fitCam.quaternion);
    const up = new V(0, 1, 0).applyQuaternion(fitCam.quaternion);
    const fwd = new V(0, 0, -1).applyQuaternion(fitCam.quaternion);
    J.copy(from).add(fwd.add(right.multiplyScalar(sx)).add(up.multiplyScalar(sy)).normalize().multiplyScalar(dist));
  }
  return { look: J, fov };
}

// 向き（dir）を決めたまま、点の集まりが余白の内側に入る最小の画角（fovMin 以上、fovMax まで）
export function fovToContain(from: THREE.Vector3, dir: THREE.Vector3, pts: THREE.Vector3[], aspect: number, fovMin: number, fovMax = CAMERA.fovMax) {
  const m = CAMERA.margin;
  fitCam.position.copy(from);
  fitCam.lookAt(from.x + dir.x, from.y + dir.y, from.z + dir.z);
  fitCam.updateMatrixWorld(true);
  fitCam.matrixWorldInverse.copy(fitCam.matrixWorld).invert();
  let T = Math.tan(THREE.MathUtils.degToRad(fovMin / 2));
  for (const q of pts) {
    tmpP.copy(q).applyMatrix4(fitCam.matrixWorldInverse);
    const d = Math.max(0.3, -tmpP.z);
    const pad = CAMERA.pad / d;
    T = Math.max(T, (Math.abs(tmpP.x / d) + pad) / (aspect * (1 - 2 * m.side)), (tmpP.y / d + pad) / (1 - 2 * m.top), (-tmpP.y / d + pad) / (1 - 2 * m.bottom));
  }
  return Math.min(fovMax, THREE.MathUtils.radToDeg(2 * Math.atan(T)));
}

// 塁審の目線の動き（プレーを作ったときに先に計算しておく）: 時刻ごとの見る向き（単位ベクトル）と画角
export type CamTrack = { spots: Spots; t0: number; dt: number; dir: THREE.Vector3[]; fov: number[]; raw?: number[]; tFreeze?: number; frozenFov?: number };

// 塁審の目線（時刻 t の関数。リプレイでも同じ動きになる）
export function umpireCamAt(p: Play, t: number, cam: THREE.PerspectiveCamera, tr: CamTrack) {
  umpirePos(p, t, tr.spots, cam.position);
  const n = tr.dir.length;
  const u = clamp((t - tr.t0) / tr.dt, 0, n - 1);
  const i = Math.min(n - 2, Math.floor(u));
  const k = u - i;
  const d = tmpP.copy(tr.dir[i]).lerp(tr.dir[i + 1], k).normalize();
  cam.lookAt(cam.position.x + d.x, cam.position.y + d.y, cam.position.z + d.z);
  cam.fov = tr.fov[i] + (tr.fov[i + 1] - tr.fov[i]) * k;
  cam.updateProjectionMatrix();
}

// リプレイ上: 足とベースを横から低く（内野側）
export function footCam(_p: Play, cam: THREE.PerspectiveCamera) {
  // 地面すれすれから、ベースの面と靴の先に寄る（タッチに来る野手の脚の下から見る）
  const pos = pathToWorld(BAG_FACE_S - 0.3, -1.45, 0.11);
  const look = pathToWorld(BAG_FACE_S - 0.12, LEAD_FOOT_L + 0.05, 0.07);
  cam.position.set(pos.x, pos.y, pos.z);
  cam.lookAt(look.x, look.y, look.z);
  cam.fov = 30;
  cam.updateProjectionMatrix();
}

// リプレイ下: グラブと走者が触れるところを、斜め上の一塁側から
export function tagCam(p: Play, cam: THREE.PerspectiveCamera) {
  const P = p.tag.P;
  cam.position.set(P.x - F.x * 1.0 - U.x * 1.5, P.y + 0.95, P.z - F.z * 1.0 - U.z * 1.5);
  cam.lookAt(P.x + F.x * 0.1, P.y + 0.05, P.z + F.z * 0.1);
  cam.fov = 34;
  cam.updateProjectionMatrix();
}

// 監督のアップ（c: 演出の経過時間）
export function managerCam(d: Dugout, c: number, cam: THREE.PerspectiveCamera) {
  const fw = fwdOf(d.yaw);
  const front = { x: d.pos.x + fw.x * 1.2, z: d.pos.z + fw.z * 1.2 };
  const dist = 5.4 - 1.2 * smooth(c / 2.4);
  const side = { x: -fw.z, z: fw.x };
  cam.position.set(front.x + fw.x * dist + side.x * 1.0, 1.45, front.z + fw.z * dist + side.z * 1.0);
  cam.lookAt(front.x, 1.3, front.z);
  cam.fov = 38;
  cam.updateProjectionMatrix();
}

