# Loom-style subtitle configuration
from videodb import SubtitleStyle, SubtitleAlignment, SubtitleBorderStyle

LOOM_SUBTITLE_STYLE = SubtitleStyle(
    font_name="Roboto",
    font_size=14,
    bold=False,
    # White text
    primary_colour="&HFFFFFF",
    # Semi-transparent black background box (80 alpha = 50% opacity)
    back_colour="&H80000000",
    outline_colour="&H80000000",
    border_style=SubtitleBorderStyle.opaque_box,
    alignment=SubtitleAlignment.bottom_center,
    margin_v=30,
    outline=2,
    shadow=0
)
