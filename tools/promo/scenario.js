// 二塁塁審ジャッジの告知動画の台本（縦型・約30秒）。npm run promo で撮影から MP4 まで作る。
// 流れ: つかみ（際どいタッチのスーパースロー）→ タイトル → ふつうの盗塁で「セーフ！」→ 際どいヘッドスライディングで
//       「アウト！」→ 監督のリクエスト → スロー映像で検証 → ナイスジャッジ！ → 締めの一言 → エンドカード。
// 称号には触れない（結果画面も映さない）。BGM はゲームの曲（__game.audio が鳴らし直す）。
// 使える操作はスキルの references/scenario-api.md。

export const config = {
  slug: 'umpire-2b',
  url: 'https://game.chozo.net/umpire-2b/',
  orientation: 'portrait',
  game: { width: 360, height: 640 }, // 9:16
  serveDir: 'dist', // npm run build の出力（dist/umpire-2b/）
  gamePath: '/umpire-2b/',
  gameQuery: 'promo=1&seed=5', // ゲームは自分の乱数を使うので、種は URL で固定する
  layout: { centerX: 0.5, centerY: 0.48, maxW: 0.9, maxH: 0.86 }, // 真ん中に大きく
  music: false, // BGM はゲームの曲
};

const CAP = { y: 0.19, size: 50 }; // 早送りの表示（上 10%）と重ならない高さ

/** 撮らずに、条件を満たすまでゲームを進める。撮らない間の音の指示は捨てられるので、BGM の状態を記録し直す */
async function skipUntil(p, cond, max = 30) {
  const r = await p.until(cond, { max, record: false });
  await p.call('audio.resync');
  return r;
}

/** 次のプレーを指定して始める（走者が走り出す少し前から） */
async function nextPlay(p, force, index = 25) {
  await p.call('setIndex', index); // 25: 途中のプレー扱い（投球の場面を省く）。0: 最初のプレー扱い（投手の投球から映す）
  await p.call('replay', force);
  await p.call('audio.resync');
  return (await p.state()).play;
}

/** コールできるようになったら正しくコールする（delay 秒待ってから） */
async function callTruth(p, play, delay = 0.3) {
  await p.until((s) => s.armed, { max: 8 });
  if (delay > 0) await p.wait(delay);
  await p.call('call', play.out ? 'out' : 'safe');
}

export default async function scenario(p) {
  await p.call('manual', true);
  await p.call('start');

  // ---- 0〜2.5秒: つかみ。際どいタッチをスーパースローで ----
  let play = await nextPlay(p, { margin: 0.02, cover: 'SS', head: false });
  await skipUntil(p, (s) => s.armed);
  await p.call('call', 'out');
  await skipUntil(p, (s) => s.phase === 'replay' && s.replaySub === 'r2');
  await skipUntil(p, (s) => s.rt >= Math.min(s.play.tTag, s.play.tArrive) - 0.03);
  p.caption('どっちが先！？', { ...CAP, size: 60, dur: 2.4 });
  let stamps = 0;
  p.on('stamp', () => {
    stamps++;
    p.flash({ dur: 0.15, strength: 0.4 });
  });
  await p.until(() => stamps >= 2, { max: 4 });
  p.fx('0.02秒差！', { x: 0.5, y: 0.47, rot: -6, size: 58, dur: 1.0 });
  await p.wait(0.8);
  p.off('stamp');

  // ---- 2.5〜5.5秒: タイトル（後ろは次のプレーの投球前。投手がセットし、捕手が構えている。ほぼ止めておく） ----
  play = await nextPlay(p, { margin: -0.12, cover: '2B', head: false }, 0);
  p.speed(0.1, { badge: false });
  p.title({ title: '二塁塁審\nジャッジ', sub: '盗塁はアウトか、セーフか。', dur: 2.8 });
  await p.wait(2.9);
  p.speed(1);

  // ---- 5.5〜13秒: 投手が投球フォームに入る → ふつうの盗塁 → セーフ！ ----
  // 投手がセットして捕手が構える → 投球フォームへ。走者が走り出す前に字幕を消す（字幕は1つずつ）
  const t0 = (await p.state()).t;
  p.caption('ピッチャーが\n投球フォームへ', { ...CAP, dur: Math.max(0.8, play.tStart - t0 - 0.1) });
  await p.until((s) => s.t >= s.play.tStart, { max: 4 });
  p.caption('走った！盗塁だ！', { ...CAP, dur: 1.4 });
  await p.wait(1.0);
  p.speed(2, { badge: false }); // 走るところは少し早める
  await p.until((s) => s.t >= s.play.tCatch - 0.5, { max: 5 });
  p.speed(1);
  p.caption('足が先？\nタッチが先？', { ...CAP, dur: 1.8 });
  await callTruth(p, play, 0.25);
  await p.wait(1.4);

  // ---- 11〜23秒: 際どいヘッドスライディング。アウト！ → リクエスト → スロー検証 → ナイスジャッジ！ ----
  play = await nextPlay(p, { margin: 0.025, cover: 'SS', head: true });
  await p.wait(0.4);
  p.speed(2, { badge: false });
  await p.until((s) => s.t >= s.play.tCatch - 0.5, { max: 5 });
  p.speed(1);
  p.caption('ヘッドスライディング！', { ...CAP, size: 38, dur: 1.4 });
  await callTruth(p, play, 0.2);
  await p.until((s) => s.phase === 'request', { max: 3 });
  p.caption('際どい判定に\n監督がリクエスト！', { ...CAP, y: 0.66, size: 46, dur: 1.8 });
  p.speed(2, { badge: false });
  await p.until((s) => s.phase === 'replay', { max: 4 });
  p.speed(1);
  p.caption('スロー映像で\nプレーを確認！', { ...CAP, dur: 1.6 });
  p.speed(2.4, { badge: false });
  await p.until((s) => s.replaySub === 'r2', { max: 5 });
  p.speed(2.4, { badge: false }); // スーパースローは足とタッチの瞬間で止まるので、そのほかは早める
  stamps = 0;
  p.on('stamp', () => {
    stamps++;
    p.flash({ dur: 0.15, strength: 0.4 });
  });
  await p.until((s) => s.replaySub === 'r3', { max: 8 });
  p.speed(1);
  p.off('stamp');
  p.fx('ナイスジャッジ！', { x: 0.5, y: 0.2, rot: -5, size: 64, dur: 1.4, color: '#fde047' });
  p.shake(6, 0.4);
  await p.wait(1.8);

  // ---- 23〜26.5秒: 締めの一言 ----
  play = await nextPlay(p, { margin: -0.03, cover: '2B', head: true });
  p.caption('誤審3回で失格！', { ...CAP, dur: 1.5 });
  p.speed(2, { badge: false });
  await p.wait(1.6);
  p.speed(1);
  p.caption('きみの目で\n見極めろ！', { ...CAP, size: 60, dur: 1.8 });
  await p.wait(1.8);

  // ---- 26.5〜30秒: エンドカード ----
  p.endCard({ title: '二塁塁審\nジャッジ', sub: '盗塁はアウトか、セーフか。', cta: '今すぐ遊べる！', dur: 3.3 });
  await p.wait(3.3);
}
