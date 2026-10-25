// 調整値をまとめる。単位は m・秒。
// 座標: 本塁が原点、y が上。投手は -z 方向、二塁は (0, -38.8)。一塁は +x 側。

export type Vec3 = { x: number; y: number; z: number };

export const BASE_DIST = 27.43; // 塁間
export const BAG_SIZE = 0.381; // ベースの一辺
export const BAG_HEIGHT = 0.08;
export const DIAMOND_HALF = BASE_DIST / Math.SQRT2; // 本塁から一塁までの x（= 一塁の -z）

// 盗塁の走路（一塁 → 二塁）の向き F と、走路から外野側に向かう向き U
export const F = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
export const U = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
export const FIRST_BASE = { x: DIAMOND_HALF, z: -DIAMOND_HALF };
export const SECOND_BASE = { x: 0, z: -2 * DIAMOND_HALF };

// 走路に沿った距離 s（一塁の角から）と、走路から外野側への距離 l を世界座標に直す
export function pathToWorld(s: number, l: number, y = 0): Vec3 {
  return { x: FIRST_BASE.x + F.x * s + U.x * l, y, z: FIRST_BASE.z + F.z * s + U.z * l };
}
export function worldToPath(p: { x: number; z: number }) {
  const dx = p.x - FIRST_BASE.x;
  const dz = p.z - FIRST_BASE.z;
  return { s: dx * F.x + dz * F.z, l: dx * U.x + dz * U.z };
}

// 一塁線に沿った距離 s と、線からフェア側への距離 l（スタジアムを作るときに使う。本塁が原点）
export function lineToWorld(s: number, l: number, y = 0): Vec3 {
  return { x: U.x * s + F.x * l, y, z: U.z * s + F.z * l };
}

// 二塁ベースの中心は二塁の角。走者が触れる面（一塁側の面）の s
export const BAG_S = BASE_DIST;
export const BAG_FACE_S = BASE_DIST - BAG_SIZE / 2;
export const BAG_CENTER = pathToWorld(BAG_S, 0);

export const MOUND = { x: 0, z: -18.44 };
export const MOUND_HEIGHT = 0.25;
// マウンドの高さ（上面の半径 0.9m、裾の半径 2.74m）
export function moundY(x: number, z: number) {
  const r = Math.hypot(x - MOUND.x, z - MOUND.z);
  if (r <= 0.9) return MOUND_HEIGHT;
  if (r >= 2.74) return 0;
  return (MOUND_HEIGHT * (2.74 - r)) / 1.84;
}

export const GAME = {
  maxMisses: 3,
  decisionWindow: 2.0, // 両方が起きてから判定できる時間
  tMove: 1.3, // プレー開始から投手が動き出すまで
  skipLead: 0.3, // 2プレー目以降は、走者が走り出すこの秒数前から始める（投手の動き出しは映さない）
  callDisplay: 1.0,
  resultDisplay: 1.3,
  lateDisplay: 2.0, // 時間切れの表示（正しい判定も読めるように少し長く）
  replaySkipGuard: 0.4,
};

// 段階（何プレー目から）
export const STAGE = {
  tutorial: 3, // 最初の3プレーは明らかなタイミングだけ
  wideThrow: 15, // 送球がそれて、野手が大きく伸びてタッチする
  headSlide: 19, // 20人目から、ヘッドスライディングもする（RUNNER.headRate）
  evade: 29, // 走者がタッチをかわす段階（いまは RUNNER.evadeRate = 0 で出さない）
};

// 得点（「球審ジャッジ」と同じ形）: 正解 100 点、際どいプレーの正解 300 点、早押しボーナス
export const SCORE = {
  correct: 100,
  closeCorrect: 300,
  // 早押しボーナス: 足とタッチの両方が起きてからコールまでの秒数がこの値以内ならその点数
  speedBonus: [
    { within: 0.7, points: 20 },
    { within: 1.0, points: 10 },
  ],
};

// 段階: そのゲームでここまでに正しく判定できた数（練習を含む）で決まる（「一塁塁審ジャッジ」と同じ）。
//   title: 結果画面の称号（最後の正解数で決まる）
//   close: [いちばん小さい差, 際どいとする差]（秒）。
//          1つめより小さい差のプレーは出さない。差が2つめ以下なら「際どいプレー」と判定し、必ずリクエスト・リプレイになる
//   rate: 際どいプレーが出る確率、medium: 中くらいのプレーが出る確率（練習の3プレーを除く。残りは、はっきりしたプレー）
//   いちばん小さい差は約 1/60 秒（1コマ）以上にして、足とタッチが必ず別のコマで起きるようにする
export const LEVELS = [
  { min: 0, title: '草野球の審判', close: [0.035, 0.058], rate: 0.35, medium: 0.35 },
  { min: 10, title: '審判見習い', close: [0.028, 0.05], rate: 0.4, medium: 0.35 },
  { min: 20, title: '二軍の審判', close: [0.022, 0.04], rate: 0.45, medium: 0.35 },
  { min: 30, title: '一軍の審判', close: [0.018, 0.034], rate: 0.5, medium: 0.3 },
  { min: 40, title: '名審判', close: [0.017, 0.027], rate: 0.55, medium: 0.25 },
  { min: 50, title: '神審判', close: [0.017, 0.022], rate: 0.6, medium: 0.2 },
  { min: 100, title: 'AI審判', close: [0.017, 0.022], rate: 0.6, medium: 0.2 },
] as const;

export function levelOf(correct: number) {
  let lv: (typeof LEVELS)[number] = LEVELS[0];
  for (const l of LEVELS) if (correct >= l.min) lv = l;
  return lv;
}

// 難易度: 正解数から、差（秒）の選び方を決める
export function difficulty(correct: number) {
  const lv = levelOf(correct);
  const [closeMin, closeMax] = lv.close;
  return {
    pClose: lv.rate,
    pMedium: lv.medium,
    closeMin, // これより小さい差は出さない
    closeMax, // これ以下の差は「際どい」
    // 際どくないプレー: 中くらいは「際どい」の境目のすぐ上から 0.06 秒の幅、はっきりはその上（0.12 秒以上、幅 0.2 秒）
    mediumMin: closeMax + 0.001,
    mediumMax: closeMax + 0.06,
    clearMin: Math.max(0.12, closeMax + 0.06),
    clearWidth: 0.2,
  };
}

// 投手と捕手（バッテリー）
export const BATTERY = {
  delivery: [0.82, 1.05] as [number, number], // 投手が動き出してから投げるまで（クイック）
  pitchSpeed: [37, 42] as [number, number], // 投球の速さ
  exchange: [0.55, 0.85] as [number, number], // 捕手が捕ってから投げるまで
  throwSpeed: [33, 38] as [number, number], // 捕手の送球の速さ
};

export const RUNNER = {
  lead: [3.2, 3.9] as [number, number], // リードの大きさ（一塁の角からの距離）
  jump: [0.06, 0.22] as [number, number], // 投手が動いてから走り出すまで
  topSpeed: [8.4, 9.3] as [number, number],
  accelTau: 0.62,
  footAheadFrac: 0.15, // 着地の瞬間、足は腰より（歩幅 × この値）前にある
  liftFrac: 0.22, // 腰が着地点を（歩幅 × この値）越えたら足が離れる
  slideDecel: 5.0, // スライディング中の減速
  slideTouchTime: [0.5, 0.7] as [number, number], // 滑り始めてからベースに触れるまで
  slideDrop: 0.28, // 走る姿勢からスライディングの姿勢になるまで
  slideReach: 0.84, // スライディング中、腰から前に伸ばした足首までの距離
  slidePelvisY: 0.25,
  slideAnkleY: 0.1,
  slideAfter: 0.14, // ベースに触れてから腰が進む距離（足がベースで止まる）
  laneL: 0.05, // 走路の横位置（腰）
  // ヘッドスライディング（STAGE.headSlide 人目から、この割合で）: 頭から飛び込み、胸を地面につけて腹ばいで滑る。
  // 両腕は肩から前へまっすぐ伸ばし、左手（両手）でベースに触れる
  headRate: 0.4,
  headLean: 1.5, // 上体の倒し方（rad。π/2 で水平）
  headReach: 1.01, // 腰から、前に伸ばした左手（手の中心）までの距離（肩から腕を伸ばした長さ）
  headPelvisY: 0.17,
  headShoulderY: 0.2,
  headHandY: 0.13, // 手の高さ（ベースの上の縁くらい。腕がほぼ水平に伸びる）
  headHandL: -0.17, // 左手の横位置（腰に対して。内野側が負）。右手は反対側の同じ距離
  // タッチをかわす（STAGE.evade 人目から、この割合で）: 頭から飛び込みながら内野側へ体をずらし、右手を伸ばしてベースの内野側の角に触れる。
  // 難しくなりすぎるので、いまは出さない（0）。確認用に replay({ evade: true }) で作れる
  evadeRate: 0,
  evadeL: -0.68, // ずらした腰の横位置（走路に対して。内野側が負）
  evadeVeer: 0.4, // 滑り始めてから、横へずれ終えるまで（秒）
  evadeHandL: -0.15, // ベースに触れる右手の横位置（ベースの内野側の角の少し内側）
  evadeReach: 0.88, // 腰から、右手（手の中心）までの前の距離
  evadeAfter: 0.04, // ベースに触れてから腰が進む距離（右手でベースの角をつかんで止まる）
  evadeTagK: 0.3, // 追いかけるタッチで触れる点: 右手から右肩の方へこの距離
  headTagK: 0.35, // 振り下ろすタッチで触れる点: 左手から肩の方へこの距離（上腕）
};

// 走者の靴の先: 足首からの前方向の距離（figure.ts の靴の大きさと位置に合わせる）
export const SHOE_FRONT = 0.07 + 0.135;
// 走者の指先: 手の中心からの前方向の距離（figure.ts の手の大きさに合わせる）
export const HAND_FRONT = 0.048;

export const FIELDERS = {
  SS: { name: '遊撃手', pos: { x: -8.5, z: -32.5 } },
  '2B': { name: '二塁手', pos: { x: 8.5, z: -33 } },
};
export type CoverId = keyof typeof FIELDERS;

// ベースに入る野手の走り: 投手が投げる少し前（走者が走ったのを見て）走り出し、加速 → 一定の速さ → 減速してベースに着く
export const COVER_RUN = {
  go: -0.05, // 走り出す時刻（投手が投げる時刻から）
  accel: 0.5, // 一定の速さになるまで
  decel: 0.45, // 止まるまで
  speed: [6.0, 8.3] as [number, number], // 一定の速さ（遅すぎるときは早く着いて待つ。速すぎるプレーは作らない）
  setBefore: 0.3, // 捕る何秒前までに着くか
};

// タッチ
export const TAG = {
  sweepSpeed: 4.2, // 捕ってからタッチへグラブを運ぶ速さ（m/s）
  minDur: 0.1,
  extra: [0, 0.3] as [number, number], // 捕ってからタッチまでの余分な時間
  headStand: [0.3, 0.22] as [number, number], // ヘッドスライディングを振り下ろしでタッチするとき、内側の足を置く位置（ベースの面から二塁側・走路から外野側）
  waitFrom: 0.42, // 捕ってからタッチまでがこれより長ければ、グラブを足の前に置いて待つ
  // かわす走者を追うタッチ: 捕ってからタッチまで chaseDur 秒。捕って chaseSet 秒でグラブをベースの前に置き、
  // 走者がずれ始めたら（滑り始めの chaseReact 秒後から）走者の右腕を追う
  chaseDur: [0.6, 0.85] as [number, number],
  chaseSet: 0.3,
  chaseReact: 0.12,
  chaseMin: 0.18, // 追い始めてからタッチまでの最短
};

export const CAMERA = {
  fov: 38, // 画角（縦）の下限
  eyeY: 1.55,
  start: { x: -5.2, z: -31.5 }, // 投球を見る位置（二塁の三塁側、内野の内側）
  judgeS: 0.5, // 判定位置: ベースの一塁側の面から三塁側へ（大きくすると走者とタッチが近い画角に収まるが、足やグラブが体に隠れやすくなる）
  judgeL: -5.8, // 判定位置: 走路から内野側へ
  // タッチの場面を画面に収める: 余白（画面の割合。上は得点などの表示の下）、体の太さ（m）、広げる画角の上限
  margin: { top: 0.13, bottom: 0.05, side: 0.05 },
  pad: 0.12,
  // 投球を見る（最初のプレーだけ）: 投手が動き出してからこの秒数まで、投手と捕手が入る画角で見て、pitchBlend 秒で走者へ移る
  pitchHold: 0.55,
  pitchBlend: 0.6,
  pitchFovMin: 10,
  leadAngle: 15, // 走者を追うとき、塁審から見て走者とこの角度（°）以内の先（ベースまで）も画面に入れる
  window: 0.07, // 前後この秒数に収めたい点をまとめて向きを決める（走者は速いので短く）
  smooth: 0.1, // 向きと画角をならす幅（秒）
  fovRate: 0.8, // 走者を追う間、1コマ（1/30秒）で広がる画角の上限（°）
  fovRateIn: 2.5, // 走者を追う間、1コマで狭まる画角の上限（°）
  // 捕球: 捕球の catchBefore 秒前から catchAfter 秒後まで、野手・ボール・ベースが入る最小の画角で止める
  catchBefore: 0.25,
  catchAfter: 0.05,
  // タッチ: 足かタッチの早いほうの freeze 秒前から、走者・野手・ベースが入る最小の画角で止める。捕球の場面から寄せる時間が minMove 秒より短いときは、捕球〜タッチを1つの画角で見せる
  freeze: 0.12,
  minMove: 0.2,
  pan: 0.5, // 走者を追う向きから、捕球の向きへ移る時間（秒）の下限。振る角度が大きいときは、1コマ panRate° くらいになるよう延ばす（panMax 秒まで）
  panRate: 2.5,
  panMax: 1.2,
  moveFovRate: 2.0, // 捕球からタッチへ寄せ直す間に、1コマで変わる画角の上限（°）
  moveTurnRate: 2.0, // 捕球からタッチへ寄せ直す間に、1コマで変わる向きの上限（°）
  ballBefore: 0.05, // 捕球のこの秒数前からボールも画面に入れる（飛んでくる途中まで入れると画角が広がりすぎる）
  runnerIn: 0.12, // 走者の全身は、足かタッチの早いほうのこの秒数前から画面に入れる（それまでは画面に入ってくる途中でもよい）
  after: 0.3, // 足とタッチの遅いほうからこの秒数後までの場面も入れる
  closeFov: 32, // 捕球とタッチの画角の下限（°）
  fovMax: 80,
};
