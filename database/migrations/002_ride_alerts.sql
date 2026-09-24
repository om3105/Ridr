-- Backend-only durable detection state; the existing ride lock serializes writes.
CREATE TABLE ridr.ride_alert_state (
  ride_id uuid PRIMARY KEY REFERENCES ridr.rides(id) ON DELETE CASCADE,
  body jsonb NOT NULL CHECK (jsonb_typeof(body)='object')
);
ALTER TABLE ridr.location_samples ADD COLUMN battery_percent integer CHECK (battery_percent BETWEEN 0 AND 100);
REVOKE ALL ON ridr.ride_alert_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ridr.ride_alert_state TO ridr_api;
