"""원본 그림(배경 있는 RGB PNG)에서 배경을 지워 투명 스프라이트를 만든다.

사용법: python tools/make_sprites.py
결과: assets/sprites/<이름>.png (투명 배경, 여백 잘라냄, 높이 통일)
"""
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "source"
OUT = ROOT / "assets" / "sprites"
TARGET_H = 160

# 이름: 배경 처리 방식
#   white      흰 배경, 외곽선이 이어진 그림 (선을 두껍게 해서 틈 막고 바깥 채우기)
#   whiteonly  흰 배경, 몸이 흰색과 구분되는 그림 (순백색만 바깥에서부터 지움)
#   close:<k>  흰 배경, 외곽선 틈이 큰 그림 (흰색 아닌 부분을 k픽셀 넓혀 틈을 막고 실루엣을 만든 뒤 되돌림)
#   black      검은 배경
#   alpha      이미 투명 배경 (자르고 크기만 맞춤)
SOURCES = {
    "usagi": "white",
    "hachiware": "white",
    "chiikawa": "black",
    "kani": "close:15",
    "momonga": "alpha",
    "rakko": "close:31",  # 점선 외곽선
    "shisa": "alpha",
    "kurimanju": "alpha",
}


def flood_from_border(mask: Image.Image) -> Image.Image:
    """mask에서 255인 영역 중 테두리와 이어진 부분을 128로 채운다."""
    # ImageDraw.floodfill이 이 그림에서 선을 넘어 새는 경우가 있어 직접 4방향 BFS로 채운다.
    w, h = mask.size
    data = bytearray(mask.tobytes())
    queue = deque()
    for x in range(w):
        queue.append(x)
        queue.append((h - 1) * w + x)
    for y in range(h):
        queue.append(y * w)
        queue.append(y * w + w - 1)
    while queue:
        i = queue.pop()
        if data[i] != 255:
            continue
        data[i] = 128
        x, y = i % w, i // w
        if x > 0: queue.append(i - 1)
        if x < w - 1: queue.append(i + 1)
        if y > 0: queue.append(i - w)
        if y < h - 1: queue.append(i + w)
    return Image.frombytes("L", (w, h), bytes(data))


def alpha_for_white_bg(img: Image.Image) -> Image.Image:
    # 외곽선의 작은 틈으로 배경이 몸 안까지 번지지 않도록, 선을 두껍게 만든 뒤
    # 바깥쪽을 채우고 다시 원래 두께만큼 되돌린다.
    lum = img.convert("L")
    lines = lum.point(lambda v: 255 if v < 200 else 0).filter(ImageFilter.MaxFilter(9))
    open_area = lines.point(lambda v: 0 if v else 255)
    outside = flood_from_border(open_area).point(lambda v: 255 if v == 128 else 0)
    bg = outside.filter(ImageFilter.MaxFilter(9))
    # 넓힌 만큼 선까지 먹지 않게, 실제로 밝은 픽셀만 배경으로 인정
    bright = lum.point(lambda v: 255 if v > 225 else 0)
    bg = ImageChops.multiply(bg, bright)
    # 배경 경계의 회색 번짐은 밝기만큼 반투명 처리
    edge = bg.filter(ImageFilter.MaxFilter(3))
    soft = ImageChops.subtract(edge, bg)  # 배경과 맞닿은 1px 띠
    alpha = ImageChops.invert(bg)
    a, s, l = alpha.load(), soft.load(), lum.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            if s[x, y] and l[x, y] > 150:
                a[x, y] = min(a[x, y], int((255 - l[x, y]) * 2.2))
    return alpha


def alpha_for_pure_white_bg(img: Image.Image) -> Image.Image:
    # 몸이 크림색처럼 흰색과 구분되는 그림: 거의 순백색인 픽셀만 바깥에서부터 지운다
    r, g, b = img.convert("RGB").split()
    lo = ImageChops.darker(ImageChops.darker(r, g), b)  # 채널 최솟값
    cand = lo.point(lambda v: 255 if v > 244 else 0)
    outside = flood_from_border(cand).point(lambda v: 255 if v == 128 else 0)
    return ImageChops.invert(outside)


def alpha_by_closing(img: Image.Image, k: int) -> Image.Image:
    r, g, b = img.convert("RGB").split()
    lo = ImageChops.darker(ImageChops.darker(r, g), b)
    ink = lo.point(lambda v: 255 if v < 238 else 0).filter(ImageFilter.MaxFilter(k))
    outside = flood_from_border(ink.point(lambda v: 0 if v else 255)).point(lambda v: 255 if v == 128 else 0)
    return ImageChops.invert(outside.filter(ImageFilter.MaxFilter(k)))


def alpha_for_black_bg(img: Image.Image) -> Image.Image:
    # 검은 배경과 검은 외곽선이 붙어 있으므로: 밝은 몸통을 구멍까지 채운 뒤
    # 외곽선 두께만큼 넓혀서 실루엣을 만든다.
    bright = img.convert("L").point(lambda v: 255 if v > 70 else 0)
    not_bright = bright.point(lambda v: 0 if v else 255)
    outside = flood_from_border(not_bright).point(lambda v: 255 if v == 128 else 0)
    body = ImageChops.invert(outside)
    return body.filter(ImageFilter.MaxFilter(7))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, bg in SOURCES.items():
        src = Image.open(SRC / f"{name}.png")
        if bg == "alpha":
            rgba = src.convert("RGBA")
            alpha = rgba.getchannel("A")
        else:
            img = src.convert("RGB")
            if bg.startswith("close:"):
                alpha = alpha_by_closing(img, int(bg.split(":")[1]))
            else:
                alpha = {
                    "white": alpha_for_white_bg,
                    "whiteonly": alpha_for_pure_white_bg,
                    "black": alpha_for_black_bg,
                }[bg](img)
            rgba = img.copy()
            rgba.putalpha(alpha)
        bbox = alpha.point(lambda v: 255 if v > 20 else 0).getbbox()
        rgba = rgba.crop(bbox)
        scale = TARGET_H / rgba.height
        rgba = rgba.resize((round(rgba.width * scale), TARGET_H), Image.LANCZOS)
        rgba.save(OUT / f"{name}.png")
        print(name, rgba.size)


if __name__ == "__main__":
    main()
