#!/usr/bin/env python3
# 하워드 트립 앱 아이콘: teal 그라데이션 배경에 '순서가 있는 일정' —
# 번호(1·2·3) 매겨진 흰 지도 핀 3개를 흰 경로선으로 이어 방문 순서를 보여준다.
import math, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 4
N = 1024 * S
OUT = sys.argv[1]

def lerp(a, b, t): return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))
C0 = (0x1a, 0xb0, 0x9d)   # 밝은 teal (좌상)
C1 = (0x0c, 0x66, 0x5e)   # 진한 brand teal (우하)
NUMCOL = (0x0c, 0x66, 0x5e)  # 번호 색(진한 teal)

# 숫자 폰트 (SF Rounded Bold → Arial Bold 폴백)
def load_font(px):
    try:
        f = ImageFont.truetype("/System/Library/Fonts/SFCompactRounded.ttf", px)
        try: f.set_variation_by_name("Bold")
        except Exception: pass
        return f
    except Exception:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", px)

# 1) 대각 그라데이션 배경
bg = Image.new("RGB", (N, N)); px = bg.load(); den = 2 * (N - 1)
for y in range(N):
    for x in range(N):
        px[x, y] = lerp(C0, C1, (x + y) / den)
bg = bg.convert("RGBA")

# 핀 3개(불룩한 머리 중심, fraction) — 좌하 → 우상 오름세
R = N * 0.093                 # 머리 반지름
L = R * 2.35                  # 머리중심→끝
bulbs = [(0.275, 0.615), (0.500, 0.455), (0.725, 0.335)]
bulbs = [(cx * N, cy * N) for (cx, cy) in bulbs]

def pin_poly(cx, by):
    tip = (cx, by + L)
    phi = math.acos(R / L)
    t1 = (cx - R * math.sin(phi),  by + R * math.cos(phi))
    t2 = (cx + R * math.sin(phi),  by + R * math.cos(phi))
    return tip, t1, t2

# 2) 경로선 (머리 중심들을 잇는 흰 선) — 핀 아래 깔림
route = Image.new("RGBA", (N, N), (0, 0, 0, 0))
rd = ImageDraw.Draw(route)
lw = int(N * 0.030)
rd.line([b for b in bulbs], fill=(255, 255, 255, 235), width=lw, joint="curve")
for (cx, cy) in bulbs:  # 이음새 둥글게
    rd.ellipse([cx-lw/2, cy-lw/2, cx+lw/2, cy+lw/2], fill=(255, 255, 255, 235))

# 3) 그림자 (핀들 아래 부드럽게)
shadow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
for (cx, by) in bulbs:
    tip, t1, t2 = pin_poly(cx, by)
    sd.polygon([tip, t1, t2], fill=(0, 40, 36, 70))
    sd.ellipse([cx-R, by-R, cx+R, by+R], fill=(0, 40, 36, 70))
shadow = shadow.filter(ImageFilter.GaussianBlur(N * 0.015))
soff = Image.new("RGBA", (N, N), (0, 0, 0, 0))
soff.paste(shadow, (int(N*0.003), int(N*0.010)))
shadow = soff

# 4) 핀 본체(흰색) + 번호
pins = Image.new("RGBA", (N, N), (0, 0, 0, 0))
pd = ImageDraw.Draw(pins)
font = load_font(int(R * 1.15))
for i, (cx, by) in enumerate(bulbs, start=1):
    tip, t1, t2 = pin_poly(cx, by)
    pd.polygon([tip, t1, t2], fill=(255, 255, 255, 255))
    pd.ellipse([cx-R, by-R, cx+R, by+R], fill=(255, 255, 255, 255))
    pd.text((cx, by), str(i), font=font, fill=NUMCOL, anchor="mm")

# 5) 합성 → 다운샘플 → 불투명 PNG
bg.alpha_composite(route)
bg.alpha_composite(shadow)
bg.alpha_composite(pins)
bg.resize((1024, 1024), Image.LANCZOS).convert("RGB").save(OUT, "PNG")
print("wrote", OUT)
