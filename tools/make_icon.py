"""스프라이트로 앱 아이콘(build/icon.ico, build/icon.png)을 만든다.

사용법: python tools/make_icon.py  (make_sprites.py 실행 후)
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "sprites" / "chiikawa" / "default.png"
OUT = ROOT / "build"


def main():
    OUT.mkdir(exist_ok=True)
    sprite = Image.open(SRC).convert("RGBA")
    size = 256
    pad = 12
    scale = (size - pad * 2) / max(sprite.size)
    sprite = sprite.resize((round(sprite.width * scale), round(sprite.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(sprite, ((size - sprite.width) // 2, (size - sprite.height) // 2))
    canvas.save(OUT / "icon.png")
    canvas.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("icon saved")


if __name__ == "__main__":
    main()
