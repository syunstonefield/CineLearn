#!/usr/bin/env python3
"""語ごとの固定難易度表（CEFR-J 1.6 ＋ Octanove C1/C2 1.0）を JSON に変換する・2026-10-30

出力は**出典ごとに別ファイル**（法務 条件2・1ファイルに混ぜない）:
  lib/data/cefrj-wordlist-1.6.json   … CEFR-J Wordlist Version 1.6（A1〜B2）
  lib/data/octanove-c1c2-1.0.json    … Octanove Vocabulary Profile C1/C2 ver 1.0（C1/C2・CC BY-SA 4.0）
各ファイルの先頭に _source / _license / _modified / _retrieved を置く。

使い方（原本は自分で取得して渡す。原本そのものは repo に置かない）:
  curl -sLO https://www.cefr-j.org/data/CEFRJ_wordlist_ver1.6.zip && unzip CEFRJ_wordlist_ver1.6.zip
  curl -sLO https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv
  python3 -I next-app/scripts/build-word-levels.py \\
      --cefrj-xlsx "CEFR-J Wordlist Ver1.6.xlsx" \\
      --octanove-csv octanove-vocabulary-profile-c1c2-1.0.csv \\
      --retrieved 2026-10-30 --out-dir next-app/lib/data
必要: openpyxl（xlsx 読み取り）。

⚠ 法務のルール（2026-10-30・82ce4c0 の回答）:
  1. 表の作り方（変換・正規化・持つ列）を変えたら、JSON の _modified・repo 直下の THIRD_PARTY_NOTICES.md・
     利用規約「第三者データ」節の3か所を同時に直す（文言は ⑤ 検索・半券・設定・その他 部門）。
  2. 表の段階そのものを API 応答・履歴（端末/クラウド同期）に含める変更は、事前に法務へ回す。

変換の規則（_modified に同じ内容を書く）:
  - CEFR-J は 'ALL_sep' シート（表記ゆれ a.m./A.M./am/AM を1行ずつに分けた版）を使う。
  - 見出し語の正規化: Unicode NFKC → 前後の空白を除去 → 連続空白を1つに → 小文字化。
  - 品詞ごとの段階を持つ: "run": {"noun":"A1","verb":"A1"}（2026-10-30〜・単語リストの絞り込みで品詞を合わせるため）。
    品詞を問わない用途（レベル判定）は読み込み側で易しい方を採る。
  - 同じ見出し語・同じ品詞で複数段階がある場合は**易しい方**を採る。
  - 品詞名は小文字化。Octanove の明らかな誤記 vern は verb に、空欄は unknown にする。
  - CoreInventory・notes などの列は持たない。
"""
import argparse
import csv
import json
import re
import unicodedata

ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

MODIFIED = (
    'JSON 化（見出し語→品詞ごとの CEFR 段階の対応を抽出・CoreInventory/notes などの列は削除）・'
    '見出し語の正規化（Unicode NFKC・前後空白の除去・連続空白の圧縮・小文字化）・'
    '品詞名の正規化（小文字化・明らかな誤記 vern→verb を修正・空欄は unknown）・'
    '同じ見出し語と品詞で複数段階がある場合は易しい方の段階を採用'
)

POS_FIX = {'vern': 'verb', '': 'unknown'}


def norm(word):
    w = unicodedata.normalize('NFKC', str(word or ''))
    w = re.sub(r'\s+', ' ', w).strip().lower()
    return w


def add(levels, word, pos, level):
    # levels = { 見出し語: { 品詞: 段階 } }（2026-10-30〜 品詞を保持。単語リストの絞り込みで品詞を合わせて引くため）
    w = norm(word)
    p = re.sub(r'\s+', ' ', str(pos or '')).strip().lower()
    p = POS_FIX.get(p, p)
    lv = str(level or '').strip().upper()
    if not w or lv not in ORDER:
        return False
    d = levels.setdefault(w, {})
    cur = d.get(p)
    if cur is None or ORDER.index(lv) < ORDER.index(cur):
        d[p] = lv
    return True


def read_cefrj(path):
    import openpyxl  # 遅延 import（Octanove だけ変換する時に不要）

    wb = openpyxl.load_workbook(path, read_only=True)
    rows = list(wb['ALL_sep'].iter_rows(values_only=True))
    header = [str(h or '').strip() for h in rows[0]]
    hi, pi, li = header.index('headword'), header.index('pos'), header.index('CEFR')
    levels, n = {}, 0
    for r in rows[1:]:
        if add(levels, r[hi], r[pi], r[li]):
            n += 1
    return levels, n


def read_octanove(path):
    levels, n = {}, 0
    with open(path, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if add(levels, r.get('headword'), r.get('pos'), r.get('CEFR')):
                n += 1
    return levels, n


def write(path, meta, levels):
    # 先頭に _ で始まるメタ情報、続けて levels（語のアルファベット順＝差分が読みやすい）
    doc = dict(meta)
    doc['levels'] = {k: levels[k] for k in sorted(levels)}
    with open(path, 'w', encoding='utf-8') as f:
        f.write('{\n')
        items = list(doc.items())
        for i, (k, v) in enumerate(items):
            comma = ',' if i < len(items) - 1 else ''
            if k == 'levels':
                f.write('"levels": {\n')
                lv = list(v.items())
                for j, (w, l) in enumerate(lv):
                    byPos = json.dumps({p: l[p] for p in sorted(l)}, ensure_ascii=False, separators=(',', ':'))
                    f.write(f'{json.dumps(w, ensure_ascii=False)}: {byPos}{"," if j < len(lv) - 1 else ""}\n')
                f.write('}' + comma + '\n')
            else:
                f.write(f'{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}{comma}\n')
        f.write('}\n')


def counts(levels):
    # 見出し語ごとの「いちばん易しい品詞の段階」で数える
    c = {lv: 0 for lv in ORDER}
    for d in levels.values():
        c[min(d.values(), key=ORDER.index)] += 1
    return {k: v for k, v in c.items() if v}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cefrj-xlsx', required=True)
    ap.add_argument('--octanove-csv', required=True)
    ap.add_argument('--retrieved', required=True, help='原本の取得日 YYYY-MM-DD')
    ap.add_argument('--out-dir', required=True)
    a = ap.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', a.retrieved):
        raise SystemExit('--retrieved は YYYY-MM-DD')

    cj, cj_rows = read_cefrj(a.cefrj_xlsx)
    write(
        f'{a.out_dir}/cefrj-wordlist-1.6.json',
        {
            '_source': 'The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. '
            '（『CEFR-J Wordlist Version 1.6』東京外国語大学投野由紀夫研究室） '
            'Retrieved from https://www.cefr-j.org/download.html '
            '(https://www.cefr-j.org/data/CEFRJ_wordlist_ver1.6.zip)',
            '_license': '著作権は東京外国語大学投野研究室に帰属。適切な引用を行えば研究教育および商用においても無償で利用可、'
            '改変して別の語彙表を作ることも可（必ず本語彙表を適切に引用）。'
            'Copyright belongs to Tono Laboratory at TUFS; free for research and commercial use with proper citation. '
            'Terms: https://www.cefr-j.org/download.html',
            '_modified': MODIFIED + '（原本 ALL_sep シート ' + str(cj_rows) + ' 行 → ' + str(len(cj)) + ' 見出し語）',
            '_retrieved': a.retrieved,
            '_counts': counts(cj),
        },
        cj,
    )

    oc, oc_rows = read_octanove(a.octanove_csv)
    write(
        f'{a.out_dir}/octanove-c1c2-1.0.json',
        {
            '_source': 'Octanove Vocabulary Profile C1/C2 (ver 1.0), created by Octanove Labs (http://www.octanove.com/). '
            'Retrieved from https://github.com/openlanguageprofiles/olp-en-cefrj '
            '(octanove-vocabulary-profile-c1c2-1.0.csv)',
            '_license': 'Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) '
            'https://creativecommons.org/licenses/by-sa/4.0/ ・このファイル（改変物）も CC BY-SA 4.0 で提供する。',
            '_modified': MODIFIED + '（原本 ' + str(oc_rows) + ' 行 → ' + str(len(oc)) + ' 見出し語）',
            '_retrieved': a.retrieved,
            '_counts': counts(oc),
        },
        oc,
    )
    print('cefrj', cj_rows, '->', len(cj), counts(cj))
    print('octanove', oc_rows, '->', len(oc), counts(oc))


if __name__ == '__main__':
    main()
