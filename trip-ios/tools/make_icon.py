#!/usr/bin/env python3
# 하워드 트립 앱 아이콘 생성: teal 그라데이션 + 흰 지도 핀(구멍으로 그라데이션 비침) + 은은한 경로 점선.
import math, sys
from PIL import Image, ImageDraw, ImageFilter

S = 4                 # 슈퍼샘플링
N = 1024 * S
OUT = sys.argv[1]

def lerp(a, b, t): return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))
C0 = (0x1a, 0xb0, 0x9d)   # 밝은 teal (좌상)
C1 = (0x0c, 0x66, 0x5e)   # 진한 brand teal (우하)

# 1) 대각 그라데이션 배경
bg = Image.new("RGB", (N, N))
px = bg.load()
den = 2 * (N - 1)
for y in range(N):
    for x in range(N):
        px[x, y] = lerp(C0, C1, (x + y) / den)
bg = bg.convert("RGBA")

# 2) 은은한 경로 점선 (좌하 → 핀 밑). 2차 베지어를 따라 점을 찍는다.
route = Image.new("RGBA", (N, N), (0, 0, 0, 0))
rd = ImageDraw.Draw(route)
P0 = (N * 0.24, N * 0.72)
P1 = (N * 0.30, N * 0.46)
P2 = (N * 0.50, N * 0.62)   # 핀 밑 근처
def bez(t):
    u = 1 - t
    x = u*u*P0[0] + 2*u*t*P1[0] + t*t*P2[0]
    y = u*u*P0[1] + 2*u*t*P1[1] + t*t*P2[1]
    return x, y
dot_r = N * 0.012
steps = 9
for i in range(steps + 1):
    t = i / steps
    x, y = bez(t)
    a = 150 if i == 0 else 95        # 시작점만 조금 진하게
    r = N * 0.026 if i == 0 else dot_r
    rd.ellipse([x-r, y-r, x+r, y+r], fill=(255, 255, 255, a))

# 3) 핀 지오메트리
cx = N * 0.50
R = N * 0.165            # 불룩한 머리 반지름
by = N * 0.395          # 머리 중심 y
L = R * 2.55            # 머리중심→뾰족한 끝 거리
tip = (cx, by + L)
phi = math.acos(R / L)
# 접점 (아래 방향 (0,1) 을 ±phi 회전)
def rot(a):
    return (-math.sin(a), math.cos(a))
t1 = (cx + R * rot(phi)[0],  by + R * rot(phi)[1])
t2 = (cx + R * rot(-phi)[0], by + R * rot(-phi)[1])

# 3a) 그림자 (핀 아래 어두운 타원 → 블러)
shadow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.ellipse([cx - R*0.9, tip[1] - R*0.25, cx + R*0.9, tip[1] + R*0.25], fill=(0, 40, 36, 120))
sd.polygon([tip, t1, t2], fill=(0, 40, 36, 90))
sd.ellipse([cx - R, by - R, cx + R, by + R], fill=(0, 40, 36, 90))
shadow = shadow.filter(ImageFilter.GaussianBlur(N * 0.02))
# 그림자 살짝 아래로 오프셋
off = Image.new("RGBA", (N, N), (0, 0, 0, 0))
off.paste(shadow, (int(N*0.004), int(N*0.012)))
shadow = off

# 3b) 핀 본체 (흰색) — 머리 원 + 삼각형
pin = Image.new("RGBA", (N, N), (0, 0, 0, 0))
pd = ImageDraw.Draw(pin)
pd.polygon([tip, t1, t2], fill=(255, 255, 255, 255))
pd.ellipse([cx - R, by - R, cx + R, by + R], fill=(255, 255, 255, 255))
# 구멍: 완전 투명으로 뚫어 배경 그라데이션이 비치게
hole = R * 0.46
pd.ellipse([cx - hole, by - hole, cx + hole, by + hole], fill=(0, 0, 0, 0))

# 4) 합성
bg.alpha_composite(route)
bg.alpha_composite(shadow)
bg.alpha_composite(pin)

# 5) 다운샘플 → 1024, 알파 제거(불투명)
out = bg.resize((1024, 1024), Image.LANCZOS).convert("RGB")
out.save(OUT, "PNG")
print("wrote", OUT)
