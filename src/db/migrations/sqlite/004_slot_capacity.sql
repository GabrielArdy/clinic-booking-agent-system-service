-- Capacity-based slots: one slot holds floor(slot_minutes / 15) consultations.
-- Replace the one-booking-per-slot unique index with a per-seat unique index.
ALTER TABLE bookings ADD COLUMN slot_seq INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS idx_bookings_unique_active_slot;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_unique_active_seat
    ON bookings(doctor_id, date, start_time, slot_seq)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_bookings_doctor_date
    ON bookings(doctor_id, date);
