// EJDict-hand（パブリックドメイン英和辞書・約46,000語）から拡張のホバー速訳用
// ローカル辞書 extension/ejdict-ja.json を生成する。
//
// 背景: ホバー速訳は /api/translate（Azure/DeepL）頼みだったが、2026-08 に Azure 試用切れで
// 全滅した。辞書を拡張に同梱すればホバー訳は API コスト永久¥0・オフライン動作・鍵失効の
// 影響なしになる（クリック時の文脈訳「この場面では」は従来どおり /api/claude wordsense）。
//
// 実行: node seed/build-ejdict.mjs
//   → https://github.com/kujirahand/EJDict の src/a.txt〜z.txt を取得して整形。
//   出力はコミット対象（ビルドにネットワーク不要にするため生成物を repo に置く）。
//
// 整形方針（ホバーの1行チップに収める）:
//   ・語義は先頭2義まで・全体40字まで
//   ・《用法注記》〈可算マーク〉『強調』(補足) は除去（入れ子括弧対応）
//   ・見出しは英字のみ（複合語・記号見出しは除外）
// 活用形の還元（ran→run 等）はデータでなく実行時ロジック（content.js の ejLookup）で行う。

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'ejdict-ja.json');
const BASE = 'https://raw.githubusercontent.com/kujirahand/EJDict/master/src';

function stripParens(s) {
  // 最内の括弧から繰り返し除去（入れ子対応）。対応の壊れた片括弧は前後ごと落とす。
  let prev;
  do {
    prev = s;
    s = s.replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '');
  } while (s !== prev);
  return s.replace(/^[^（）()]*[)）]/, '').replace(/[（(][^（）()]*$/, '');
}

function cleanGloss(def) {
  const cleaned = [];
  for (let s of def.split(' / ')) {
    s = s.replace(/《[^》]*》/g, '');
    s = stripParens(s);
    s = s
      .replace(/[『』«»]/g, '')
      .replace(/〈[^〉]*〉/g, '')
      .replace(/[＝=]\S+/g, '')
      .replace(/\s+/g, '')
      .replace(/^[,，;；・]+|[,，;；・]+$/g, '');
    if (s && s.length >= 2 && !cleaned.includes(s)) cleaned.push(s);
    if (cleaned.length >= 2) break;
  }
  let out = cleaned.join('、');
  if (out.length > 40) out = out.slice(0, 39) + '…';
  return out;
}

const dict = {};
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  const res = await fetch(`${BASE}/${letter}.txt`);
  if (!res.ok) throw new Error(`fetch ${letter}.txt: ${res.status}`);
  for (const line of (await res.text()).split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const word = line.slice(0, tab).toLowerCase();
    if (!/^[a-z][a-z-]*$/.test(word)) continue;
    const gloss = cleanGloss(line.slice(tab + 1));
    if (!gloss) continue;
    if (!dict[word]) dict[word] = gloss; // 同語の重複見出しは先勝ち
  }
  process.stdout.write(letter);
}

const json = JSON.stringify(dict);
writeFileSync(OUT, json);
console.log(`\n${Object.keys(dict).length}語 / ${(json.length / 1024).toFixed(0)}KB → ${OUT}`);
