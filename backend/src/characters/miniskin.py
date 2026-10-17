# SPDX-License-Identifier: GPL-3.0-only
# Adapted from MiniSkin Generator by Christian (nirastich), GPL-3.0.
# https://github.com/nirastich/miniskin/blob/bce0b237b16104154e56cfa15521a25c9aff6132/index.html
# Only the miniature head layout is used; see third_party/miniskin/LICENSE.
"""Map a wardrobe skin's face, outfit, sleeves and shoes onto a player head."""

from io import BytesIO

from PIL import Image


def miniature_png(png: bytes) -> bytes:
    with Image.open(BytesIO(png)) as image:
        if image.format != "PNG" or image.size != (64, 64):
            raise ValueError("Expected a 64x64 PNG skin")
        skin = image.convert("RGBA")
    out = Image.new("RGBA", (64, 64))

    def copy(x: int, y: int, width: int, height: int, dx: int, dy: int) -> None:
        out.paste(skin.crop((x, y, x + width, y + height)), (dx, dy))

    # Head top, and the soles on the underside.
    copy(8, 0, 8, 8, 8, 0)
    for sx, dx, dy in ((4, 16, 0), (4, 20, 4), (20, 20, 0), (20, 16, 4)):
        copy(sx, 16 if sx == 4 else 48, 4, 4, dx, dy)

    # Six rows of face/hair leave room for the miniature's shirt and trousers.
    for x in (0, 8, 16, 24):
        copy(x, 9, 8, 2, x, 8)
        copy(x, 12, 8, 4, x, 10)
        copy(x + 32, 9, 8, 2, x + 32, 8)
        copy(x + 32, 12, 8, 4, x + 32, 10)
    copy(40, 0, 8, 8, 40, 0)

    # Front and back of the outfit, including its second layer.
    for sx, dx, y in ((20, 8, 21), (20, 40, 37)):
        copy(sx, y, 3, 1, dx, 13)
        copy(sx + 5, y, 3, 1, dx + 5, 13)
        copy(sx, y + 1, 8, 1, dx, 14)
    copy(32, 21, 8, 2, 24, 13)
    copy(32, 36, 8, 2, 56, 13)
    for sx, sy, dx in ((4, 20, 8), (20, 52, 12), (12, 20, 24), (28, 52, 28)):
        copy(sx, sy, 4, 1, dx, 15)
    for sx, sy, dx in ((4, 36, 40), (4, 52, 44), (12, 36, 56), (12, 52, 60)):
        copy(sx, sy, 4, 1, dx, 15)

    # Stretch the four-pixel body sides over the eight-pixel head sides.
    for sx, dx in ((16, 0), (28, 16)):
        for i in range(8):
            copy(sx + i // 2, 21, 1, 2, dx + i, 13)
            copy(sx + i // 2, 37, 1, 2, dx + 32 + i, 13)
    for sx, dx in ((0, 0), (12, 4), (0, 16), (12, 20)):
        copy(sx, 20, 4, 1, dx, 15)
    for sx, dx in ((0, 32), (8, 48)):
        for i in range(8):
            copy(sx + i // 2, 37, 1, 1, dx + i, 15)

    # Arms project slightly on the head's outer layer. Middle sleeve pixels
    # exist in both classic and slim skins.
    for sx, sy, dx in ((45, 20, 35), (37, 52, 51)):
        copy(sx, sy, 2, 1, dx, 13)
        copy(sx, sy + 11, 2, 1, dx, 14)
    # Composite sleeves over the arm colour rather than erasing it when clear.
    for sx, sy, dx in ((45, 36, 35), (53, 52, 51)):
        out.alpha_composite(skin.crop((sx, sy, sx + 2, sy + 1)), (dx, 13))
    for sx, sy, dx, dy in ((5, 31, 41, 15), (21, 63, 45, 15),
                           (9, 17, 49, 7), (25, 49, 53, 7)):
        copy(sx, sy, 2, 1, dx, dy)

    result = BytesIO()
    out.save(result, format="PNG")
    return result.getvalue()
