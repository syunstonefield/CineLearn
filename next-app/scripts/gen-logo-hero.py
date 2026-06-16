#!/usr/bin/env python3
# LPヒーロー用の透過ロゴ（public/logo-hero.png）を、白背景版ロゴから生成する。
# ヒーロー背景はグラデ(白→クリーム)なので、ベタ背景のままだと箱が見える→
# クリーム背景をキーアウトして透過PNGにする。
# 実行: python3 scripts/gen-logo-hero.py （next-app/ 直下から）
import numpy as np
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "ロゴ案" / "ホワイト版.png"
OUT = ROOT / "next-app" / "public" / "logo-hero.png"

im = Image.open(SRC).convert("RGB")
a = np.asarray(im, float)
cream = np.array([252, 246, 240])  # 角の背景色
dist = np.sqrt(((a - cream) ** 2).sum(2))
alpha = np.clip((dist - 10) / 26, 0, 1)  # クリーム背景→透過、要素→不透明

# コンテンツの bbox（alpha>0.25）で余白をトリミング
ys, xs = np.where(alpha > 0.25)
pad = 24
t = max(0, ys.min() - pad)
l = max(0, xs.min() - pad)
b = min(a.shape[0], ys.max() + pad)
r = min(a.shape[1], xs.max() + pad)

rgba = np.dstack([a, alpha * 255]).astype("uint8")[t:b, l:r]
Image.fromarray(rgba, "RGBA").save(OUT)
print("✓ logo-hero.png", (r - l, b - t))
