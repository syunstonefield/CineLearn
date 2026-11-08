"""v1.2.12 のストア画像 A2・A4 用: オーナーの写真の白い映像部分（配信側の保護で白く写る）を黒に置き換える。
字幕の白文字は暗い縁取りがあるので、画像の外周から「明るくて色の薄い画素」だけを塗りつぶせば縁取りで止まる。
文字の穴（O・A・D などの内側）は外から届かないので、穴の外周がすぐ文字の白に接しているかで見分けて黒にする。
ポップアップ（白いカード）は矩形で守る。字幕の印（クリーム色・点線）とポップアップはそのまま残す。
実行: python3 darken_popup_bg.py → src/extension-popup-star-v1.2.12-dark.png"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import os
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = f'{HERE}/src/extension-popup-star-v1.2.12.png'
OUT = f'{HERE}/src/extension-popup-star-v1.2.12-dark.png'
BLACK = np.array([12, 12, 14], dtype=np.uint8)  # 再生画面の暗い場面に近い色

a = np.asarray(Image.open(SRC).convert('RGB')).astype(np.int16)
h, w, _ = a.shape
bright = a.mean(axis=2)
sat = a.max(axis=2) - a.min(axis=2)
SUB_TOP = 870  # 字幕の文字の上端（実測 872・これより上はクリック中の語の地色だけ）

# ポップアップ（白いカード）は角の丸い形で守る（実測の矩形・半径14px）
cx0, cy0, cx1, cy1, r = 938, 633, 1158, 852, 14
yy, xx = np.mgrid[0:h, 0:w]
in_rect = (xx >= cx0) & (xx < cx1) & (yy >= cy0) & (yy < cy1)
corner = np.zeros((h, w), bool)
for (ox, oy) in [(cx0 + r, cy0 + r), (cx1 - r - 1, cy0 + r), (cx0 + r, cy1 - r - 1), (cx1 - r - 1, cy1 - r - 1)]:
    q = ((xx < cx0 + r) if ox == cx0 + r else (xx > cx1 - r - 1)) & ((yy < cy0 + r) if oy == cy0 + r else (yy > cy1 - r - 1))
    corner |= q & ((xx - ox) ** 2 + (yy - oy) ** 2 > r * r)
card = in_rect & ~corner

# 字幕の行より上: 字幕は無いので、カード以外の色の薄い明るい画素（映像の白・カードの影の灰）を全部黒に
upper = (yy < SUB_TOP) & ~card & (sat <= 14) & (bright >= 120)

# 字幕の行: 文字の縁は 240 台のうっすらした影で囲まれているので、真っ白（252 以上）だけを外周からたどる
white = (bright >= 252) & (sat <= 6) & (yy >= SUB_TOP)
lab, n = ndi.label(white | upper)
edge_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
outside = np.isin(lab, list(edge_labels)) & (yy >= SUB_TOP)

# 文字の穴（O・A・D などの内側）: 外に届かない真っ白の島のうち、周り 6px に外側の背景が無いもの
holes = np.zeros((h, w), bool)
ring_k = np.ones((13, 13), bool)
lab2, n2 = ndi.label(white & ~outside)
for i in range(1, n2 + 1):
    comp = lab2 == i
    size = int(comp.sum())
    if size < 6 or size > 4000:
        continue
    ring = ndi.binary_dilation(comp, ring_k) & ~comp
    if (outside & ring).sum() > 3:  # 外側の背景に接している＝文字の本体
        continue
    if ((sat > 30) & ring).sum() > 0.4 * ring.sum():  # 周りの多くが色の付いた印（クリック中の語の地色）＝印の中の文字
        continue
    holes |= comp

dark = upper | outside | holes
out = a.astype(np.uint8).copy()
out[dark] = BLACK
# 字幕の影: 白い背景の上では薄い灰（200〜250）に写っている。黒い背景では本物と同じく暗い影に見えるよう、
#   色の薄い灰だけを暗い方へ寄せる（文字の白 252 以上と、色の付いた印・カードには触れない）
band = (yy >= SUB_TOP - 6) & ~card & ~dark & (sat <= 14) & (bright < 252)
v = bright[band]
nv = np.clip((v - 200) * 255.0 / 52.0, 0, 255)
out[band] = np.stack([nv, nv, nv], axis=1).astype(np.uint8)
# 影の外側の縁（影から白い背景へ戻る途中の明るい画素）は背景の続きなので黒に。背景から 3px 以内の色の薄い画素が対象
#   （文字の内側の縁は文字の白に接していて、背景からは影の厚み 4〜6px 離れているので触れない）
rim = ndi.binary_dilation(dark, np.ones((3, 3), bool), iterations=3) & ~dark & ~card & (sat <= 14) & (yy >= SUB_TOP - 6)
out[rim] = BLACK
# 字幕の下の細い点線（他の作品で出会った語・単語リストの語の印）: 白い背景の上ではごく淡い暖色に写っている。
#   黒い背景で印として読めるよう、点線の帯（実測 y=939〜943・1017〜1022）の暖色の画素をクリーム色にする。
CREAM = np.array([214, 178, 112], dtype=np.uint8)
dots_rows = ((yy >= 939) & (yy <= 943)) | ((yy >= 1017) & (yy <= 1022))
warm = (a[..., 0] - a[..., 2] >= 6) & (bright >= 200)
dots = dots_rows & warm & ~card
out[dots] = CREAM
out[dots_rows & ~warm & ~card] = BLACK
Image.fromarray(out).save(OUT, optimize=True)
print('saved', OUT, 'upper', int(upper.sum()), 'outside', int(outside.sum()), 'holes', int(holes.sum()))
