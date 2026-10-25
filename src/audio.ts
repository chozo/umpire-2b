// Web Audio で合成する効果音と BGM。ユーザー操作の後に unlock() してから鳴らす。
// プレー中の音は、起きる時刻の少し前に「何秒後に鳴らす」と予約する（画面のコマ単位のずれを音に持ち込まない）。

const BGM_VOL = 0.3;
const BGM_DUCK_VOL = 0.06; // プレー中は足音が聞こえるよう小さく
const BGM_SLOW_RATE = 0.7;
const MASTER_VOL = 0.75;

export type SfxName =
  | 'bat'
  | 'step'
  | 'slide'
  | 'bag'
  | 'glove'
  | 'mitt'
  | 'whoosh'
  | 'call'
  | 'chime'
  | 'crowd'
  | 'correct'
  | 'wrong'
  | 'tick'
  | 'ejected'
  | 'swoosh';

function noise(ctx: BaseAudioContext, dur: number) {
  const buf = ctx.createBuffer(1, Math.max(1, Math.ceil(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function tone(ctx: BaseAudioContext, out: AudioNode, freq: number, start: number, dur: number, type: OscillatorType, vol: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = env(ctx, start, vol, 0.01, dur);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + dur + 0.03);
}

function thump(ctx: BaseAudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, vol: number) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = env(ctx, t, vol, 0.003, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function burst(ctx: BaseAudioContext, out: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, dur: number, vol: number, attack = 0.002) {
  const n = noise(ctx, dur + attack + 0.02);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = env(ctx, t, vol, attack, dur);
  n.connect(f).connect(g).connect(out);
  n.start(t);
}

// 音を鳴らす。args は音ごとに決まった順番（vol, pan, rate など）
export function renderSfx(ctx: BaseAudioContext, dest: AudioNode, name: SfxName, args: unknown[], t: number) {
  const num = (i: number, d: number) => (typeof args[i] === 'number' ? (args[i] as number) : d);
  // 左右の定位
  let out: AudioNode = dest;
  const pan = name === 'step' || name === 'slide' || name === 'bag' || name === 'glove' || name === 'mitt' || name === 'bat' ? num(1, 0) : 0;
  if (pan !== 0 && 'createStereoPanner' in ctx) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    out = p;
  }
  switch (name) {
    // 打球音「カキーン」
    case 'bat': {
      const v = num(0, 1);
      burst(ctx, out, t, 'highpass', 1800, 0.7, 0.05, 0.9 * v);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(2350, t);
      o.frequency.exponentialRampToValueAtTime(1900, t + 0.25);
      const g = env(ctx, t, 0.35 * v, 0.002, 0.28);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.32);
      tone(ctx, out, 3400, t, 0.12, 'sine', 0.12 * v);
      thump(ctx, out, t, 160, 70, 0.08, 0.5 * v);
      break;
    }
    // 走る足音（土を蹴る）
    case 'step': {
      const v = num(0, 1);
      const r = num(2, 1);
      burst(ctx, out, t, 'bandpass', 520 * r, 1.1, 0.06 / r, 0.75 * v);
      burst(ctx, out, t + 0.012 / r, 'highpass', 2600 * r, 0.6, 0.03 / r, 0.12 * v);
      thump(ctx, out, t, 110 * r, 55 * r, 0.06 / r, 0.55 * v);
      break;
    }
    // スライディング（土の上を滑る「ザザーッ」）
    case 'slide': {
      const v = num(0, 1);
      const r = num(2, 1);
      const d = num(3, 0.6) / r;
      burst(ctx, out, t, 'bandpass', 650 * r, 0.7, d, 0.9 * v, 0.04 / r);
      burst(ctx, out, t + 0.02 / r, 'highpass', 2200 * r, 0.5, d * 0.7, 0.25 * v, 0.05 / r);
      thump(ctx, out, t, 95 * r, 50 * r, 0.1 / r, 0.6 * v);
      break;
    }
    // ベースを踏む音（ゴムのベースを強く踏む「ドスッ」）
    case 'bag': {
      const v = num(0, 1);
      const r = num(2, 1);
      thump(ctx, out, t, 140 * r, 48 * r, 0.12 / r, 0.95 * v);
      burst(ctx, out, t, 'lowpass', 900 * r, 0.8, 0.09 / r, 0.8 * v);
      burst(ctx, out, t, 'bandpass', 1500 * r, 2.5, 0.04 / r, 0.3 * v);
      break;
    }
    // 内野手のグラブ（少し遠いので柔らかめ）
    case 'glove': {
      const v = num(0, 1);
      burst(ctx, out, t, 'bandpass', 1000, 1.0, 0.07, 0.8 * v);
      thump(ctx, out, t, 150, 70, 0.07, 0.5 * v);
      break;
    }
    // 一塁手のミット「パシッ」
    case 'mitt': {
      const v = num(0, 1);
      const r = num(2, 1);
      burst(ctx, out, t, 'bandpass', 1500 * r, 0.9, 0.09 / r, 1.0 * v);
      burst(ctx, out, t, 'highpass', 3500 * r, 0.7, 0.025 / r, 0.35 * v);
      thump(ctx, out, t, 200 * r, 75 * r, 0.09 / r, 0.7 * v);
      break;
    }
    // 送球の風切り音
    case 'whoosh': {
      const dur = num(0, 0.3);
      const v = num(1, 0.12);
      const n = noise(ctx, dur + 0.05);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + dur * 0.92);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
      n.connect(bp).connect(g).connect(out);
      n.start(t);
      break;
    }
    // コールの効果音（アウト: 力強く、セーフ: 横に払う）
    case 'call': {
      if (args[0] === 'out') {
        thump(ctx, out, t, 180, 55, 0.22, 0.9);
        burst(ctx, out, t, 'lowpass', 1200, 0.7, 0.12, 0.5);
        tone(ctx, out, 392, t + 0.02, 0.18, 'square', 0.06);
      } else {
        const n = noise(ctx, 0.4);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(3200, t);
        bp.frequency.exponentialRampToValueAtTime(600, t + 0.3);
        const g = env(ctx, t, 0.5, 0.02, 0.3);
        n.connect(bp).connect(g).connect(out);
        n.start(t);
        tone(ctx, out, 523, t + 0.02, 0.18, 'triangle', 0.1);
        tone(ctx, out, 659, t + 0.1, 0.22, 'triangle', 0.1);
      }
      break;
    }
    // 場内アナウンスのチャイム（リクエスト）
    case 'chime': {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone(ctx, out, f, t + i * 0.17, 0.7, 'sine', 0.22);
        tone(ctx, out, f * 2, t + i * 0.17, 0.3, 'sine', 0.04);
      });
      break;
    }
    // 観客の反応（ooh: どよめき、cheer: 歓声、boo: ブーイング）
    case 'crowd': {
      const kind = args[0] as string;
      const dur = num(1, 1.6);
      const v = num(2, 0.25);
      const n = noise(ctx, dur + 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = kind === 'boo' ? 3 : 0.8;
      const f0 = kind === 'boo' ? 260 : kind === 'cheer' ? 900 : 380;
      const f1 = kind === 'boo' ? 220 : kind === 'cheer' ? 1300 : 650;
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(bp).connect(g).connect(out);
      n.start(t);
      break;
    }
    case 'correct': {
      const notes = args[0] ? [784, 988, 1175, 1568] : [880, 1175];
      notes.forEach((f, i) => tone(ctx, out, f, t + i * 0.07, 0.22, 'triangle', 0.25));
      break;
    }
    case 'wrong':
      tone(ctx, out, 196, t, 0.35, 'square', 0.12);
      tone(ctx, out, 147, t + 0.16, 0.45, 'square', 0.12);
      break;
    case 'tick':
      tone(ctx, out, 1320, t, 0.05, 'sine', 0.12);
      break;
    case 'ejected':
      [523, 415, 330, 262].forEach((f, i) => tone(ctx, out, f, t + i * 0.18, 0.35, 'sawtooth', 0.08));
      break;
    // リプレイへの切り替え
    case 'swoosh': {
      const n = noise(ctx, 0.5);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(4000, t + 0.35);
      const g = env(ctx, t, 0.28, 0.15, 0.3);
      n.connect(bp).connect(g).connect(out);
      n.start(t);
      break;
    }
  }
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  bgmOn = true;
  private bgmBuf: AudioBuffer | null = null;
  private bgmLoading = false;
  private bgmSrc: AudioBufferSourceNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmLp: BiquadFilterNode | null = null;
  private bgmWanted = false;
  private bgmSlow = false;
  private ducked = false;
  readonly log: { name: SfxName; args: unknown[]; at: number }[] = [];
  // 告知動画の撮影用: true の間は鳴らさずに呼び出しを記録し、書き出しで render() が鳴らし直す
  private capturing = false;
  private queue: { name: string; args: unknown[] }[] = [];
  private promoBgm: AudioBuffer | null = null;
  private promoNodes = new WeakMap<BaseAudioContext, { master: GainNode; bgm?: { src: AudioBufferSourceNode; gain: GainNode; lp: BiquadFilterNode } }>();

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = MASTER_VOL;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
      }
    }
    void this.ctx?.resume();
    if (this.ctx && !this.bgmBuf && !this.bgmLoading) {
      this.bgmLoading = true;
      renderCheer(this.ctx.sampleRate)
        .then((b) => {
          this.bgmBuf = b;
          if (this.bgmWanted) this.startBgm();
        })
        .catch(() => {
          // BGM が作れなくてもゲームは続ける
        });
    }
  }

  get now() {
    return this.ctx?.currentTime ?? 0;
  }

  suspend(on: boolean) {
    if (!this.ctx) return;
    void (on ? this.ctx.suspend() : this.ctx.resume());
  }

  // delay 秒後に鳴らす
  play(name: SfxName, args: unknown[] = [], delay = 0) {
    this.log.push({ name, args, at: performance.now() + delay * 1000 });
    if (this.log.length > 300) this.log.splice(0, 100);
    if (this.capturing) {
      this.queue.push({ name, args: [Math.max(0, delay), args] });
      return;
    }
    if (!this.ctx || !this.master || this.muted) return;
    renderSfx(this.ctx, this.master, name, args, this.ctx.currentTime + Math.max(0, delay));
  }

  private bgmTarget() {
    if (!this.bgmOn) return 0.0001;
    return this.ducked ? BGM_DUCK_VOL : BGM_VOL;
  }

  startBgm() {
    if (this.capturing) this.queue.push({ name: 'bgm', args: [0, ['start']] });
    this.bgmWanted = true;
    this.bgmSlow = false;
    if (!this.ctx || !this.master || !this.bgmBuf || this.bgmSrc) {
      this.applyBgmRate(0);
      return;
    }
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.bgmBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(this.bgmTarget(), ctx.currentTime + 0.6);
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.bgmSrc = src;
    this.bgmGain = g;
    this.bgmLp = lp;
  }

  stopBgm(fade = 0.8) {
    if (this.capturing) this.queue.push({ name: 'bgm', args: [0, ['stop', fade]] });
    this.bgmWanted = false;
    const src = this.bgmSrc;
    if (!src || !this.ctx || !this.bgmGain) return;
    const t = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(t);
    this.bgmGain.gain.setValueAtTime(Math.max(0.0001, this.bgmGain.gain.value), t);
    this.bgmGain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    src.stop(t + fade + 0.05);
    this.bgmSrc = null;
    this.bgmGain = null;
    this.bgmLp = null;
  }

  // プレー中は BGM を小さくする
  duck(on: boolean) {
    if (this.ducked === on) return;
    this.ducked = on;
    if (this.capturing) this.queue.push({ name: 'bgm', args: [0, ['duck', on]] });
    if (!this.ctx || !this.bgmGain) return;
    const t = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(t);
    this.bgmGain.gain.setTargetAtTime(this.bgmTarget(), t, on ? 0.15 : 0.4);
  }

  setBgmSlow(on: boolean) {
    if (this.bgmSlow === on) return;
    this.bgmSlow = on;
    if (this.capturing) this.queue.push({ name: 'bgm', args: [0, ['slow', on]] });
    this.applyBgmRate(0.12);
  }

  private applyBgmRate(tc: number) {
    if (!this.ctx || !this.bgmSrc || !this.bgmLp) return;
    const t = this.ctx.currentTime;
    const rate = this.bgmSlow ? BGM_SLOW_RATE : 1;
    if (tc <= 0) this.bgmSrc.playbackRate.setValueAtTime(rate, t);
    else this.bgmSrc.playbackRate.setTargetAtTime(rate, t, tc);
    this.bgmLp.frequency.setTargetAtTime(this.bgmSlow ? 2600 : 18000, t, Math.max(0.01, tc));
  }

  setBgmOn(on: boolean) {
    this.bgmOn = on;
    if (!this.ctx || !this.bgmGain) return;
    const t = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(t);
    this.bgmGain.gain.setTargetAtTime(this.bgmTarget(), t, 0.08);
  }

  // ---- 告知動画の撮影用（window.__game.audio） ----
  capture(on: boolean) {
    this.capturing = on;
    this.queue = [];
    if (on && !this.promoBgm) void renderCheer(44100).then((b) => (this.promoBgm = b));
  }
  // 撮らずに進めた区間の指示は捨てられるので、撮影を再開するときに今の BGM の状態を記録し直す
  resync() {
    if (this.capturing) this.queue.push({ name: 'bgm', args: [0, ['state', this.bgmWanted, this.ducked, this.bgmSlow]] });
  }
  drain() {
    const q = this.queue;
    this.queue = [];
    return q;
  }
  // 記録した呼び出しを、渡された AudioContext（書き出しでは OfflineAudioContext）の時刻 when に鳴らす
  render(ctx: BaseAudioContext, name: string, args: unknown[], when: number) {
    let nodes = this.promoNodes.get(ctx);
    if (!nodes) {
      const master = ctx.createGain();
      master.gain.value = MASTER_VOL;
      master.connect(ctx.destination);
      nodes = { master };
      this.promoNodes.set(ctx, nodes);
    }
    const [delay, a] = args as [number, unknown[]];
    const t = when + (delay || 0);
    if (name !== 'bgm') {
      renderSfx(ctx, nodes.master, name as SfxName, a ?? [], t);
      return;
    }
    // BGM: 動画ではプレー中も少し大きめ（足音より目立ちすぎない程度）
    const [cmd, v, ducked, slow] = a as [string, unknown, boolean, boolean];
    const PROMO_DUCK = 0.12;
    if (cmd === 'state') {
      // 流れていなければ始め、音量と速さを今の状態に合わせる
      if (!v) {
        if (nodes.bgm) this.render(ctx, 'bgm', [delay, ['stop', 0.3]], when);
        return;
      }
      if (!nodes.bgm) this.render(ctx, 'bgm', [delay, ['start']], when);
      const b = nodes.bgm;
      if (!b) return;
      b.gain.gain.setTargetAtTime(ducked ? PROMO_DUCK : BGM_VOL, t + 0.01, 0.2);
      b.src.playbackRate.setTargetAtTime(slow ? BGM_SLOW_RATE : 1, t, 0.05);
      b.lp.frequency.setTargetAtTime(slow ? 2600 : 18000, t, 0.05);
      return;
    }
    if (cmd === 'start' && this.promoBgm && !nodes.bgm) {
      const src = ctx.createBufferSource();
      src.buffer = this.promoBgm;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 18000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(BGM_VOL, t + 0.6);
      src.connect(lp).connect(gain).connect(nodes.master);
      src.start(t);
      nodes.bgm = { src, gain, lp };
    } else if (nodes.bgm) {
      const b = nodes.bgm;
      if (cmd === 'stop') {
        const fade = Number(v) || 0.8;
        b.gain.gain.setTargetAtTime(0.0001, t, fade / 3);
        b.src.stop(t + fade + 0.05);
        nodes.bgm = undefined;
      } else if (cmd === 'duck') b.gain.gain.setTargetAtTime(v ? PROMO_DUCK : BGM_VOL, t, v ? 0.15 : 0.4);
      else if (cmd === 'slow') {
        b.src.playbackRate.setTargetAtTime(v ? BGM_SLOW_RATE : 1, t, 0.12);
        b.lp.frequency.setTargetAtTime(v ? 2600 : 18000, t, 0.12);
      }
    }
  }

  bgmState() {
    return { ready: !!this.bgmBuf, playing: !!this.bgmSrc, on: this.bgmOn, slow: this.bgmSlow, ducked: this.ducked };
  }
}

// ---- 応援風の BGM ----
// トランペット・太鼓・メガホン・観客のざわめきを OfflineAudioContext で一度だけ合成し、ループ再生する。
// リプレイ中は再生速度を落とす（テープの遅回しのように音程も下がる）。曲はこのゲームのための自作。

const BPM = 150;
const BEAT = 60 / BPM;
const BARS = 8;
export const BGM_LOOP_SEC = BARS * 4 * BEAT;

// 半音（0 = C5）と長さ（8分音符単位）。null は休み
type Note = [number | null, number];
const RIFF: Note[][] = [
  [[-5, 1], [0, 1], [0, 1], [4, 1], [7, 2], [4, 1], [0, 1]],
  [[2, 1], [2, 1], [4, 1], [5, 1], [4, 2], [0, 2]],
  [[-5, 1], [0, 1], [0, 1], [4, 1], [7, 2], [9, 1], [7, 1]],
  [[5, 1], [4, 1], [2, 1], [4, 1], [0, 3], [null, 1]],
  // 三三七拍子（後半4小節）: トランペットは拍に合わせて短く吹く
  [[7, 2], [7, 2], [7, 2], [null, 2]],
  [[9, 2], [9, 2], [9, 2], [null, 2]],
  [[7, 2], [7, 2], [7, 2], [7, 2]],
  [[12, 2], [12, 2], [12, 2], [null, 2]],
];
// 太鼓を打つ拍（小節内の 8分音符の位置）
const DRUM: number[][] = [
  [0, 2, 4, 6], [0, 2, 4, 5, 6], [0, 2, 4, 6], [0, 2, 4, 5, 6],
  [0, 2, 4], [0, 2, 4], [0, 2, 4, 6], [0, 2, 4],
];

function brass(ctx: BaseAudioContext, out: AudioNode, semi: number, t: number, dur: number, vol: number) {
  const f = 523.25 * 2 ** (semi / 12);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.frequency.setValueAtTime(f * 1.5, t);
  lp.frequency.linearRampToValueAtTime(f * 6, t + 0.04);
  lp.frequency.exponentialRampToValueAtTime(f * 3, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.025);
  g.gain.setValueAtTime(vol * 0.8, t + Math.max(0.03, dur - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(g).connect(out);
  // 少しずらした 2 本 + 3度下のハモり
  for (const [mul, det, v] of [[1, -6, 1], [1, 7, 1], [2 ** (-4 / 12), 0, 0.45]] as const) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f * mul;
    o.detune.value = det;
    const og = ctx.createGain();
    og.gain.value = v;
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

function drum(ctx: BaseAudioContext, out: AudioNode, t: number, vol: number) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.32);
}

function noiseBuffer(ctx: BaseAudioContext, sec: number) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * sec), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// メガホンを打ち鳴らす音
function clap(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, vol: number) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1600;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  s.connect(bp).connect(g).connect(out);
  s.start(t, Math.random() * 0.5, 0.1);
}

export async function renderCheer(sampleRate = 44100): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * BGM_LOOP_SEC), sampleRate);
  const bus = ctx.createGain();
  bus.gain.value = 0.8;
  bus.connect(ctx.destination);
  const noise = noiseBuffer(ctx, 1);
  const E = BEAT / 2;
  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * 4 * BEAT;
    let pos = 0;
    for (const [semi, len] of RIFF[bar]) {
      if (semi !== null) brass(ctx, bus, semi, t0 + pos * E, len * E * 0.92, 0.09);
      pos += len;
    }
    for (const e of DRUM[bar]) drum(ctx, bus, t0 + e * E, 0.9);
    // メガホン: 前半は裏拍、三三七拍子は太鼓と同時
    const claps = bar < 4 ? [1, 3, 5, 7] : DRUM[bar];
    for (const e of claps) clap(ctx, bus, noise, t0 + e * E, 0.35);
  }
  // 観客のざわめき（ループの継ぎ目が目立たないよう一定の音量）
  const crowd = ctx.createBufferSource();
  crowd.buffer = noiseBuffer(ctx, BGM_LOOP_SEC);
  const cf = ctx.createBiquadFilter();
  cf.type = 'bandpass';
  cf.frequency.value = 700;
  cf.Q.value = 0.5;
  const cg = ctx.createGain();
  cg.gain.value = 0.05;
  crowd.connect(cf).connect(cg).connect(ctx.destination);
  crowd.start(0);
  return ctx.startRendering();
}
