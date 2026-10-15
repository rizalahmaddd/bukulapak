import os
from PIL import Image, ImageDraw, ImageFont

# Colors
BG_COLOR = (245, 245, 247)  # #f5f5f7
TEXT_COLOR = (29, 29, 31)   # #1d1d1f
SUBTEXT_COLOR = (99, 99, 102) # #636366
BRAND_GREEN = (11, 122, 62)  # #0b7a3e

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES_DIR = os.path.join(ROOT, "android", "app", "src", "main", "res")

ICON_512 = Image.open(os.path.join(ROOT, "public", "icons", "icon-512.png")).convert("RGBA")
MASKABLE_512 = Image.open(os.path.join(ROOT, "public", "icons", "icon-maskable-512.png")).convert("RGBA")

# Font helpers
FONT_PATH = "/System/Library/Fonts/Helvetica.ttc"
BOLD_FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
if not os.path.exists(BOLD_FONT_PATH):
    BOLD_FONT_PATH = FONT_PATH

def make_round_icon(im):
    size = im.size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size[0], size[1]), fill=255)
    output = Image.new("RGBA", size, (0, 0, 0, 0))
    output.paste(im, (0, 0))
    output.putalpha(mask)
    return output

# 1. Generate Mipmap Icons
MIPMAPS = {
    "mipmap-mdpi": (48, 108),
    "mipmap-hdpi": (72, 162),
    "mipmap-xhdpi": (96, 216),
    "mipmap-xxhdpi": (144, 324),
    "mipmap-xxxhdpi": (192, 432)
}

print("Generating launcher icons...")
for folder, (icon_sz, fg_sz) in MIPMAPS.items():
    dir_path = os.path.join(RES_DIR, folder)
    os.makedirs(dir_path, exist_ok=True)
    
    # Standard icon (squircle)
    ic_launcher = ICON_512.resize((icon_sz, icon_sz), Image.Resampling.LANCZOS)
    ic_launcher.save(os.path.join(dir_path, "ic_launcher.png"), "PNG")
    
    # Round icon
    round_source = MASKABLE_512.resize((icon_sz, icon_sz), Image.Resampling.LANCZOS)
    ic_launcher_round = make_round_icon(round_source)
    ic_launcher_round.save(os.path.join(dir_path, "ic_launcher_round.png"), "PNG")
    
    # Adaptive foreground (icon scaled within safe zone of 108dp canvas)
    # Safe zone is ~66% of the canvas
    fg_canvas = Image.new("RGBA", (fg_sz, fg_sz), (0, 0, 0, 0))
    logo_sz = int(fg_sz * 0.65)
    logo_scaled = ICON_512.resize((logo_sz, logo_sz), Image.Resampling.LANCZOS)
    offset = ((fg_sz - logo_sz) // 2, (fg_sz - logo_sz) // 2)
    fg_canvas.paste(logo_scaled, offset, logo_scaled)
    fg_canvas.save(os.path.join(dir_path, "ic_launcher_foreground.png"), "PNG")
    print(f"  Saved {folder} (icon: {icon_sz}x{icon_sz}, fg: {fg_sz}x{fg_sz})")

# 2. Generate Splash Screens
SPLASHES = {
    "drawable": (480, 320),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280)
}

print("Generating splash screens...")
for folder, (w, h) in SPLASHES.items():
    dir_path = os.path.join(RES_DIR, folder)
    os.makedirs(dir_path, exist_ok=True)
    
    splash = Image.new("RGBA", (w, h), BG_COLOR + (255,))
    draw = ImageDraw.Draw(splash)
    
    # Determine logo & text sizes based on min dimension
    min_dim = min(w, h)
    is_portrait = h >= w
    
    logo_target = int(min_dim * (0.28 if is_portrait else 0.32))
    logo_target = max(64, min(logo_target, 280))
    
    logo = ICON_512.resize((logo_target, logo_target), Image.Resampling.LANCZOS)
    
    title_size = max(14, int(logo_target * 0.22))
    sub_size = max(10, int(title_size * 0.55))
    
    try:
        font_title = ImageFont.truetype(BOLD_FONT_PATH, title_size)
        font_sub = ImageFont.truetype(FONT_PATH, sub_size)
    except Exception:
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        
    title_text = "BukuLapak"
    sub_text = "Pembukuan Praktis UMKM"
    
    # Calculate text bounding boxes
    t_bbox = draw.textbbox((0, 0), title_text, font=font_title)
    s_bbox = draw.textbbox((0, 0), sub_text, font=font_sub)
    t_w = t_bbox[2] - t_bbox[0]
    t_h = t_bbox[3] - t_bbox[1]
    s_w = s_bbox[2] - s_bbox[0]
    s_h = s_bbox[3] - s_bbox[1]
    
    spacing = int(title_size * 0.4)
    total_content_h = logo_target + spacing + t_h + (spacing // 2) + s_h
    
    start_y = (h - total_content_h) // 2
    logo_x = (w - logo_target) // 2
    logo_y = start_y
    
    splash.paste(logo, (logo_x, logo_y), logo)
    
    t_x = (w - t_w) // 2
    t_y = logo_y + logo_target + spacing
    draw.text((t_x, t_y), title_text, fill=TEXT_COLOR, font=font_title)
    
    s_x = (w - s_w) // 2
    s_y = t_y + t_h + (spacing // 2)
    draw.text((s_x, s_y), sub_text, fill=SUBTEXT_COLOR, font=font_sub)
    
    splash.save(os.path.join(dir_path, "splash.png"), "PNG")
    print(f"  Saved {folder}/splash.png ({w}x{h})")

print("All Android assets successfully generated!")
