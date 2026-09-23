-- Existing storage records one payment for the whole order.
CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE,
    amount_paid INTEGER NOT NULL,
    provider_reference TEXT NOT NULL
);

-- No per-item refund allocation exists in this illustrative snapshot.
