"""Frozen illustrative implementation for skill evaluation, not production code."""

VOUCHER_MINIMUM = 500_000
VOUCHER_DISCOUNT = 50_000
SHIPPING_FEE = 30_000


def total(items):
    subtotal = sum(item['price'] * item['quantity'] for item in items)
    discount = VOUCHER_DISCOUNT if subtotal >= VOUCHER_MINIMUM else 0
    return subtotal - discount + SHIPPING_FEE


def cancel(order):
    if order['status'] != 'created':
        raise ValueError('Only created orders can be cancelled currently')
    order['status'] = 'cancelled'
    return order
