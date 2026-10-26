"""Stable decimal strings for aggregate financial and quantity reports."""
from decimal import Decimal


def decimal_text(value):
    """Preserve exact value without exposing database NUMERIC scale or exponent notation."""
    value = Decimal(value)
    if not value:
        return '0'
    rendered = format(value, 'f')
    return rendered.rstrip('0').rstrip('.') if '.' in rendered else rendered
