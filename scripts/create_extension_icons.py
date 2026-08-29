from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path("/home/ubuntu/webdev-static-assets/content-firewall-extension-icons")
OUT.mkdir(parents=True, exist_ok=True)
BASE = 1024

canvas = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)

# Strong silhouette for recognition in Chrome's smallest 16px toolbar slot.
outer = [(512, 74), (853, 204), (794, 684), (512, 915), (230, 684), (171, 204)]
inner = [(512, 126), (802, 237), (750, 653), (512, 853), (274, 653), (222, 237)]
draw.polygon(outer, fill=(77, 29, 149, 255))
draw.line(outer + [outer[0]], fill=(139, 92, 246, 255), width=28, joint="curve")
draw.polygon(inner, fill=(35, 20, 76, 255))

# Teal signal arcs form a subtle firewall/lens cue without relying on text.
draw.arc((258, 258, 766, 766), start=205, end=330, fill=(45, 212, 191, 255), width=34)
draw.arc((290, 290, 734, 734), start=28, end=155, fill=(20, 184, 166, 210), width=24)

# Center eye/lens communicates user-controlled review rather than surveillance.
draw.ellipse((314, 382, 710, 642), fill=(15, 23, 42, 255), outline=(94, 234, 212, 255), width=30)
draw.ellipse((398, 422, 626, 602), fill=(94, 234, 212, 255))
draw.ellipse((456, 450, 568, 570), fill=(30, 27, 75, 255))
draw.ellipse((486, 470, 522, 506), fill=(255, 255, 255, 240))

for size in (16, 32, 48, 128):
    icon = canvas.resize((size, size), Image.Resampling.LANCZOS)
    icon.save(OUT / f"icon{size}.png", format="PNG", optimize=True)

print(f"Created Chrome extension icons in {OUT}")
