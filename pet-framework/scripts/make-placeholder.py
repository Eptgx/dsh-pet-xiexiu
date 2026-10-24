"""生成一个不含第三方版权的占位角色素材（透明 VP9 webm + 配置）。

产物写到 pet-framework/assets/placeholder/：
  anim/a001.webm  640×360、透明背景、4 秒循环（呼吸 + 眨眼 + 说话口型）
  config.json / config.js / bounds.js

用法：
  python scripts/make-placeholder.py
需要：Pillow、imageio-ffmpeg（或系统 ffmpeg）。
"""
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # pragma: no cover
    FFMPEG = "ffmpeg"

OUT = Path(__file__).resolve().parent.parent / "assets" / "pet"
W, H = 640, 360
FPS = 24
SECONDS = 4
FRAMES = FPS * SECONDS

BODY = (127, 179, 232)
BODY_DARK = (86, 135, 189)
EYE = (40, 52, 70)
MOUTH = (60, 40, 45)

NAME = "占位角色"
ASSET = "a001"


def draw_frame(t: float) -> Image.Image:
    """画一帧：呼吸上下浮动 + 眨眼 + 张嘴（0.5Hz 开合）。"""
    import math

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    bob = math.sin(t * 2 * math.pi / SECONDS * 2) * 6          # 上下浮动
    cx, cy = 320, 210 + bob

    # 身体（圆角矩形 + 圆头，简单几何，无版权问题）
    d.rounded_rectangle([cx - 70, cy + 10, cx + 70, cy + 120], radius=34, fill=BODY, outline=BODY_DARK, width=4)
    d.ellipse([cx - 88, cy - 90, cx + 88, cy + 70], fill=BODY, outline=BODY_DARK, width=4)

    # 眼睛：每 2 秒眨一次
    blink_phase = (t % 2.0)
    eye_h = 4 if blink_phase < 0.12 else 16
    for ex in (-34, 34):
        d.ellipse([cx + ex - 9, cy - 22 - eye_h // 2, cx + ex + 9, cy - 22 + eye_h // 2], fill=EYE)

    # 嘴：说话开合
    mouth_open = 4 + abs(math.sin(t * 2 * math.pi / 1.2)) * 12
    d.ellipse([cx - 14, cy + 12, cx + 14, cy + 12 + mouth_open], fill=MOUTH)

    # 腮红
    for ex in (-58, 58):
        d.ellipse([cx + ex - 12, cy + 2, cx + ex + 12, cy + 16], fill=(240, 160, 175, 150))

    return img


def main() -> None:
    (OUT / "anim").mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for i in range(FRAMES):
            draw_frame(i / FPS).save(tmp_path / f"f{i:04d}.png")

        subprocess.run(
            [
                FFMPEG, "-y", "-v", "error",
                "-framerate", str(FPS),
                "-i", str(tmp_path / "f%04d.png"),
                "-c:v", "libvpx-vp9",
                "-pix_fmt", "yuva420p",
                "-b:v", "0", "-crf", "34",
                "-auto-alt-ref", "0",
                str(OUT / "anim" / f"{ASSET}.webm"),
            ],
            check=True,
        )

    config = {
        "version": 1,
        "source": "placeholder",
        "size": 320,
        "files": {NAME: ASSET},
        "talkAnims": [NAME],
        "animations": {
            "idle": [NAME],
            "turn": [NAME],
            "drag": [NAME],
            "clicks": [NAME],
            "moves": {"default": {}, "actions": []},
            "categories": [],
        },
        "animationWeights": {"idle": 10, "turn": 5, "move": 5},
        "physics": {},
    }
    (OUT / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "config.js").write_text(
        "/* 自动生成：scripts/make-placeholder.py */\nwindow.PET_CONFIG = "
        + json.dumps(config, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    # 内容包围盒：身体 + 头（约 x 232..408 / y 120..300），手写即可
    bounds = {NAME: [232, 112, 408, 300]}
    (OUT / "bounds.js").write_text(
        "/* 自动生成：scripts/make-placeholder.py */\nwindow.PET_BOUNDS = "
        + json.dumps(bounds, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"占位素材已生成：{OUT}")


if __name__ == "__main__":
    main()

