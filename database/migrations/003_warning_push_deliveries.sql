-- Provider acceptance is distinct from device acknowledgement.
CREATE TABLE ridr.warning_push_deliveries (
  ride_id uuid NOT NULL REFERENCES ridr.rides(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES ridr.devices(id) ON DELETE CASCADE,
  warning_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','accepted','delivered','failed','unknown','suppressed')),
  ticket_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id,device_id,warning_id)
);
CREATE INDEX warning_push_receipts ON ridr.warning_push_deliveries(updated_at) WHERE state='accepted';
REVOKE ALL ON ridr.warning_push_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ridr.warning_push_deliveries TO ridr_api;
