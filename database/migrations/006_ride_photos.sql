ALTER TABLE ridr.media_assets
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN photo_request_hash bytea CHECK (photo_request_hash IS NULL OR octet_length(photo_request_hash)=32);

CREATE INDEX media_ride_photos ON ridr.media_assets (ride_id, created_at DESC, id DESC)
  WHERE kind='photo' AND state='ready';
CREATE INDEX media_owner_photos ON ridr.media_assets (owner_member_id)
  WHERE kind='photo' AND state IN ('ready','deleting');
CREATE INDEX media_expired_photos ON ridr.media_assets (expires_at)
  WHERE kind='photo' AND state IN ('ready','deleting');
