"""'캐릭터 디자인' 폴더의 그림을 상황별 투명 스프라이트로 만든다.

폴더 구조:  캐릭터 디자인/<캐릭터 한글 이름>/<상황 낱말이 들어간 이름>.png|jpg|webp
  예) 캐릭터 디자인/치이카와/먹방 치이카와.png  →  assets/sprites/chiikawa/eat.png

파일 이름에 들어 있는 낱말로 상황을 정한다 (SITUATIONS). 같은 상황 그림이 여럿이면
eat.png, eat-2.png … 로 저장되고 앱이 그중 하나를 골라 보여준다.
배경은 자동으로 알아낸다: 투명 / 어두운 단색 / 밝은 단색(흰색·크림색).

사용법: python tools/make_sprites.py
결과:   assets/sprites/<id>/<상황>.png, src/renderer/sprite-manifest.js
"""
import json
import shutil
from collections import deque
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
DESIGNS = ROOT / "캐릭터 디자인"
OUT = ROOT / "assets" / "sprites"
MANIFEST = ROOT / "src" / "renderer" / "sprite-manifest.js"
TARGET_H = 160

CHARACTER_IDS = {
    "치이카와": "chiikawa",
    "하치와레": "hachiware",
    "우사기": "usagi",
    "랏코": "rakko",
    "모몽가": "momonga",
    "시사": "shisa",
    "헌책방": "kani",
    "쿠리만쥬": "kurimanju",
}

# 파일 이름 낱말 → 상황. 위에서부터 먼저 맞는 것을 쓴다.
#   default 평소(걷기·서 있기)   eat 간식 먹을 때      sleep 잘 때
#   happy   쓰다듬기·공 잡았을 때  greet 친구를 만났을 때  special 고유 행동
#   dance   음악이 나올 때 춤      focus 집중 모드        cheer 응원·알림
#   work    가끔 하는 일(청소 등)
SITUATIONS = [
    ("기본", "default"),
    ("먹방", "eat"), ("아이스크림", "eat"), ("딸기", "eat"),
    ("졸", "sleep"),
    ("춤", "dance"),
    ("노래", "special"), ("귀여운척", "special"),
    ("행복", "happy"), ("다행", "happy"), ("한정선", "happy"), ("메지컬", "happy"),
    ("인사", "greet"),
    ("공부", "focus"), ("집중", "focus"), ("의젓", "focus"),
    ("응원", "cheer"), ("히어로", "cheer"),
    ("청소", "work"),
]

# 외곽선 틈이 커서 더 넓게 막아야 하는 그림 (파일 이름에 들어 있는 글자: 틈 크기)
GAP_OVERRIDES = {
    "기본 랏코": 31,  # 점선 외곽선
    "집중 헌책방": 15,
    "행복 치이카와": 21,
    "아이스크림 모몽가": 29,
}
# 외곽선이 열려 있거나 몸 색이 배경색과 거의 같은 그림: 그림 전체를 감싸는 볼록한 모양으로 자른다
HULL_CUT = ["졸린 모몽가", "공부 시사"]
DEFAULT_GAP = 11


def flood_from_border(mask: Image.Image) -> Image.Image:
    """mask에서 255인 영역 중 테두리와 이어진 부분을 128로 채운다 (4방향 BFS)."""
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


def border_color(img: Image.Image):
    """네 모서리 색의 평균 (배경색 추정)."""
    w, h = img.size
    pts = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]
    cols = [img.getpixel(p) for p in pts]
    return tuple(sum(c[i] for c in cols) // len(cols) for i in range(3))


def color_distance(img: Image.Image, bg) -> Image.Image:
    # 크림색 몸처럼 한 채널만 다른 경우도 잡도록 채널별 차이 중 가장 큰 값을 쓴다
    r, g, b = ImageChops.difference(img, Image.new("RGB", img.size, bg)).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), b)


def alpha_hull(img: Image.Image, bg) -> Image.Image:
    ink = color_distance(img, bg).point(lambda v: 255 if v > 40 else 0)
    px = ink.load()
    w, h = ink.size
    pts = sorted({(x, y) for y in range(0, h, 2) for x in range(0, w, 2) if px[x, y]})

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for pt in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], pt) <= 0:
            lower.pop()
        lower.append(pt)
    for pt in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], pt) <= 0:
            upper.pop()
        upper.append(pt)
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon(lower[:-1] + upper[:-1], fill=255)
    return mask.filter(ImageFilter.MaxFilter(5))


def alpha_light_bg(img: Image.Image, bg, gap: int) -> Image.Image:
    # 배경색과 확실히 다른 픽셀(선·몸)을 gap만큼 넓혀 외곽선 틈을 막고, 바깥을 채운 뒤 되돌린다.
    ink = color_distance(img, bg).point(lambda v: 255 if v > 18 else 0).filter(ImageFilter.MaxFilter(gap))
    outside = flood_from_border(ink.point(lambda v: 0 if v else 255)).point(lambda v: 255 if v == 128 else 0)
    return ImageChops.invert(outside.filter(ImageFilter.MaxFilter(gap)))


def alpha_dark_bg(img: Image.Image) -> Image.Image:
    # 검은 배경과 검은 외곽선이 붙어 있으므로: 밝은 몸통을 구멍까지 채운 뒤 외곽선 두께만큼 넓힌다.
    bright = img.convert("L").point(lambda v: 255 if v > 70 else 0)
    not_bright = bright.point(lambda v: 0 if v else 255)
    outside = flood_from_border(not_bright).point(lambda v: 255 if v == 128 else 0)
    return ImageChops.invert(outside).filter(ImageFilter.MaxFilter(7))


def cut_out(path: Path) -> Image.Image:
    src = Image.open(path)
    rgba = src.convert("RGBA")
    if rgba.getpixel((1, 1))[3] < 20:  # 이미 투명 배경
        return rgba
    img = src.convert("RGB")
    bg = border_color(img)
    if sum(bg) / 3 < 60:
        alpha = alpha_dark_bg(img)
    elif any(k in path.stem for k in HULL_CUT):
        alpha = alpha_hull(img, bg)
    else:
        gap = next((g for k, g in GAP_OVERRIDES.items() if k in path.stem), DEFAULT_GAP)
        alpha = alpha_light_bg(img, bg, gap)
    out = img.convert("RGBA")
    out.putalpha(alpha)
    return out


def situation_of(stem: str):
    return next((key for word, key in SITUATIONS if word in stem), None)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    manifest = {}
    for folder in sorted(p for p in DESIGNS.iterdir() if p.is_dir()):
        cid = CHARACTER_IDS.get(folder.name)
        if not cid:
            print(f"! 모르는 캐릭터 폴더: {folder.name}")
            continue
        (OUT / cid).mkdir(parents=True, exist_ok=True)
        sets = manifest.setdefault(cid, {})
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                continue
            key = situation_of(f.stem)
            if not key:
                print(f"! 상황을 모르는 그림 (이름에 상황 낱말을 넣어 주세요): {f.name}")
                continue
            rgba = cut_out(f)
            bbox = rgba.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
            rgba = rgba.crop(bbox)
            scale = TARGET_H / rgba.height
            rgba = rgba.resize((max(1, round(rgba.width * scale)), TARGET_H), Image.LANCZOS)
            n = len(sets.get(key, []))
            name = f"{key}.png" if n == 0 else f"{key}-{n + 1}.png"
            rgba.save(OUT / cid / name)
            sets.setdefault(key, []).append(f"../../assets/sprites/{cid}/{name}")
            print(f"{cid}/{name:12} ← {f.name}  {rgba.size}")
        if "default" not in sets:
            print(f"! {folder.name}: '기본' 그림이 없어요")

    MANIFEST.write_text(
        "// tools/make_sprites.py가 만든 파일입니다. 직접 고치지 마세요.\n"
        "// 캐릭터별 상황 → 스프라이트 경로 목록\n"
        f"const SPRITE_SETS = {json.dumps(manifest, ensure_ascii=False, indent=2)};\n",
        encoding="utf-8",
    )
    print("manifest:", MANIFEST.relative_to(ROOT))


if __name__ == "__main__":
    main()
