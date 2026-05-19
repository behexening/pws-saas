"""
Generate print-ready PDF flyers for the beta-access QR code campaign at
PWS port towns (Whittier, Valdez, Cordova). Output goes to docs/flyers/.

Each flyer is identical except for the QR code, which encodes
https://akfishinfo.com/request-beta?src=<port>. The page logs the scan
and pre-fills the source field, so we can see per-port conversion in
the admin panel.

Run:
    python3 scripts/build_beta_flyers.py
"""

from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from fontTools.ttLib import TTFont as FTFont
from otf2ttf.cli import otf_to_ttf
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR   = REPO_ROOT / "docs" / "flyers"
FONT_PATH = REPO_ROOT / "public" / "static" / "projekt-blackbird-v2.otf"

# Brand palette — mirrors public/static/theme.css
ACCENT = HexColor("#00b4d8")
INK    = HexColor("#0f1a26")
MUTED  = HexColor("#5a6f87")
BG_TOP = HexColor("#060a0f")
LINE   = HexColor("#cfd8e3")

BASE_URL = "https://akfishinfo.com"
PORTS = [
    ("whittier", "WHITTIER"),
    ("valdez",   "VALDEZ"),
    ("cordova",  "CORDOVA"),
]

# Blackbird ships as a CFF/PostScript-flavored OTF, which reportlab's
# TTFont can't embed directly. Convert it to TTF outlines in a temp file
# (via otf2ttf) and register that. Falls back to Helvetica-Bold if any
# step fails.
BRAND_FONT = "Helvetica-Bold"
try:
    if FONT_PATH.exists():
        ttf = FTFont(str(FONT_PATH))
        otf_to_ttf(ttf)
        ttf_path = Path(tempfile.gettempdir()) / "blackbird-converted.ttf"
        ttf.save(str(ttf_path))
        pdfmetrics.registerFont(TTFont("Blackbird", str(ttf_path)))
        BRAND_FONT = "Blackbird"
except Exception as exc:
    print(f"[warn] Could not register Blackbird font, falling back: {exc}")


def build_qr_image(url: str):
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=20,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0f1a26", back_color="white").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)


def draw_centered(c, text, font, size, y):
    c.setFont(font, size)
    w, _ = LETTER
    c.drawCentredString(w / 2, y, text)


def draw_wordmark(c, x_center, y, size, dark=False):
    """ak FISH info. — same composition as the site nav wordmark."""
    if dark:
        ink, accent = white, ACCENT
    else:
        ink, accent = INK, ACCENT
    c.setFont(BRAND_FONT, size)
    label = "akFISH"
    suffix = "info."
    label_w  = c.stringWidth(label,  BRAND_FONT, size)
    suffix_w = c.stringWidth(suffix, BRAND_FONT, size)
    total = label_w + suffix_w
    x = x_center - total / 2
    c.setFillColor(ink)
    c.drawString(x, y, label)
    c.setFillColor(accent)
    c.drawString(x + label_w, y, suffix)


def render_flyer(out_path: Path, port_slug: str, port_label: str):
    page_w, page_h = LETTER
    c = canvas.Canvas(str(out_path), pagesize=LETTER)
    c.setTitle(f"akFISHinfo — {port_label} beta access")

    # Top dark band: brand + season eyebrow
    band_h = 1.6 * inch
    c.setFillColor(BG_TOP)
    c.rect(0, page_h - band_h, page_w, band_h, fill=1, stroke=0)
    draw_wordmark(c, page_w / 2, page_h - band_h * 0.65, 36, dark=True)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(ACCENT)
    c.drawCentredString(page_w / 2, page_h - band_h * 0.92,
                        "2026 PWS SEASON  ·  FREE BETA ACCESS")

    # Hero headline
    c.setFillColor(INK)
    c.setFont(BRAND_FONT, 56)
    c.drawCentredString(page_w / 2, page_h - band_h - 0.95 * inch,
                        "Real-time PWS")
    c.setFillColor(ACCENT)
    c.drawCentredString(page_w / 2, page_h - band_h - 1.65 * inch,
                        "opening alerts.")

    # Subhead
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 13)
    c.drawCentredString(page_w / 2, page_h - band_h - 2.15 * inch,
                        "Know before you go. The instant ADF&G drops")
    c.drawCentredString(page_w / 2, page_h - band_h - 2.40 * inch,
                        "a Prince William Sound opening, your phone buzzes.")

    # QR code — centered, large
    qr_url = f"{BASE_URL}/request-beta?src={port_slug}"
    qr_img = build_qr_image(qr_url)
    qr_size = 3.3 * inch
    qr_x = (page_w - qr_size) / 2
    qr_y = 2.55 * inch
    # Thin border around the QR so it reads cleanly even on textured paper
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.rect(qr_x - 0.10 * inch, qr_y - 0.10 * inch,
           qr_size + 0.20 * inch, qr_size + 0.20 * inch, fill=0, stroke=1)
    c.drawImage(qr_img, qr_x, qr_y, qr_size, qr_size,
                preserveAspectRatio=True, mask='auto')

    # Scan callout under QR
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(page_w / 2, qr_y - 0.45 * inch,
                        "SCAN TO CLAIM YOUR FREE BETA SPOT")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 11)
    c.drawCentredString(page_w / 2, qr_y - 0.70 * inch,
                        "Or visit akfishinfo.com/request-beta")

    # Bottom row: bullets + port tag
    bullets = [
        "ADF&G announcements parsed the moment they're emailed",
        "Live district map shows open waters at a glance",
        "Telegram alerts straight to your phone — free during beta",
    ]
    c.setFillColor(INK)
    c.setFont("Helvetica", 11)
    y = 1.40 * inch
    for line in bullets:
        c.drawCentredString(page_w / 2, y, f"·  {line}  ·")
        y -= 0.22 * inch

    # Footer — kept identical across ports so the scanner can't tell which
    # poster they're looking at. Source attribution lives in the QR URL only.
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 8)
    c.drawCentredString(page_w / 2, 0.40 * inch, "akfishinfo.com")

    c.showPage()
    c.save()


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for slug, label in PORTS:
        out = OUT_DIR / f"beta-flyer-{slug}.pdf"
        render_flyer(out, slug, label)
        print(f"✓ {out.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
