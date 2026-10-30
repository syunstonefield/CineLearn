'use client';

// 綴りミスの候補シート（2026-10-30 オーナー決定＝案B・法務「条件付きOK」）。単語リストの「単語を追加」の下に出す。
//   inList … リストにある語の綴り違い（画面の中だけで判定・サーバには聞いていない）。「見る」でその行へ飛ぶ。
//   items  … サーバ（/api/example mode:'manual'）が返した候補。最大3語。例文（“ ”で囲み・📺出典）が付くのは
//            最も近い1語だけ（法務 条件4/5）。2語目以降は語だけ＝押すと VocabScreen が別の問い合わせで1文を取る。
//            「別の例文」は出さない。
//   この部品は表示するだけ。保存は VocabScreen が選ばれた1語だけ行い、選ばれなかった候補の文は保存しない（法務 条件6）。
export default function SpellSuggestSheet({ input, inList, items, credit, busy, onPick, onNone, onJump }) {
  if (inList) {
    return (
      <div className="spell-sheet" role="dialog" aria-label="リストにある語の確認">
        <p className="spell-lead">
          リストにある「<b>{inList}</b>」ですか？
        </p>
        <button type="button" className="spell-pick is-sub" disabled={busy} onClick={onJump}>
          リストの {inList} を見る
        </button>
        <button type="button" className="spell-none" disabled={busy} onClick={onNone}>
          ちがう（「{input}」として追加）
        </button>
      </div>
    );
  }
  return (
    <div className="spell-sheet" role="dialog" aria-label="スペルの近い語">
      <p className="spell-lead">
        「<b>{input}</b>」はこの話の字幕に見つかりませんでした。この語ですか？
      </p>
      {(items || []).map((it) => (
        <div key={it.word} className="spell-cand">
          <div className="spell-top">
            <span className="spell-word">{it.word}</span>
            {it.sentence ? it.tsLabel && <span className="spell-ts">📍 {it.tsLabel}</span> : <span className="spell-hint">ほかの候補</span>}
          </div>
          {it.sentence && (
            <>
              {/* 字幕の逐語引用＝“ ”で明瞭区分（32条）・出典（48条） */}
              <div className="spell-ex">“{highlightWord(it.sentence, it.word)}”</div>
              <div className="spell-src">{credit}</div>
            </>
          )}
          <button type="button" className={'spell-pick' + (it.sentence ? '' : ' is-sub')} disabled={busy} onClick={() => onPick(it)}>
            この語で追加
          </button>
        </div>
      ))}
      <button type="button" className="spell-none" disabled={busy} onClick={onNone}>
        どれでもない（「{input}」のまま例文なしで追加）
      </button>
    </div>
  );
}

// 例文の中の候補語を強調する（大小文字は問わない・最初の1つ）
function highlightWord(sentence, word) {
  const s = String(sentence || '');
  const re = new RegExp(`\\b(${String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
  const m = re.exec(s);
  if (!m) return s;
  return (
    <>
      {s.slice(0, m.index)}
      <mark>{m[1]}</mark>
      {s.slice(m.index + m[1].length)}
    </>
  );
}
