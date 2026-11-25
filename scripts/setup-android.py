import os
import shutil

manifest_path = os.path.join("android", "app", "src", "main", "AndroidManifest.xml")

if os.path.exists(manifest_path):
    with open(manifest_path, "r", encoding="utf-8") as f:
        xml = f.read()

    perms = [
        '<uses-permission android:name="android.permission.INTERNET" />',
        '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
        '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
        '<uses-permission android:name="android.permission.WAKE_LOCK" />',
    ]

    missing = [p for p in perms if p not in xml]
    if missing:
        inject_block = "\n    " + "\n    ".join(missing) + "\n</manifest>"
        xml = xml.replace("</manifest>", inject_block)

    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(xml)
    print("Permisos de audio inyectados correctamente en AndroidManifest.xml")

try:
    from PIL import Image, ImageDraw

    res_dir = os.path.join("android", "app", "src", "main", "res")
    anydpi = os.path.join(res_dir, "mipmap-anydpi-v26")
    if os.path.exists(anydpi):
        shutil.rmtree(anydpi)

    sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for folder, px in sizes.items():
        target_folder = os.path.join(res_dir, folder)
        os.makedirs(target_folder, exist_ok=True)
        img = Image.new("RGBA", (px, px), (0, 0, 0, 255))
        draw = ImageDraw.Draw(img)

        bars = [0.32, 0.58, 0.80, 0.52, 0.28]
        bar_w = max(2, int(px * 0.09))
        gap = max(2, int(px * 0.06))
        total_w = len(bars) * bar_w + (len(bars) - 1) * gap
        start_x = (px - total_w) // 2

        for idx, ratio in enumerate(bars):
            bh = max(4, int(px * ratio))
            x0 = start_x + idx * (bar_w + gap)
            y0 = (px - bh) // 2
            color = (16, 185, 129, 255) if idx < 3 else (6, 182, 212, 255)
            draw.rounded_rectangle(
                [x0, y0, x0 + bar_w, y0 + bh],
                radius=max(1, bar_w // 2),
                fill=color,
            )

        for icon_name in ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]:
            img.save(os.path.join(target_folder, icon_name))
    print("Iconos AMOLED de VOXLATAM generados correctamente")
except Exception as exc:
    print("Aviso opcional generando iconos:", exc)
