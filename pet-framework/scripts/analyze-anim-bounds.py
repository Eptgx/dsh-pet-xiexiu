"""分析每段动画的透明内容包围盒，写入 <pet>/bounds.js。

默认裁切框是 400×320（x120..520 / y20..340）。文字气泡、风筝、烟花等内容会超出这个范围，
播放时就需要把整段缩到"完整可见"，否则会被裁掉。这里用 ffmpeg 抽取每一帧的 alpha，
取所有帧的并集包围盒。

用法：
  python scripts/analyze-anim-bounds.py <pet 目录> [--ffmpeg ffmpeg路径] [--limit N]

<pet 目录> 里应有 config.json 与 anim/*.webm（由 build-pet-assets.mjs 生成）。
ffmpeg 查找顺序：--ffmpeg → imageio-ffmpeg 自带的二进制 → PATH 里的 ffmpeg。
"""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

W, H = 96, 54
ALPHA_THRESHOLD = 32
CROP = (120, 20, 520, 340)


def find_ffmpeg(explicit):
    if explicit:
        return explicit
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    found = shutil.which("ffmpeg")
    if found:
        return found
    raise SystemExit("找不到 ffmpeg：请用 --ffmpeg 指定，或 pip install imageio-ffmpeg")


def bbox_of(ffmpeg, video):
    cmd = [
        ffmpeg, "-v", "error",
        # VP9 的 alpha 是独立平面，只有 libvpx 解码器会把它解出来
        "-c:v", "libvpx-vp9",
        "-i", str(video),
        "-vf", f"alphaextract,scale={W}:{H}:flags=area,format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]
    raw = subprocess.run(cmd, stdout=subprocess.PIPE, check=True).stdout
    size = W * H
    frames = len(raw) // size
    if frames == 0:
        return None
    arr = np.frombuffer(raw[: frames * size], dtype=np.uint8).reshape(frames, H, W)
    mask = (arr > ALPHA_THRESHOLD).any(axis=0)
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    x0 = xs.min() * 640 / W
    x1 = (xs.max() + 1) * 640 / W
    y0 = ys.min() * 360 / H
    y1 = (ys.max() + 1) * 360 / H
    return [int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pet", help="素材目录（含 config.json 与 anim/）")
    parser.add_argument("--ffmpeg", default=None)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    pet = Path(args.pet).resolve()
    ffmpeg = find_ffmpeg(args.ffmpeg)

    config = json.loads((pet / "config.json").read_text("utf-8"))
    files = config["files"]
    bounds = {}
    items = list(files.items())
    if args.limit:
        items = items[: args.limit]

    for index, (name, asset) in enumerate(items, 1):
        video = pet / "anim" / f"{asset}.webm"
        if not video.exists():
            continue
        box = bbox_of(ffmpeg, video)
        if box:
            bounds[name] = box
        if index % 10 == 0:
            print(f"  {index}/{len(items)}")

    payload = json.dumps(bounds, ensure_ascii=False, separators=(",", ":"))
    (pet / "bounds.js").write_text(
        "/* 自动生成：scripts/analyze-anim-bounds.py */\nwindow.PET_BOUNDS = " + payload + ";\n",
        encoding="utf-8",
    )

    outside = {
        name: box for name, box in bounds.items()
        if box[0] < CROP[0] or box[1] < CROP[1] or box[2] > CROP[2] or box[3] > CROP[3]
    }
    print(f"共分析 {len(bounds)} 段；超出默认裁切范围的有 {len(outside)} 段")
    for name, box in sorted(outside.items(), key=lambda kv: kv[1][0]):
        print(f"  {name}: {box}")


if __name__ == "__main__":
    main()
