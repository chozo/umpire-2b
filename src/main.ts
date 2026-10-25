import * as THREE from 'three';
import { Cast } from './actors';
import { Sfx, type SfxName } from './audio';
import { fitView, fovToContain, footCam, managerCam, tagCam, umpireCamAt, umpirePos, umpireSpots, type CamTrack } from './camera';
import { BAG_FACE_S, BAG_HEIGHT, BAG_S, BAG_SIZE, CAMERA, GAME, SCORE, STAGE, levelOf, pathToWorld, type Vec3 } from './config';
import { PITCHER_BASE, ballAt, runnerS, generatePlay, leadFront, leadPoint, mulberry32, plantWorld, tagTarget, type Force, type Play } from './play';
import { BallView, Marker, Trail, buildStadium } from './scene';

type Call = 'out' | 'safe';
type Phase = 'title' | 'play' | 'called' | 'request' | 'replay' | 'verdict' | 'result';
type ReplaySub = 'r1' | 'r2' | 'r3';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- 描画の準備 ----
const canvas = $<HTMLCanvasElement>('c');
const view = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const { dugouts } = buildStadium(scene, renderer);
const cast = new Cast(scene, dugouts);
const ball = new BallView(scene);
const trail = new Trail(scene);
const markFoot = new Marker(scene, '#facc15');
const markTag = new Marker(scene, '#facc15');
const umpCam = new THREE.PerspectiveCamera(50, 1, 0.05, 600);
const camA = new THREE.PerspectiveCamera(34, 1, 0.03, 400); // リプレイ上（足）
const camB = new THREE.PerspectiveCamera(34, 1, 0.03, 400); // リプレイ下（タッチ）
const mgrCam = new THREE.PerspectiveCamera(38, 1, 0.05, 400);
let viewW = 1;
let viewH = 1;

function resize() {
  viewW = view.clientWidth;
  viewH = view.clientHeight;
  renderer.setSize(viewW, viewH, false);
  for (const c of [umpCam, mgrCam]) {
    c.aspect = viewW / viewH;
    c.updateProjectionMatrix();
  }
  for (const c of [camA, camB]) {
    c.aspect = viewW / (viewH / 2);
    c.updateProjectionMatrix();
  }
}
new ResizeObserver(resize).observe(view);
resize();

const sfx = new Sfx();

// ---- 状態 ----
const params = new URLSearchParams(location.search);
let rng = mulberry32(Number(params.get('seed')) || (Date.now() & 0xffffffff));

type Rec = {
  play: Play;
  call: Call | null;
  correct: boolean;
  requested: boolean;
  reaction: number; // 足とタッチの両方が起きてからコールまでの秒数
  base: number;
  bonus: number; // 早押しボーナス
  points: number;
};

type AudioEv = { t: number; name: SfxName; pos: Vec3; vol: number; done: boolean; rate?: number; dur?: number };

const S = {
  phase: 'title' as Phase,
  t: 0, // プレーの時刻（投手が動き出すのが GAME.tMove）
  pt: 0, // フェーズ内の経過時間
  index: 0,
  score: 0,
  misses: 0,
  play: null as Play | null,
  call: null as Call | null,
  armed: false,
  armedAt: 0,
  requestSide: null as 'home' | 'away' | null,
  replaySub: 'r1' as ReplaySub,
  rt: 0, // リプレイで映しているプレーの時刻
  pause: 0,
  shown: { foot: false, tag: false },
  records: [] as Rec[],
  timeScale: 1,
  forced: null as Force | null,
  events: [] as string[],
  audioEvs: [] as AudioEv[],
  handL: [] as THREE.Vector3[],
  handR: [] as THREE.Vector3[],
  verdictShown: false,
};
let track: ReturnType<typeof buildTrack> | null = null;
const audioLog: { name: SfxName; t: number }[] = [];

const BEST_KEY = 'umpire2b.best';
function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    // 保存できない環境では記録しない
  }
}

// ---- UI ----
const ui = {
  hud: $('hud'),
  count: $('hud-count'),
  score: $('hud-score'),
  miss: $('hud-miss'),
  timer: $('timer'),
  timerBar: $('timer-bar'),
  hint: $('hint'),
  call: $('call'),
  verdict: $('verdict'),
  request: $('request'),
  requestSub: $('request-sub'),
  replayTag: $('replay-tag'),
  replayTagSub: $('replay-tag-sub'),
  split: $('split'),
  stampFoot: $('stamp-foot'),
  stampTag: $('stamp-tag'),
  clock: $('clock'),
  replayResult: $('replay-result'),
  title: $('title'),
  result: $('result'),
  btnOut: $('btn-out'),
  btnSafe: $('btn-safe'),
};

function renderHud() {
  ui.count.textContent = String(S.index + 1);
  ui.score.textContent = S.score.toLocaleString();
  ui.miss.innerHTML = Array.from({ length: GAME.maxMisses }, (_, i) => `<i class="${i < S.misses ? 'on' : ''}"></i>`).join('');
}

let hintTimer = 0;
function showHint(text: string, sec = 0.9) {
  ui.hint.textContent = text;
  ui.hint.hidden = false;
  hintTimer = sec;
}

function setButtonsArmed(on: boolean) {
  ui.btnOut.classList.toggle('idle', !on);
  ui.btnSafe.classList.toggle('idle', !on);
}

function clearOverlays() {
  ui.call.hidden = true;
  ui.verdict.hidden = true;
  ui.request.hidden = true;
  ui.replayTag.hidden = true;
  ui.split.hidden = true;
  ui.replayResult.hidden = true;
  ui.timer.hidden = true;
  ui.stampFoot.hidden = true;
  ui.stampTag.hidden = true;
}

function setPhase(p: Phase) {
  S.phase = p;
  S.pt = 0;
  S.events.push('phase:' + p);
  if (S.events.length > 500) S.events.splice(0, S.events.length - 200);
}

// ---- 進行 ----
function startGame() {
  sfx.unlock();
  sfx.startBgm();
  S.index = 0;
  S.score = 0;
  S.misses = 0;
  S.records = [];
  ui.title.hidden = true;
  ui.result.hidden = true;
  ui.hud.hidden = false;
  nextPlay();
  showHint('足とタッチ、どっちが先？', 2.6);
}

function nextPlay() {
  clearOverlays();
  ui.hud.hidden = false;
  trail.clear();
  cast.endRequest();
  const forced = S.forced;
  S.forced = null;
  // 練習の2プレー目は1プレー目と逆（アウトとセーフの両方を見せる）
  const prev = S.records[S.records.length - 1];
  const tut: Force = S.index > 0 && S.index < STAGE.tutorial && prev && !forced ? { out: !prev.play.out } : {};
  const correctSoFar = S.records.filter((r) => r.correct).length;
  const p = generatePlay(rng, S.index, { ...tut, ...(forced ?? {}) }, correctSoFar);
  S.play = p;
  S.call = null;
  S.armed = false;
  // 最初のプレーだけ投手が投球に入るところから見せる。2プレー目以降は走者が走り出す直前から
  S.t = S.index > 0 ? Math.max(0, p.runner.tStart - GAME.skipLead) : 0;
  track = buildTrack(p, S.index === 0, S.t);
  S.requestSide = null;
  S.verdictShown = false;
  S.audioEvs = buildAudio(p);
  renderHud();
  setButtonsArmed(false);
  sfx.duck(true);
  sfx.setBgmSlow(false);
  setPhase('play');
}

// プレー中に鳴らす音（時刻・場所・大きさ）
function buildAudio(p: Play): AudioEv[] {
  const ev: AudioEv[] = [];
  const r = p.runner;
  // 捕手のミット（遠い）、二塁での捕球、送球の風切り音
  ev.push({ t: p.tCatcher, name: 'mitt', pos: { x: 0, y: 0.7, z: 0.4 }, vol: 9, done: false });
  ev.push({ t: p.tCatch, name: 'mitt', pos: p.th.C, vol: 6.5, done: false });
  ev.push({ t: p.tCatch - 0.28, name: 'whoosh', pos: p.th.C, vol: 1, done: false });
  // 走者の足音（滑り始めるまで）と、スライディングの音。タッチとベースに触れる瞬間には特別な音を鳴らさない
  for (const pl of r.plants) {
    if (pl.t > r.tSlide) break;
    ev.push({ t: pl.t, name: 'step', pos: plantWorld(pl), vol: 3.2, done: false });
  }
  const sp = pathToWorld(r.sSlide + 1.5, 0, 0);
  ev.push({ t: r.tSlide + 0.12, name: 'slide', pos: sp, vol: 4.5, done: false, dur: r.tArrive - r.tSlide + 0.15 });
  return ev.sort((a, b) => a.t - b.t);
}

// 先読みして予約する。rate < 1 はスロー再生
function scheduleAudio(fromT: number, toT: number, speed: number, rate = 1, only?: SfxName[]) {
  const cam = umpCam;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  for (const e of S.audioEvs) {
    if (e.done || e.t > toT) continue;
    if (only && !only.includes(e.name)) {
      if (e.t <= fromT) e.done = true;
      continue;
    }
    e.done = true;
    if (e.t < fromT - 0.05) continue; // 取りこぼし（タブが止まっていたなど）は鳴らさない
    const d = Math.max(1, cam.position.distanceTo(new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z)));
    const vol = Math.min(1.1, e.vol / d);
    const rel = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z).sub(cam.position).normalize();
    const pan = Math.max(-0.8, Math.min(0.8, rel.dot(right) * 0.9));
    const delay = Math.max(0, (e.t - fromT) / Math.max(1e-3, speed));
    // 確認用: 鳴らす予定のプレー時刻
    audioLog.push({ name: e.name, t: fromT + delay * speed });
    if (audioLog.length > 300) audioLog.splice(0, 100);
    if (e.name === 'whoosh') sfx.play('whoosh', [0.28 / speed, 0.1], delay);
    else if (e.name === 'slide') sfx.play('slide', [vol, pan, rate, e.dur ?? 0.6], delay);
    else sfx.play(e.name, [vol, pan, rate], delay);
  }
}

function onCall(c: Call) {
  if (S.phase === 'replay' || S.phase === 'request') {
    skipReplay();
    return;
  }
  if (S.phase === 'verdict' && S.pt > 0.6) {
    advance();
    return;
  }
  if (S.phase !== 'play' || !S.play || S.call) return;
  if (!S.armed) {
    if (S.t > S.play.tPitch) showHint('まだ早い！ 両方を見てから');
    return;
  }
  S.call = c;
  pressFx(c);
  resolve();
}

function pressFx(c: Call) {
  const b = c === 'out' ? ui.btnOut : ui.btnSafe;
  b.classList.add('pressed');
  setTimeout(() => b.classList.remove('pressed'), 120);
}

function truthOf(p: Play): Call {
  return p.out ? 'out' : 'safe';
}

function resolve() {
  const p = S.play!;
  setButtonsArmed(false);
  ui.timer.hidden = true;
  const correct = S.call === truthOf(p);
  // リクエスト: 誤審と際どい判定のときだけ（際どいプレーの割合は config.ts の LEVELS）
  const requested = !!S.call && (!correct || p.close);
  S.requestSide = requested ? (S.call === 'out' ? 'away' : 'home') : null;
  const reaction = S.t - S.armedAt;
  let base = 0;
  let bonus = 0;
  if (correct) {
    base = p.close ? SCORE.closeCorrect : SCORE.correct;
    bonus = SCORE.speedBonus.find((b) => reaction <= b.within)?.points ?? 0;
  } else {
    S.misses++;
  }
  const points = base + bonus;
  S.records.push({ play: p, call: S.call, correct, requested, reaction, base, bonus, points });
  S.events.push(`resolve:${S.call ?? 'none'}:${truthOf(p)}:${correct ? 'ok' : 'ng'}:${requested ? 'req' : '-'}`);
  ui.call.hidden = false;
  ui.call.className = S.call ?? 'late';
  ui.call.textContent = S.call === 'out' ? 'アウト！' : S.call === 'safe' ? 'セーフ！' : '判定遅れ…';
  if (S.call) {
    sfx.play('call', [S.call]);
    sfx.play('crowd', [S.call === 'out' ? 'cheer' : 'ooh', 1.6, 0.22], 0.1);
  } else sfx.play('wrong');
  setPhase('called');
}

function lastRec() {
  return S.records[S.records.length - 1];
}

// 得点の内訳（「球審ジャッジ」と同じ書き方）
function pointsText(r: Rec) {
  return r.bonus > 0 ? `${r.base} ＋ ${r.bonus}（早押しボーナス）` : `${r.base}`;
}

// リクエストなし: すぐに正誤を出す
function showVerdict() {
  const r = lastRec();
  ui.call.hidden = true;
  ui.verdict.hidden = false;
  if (r.correct) {
    const big = r.play.close;
    ui.verdict.className = 'ok' + (big ? ' big' : '');
    ui.verdict.innerHTML = (big ? 'ナイスジャッジ！' : '正解') + `<small>${pointsText(r)}</small>`;
    sfx.play('correct', [big]);
    S.score += r.points;
  } else {
    // 時間切れでも、正しくはどちらだったかを出す
    ui.verdict.className = r.call ? 'ng' : 'ng late';
    ui.verdict.innerHTML = r.call ? '誤審…' : `時間切れ<small>正しくは「${r.play.out ? 'アウト' : 'セーフ'}」</small>`;
    sfx.play('wrong');
  }
  renderHud();
  setPhase('verdict');
}

function startRequest() {
  clearOverlays();
  const side = S.requestSide!;
  ui.request.hidden = false;
  ui.requestSub.className = 'req-sub ' + side;
  ui.requestSub.textContent = side === 'away' ? '攻撃側の監督が「セーフでは？」' : '守備側の監督が「アウトでは？」';
  sfx.play('chime');
  sfx.play('crowd', ['ooh', 2.2, 0.28], 0.2);
  S.handL = [];
  S.handR = [];
  trail.clear();
  trail.setOpacity(1);
  setPhase('request');
}

function startReplay() {
  clearOverlays();
  trail.clear();
  cast.endRequest();
  ui.replayTag.hidden = false;
  ui.replayTagSub.textContent = 'リプレイ検証中';
  replaySkipHint(true);
  ui.hud.hidden = true;
  sfx.setBgmSlow(true);
  sfx.play('swoosh');
  const p = S.play!;
  S.replaySub = 'r1';
  S.rt = Math.min(p.tTag, p.tArrive) - 1.0;
  S.shown = { foot: false, tag: false };
  S.pause = 0;
  // 音をもう一度鳴らせるようにする
  for (const e of S.audioEvs) e.done = e.t < S.rt;
  setPhase('replay');
}

const FIRST = () => Math.min(S.play!.tTag, S.play!.tArrive);
const LAST = () => Math.max(S.play!.tTag, S.play!.tArrive);

function startSplit() {
  const p = S.play!;
  markFoot.hide();
  markTag.hide();
  S.replaySub = 'r2';
  S.rt = FIRST() - 0.2;
  S.shown = { foot: false, tag: false };
  S.pause = 0.5;
  for (const e of S.audioEvs) e.done = e.t < S.rt;
  ui.split.hidden = false;
  ui.stampFoot.hidden = true;
  ui.stampTag.hidden = true;
  ui.replayTagSub.textContent = 'スーパースロー';
  footCam(p, camA);
  tagCam(p, camB);
  sfx.play('swoosh');
}

function fmt(sec: number) {
  return (sec >= 0 ? '+' : '−') + Math.abs(sec).toFixed(3);
}

// 左上の「タップで結果へ」。結果を出したら消す（結果の「タップで次へ」と食い違わないように）
function replaySkipHint(on: boolean) {
  const el = ui.replayTag.querySelector<HTMLElement>('.skip');
  if (el) el.style.display = on ? '' : 'none';
}

function showReplayResult() {
  const p = S.play!;
  const r = lastRec();
  S.replaySub = 'r3';
  replaySkipHint(false);
  S.pt = 0;
  const truth = truthOf(p);
  const ms = Math.abs(p.margin);
  const who = p.out ? 'タッチ' : p.runner.head ? '手' : '足';
  ui.replayResult.hidden = false;
  ui.replayResult.innerHTML =
    `<span class="res ${truth}">${truth === 'out' ? 'アウト' : 'セーフ'}</span>` +
    `<span class="diff">${who}が <b>${ms.toFixed(3)}秒</b> 先</span><br>` +
    (r.correct
      ? `<span class="judge ok${p.close ? ' big' : ''}">${p.close ? 'ナイスジャッジ！' : '正解'}<small>${pointsText(r)}</small></span>`
      : `<span class="judge ng">誤審…<small>判定がくつがえった</small></span>`) +
    `<span class="next">タップで次へ</span>`;
  if (r.correct) {
    sfx.play('correct', [p.close]);
    sfx.play('crowd', ['cheer', 1.4, 0.2]);
    S.score += r.points;
  } else {
    sfx.play('wrong');
    sfx.play('crowd', ['boo', 1.8, 0.25]);
  }
  renderHud();
  S.events.push('replayResult');
}

// タップでリプレイを飛ばす。監督のリクエストの場面からでも、スローを見せずに結果だけを出す
function skipReplay() {
  if (S.phase === 'request') {
    if (S.pt < GAME.replaySkipGuard) return;
    startReplay();
    jumpToResult();
    return;
  }
  if (S.phase !== 'replay') return;
  if (S.replaySub === 'r3') {
    if (S.pt > 0.5) advance();
    return;
  }
  if (S.pt < GAME.replaySkipGuard) return;
  jumpToResult();
}

// 結果へ（分割画面の最後の場面で止め、足とタッチの印と時刻を出す）
function jumpToResult() {
  if (S.replaySub === 'r1') startSplit();
  S.rt = LAST() + 0.12;
  S.pause = 0;
  S.shown = { foot: true, tag: true };
  showMarks();
  showStamps();
  showReplayResult();
}

// リプレイの印: 足（ヘッドスライディングは手）がベースに触れたところと、グラブが走者に触れたところ
const footMarkPos = () => pathToWorld(BAG_FACE_S - 0.04, (S.play ?? demo!).runner.leadL, 0.08); // かわす走者は右手（leadL は触れたときの位置）
function showMarks() {
  const p = S.play!;
  if (S.shown.foot) markFoot.show(footMarkPos(), 0.24);
  if (S.shown.tag) markTag.show(p.tag.P, 0.26);
}

function showStamps() {
  const p = S.play!;
  const first = FIRST();
  ui.stampFoot.hidden = !S.shown.foot;
  ui.stampTag.hidden = !S.shown.tag;
  ui.stampFoot.innerHTML = `ベースに触れた<small>${fmt(p.tArrive - first)}秒</small>`;
  ui.stampTag.innerHTML = `タッチした<small>${fmt(p.tTag - first)}秒</small>`;
}

function advance() {
  sfx.setBgmSlow(false);
  if (S.misses >= GAME.maxMisses) {
    showResult();
    return;
  }
  S.index++;
  nextPlay();
  const msg = stageMessage(S.index);
  if (msg) showHint(msg, 2.4);
}

function stageMessage(i: number) {
  if (i === STAGE.tutorial) return 'ここから本番！ 際どいタイミングも来るぞ';
  if (i === STAGE.wideThrow) return '送球がそれることも！ タッチをよく見よう';
  return null;
}

// 称号: 正しく判定できたプレーの数（config.ts の LEVELS。基準は「球審ジャッジ」と同じ）
function rankTitle(ok: number) {
  return levelOf(ok).title;
}

function showResult() {
  clearOverlays();
  setButtonsArmed(false);
  const n = S.records.length;
  const ok = S.records.filter((r) => r.correct).length;
  const close = S.records.filter((r) => r.play.close);
  const closeOk = close.filter((r) => r.correct).length;
  const best = loadBest();
  const isBest = S.score > best;
  if (isBest) saveBest(S.score);
  $('res-rank').textContent = rankTitle(ok);
  $('res-score').textContent = S.score.toLocaleString();
  $('res-correct').textContent = `${ok}回（${n}回中）`;
  $('res-close').textContent = `${closeOk} / ${close.length}回`;
  $('res-best').textContent = isBest ? '新記録！' : best > 0 ? `${best.toLocaleString()}点` : '―';
  $('res-best').classList.toggle('new', isBest);
  ui.hud.hidden = true;
  ui.result.hidden = false;
  sfx.duck(false);
  sfx.stopBgm(0.4);
  sfx.play('ejected');
  setPhase('result');
}

function toTitle() {
  sfx.stopBgm();
  ui.result.hidden = true;
  ui.title.hidden = false;
  ui.hud.hidden = true;
  setPhase('title');
}

// ---- 描画するもの ----
type View = 'ump' | 'mgr' | 'split';
let viewMode: View = 'ump';
const tmpV = new THREE.Vector3();

function placeWorld(p: Play, t: number) {
  cast.update(p, t);
  if (cast.heldBall(p, t, tmpV)) ball.mesh.position.copy(tmpV);
  else {
    const b = ballAt(p, t).pos;
    ball.mesh.position.set(b.x, b.y, b.z);
  }
}

// 塁審の目線で画面に収めたい点（時刻 t ごと。どれを収めるかは目線の段階で変わる）
// - 投球を見る間（最初のプレーだけ、投手が動き出して少しまで）: 投手・打者・捕手
// - 走者を追う間: 走者の全身
// - 捕球の少し前から: ベースに入った野手の全身・グラブ・ベースの四隅・ボール。走者の全身は、足かタッチの少し前から（tRun）
// 目線が移る間（投球→走者、走者→捕球）は収めなくてよい
const JOINTS = ['head', 'chest', 'lSh', 'rSh', 'lEl', 'rEl', 'lHand', 'rHand', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle'] as const;
const BAG_CORNERS = (() => {
  const h = BAG_SIZE / 2;
  const out: THREE.Vector3[] = [];
  for (const ds of [-h, h]) for (const l of [-h, h]) {
    const c = pathToWorld(BAG_S + ds, l, BAG_HEIGHT);
    out.push(new THREE.Vector3(c.x, c.y, c.z));
  }
  return out;
})();
const joints = (f: { j: Record<(typeof JOINTS)[number], THREE.Vector3> }) => JOINTS.map((k) => f.j[k].clone());
type Stages = { tHold: number; tBlend: number; tPan: number; tLock: number; tCatchEnd: number; tFreeze: number; tRun: number };
function sceneParts(p: Play, t: number, st: Stages) {
  const none: THREE.Vector3[] = [];
  if (t < st.tHold) return { pitch: [...joints(cast.pitcher), ...joints(cast.batter), ...joints(cast.catcher)], runner: none, fielder: none, glove: none, ball: none, bag: none };
  const fig = cast.coverFig(p);
  const lock = t >= st.tLock;
  const g = new THREE.Vector3();
  fig.glove?.getWorldPosition(g);
  return {
    pitch: none,
    runner: (t >= st.tBlend && t < st.tPan) || t >= st.tRun ? joints(cast.runner) : none,
    fielder: lock ? joints(fig) : none,
    glove: lock ? [g] : none,
    bag: lock ? BAG_CORNERS : none,
    ball: lock && t >= p.tCatch - CAMERA.ballBefore ? [ball.mesh.position.clone()] : none,
  };
}

// 塁審の目線の動きを先に計算する。pitchView: 投球フォームに入るところを、投手と捕手が入る画角で見せる（最初のプレー）
// 1. 投球（最初のプレーだけ）: 投手〜捕手が入る向きで止める
// 2. 走者を追う: 走者の全身と走者の先（前後 CAMERA.window 秒ぶん）の真ん中へ向け、入らなければ画角を広げる
// 3. 捕球の CAMERA.catchBefore 秒前から: 野手・ボール・ベースが入る最小の画角で止める（その CAMERA.pan 秒前から移る）
// 4. 捕球の後、足かタッチの CAMERA.freeze 秒前までにタッチの場面へ寄せて止める（走者・野手・ベースが入る最小の画角）
function buildTrack(p: Play, pitchView: boolean, tBegin: number): CamTrack & Stages {
  const spots = umpireSpots(p);
  const dt = 1 / 30;
  const tHold = pitchView ? p.tMove + CAMERA.pitchHold : -Infinity;
  const tBlend = pitchView ? tHold + CAMERA.pitchBlend : -Infinity;
  const first = Math.min(p.tTag, p.tArrive);
  const last = Math.max(p.tTag, p.tArrive);
  const tFreeze = first - CAMERA.freeze;
  const tLock = Math.min(p.tCatch - CAMERA.catchBefore, tFreeze);
  // 走者から捕球へ移る時間: 振る角度（塁審から見た走者とベースの間）が大きいほど長く。1コマ CAMERA.panRate° くらいで振る
  // （smoothstep なので、いちばん速いところは平均の 1.5 倍）
  let panDur = CAMERA.pan;
  {
    const from = new THREE.Vector3();
    const bag = pathToWorld(BAG_S, 0, 0.5);
    for (let it = 0; it < 3; it++) {
      const t0 = tLock - panDur;
      umpirePos(p, t0, spots, from);
      const r = pathToWorld(runnerS(p.runner, t0), 0, 0.9);
      const a = new THREE.Vector3(r.x - from.x, r.y - from.y, r.z - from.z).normalize();
      const b = new THREE.Vector3(bag.x - from.x, bag.y - from.y, bag.z - from.z).normalize();
      const ang = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, a.dot(b))));
      panDur = Math.min(CAMERA.panMax, Math.max(CAMERA.pan, ((ang * 1.5) / CAMERA.panRate) * dt));
    }
  }
  const tPan = Math.max(tBlend, tLock - panDur);
  // 捕球の場面の後、タッチの場面へ移る時間が短すぎるときは、捕球〜タッチを1つの画角で見せる
  const tCatchEnd = tFreeze - (p.tCatch + CAMERA.catchAfter) >= CAMERA.minMove ? p.tCatch + CAMERA.catchAfter : tLock;
  const tRun = Math.max(tLock, first - CAMERA.runnerIn);
  const st: Stages = { tHold, tBlend, tPan, tLock, tCatchEnd, tFreeze, tRun };
  const tEnd = last + 8;
  const n = Math.ceil((tEnd - tBegin) / dt) + 1;
  const aspect = viewW / viewH;
  const T = (i: number) => tBegin + i * dt;
  const idx = (t: number) => Math.min(n, Math.max(0, Math.ceil((t - tBegin) / dt)));
  // 時刻ごとの収めたい点。走者を追う間は、走者の先の地面の点（塁審から見て走者との角度が CAMERA.leadAngle 以内で、できるだけ先。ベースまで）も
  const pts: THREE.Vector3[][] = [];
  const pos = new THREE.Vector3();
  const cosA = Math.cos(THREE.MathUtils.degToRad(CAMERA.leadAngle));
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = T(i);
    if (t > last + 1.0) {
      pts.push(pts[pts.length - 1]);
      continue;
    }
    placeWorld(p, t);
    const x = sceneParts(p, t, st);
    const ahead: THREE.Vector3[] = [];
    if (t >= tHold && t < tLock) {
      umpirePos(p, t, spots, pos);
      const rs = runnerS(p.runner, t);
      const r = pathToWorld(rs, 0, 0.9);
      va.set(r.x - pos.x, r.y - pos.y, r.z - pos.z).normalize();
      const at = (s2: number) => {
        const q = pathToWorld(s2, 0, 0);
        return vb.set(q.x - pos.x, q.y - pos.y, q.z - pos.z).normalize().dot(va);
      };
      const end = BAG_S + BAG_SIZE / 2;
      let sa = end;
      if (at(end) < cosA) {
        let lo = rs;
        let hi = end;
        for (let it = 0; it < 20; it++) {
          const mid = (lo + hi) / 2;
          if (at(mid) >= cosA) lo = mid;
          else hi = mid;
        }
        sa = lo;
      }
      const a = pathToWorld(Math.max(sa, Math.min(rs + 1.0, end)), 0, 0);
      ahead.push(new THREE.Vector3(a.x, 0, a.z));
    }
    // 走者を追う向きは、走者が見えなくてよい間（移る間）も走者で決める
    const runner = t >= tHold && t < tLock && !x.runner.length ? joints(cast.runner) : x.runner;
    pts.push([...x.pitch, ...runner, ...ahead, ...x.fielder, ...x.glove, ...x.bag, ...x.ball]);
  }
  const iHold = idx(tHold);
  const iBlend = idx(tBlend);
  const iPan = idx(tPan);
  const iLock = idx(tLock);
  const dir: THREE.Vector3[] = [];
  const fov: number[] = [];
  // 1. 投球を見る向き（動かさない）
  let pitch: { look: THREE.Vector3; fov: number } | null = null;
  if (pitchView) {
    const P: THREE.Vector3[] = [];
    for (let i = 0; i < iHold; i++) P.push(...pts[i]);
    pitch = fitView(spots.S0, new THREE.Vector3(PITCHER_BASE.x, 1.2, PITCHER_BASE.z), P, aspect, CAMERA.pitchFovMin);
  }
  // 2. 走者を追う（捕球の場面へ移り終えるまで計算する）
  const W = Math.round(CAMERA.window / dt);
  let look = spots.J.clone();
  for (let i = 0; i < n; i++) {
    umpirePos(p, T(i), spots, pos);
    if (i < iHold) {
      dir.push(pitch!.look.clone().sub(pos).normalize());
      fov.push(pitch!.fov);
      continue;
    }
    if (i >= iLock) {
      dir.push(dir[i - 1].clone());
      fov.push(fov[i - 1]);
      continue;
    }
    const P: THREE.Vector3[] = [];
    for (let k = Math.max(iHold, i - W); k <= Math.min(iLock - 1, i + W); k++) P.push(...pts[k]);
    const f = fitView(pos, look, P, aspect, CAMERA.fov);
    look = f.look;
    dir.push(f.look.clone().sub(pos).normalize());
    fov.push(f.fov);
  }
  // ならす（投球を見る間は除く）
  const S2 = Math.round(CAMERA.smooth / dt);
  const dir2 = dir.map((d) => d.clone());
  const fov2 = fov.slice();
  for (let i = iHold; i < iLock; i++) {
    const acc = new THREE.Vector3();
    let fs = 0;
    let c = 0;
    for (let k = Math.max(iHold, i - S2); k <= Math.min(iLock - 1, i + S2); k++) {
      acc.add(dir[k]);
      fs += fov[k];
      c++;
    }
    dir2[i] = acc.normalize();
    fov2[i] = fs / c;
  }
  // 決めた向きで、その時刻の点（前後1コマ）が必ず入るように画角を足し、急に変わらないようにする（走者を見せる間だけ）
  const need = fov2.slice();
  for (let i = iBlend; i < iPan; i++) {
    umpirePos(p, T(i), spots, pos);
    const P: THREE.Vector3[] = [];
    for (let k = Math.max(iBlend, i - 1); k <= Math.min(iPan - 1, i + 1); k++) P.push(...pts[k]);
    need[i] = Math.max(fov2[i], fovToContain(pos, dir2[i], P, aspect, CAMERA.fov));
  }
  const fov3 = need.slice();
  const R = 4;
  for (let i = iBlend; i < iPan; i++) {
    let sum = 0;
    let c = 0;
    for (let k = Math.max(iBlend, i - R); k <= Math.min(iPan - 1, i + R); k++) {
      let m = 0;
      for (let q = Math.max(iBlend, k - R); q <= Math.min(iPan - 1, k + R); q++) m = Math.max(m, need[q]);
      sum += m;
      c++;
    }
    fov3[i] = Math.max(need[i], sum / c);
  }
  for (let i = iBlend + 1; i < iPan; i++) fov3[i] = Math.max(fov3[i], fov3[i - 1] - CAMERA.fovRateIn);
  for (let i = iPan - 2; i >= iBlend; i--) fov3[i] = Math.max(fov3[i], fov3[i + 1] - CAMERA.fovRate);
  for (let i = iPan; i < iLock; i++) fov3[i] = fov2[i];
  // 3. 捕球の場面とタッチの場面: それぞれ1つの向き・画角で止める（塁審はもう判定位置にいる）。間が短いときは1つにまとめる
  const fixedView = (t0: number, t1: number) => {
    const P: THREE.Vector3[] = [];
    for (let k = idx(t0); k < n && T(k) <= t1; k++) P.push(...pts[k]);
    const v = fitView(spots.S1, spots.J, P, aspect, CAMERA.closeFov);
    let f = v.fov;
    for (let k = idx(t0); k < n && T(k) <= t1; k++) {
      umpirePos(p, T(k), spots, pos);
      f = Math.max(f, fovToContain(pos, v.look.clone().sub(pos).normalize(), pts[k], aspect, CAMERA.closeFov));
    }
    return { look: v.look, fov: f };
  };
  const split = tCatchEnd > tLock;
  const tagView = fixedView(split ? tFreeze : tLock, last + CAMERA.after);
  const catchView = split ? fixedView(tLock, tCatchEnd) : tagView;
  if (split) {
    const frames = (tFreeze - tCatchEnd) / dt;
    // 寄せ直す間に向きが1コマ CAMERA.moveTurnRate° より速く変わらないよう、捕球の向きをタッチの向きへ寄せておく
    // （寄せ直しは smoothstep なので、いちばん速いところは平均の 1.5 倍）。捕球の場面が入るよう画角を広げ直す
    const S1 = spots.S1;
    const dc = catchView.look.clone().sub(S1).normalize();
    const dtg = tagView.look.clone().sub(S1).normalize();
    const ang = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, dc.dot(dtg))));
    const turnRoom = (CAMERA.moveTurnRate * frames) / 1.5;
    if (ang > turnRoom) {
      const d = dc.clone().lerp(dtg, 1 - turnRoom / ang).normalize();
      catchView.look = S1.clone().addScaledVector(d, catchView.look.distanceTo(S1));
      for (let k = idx(tLock); k < n && T(k) <= tCatchEnd; k++) {
        umpirePos(p, T(k), spots, pos);
        catchView.fov = Math.max(catchView.fov, fovToContain(pos, catchView.look.clone().sub(pos).normalize(), pts[k], aspect, CAMERA.closeFov));
      }
    }
    // 画角も1コマ CAMERA.moveFovRate より速く変わらないよう、狭いほうの画角を広げて差を詰める
    const room = (CAMERA.moveFovRate * frames) / 1.5;
    if (tagView.fov - catchView.fov > room) catchView.fov = tagView.fov - room;
    else if (catchView.fov - tagView.fov > room) tagView.fov = catchView.fov - room;
  }
  // 組み立て: 投球 →（pitchBlend 秒で）走者を追う →（pan 秒で）捕球〜タッチ
  const outDir: THREE.Vector3[] = [];
  const outFov: number[] = [];
  const sm = (u: number) => {
    const k = Math.min(1, Math.max(0, u));
    return k * k * (3 - 2 * k);
  };
  for (let i = 0; i < n; i++) {
    const t = T(i);
    umpirePos(p, t, spots, pos);
    let d = dir2[i].clone();
    let f = fov3[i];
    if (pitch && i >= iHold && i < iBlend) {
      // 投球を見る向きから、走者を追う向きへ（走者を追う向きは、移り終えたときの値へ向かう）
      const e = sm((t - tHold) / CAMERA.pitchBlend);
      d = dir[iHold - 1].clone().lerp(dir2[i], e).normalize();
      f = pitch.fov + (fov3[Math.min(iBlend, iPan - 1)] - pitch.fov) * e;
    }
    if (t >= tPan) {
      const e = tLock > tPan ? sm((t - tPan) / (tLock - tPan)) : 1;
      d = d.lerp(catchView.look.clone().sub(pos).normalize(), e).normalize();
      f = f + (catchView.fov - f) * e;
    }
    if (split && t >= tCatchEnd) {
      // 捕球の場面から、タッチの場面へ寄せる
      const e = sm((t - tCatchEnd) / (tFreeze - tCatchEnd));
      d = d.lerp(tagView.look.clone().sub(pos).normalize(), e).normalize();
      f = f + (tagView.fov - f) * e;
    }
    outDir.push(d);
    outFov.push(f);
  }
  return { spots, t0: tBegin, dt, dir: outDir, fov: outFov, raw: fov, ...st, frozenFov: tagView.fov };
}

// タイトル画面の背景に流すプレー
let demo: Play | null = null;
let demoT = 0;
let demoTrack: ReturnType<typeof buildTrack> | null = null;

function update(dt: number) {
  S.pt += dt;
  if (hintTimer > 0) {
    hintTimer -= dt;
    if (hintTimer <= 0) ui.hint.hidden = true;
  }
  const p = S.play;
  switch (S.phase) {
    case 'title':
    case 'result': {
      if (!demo || demoT > demo.tArrive + 2.5) {
        demo = generatePlay(mulberry32((Math.random() * 1e9) | 0), 12);
        demoT = demo.tMove - 0.8;
        demoTrack = buildTrack(demo, true, demoT);
      }
      demoT += dt;
      placeWorld(demo, demoT);
      umpireCamAt(demo, demoT, umpCam, demoTrack!);
      viewMode = 'ump';
      break;
    }
    case 'play': {
      if (!p) break;
      const t0 = S.t;
      S.t += dt;
      placeWorld(p, S.t);
      umpireCamAt(p, S.t, umpCam, track!);
      viewMode = 'ump';
      scheduleAudio(t0, S.t + 0.1 * Math.max(1, S.timeScale), S.timeScale);
      if (!S.armed && S.t >= LAST()) {
        S.armed = true;
        S.armedAt = S.t;
        setButtonsArmed(true);
        ui.timer.hidden = false;
        S.events.push('armed');
      }
      if (S.armed) {
        const left = 1 - (S.t - S.armedAt) / GAME.decisionWindow;
        ui.timerBar.style.transform = `scaleX(${Math.max(0, left)})`;
        if (left <= 0) {
          S.call = null;
          resolve();
        }
      }
      break;
    }
    case 'called': {
      if (!p) break;
      S.t += dt;
      placeWorld(p, S.t);
      umpireCamAt(p, S.t, umpCam, track!);
      if (S.pt >= GAME.callDisplay) {
        sfx.duck(false);
        if (S.requestSide) startRequest();
        else showVerdict();
      }
      break;
    }
    case 'request': {
      if (!p) break;
      placeWorld(p, S.t);
      const side = S.requestSide!;
      const h = cast.managerRequest(side, S.pt);
      managerCam(dugouts[side], S.pt, mgrCam);
      viewMode = 'mgr';
      if (S.pt >= 1.27 && S.pt <= 2.2) {
        S.handL.push(h.l);
        S.handR.push(h.r);
        trail.set(S.handL, S.handR);
      }
      if (S.pt > 2.6) trail.setOpacity(Math.max(0, 1 - (S.pt - 2.6) / 0.4));
      if (S.pt >= 3.1) startReplay();
      break;
    }
    case 'replay': {
      if (!p) break;
      if (S.replaySub === 'r1') {
        // 塁審の目線でスロー（0.4倍）
        const sp = 0.4;
        const t0 = S.rt;
        S.rt += dt * sp;
        placeWorld(p, S.rt);
        umpireCamAt(p, S.rt, umpCam, track!);
        viewMode = 'ump';
        scheduleAudio(t0, S.rt + 0.05, sp, 0.7, ['step', 'mitt', 'slide']);
        if (S.rt >= LAST() + 0.15) startSplit();
      } else if (S.replaySub === 'r2') {
        viewMode = 'split';
        if (S.pause > 0) S.pause -= dt;
        else {
          const near = Math.min(Math.abs(S.rt - p.tArrive), Math.abs(S.rt - p.tTag));
          const sp = near < 0.05 ? 1 / 30 : near < 0.14 ? 1 / 10 : 1 / 4;
          let next = S.rt + dt * sp;
          // 出来事の瞬間で止める
          const evs: ['foot' | 'tag', number][] = [
            ['foot', p.tArrive],
            ['tag', p.tTag],
          ];
          evs.sort((a, b) => a[1] - b[1]);
          for (const [k, te] of evs) {
            if (!S.shown[k] && S.rt < te && next >= te) {
              next = te;
              S.shown[k] = true;
              S.pause = 0.8;
              showStamps();
              if (k === 'foot') markFoot.show(footMarkPos(), 0.24);
              else markTag.show(p.tag.P, 0.26);
              sfx.play(k === 'foot' ? 'bag' : 'glove', [0.9, 0, 0.45]);
              S.events.push('stamp:' + k);
              break;
            }
          }
          S.rt = next;
          if (S.rt >= LAST() + 0.12) showReplayResult();
        }
        placeWorld(p, S.rt);
        ui.clock.textContent = fmt(S.rt - FIRST());
      } else {
        viewMode = 'split';
        placeWorld(p, S.rt);
        if (S.pt > 4.5) advance();
      }
      break;
    }
    case 'verdict': {
      if (!p) break;
      S.t += dt;
      placeWorld(p, S.t);
      umpireCamAt(p, S.t, umpCam, track!);
      if (S.pt >= (lastRec().call ? GAME.resultDisplay : GAME.lateDisplay)) advance();
      break;
    }
  }
  if (S.phase !== 'request') cast.managerIdle();
  if (S.phase !== 'replay') {
    markFoot.hide();
    markTag.hide();
  }
  markFoot.tick(dt);
  markTag.tick(dt);
}

function render() {
  if (viewMode === 'split') {
    renderer.setScissorTest(true);
    const h2 = viewH / 2;
    // 上: 足とベース
    ball.place(ball.mesh.position, camA, false);
    renderer.setViewport(0, h2, viewW, h2);
    renderer.setScissor(0, h2, viewW, h2);
    renderer.render(scene, camA);
    // 下: タッチ
    renderer.setViewport(0, 0, viewW, h2);
    renderer.setScissor(0, 0, viewW, h2);
    renderer.render(scene, camB);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewW, viewH);
  } else {
    const cam = viewMode === 'mgr' ? mgrCam : umpCam;
    ball.place(ball.mesh.position, cam, viewMode === 'ump');
    renderer.render(scene, cam);
  }
}

// ---- 入力 ----
ui.btnOut.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  onCall('out');
});
ui.btnSafe.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  onCall('safe');
});
view.addEventListener('pointerdown', () => {
  if (S.phase === 'replay' || S.phase === 'request') skipReplay();
  else if (S.phase === 'verdict' && S.pt > 0.6) advance();
});
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  // ボタンの並び（左 = セーフ、右 = アウト）に合わせる
  if (k === 'f' || e.key === 'ArrowLeft') onCall('safe');
  else if (k === 'j' || e.key === 'ArrowRight') onCall('out');
  else if ((k === ' ' || k === 'enter') && (S.phase === 'title' || S.phase === 'result')) startGame();
  else if ((k === ' ' || k === 'enter') && (S.phase === 'replay' || S.phase === 'request')) skipReplay();
  else if (k === 'm') setBgm(!sfx.bgmOn);
});
$('btn-start').addEventListener('click', startGame);
$('btn-retry').addEventListener('click', startGame);
$('btn-title').addEventListener('click', toTitle);

const BGM_KEY = 'umpire2b.bgm';
function setBgm(on: boolean) {
  sfx.setBgmOn(on);
  try {
    localStorage.setItem(BGM_KEY, on ? '1' : '0');
  } catch {
    // 保存できない環境では今回だけ
  }
  document.querySelectorAll<HTMLButtonElement>('.bgm-toggle').forEach((b) => {
    b.textContent = on ? 'BGM オン' : 'BGM オフ';
    b.classList.toggle('off', !on);
  });
}
try {
  setBgm(localStorage.getItem(BGM_KEY) !== '0');
} catch {
  setBgm(true);
}
document.querySelectorAll<HTMLButtonElement>('.bgm-toggle').forEach((b) =>
  b.addEventListener('click', () => {
    sfx.unlock();
    setBgm(!sfx.bgmOn);
  }),
);
document.addEventListener('visibilitychange', () => sfx.suspend(document.hidden));

// ---- ループ ----
let last = performance.now();
let manual = false;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!manual) {
    update(dt * S.timeScale);
    render();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- 確認用の入口 ----
declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  state: () => ({
    phase: S.phase,
    replaySub: S.replaySub,
    t: S.t,
    rt: S.rt,
    index: S.index,
    score: S.score,
    misses: S.misses,
    armed: S.armed,
    requestSide: S.requestSide,
    view: viewMode,
    play: S.play && {
      out: S.play.out,
      margin: S.play.margin,
      close: S.play.close,
      category: S.play.category,
      cover: S.play.cover,
      style: S.play.tag.style,
      wide: S.play.wide,
      tMove: S.play.tMove,
      tPitch: S.play.tPitch,
      tCatcher: S.play.tCatcher,
      tRelease: S.play.th.tRelease,
      tCatch: S.play.tCatch,
      tTag: S.play.tTag,
      tArrive: S.play.tArrive,
      tSlide: S.play.runner.tSlide,
      tStart: S.play.runner.tStart,
      tagP: [S.play.tag.P.x, S.play.tag.P.y, S.play.tag.P.z],
    },
    records: S.records.map((r) => ({ call: r.call, correct: r.correct, requested: r.requested, reaction: r.reaction, base: r.base, bonus: r.bonus, points: r.points })),
  }),
  start: startGame,
  call: onCall,
  skip: skipReplay,
  advance,
  toTitle,
  setTimeScale: (s: number) => (S.timeScale = s),
  track: () => track, // 確認用: 塁審の目線の動き（先に計算したもの）
  setIndex: (n: number) => (S.index = n), // 確認用: 何プレー目として次のプレーを作るか（0 なら投球から見せる）
  setSeed: (n: number) => (rng = mulberry32(n)),
  force: (f: Force | null) => (S.forced = f),
  replay: (f: Force | null) => {
    S.forced = f;
    nextPlay();
  },
  manual: (on: boolean) => (manual = on),
  camera: CAMERA, // 見た目の確認用: 塁審の目線の調整値（次のプレーから効く）
  cast, // 確認用: 人形の関節（cast.runner.j など）
  step: (dt: number, n = 1) => {
    for (let i = 0; i < n; i++) update(dt);
    render();
  },
  drainEvents: () =>
    S.events.splice(0).map((e) => {
      const [type, ...args] = e.split(':');
      return { type, args };
    }),
  // 検算: いま描いている走者の前の足（左足首）・左手と、グラブ（ベースに入った野手の左手）の位置
  probe: () => {
    const p = S.play ?? demo!;
    const f = cast.runner.j;
    const g = cast.coverFig(p).j.lHand;
    return {
      lAnkle: f.lAnkle.toArray(),
      rAnkle: f.rAnkle.toArray(),
      lKnee: f.lKnee.toArray(),
      lHand: f.lHand.toArray(),
      rHand: f.rHand.toArray(),
      head: p.runner.head,
      evade: p.runner.evade,
      // ベースに触れる体の先（描いた関節）: 足から滑るときは左足首、ヘッドスライディングは左手、かわす走者は右手
      touch: (p.runner.evade ? f.rHand : p.runner.head ? f.lHand : f.lAnkle).toArray(),
      glove: g.toArray(),
      ball: ball.mesh.position.toArray(),
      cam: umpCam.position.toArray(),
      // 正解のデータから計算した、いまの時刻のタッチの目標と、ベースに触れる体の先（足首か手）とその先端（靴の先か指先）
      tagTarget: Object.values(tagTarget(p, S.play ? S.t : demoT)),
      lead: Object.values(leadPoint(p.runner, S.play ? S.t : demoT)),
      shoe: Object.values(leadFront(p.runner, S.play ? S.t : demoT)),
    };
  },
  // 検算: 塁審の目線から、グラブ（タッチ）と前の足（ヘッドスライディングは左手）が、走者・野手の体に隠れていないか。画面での位置（0..1、上が0）
  sight: () => {
    const p = S.play ?? demo!;
    const from = umpCam.position;
    const cover = cast.coverFig(p);
    const glove = cover.glove!;
    const inside = (o: THREE.Object3D, root: THREE.Object3D) => {
      for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q === root) return true;
      return false;
    };
    const ray = new THREE.Raycaster();
    // near: 目標のまわりこの距離以内の当たりは、目標そのもの（脚・靴・グラブ）とみなす
    const check = (target: THREE.Vector3, near: number) => {
      const d = target.clone().sub(from);
      const dist = d.length();
      ray.set(from, d.normalize());
      const hit = ray
        .intersectObjects([cast.runner.group, cover.group], true)
        .find((h) => h.distance < dist - near && !inside(h.object, glove));
      const sc = target.clone().project(umpCam);
      return {
        by: hit ? (inside(hit.object, cast.runner.group) ? 'runner' : 'fielder') : null,
        part: hit ? (hit.object.name || hit.object.parent?.name || '') : null,
        x: (sc.x + 1) / 2,
        y: (1 - sc.y) / 2,
      };
    };
    const gp = new THREE.Vector3();
    glove.getWorldPosition(gp);
    const fp = footMarkPos();
    return {
      glove: check(gp, 0.16),
      foot: check((p.runner.evade ? cast.runner.j.rHand : p.runner.head ? cast.runner.j.lHand : cast.runner.j.lAnkle).clone(), 0.2),
      bag: check(new THREE.Vector3(fp.x, fp.y, fp.z), 0.12),
      ball: check(ball.mesh.position.clone(), 0.14),
    };
  },
  // 検算: いまの塁審の目線で、収めたい点（sceneParts と同じ選び方）が画面のどこにあるか（0..1、上が0。点が無いときは 9/-9）
  frameInfo: () => {
    const parts = sceneParts(S.play!, S.t, track!);
    const box = (vs: THREE.Vector3[]) => {
      const b = { x0: 9, x1: -9, y0: 9, y1: -9 };
      for (const v of vs) {
        const q = v.clone().project(umpCam);
        const x = (q.x + 1) / 2;
        const y = (1 - q.y) / 2;
        b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
      }
      return b;
    };
    return { fov: umpCam.fov, t: S.t, hold: track!.tHold, pitch: box(parts.pitch), glove: box(parts.glove), ball: box(parts.ball), bag: box(parts.bag), fielder: box(parts.fielder), runner: box(parts.runner) };
  },
  // 見た目の確認用: いまの場面を、指定した位置のカメラから1コマ描く（次の step で元の目線に戻る）
  peek: (from: [number, number, number], to: [number, number, number], fov = 50) => {
    const c = new THREE.PerspectiveCamera(fov, viewW / viewH, 0.05, 600);
    c.position.set(...from);
    c.lookAt(...to);
    ball.place(ball.mesh.position, c, false);
    renderer.render(scene, c);
  },
  audio: sfx, // capture / drain / render は告知動画の撮影用
  audioLog: () => audioLog.slice(),
};
