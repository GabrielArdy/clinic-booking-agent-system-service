-- Optional profile photo URL for a doctor. NULL = no photo.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS photo_url TEXT;
