#!/usr/bin/env python3
# 公開ロゴ(ロゴ案/ダーク版.png)からPWAアイコンを生成する。
# シンボル(金のC＋スクリーン＋座席)を暗い背景から抜き出し、元と同じ放射状の
# 暗いグラデ背景に合成し直す（矩形クロップ由来の継ぎ目を消すため）。
# 実行: python3 scripts/gen-icons-from-logo.py （next-app/ 直下から）
# 出力: public/icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png
import numpy as np
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "ロゴ案" / "ダーク版.png"
OUT = ROOT / "next-app" / "public"

# シンボル部分（文字は除外。少し広めに取り、画面のグローも拾う）
SYM_BOX = (145, 102, 1108, 788)

CENTER = np.array([28, 28, 34], float)  # 背景グラデ中心色
EDGE = np.array([9, 9, 12], float)      # 背景グラデ周辺色

def extract_symbol_rgba():
    im = Image.open(SRC).convert("RGB").crop(SYM_BOX)
    a = np.asarray(im, float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    sat = a.max(2) - a.min(2)
    # 明るさ or 色味があればシンボル。暗い無彩色の背景＋縁のベベルは透過させる
    # ため明るさ側のしきい値を高めに取り、色のある金/赤は彩度側で確実に残す。
    al = np.clip((luma - 52) / 34, 0, 1)
    ac = np.clip((sat - 26) / 26, 0, 1)
    alpha = np.clip(np.maximum(al, ac), 0, 1)
    rgba = np.dstack([a, alpha * 255]).astype("uint8")
    return Image.fromarray(rgba, "RGBA")

def radial_canvas(side):
    yy, xx = np.mgrid[0:side, 0:side]
    cx = cy = (side - 1) / 2
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (side / 2 * 1.05)
    d = np.clip(d, 0, 1)[..., None]
    col = (CENTER * (1 - d) + EDGE * d).astype("uint8")
    img = np.dstack([col, np.full((side, side, 1), 255, "uint8")])
    return Image.fromarray(img, "RGBA")

def compose(scale):
    sym = extract_symbol_rgba()
    w, h = sym.size
    side = round(w / scale)
    canvas = radial_canvas(side)
    canvas.alpha_composite(sym, ((side - w) // 2, (side - h) // 2))
    return canvas.convert("RGB")

std = compose(0.90)   # 標準
msk = compose(0.72)   # maskable（円形クロップ用に余白多め）

for img, size, name in [
    (std, 192, "icon-192.png"),
    (std, 512, "icon-512.png"),
    (std, 180, "apple-touch-icon.png"),
    (msk, 512, "icon-maskable-512.png"),
]:
    img.resize((size, size), Image.LANCZOS).save(OUT / name)
    print("✓", name, f"{size}x{size}")

# ブラウザタブ用 favicon.ico（小サイズなので余白多めの msk 構図を使う）。
# Next.js は app/favicon.ico を /favicon.ico として配信する。
fav = msk.resize((256, 256), Image.LANCZOS).convert("RGBA")  # Next.js は RGBA 必須
fav.save(ROOT / "next-app" / "app" / "favicon.ico", format="ICO",
         sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("✓ app/favicon.ico")
