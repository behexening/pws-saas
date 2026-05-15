"""Rebuild public/awc-points.json from the PWS Anadromous Stream List PDF.

The PDF (docs/closedwaters/pws_anadromous_stream_list.pdf) is the ADF&G
source of truth for streams that trigger the 500-yd closure buffer.
"""
import json
import re
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "docs" / "closedwaters" / "pws_anadromous_stream_list.pdf"
OUT = ROOT / "public" / "awc-points.json"

AWC_RE = re.compile(r"^\d{3}-\d{2}-\d{4,5}$")


def parse_pdf():
    rows = []
    seen = set()
    with pdfplumber.open(PDF) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for row in table:
                    if not row or len(row) < 5:
                        continue
                    awc = (row[1] or "").strip()
                    if not AWC_RE.match(awc):
                        continue
                    name = " ".join((row[2] or "").split()).strip()
                    try:
                        lat = float((row[3] or "").strip())
                        lon = float((row[4] or "").strip())
                    except ValueError:
                        continue
                    key = (awc, round(lat, 6), round(lon, 6))
                    if key in seen:
                        continue
                    seen.add(key)
                    rows.append(
                        {
                            "lat": lat,
                            "lon": lon,
                            "name": name if name else "Stream",
                            "awc": awc,
                        }
                    )
    return rows


def main():
    rows = parse_pdf()
    OUT.write_text(json.dumps(rows))
    print(f"Wrote {len(rows)} points → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
