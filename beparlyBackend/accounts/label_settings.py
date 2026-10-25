"""Validated physical paper and calibration settings for sales labels."""
from decimal import Decimal, InvalidOperation


DEFAULT_LABEL_SETTINGS = {
    'paper': '4x6', 'width_mm': 101.6, 'height_mm': 152.4,
    'horizontal_offset_mm': 0, 'vertical_offset_mm': 0,
    'scale_percent': 100, 'inner_padding_mm': 3, 'rotation': 0,
    'safe_margin_mm': 3,
}
PAPER_SIZES = {'4x6': (Decimal('101.6'), Decimal('152.4')),
               '4x6_metric': (Decimal('100'), Decimal('150')),
               '2x4': (Decimal('50.8'), Decimal('101.6'))}
RANGES = {
    'width_mm': (50, 210), 'height_mm': (70, 300),
    'horizontal_offset_mm': (-20, 20), 'vertical_offset_mm': (-20, 20),
    'scale_percent': (50, 150), 'inner_padding_mm': (0, 20),
    'safe_margin_mm': (0, 20),
}


def validate_label_settings(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULT_LABEL_SETTINGS):
        raise ValueError('Provide all label print settings.')
    paper = value.get('paper')
    if paper not in (*PAPER_SIZES, 'custom'):
        raise ValueError('Choose a valid label paper size.')
    result = {'paper': paper}
    for key, (minimum, maximum) in RANGES.items():
        raw = value[key]
        if isinstance(raw, bool):
            raise ValueError(f'{key} must be a number.')
        try:
            number = Decimal(str(raw))
        except (InvalidOperation, TypeError, ValueError):
            raise ValueError(f'{key} must be a number.') from None
        if not number.is_finite() or not minimum <= number <= maximum:
            raise ValueError(f'{key} must be between {minimum} and {maximum}.')
        result[key] = float(number)
    if value.get('rotation') not in (0, 90, 180, 270) or isinstance(value.get('rotation'), bool):
        raise ValueError('Rotation must be 0, 90, 180 or 270 degrees.')
    result['rotation'] = value['rotation']
    if paper in PAPER_SIZES:
        width, height = PAPER_SIZES[paper]
        result['width_mm'], result['height_mm'] = float(width), float(height)
    if result['inner_padding_mm'] + result['safe_margin_mm'] >= min(result['width_mm'], result['height_mm']) / 2:
        raise ValueError('Padding and safe margin leave no room for the label.')
    return result


def label_settings(business):
    return validate_label_settings({**DEFAULT_LABEL_SETTINGS, **(getattr(business, 'label_print_settings', None) or {})})
