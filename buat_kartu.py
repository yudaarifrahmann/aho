# buat_kartu.py
import sys
import json
from PIL import Image, ImageDraw, ImageFont
import qrcode
from io import BytesIO
import base64
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
template_path = os.path.join(BASE_DIR, "NEW CARD.jpg")
font_path = os.path.join(BASE_DIR, "fonts", "LibreBaskerville-Regular.ttf")

def format_nisn(nisn):
    nisn = nisn.zfill(10)
    return f"{nisn[:3]}-{nisn[3:6]}-{nisn[6:]}"

def draw_text_with_spacing(draw, position, text, font, fill, spacing):
    x, y = position
    for char in text:
        draw.text((x, y), char, font=font, fill=fill)
        char_width = font.getlength(char)
        x += char_width + spacing

def create_card(name, class_name, raw_nisn):
    nisn = format_nisn(str(raw_nisn))
    qr_data = json.dumps({
        "name": name,
        "class": class_name,
        "nisn": raw_nisn
    })

    template = Image.open(template_path).convert("RGBA")

    qr = qrcode.make(qr_data)
    qr = qr.resize((860, 850))
    template.paste(qr, (220, 560))

    font_nisn = ImageFont.truetype(font_path, 100)
    font_name = ImageFont.truetype(font_path, 100)
    font_class = ImageFont.truetype(font_path, 65)

    draw = ImageDraw.Draw(template)
    x_label = 500
    x_value = 1200
    y_nisn = 1500
    y_name = 1670
    y_class = 1810
    spacing = 20

    draw_text_with_spacing(draw, (x_label, y_nisn), "NISN :", font_nisn, "white", spacing)
    draw_text_with_spacing(draw, (x_value, y_nisn), nisn, font_nisn, "white", spacing)
    draw_text_with_spacing(draw, (x_label, y_name), name.upper(), font_name, "white", spacing)
    draw_text_with_spacing(draw, (x_label, y_class), class_name.upper(), font_class, "white", spacing)

    buf = BytesIO()
    template.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("utf-8")
    return encoded

if __name__ == "__main__":
    data = json.loads(sys.argv[1])
    image_base64 = create_card(data["name"], data["class"], data["nisn"])
    print(image_base64)
