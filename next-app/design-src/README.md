# design-src — 半券画像の原本（配信対象外）

`public/premiere-pass.webp` / `public/collection-ticket.webp` の元 PNG。public/ には置かない（1〜2MB で表示が遅くなる）。

2026-10-08 の切り抜き手順（Python + Pillow + scipy、再生成が必要になったら参考に）:
- premiere-pass: 暗い背景(輝度 R+G+B ≤ 90)を外周からフラッドフィルで抜く → 最外層の暗い画素(影)を皮むき → ミシン目の点を透過穴にする → 券のバウンディングボックス+8px で切り抜き（1250×640）。切り抜き後は PrepLaunch.js の重ね文字の top/left % と style.css の aspect-ratio を再計算すること。
- collection-ticket: 既存の二値αを opening(半径6)で端材除去 → 右辺の輪郭を左辺に鏡映 → 4辺を内側包絡で直線カット → 小さなへこみを closing で埋める（キャンバス 1300×556 は不変＝重ね位置はそのまま）。
- 共通: マスクを σ0.9 でぼかしてアンチエイリアス、半透明縁の RGB は最寄りの不透明画素の色で置換（背景色の滲み防止）、`cwebp -q 85 -alpha_q 100 -exact`。
