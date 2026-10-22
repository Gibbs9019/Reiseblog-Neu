"""
Erzeugt AVIF-Varianten aller Bilder, die in den HTML-Dateien referenziert werden,
und stellt die HTML-Dateien von /cdn-cgi/image/... auf feste R2-Dateien um.

Namensschema auf R2 (neben dem Original):
    https://img.reiseblog-hollmann.de/singapur/hero.jpg          (Original, bleibt)
    https://img.reiseblog-hollmann.de/singapur/hero-400.avif     (Variante 400px breit)

Befehle (aus dem Projektordner):
    py tools/bilder_avif.py convert              alle benötigten Varianten erzeugen (nur fehlende/veraltete)
    py tools/bilder_avif.py convert sydney.html  nur Bilder aus bestimmten Seiten
    py tools/bilder_avif.py convert --force      alles neu erzeugen
    py tools/bilder_avif.py rewrite --dry-run    zeigen, was in den HTML-Dateien ersetzt würde
    py tools/bilder_avif.py rewrite              HTML-Dateien umschreiben (vorher Backup)

Die benötigten Breiten werden aus beiden Schreibweisen gelesen
(/cdn-cgi/image/width=400,... und ...-400.avif), d.h. für neue Blogposts
einfach die AVIF-URLs ins HTML schreiben und danach "convert" laufen lassen.
"""

import argparse
import os
import re
import shutil
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageOps

PROJECT = Path(__file__).resolve().parent.parent
IMG_DIR = PROJECT / "img"  # lokale Originale, gleiche Struktur wie auf R2
HOST = "https://img.reiseblog-hollmann.de"

# Muss zu LIGHTBOX_WIDTHS in js/script.js passen
LIGHTBOX_WIDTHS = [640, 1024, 1600, 2000]

AVIF_QUALITY = 60  # entspricht optisch etwa JPEG-Qualität 80
AVIF_SPEED = 6  # 0 = langsam/klein ... 10 = schnell/größer

SOURCE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".JPG", ".JPEG", ".PNG"]

H = re.escape(HOST)
CDN_RX = re.compile(r"/cdn-cgi/image/([^/\"'\s]+)/" + H + r"/([^\"'\s,)]+)")
AVIF_RX = re.compile(H + r"/([^\"'\s,)]+)-(\d+)\.avif")
DATA_FULL_RX = re.compile(r"data-full=\"" + H + r"/([^\"]+)\"")
WIDTH_RX = re.compile(r"(?:^|,)width=(\d+)")

Image.MAX_IMAGE_PIXELS = None  # große Kamera-Originale nicht als "Decompression Bomb" ablehnen


def strip_ext(path):
    return os.path.splitext(path)[0]


def html_files(selected):
    if selected:
        return [PROJECT / f for f in selected]
    return sorted(PROJECT.glob("*.html"))


def find_source(key):
    for ext in SOURCE_EXTS:
        p = IMG_DIR / (key + ext)
        if p.exists():
            return p
    return None


def collect(files):
    """Liefert {key: {"widths": set, "source": Path|None}} aus allen HTML-Dateien."""
    needed = defaultdict(lambda: {"widths": set(), "source": None})

    for f in files:
        text = f.read_text(encoding="utf-8")

        for m in CDN_RX.finditer(text):
            w = WIDTH_RX.search(m.group(1))
            if not w:
                continue
            path = m.group(2)
            entry = needed[strip_ext(path)]
            entry["widths"].add(int(w.group(1)))
            if entry["source"] is None and (IMG_DIR / path).exists():
                entry["source"] = IMG_DIR / path

        for m in AVIF_RX.finditer(text):
            needed[m.group(1)]["widths"].add(int(m.group(2)))

        for m in DATA_FULL_RX.finditer(text):
            path = m.group(1)
            entry = needed[strip_ext(path)]
            entry["widths"].update(LIGHTBOX_WIDTHS)
            if entry["source"] is None and (IMG_DIR / path).exists():
                entry["source"] = IMG_DIR / path

    for key, entry in needed.items():
        if entry["source"] is None:
            entry["source"] = find_source(key)

    return needed


def convert_one(src, key, widths, out_dir, force):
    """Erzeugt alle Breiten für ein Bild. Läuft in einem eigenen Prozess."""
    src = Path(src)
    src_mtime = src.stat().st_mtime
    todo = []
    for w in sorted(widths, reverse=True):
        target = Path(out_dir) / f"{key}-{w}.avif"
        if force or not target.exists() or target.stat().st_mtime < src_mtime:
            todo.append((w, target))
    if not todo:
        return key, 0, 0

    upscale_capped = 0
    with Image.open(src) as im:
        icc = im.info.get("icc_profile")
        im = ImageOps.exif_transpose(im)  # Hochkant-Fotos richtig drehen
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGB")

        for w, target in todo:
            # Nicht hochskalieren (wie Cloudflare): Datei heißt trotzdem -<w>.avif
            if w >= im.width:
                variant = im
                upscale_capped += 1
            else:
                h = max(1, round(im.height * w / im.width))
                variant = im.resize((w, h), Image.LANCZOS)

            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(".avif.tmp")
            variant.save(
                tmp,
                format="AVIF",
                quality=AVIF_QUALITY,
                speed=AVIF_SPEED,
                icc_profile=icc,
            )
            os.replace(tmp, target)

    return key, len(todo), upscale_capped


def cmd_convert(args):
    out_dir = (PROJECT / args.out).resolve()
    needed = collect(html_files(args.files))

    missing = sorted(k for k, e in needed.items() if e["source"] is None)
    jobs = {k: e for k, e in needed.items() if e["source"] is not None}
    total_variants = sum(len(e["widths"]) for e in jobs.values())
    print(f"{len(jobs)} Bilder, {total_variants} Varianten -> {out_dir}")

    started = time.time()
    created = capped = done = 0
    workers = args.jobs or max(1, (os.cpu_count() or 2) - 1)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(convert_one, str(e["source"]), k, e["widths"], str(out_dir), args.force): k
            for k, e in jobs.items()
        }
        for fut in as_completed(futures):
            done += 1
            try:
                _, n, c = fut.result()
                created += n
                capped += c
            except Exception as exc:
                print(f"\n  FEHLER bei {futures[fut]}: {exc}")
            print(f"\r  {done}/{len(jobs)} Bilder, {created} Varianten erzeugt", end="", flush=True)

    print(f"\nFertig in {time.time() - started:.0f}s.")
    if capped:
        print(f"{capped} Varianten waren breiter als das Original und wurden in Originalgröße gespeichert.")
    if missing:
        print(f"\nKein lokales Original unter img/ gefunden für {len(missing)} Bild(er):")
        for k in missing:
            print(f"  {k}")


def cmd_rewrite(args):
    files = html_files(args.files)

    def repl(m):
        w = WIDTH_RX.search(m.group(1))
        if not w:
            return m.group(0)
        return f"{HOST}/{strip_ext(m.group(2))}-{w.group(1)}.avif"

    changes = {}
    for f in files:
        with open(f, encoding="utf-8", newline="") as fh:
            text = fh.read()
        new, n = CDN_RX.subn(repl, text)
        if n:
            changes[f] = (new, n)

    for f, (_, n) in changes.items():
        print(f"  {f.name}: {n} URLs")
    print(f"{sum(n for _, n in changes.values())} URLs in {len(changes)} Dateien.")

    if args.dry_run or not changes:
        return

    backup = PROJECT / "backup-html" / time.strftime("%Y-%m-%d_%H-%M-%S")
    backup.mkdir(parents=True)
    for f, (new, _) in changes.items():
        shutil.copy2(f, backup / f.name)
        with open(f, "w", encoding="utf-8", newline="") as fh:
            fh.write(new)
    print(f"Umgeschrieben. Backup der alten Dateien: {backup}")


def main():
    p = argparse.ArgumentParser(description="AVIF-Varianten für R2 erzeugen und HTML umstellen")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("convert", help="AVIF-Varianten erzeugen")
    c.add_argument("files", nargs="*", help="nur diese HTML-Dateien auswerten (Standard: alle)")
    c.add_argument("--out", default="r2-upload", help="Zielordner (Standard: r2-upload)")
    c.add_argument("--force", action="store_true", help="vorhandene Varianten überschreiben")
    c.add_argument("--jobs", type=int, help="Anzahl paralleler Prozesse")
    c.set_defaults(func=cmd_convert)

    r = sub.add_parser("rewrite", help="/cdn-cgi/image-URLs in den HTML-Dateien ersetzen")
    r.add_argument("files", nargs="*", help="nur diese HTML-Dateien (Standard: alle)")
    r.add_argument("--dry-run", action="store_true", help="nur anzeigen, nichts schreiben")
    r.set_defaults(func=cmd_rewrite)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
