-- Keep the original request digest beyond the short-lived command receipt window.
ALTER TABLE ridr.sos_events
  ADD COLUMN request_hash bytea CHECK (request_hash IS NULL OR octet_length(request_hash)=32);

-- A device acknowledgement records transport receipt, not that a person saw the alert.
ALTER TABLE ridr.device_acknowledgements
  ADD COLUMN reported_received_at timestamptz;

CREATE INDEX sos_ride_recent ON ridr.sos_events (ride_id, accepted_at DESC, id DESC);
CREATE INDEX sos_pair_recent ON ridr.sos_events ((pair_snapshot->>'pairId'), accepted_at DESC)
  WHERE pair_snapshot IS NOT NULL;

CREATE TABLE ridr.sos_push_deliveries (
  sos_id uuid NOT NULL REFERENCES ridr.sos_events(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES ridr.devices(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('pending','accepted','delivered','failed','unknown')),
  ticket_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sos_id,device_id)
);
CREATE INDEX sos_push_receipts ON ridr.sos_push_deliveries(updated_at) WHERE state='accepted';
REVOKE ALL ON ridr.sos_push_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ridr.sos_push_deliveries TO ridr_api;
