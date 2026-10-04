import colorsys

# Preserve region hues while applying a parchment wash.
PAPER_HIGH = (240, 230, 210)
WARM_HUE_CENTER = 40 / 360.0
GREEN_HUE_MIN = 80 / 360.0
GREEN_HUE_MAX = 160 / 360.0
WARM_HUE_PULL = 0.12

SATURATION_SCALE = 0.50
FILL_SATURATION_MAX = 0.48
FILL_LIGHTNESS_MIN = 0.42
FILL_LIGHTNESS_MAX = 0.58
PARCHMENT_BLEND = 0.08
OCCUPATION_GREY_BLEND = 0.22

HOVER_LIGHTNESS_BUMP = 0.10
HOVER_SATURATION_BUMP = 0.05
HOVER_SATURATION_MAX = FILL_SATURATION_MAX + 0.08


def _clamp_byte(value: float) -> int:
    return int(max(0, min(255, round(value))))


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _lerp_rgb(
    a: tuple[int, int, int], b: tuple[int, int, int], t: float
) -> tuple[int, int, int]:
    return tuple(int(_lerp(a[i], b[i], t)) for i in range(3))


def _maybe_warm_green_hue(hue: float) -> float:
    if GREEN_HUE_MIN <= hue <= GREEN_HUE_MAX:
        return _lerp(hue, WARM_HUE_CENTER, WARM_HUE_PULL)
    return hue


def parchment_wash_rgb(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    """Desaturate and lightness-map nation rgb while keeping hue identity."""
    r, g, b = (c / 255.0 for c in rgb)
    hue, lightness, saturation = colorsys.rgb_to_hls(r, g, b)

    hue = _maybe_warm_green_hue(hue)
    lightness = FILL_LIGHTNESS_MIN + lightness * (FILL_LIGHTNESS_MAX - FILL_LIGHTNESS_MIN)
    saturation = min(saturation * SATURATION_SCALE, FILL_SATURATION_MAX)

    r, g, b = colorsys.hls_to_rgb(hue, lightness, saturation)
    washed = (
        _clamp_byte(r * 255),
        _clamp_byte(g * 255),
        _clamp_byte(b * 255),
    )
    if PARCHMENT_BLEND <= 0:
        return washed
    return _lerp_rgb(washed, PAPER_HIGH, PARCHMENT_BLEND)


def display_rgb(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    """Display colour for region overlays (parchment wash, faithful hue)."""
    return parchment_wash_rgb(rgb)


def occupation_display_rgb(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    """Nation display colour, slightly greyer, for occupied land of the occupier."""
    home = display_rgb(rgb)
    luminance = 0.299 * home[0] + 0.587 * home[1] + 0.114 * home[2]
    grey = (_clamp_byte(luminance), _clamp_byte(luminance), _clamp_byte(luminance))
    muted = _lerp_rgb(home, grey, OCCUPATION_GREY_BLEND)
    return tuple(_clamp_byte(channel) for channel in muted)


def hover_rgb(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    """Brighter hover variant in the same hue family."""
    base = parchment_wash_rgb(rgb)
    r, g, b = (c / 255.0 for c in base)
    hue, lightness, saturation = colorsys.rgb_to_hls(r, g, b)

    lightness = min(1.0, lightness + HOVER_LIGHTNESS_BUMP)
    saturation = min(HOVER_SATURATION_MAX, saturation + HOVER_SATURATION_BUMP)

    r, g, b = colorsys.hls_to_rgb(hue, lightness, saturation)
    return _clamp_byte(r * 255), _clamp_byte(g * 255), _clamp_byte(b * 255)
