"""Build the full-resolution map served by the editor.

Install Pillow (``python -m pip install Pillow``), then run this file from any
directory. The original PNG is retained as the source; no resizing is applied.
"""

from pathlib import Path

from PIL import Image


def main():
    assets = Path(__file__).resolve().parents[1] / "assets"
    source = assets / "sr.png"
    destination = assets / "sr.webp"
    with Image.open(source) as image:
        image.save(destination, "WEBP", quality=95, method=6)
        dimensions = image.size

    source_bytes = source.stat().st_size
    output_bytes = destination.stat().st_size
    print(f"{destination.name}: {dimensions[0]} x {dimensions[1]}, {output_bytes:,} bytes")
    print(f"{100 * (1 - output_bytes / source_bytes):.1f}% smaller than the original PNG")


if __name__ == "__main__":
    main()
