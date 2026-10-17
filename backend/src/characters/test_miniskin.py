"""The miniature keeps face, outfit and outer-layer details on a static head."""

from io import BytesIO

import pytest
from PIL import Image, PngImagePlugin

from src.characters.miniskin import miniature_png


def png(image, metadata=None):
    result = BytesIO()
    image.save(result, format="PNG", pnginfo=metadata)
    return result.getvalue()


def test_face_outfit_both_legs_and_sleeves_are_mapped_onto_the_head():
    # Unique pixels expose transposed faces and accidentally shared left/right limbs.
    skin = Image.new("RGBA", (64, 64))
    for y in range(64):
        for x in range(64):
            skin.putpixel((x, y), (x, y, 99, 255 if x < 32 else 0))
    # The arm fronts belong to the base layer despite their UV x coordinates.
    skin.paste((90, 91, 92, 255), (44, 20, 47, 32))
    skin.paste((93, 94, 95, 255), (36, 52, 39, 64))
    result = Image.open(BytesIO(miniature_png(png(skin))))
    assert result.size == (64, 64)
    for dest, source in (((8, 8), (8, 9)), ((11, 13), (11, 15)),
                         ((8, 14), (20, 22)), ((8, 15), (4, 20)),
                         ((12, 15), (20, 52)), ((24, 13), (32, 21)),
                         ((0, 13), (16, 21)), ((7, 13), (19, 21)),
                         ((35, 13), (45, 20)), ((51, 13), (37, 52)),
                         ((41, 15), (5, 31)), ((45, 15), (21, 63))):
        assert result.getpixel(dest) == skin.getpixel(source)
    assert result.getpixel((20, 20))[3] == 0  # No carrier skin is generated.


def test_hat_jacket_and_partially_transparent_sleeves_are_preserved():
    skin = Image.new("RGBA", (64, 64))
    skin.paste((100, 0, 0, 255), (44, 20, 47, 32))
    skin.paste((0, 0, 100, 128), (45, 36, 47, 37))
    skin.putpixel((40, 12), (10, 20, 30, 128))
    skin.putpixel((20, 38), (40, 50, 60, 255))
    result = Image.open(BytesIO(miniature_png(png(skin))))
    assert result.getpixel((40, 10)) == (10, 20, 30, 128)
    assert result.getpixel((40, 14)) == (40, 50, 60, 255)
    assert result.getpixel((35, 13)) == (50, 0, 50, 255)


def test_png_metadata_does_not_change_generated_bytes():
    skin = Image.new("RGBA", (64, 64), (100, 110, 120, 255))
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("comment", "different upload")
    assert miniature_png(png(skin)) == miniature_png(png(skin, metadata))


@pytest.mark.parametrize("data", [b"invalid", png(Image.new("RGBA", (64, 32))),
                                       png(Image.new("RGBA", (128, 128)))])
def test_invalid_or_unsupported_images_are_rejected(data):
    with pytest.raises((OSError, ValueError)):
        miniature_png(data)
