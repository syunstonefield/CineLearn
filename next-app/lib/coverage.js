// 生成したスーパーセットが作品の全編を覆っているかを、📍時刻の分布で判定する（§1）。
//   components/VocabScreen.js の coverageOk（総尺＝生SRT最終タイムコード版）をここへ移設。サーバ生成
//   （lib/server/vocabGen.js）と seed の両方が同じ判定器を使う。
//   共有キャッシュは一度書くと上書きされない（writeVocabRow は既存行を触らない）ので、片寄ったデータを
//   入れてしまうとその作品は全ユーザーに対して永久に壊れる（アイアンマン＝前半57分欠落の実害・2026-08-08）。
//   判定できない時は true（寄与を止めない）＝新しい検査で正常な寄与を止めないことを優先する。
//   基準: ①最初の語が本編の序盤に居ること（総尺の25%以内） ②語の空白期間が30分を超えないこと
// seed（素の Node）からも import されるため相対 import も外部依存も使わない。

// 生 SRT の最終タイムコード（"01:54:33,120 --> ..." の時:分:秒）を総尺として秒で返す。無ければ null。
export function srtTotalSec(rawSrt) {
  if (!rawSrt) return null;
  const stamps = [...String(rawSrt).matchAll(/(\d{2}):(\d{2}):(\d{2})[,.]\d{3}\s*-->/g)];
  if (!stamps.length) return null;
  const last = stamps[stamps.length - 1];
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

export function coverageOk(words, rawSrt) {
  const secs = (words || []).map((w) => w?.tsSec).filter((s) => typeof s === 'number' && isFinite(s));
  if (secs.length < 5 || !rawSrt) return true; // 判定材料が無い＝止めない
  const total = srtTotalSec(rawSrt);
  if (total == null) return true;
  if (total < 600) return true; // 10分未満は分割生成の対象外＝検査しない
  const sorted = [...secs].sort((a, b) => a - b);
  if (sorted[0] > total * 0.25) return false; // 序盤が丸ごと無い
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 1800) return false; // 30分の空白＝1チャンク相当が欠けている
  }
  return true;
}
