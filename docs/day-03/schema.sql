-- Day 3 PostgreSQL reference schema, not a deployed migration.
-- Run only in an empty disposable database. Application transactions described
-- in data-model.md and access-and-lifecycle.md are required for cross-row rules.
BEGIN;
CREATE SCHEMA ridr;
REVOKE ALL ON SCHEMA ridr FROM PUBLIC;
SET LOCAL search_path = ridr, pg_catalog;

CREATE TABLE profiles (
    id uuid PRIMARY KEY, -- Same UUID as the verified Supabase Auth subject.
    display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
    account_state text NOT NULL DEFAULT 'active' CHECK (account_state IN ('active', 'deleting', 'anonymized')),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE devices (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES profiles(id),
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    push_token_ciphertext bytea,
    revoked_at timestamptz,
    UNIQUE (id, user_id)
);

CREATE TABLE rides (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    transport text NOT NULL CHECK (transport IN ('motorcycle', 'cycling', 'car')),
    state text NOT NULL DEFAULT 'lobby' CHECK (state IN ('lobby', 'active', 'ended')),
    leader_member_id uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    pairing_revision bigint NOT NULL DEFAULT 0 CHECK (pairing_revision >= 0),
    event_sequence bigint NOT NULL DEFAULT 0 CHECK (event_sequence >= 0),
    broadcast_seconds integer NOT NULL DEFAULT 5 CHECK (broadcast_seconds IN (5, 10, 15)),
    straggler_metres integer NOT NULL DEFAULT 500 CHECK (straggler_metres BETWEEN 200 AND 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    ended_at timestamptz,
    CHECK (
        (state = 'lobby' AND started_at IS NULL AND ended_at IS NULL) OR
        (state = 'active' AND started_at IS NOT NULL AND ended_at IS NULL) OR
        (state = 'ended' AND ended_at IS NOT NULL)
    ),
    CHECK (started_at IS NULL OR started_at >= created_at),
    CHECK (ended_at IS NULL OR ended_at >= coalesce(started_at, created_at))
);

CREATE TABLE memberships (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL REFERENCES rides(id),
    user_id uuid NOT NULL REFERENCES profiles(id),
    physical_role text NOT NULL CHECK (physical_role IN ('rider', 'pillion')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    sharing boolean NOT NULL DEFAULT false,
    consent_epoch bigint NOT NULL DEFAULT 0 CHECK (consent_epoch >= 0),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    CHECK (left_at IS NULL OR left_at >= joined_at),
    CHECK (left_at IS NULL OR NOT sharing),
    UNIQUE (ride_id, id),
    UNIQUE (id, user_id, ride_id)
);
CREATE UNIQUE INDEX one_current_membership ON memberships (ride_id, user_id) WHERE left_at IS NULL;
CREATE INDEX membership_history ON memberships (user_id, joined_at DESC, id);
ALTER TABLE rides ADD CONSTRAINT leader_belongs_to_ride
    FOREIGN KEY (id, leader_member_id) REFERENCES memberships(ride_id, id)
    DEFERRABLE INITIALLY DEFERRED;

-- One row per account in an active ride. Transactions must keep claims in sync
-- with ride start/join/leave/end; stopping sharing does not delete this claim.
CREATE TABLE active_memberships (
    user_id uuid PRIMARY KEY,
    membership_id uuid NOT NULL UNIQUE,
    ride_id uuid NOT NULL,
    FOREIGN KEY (membership_id, user_id, ride_id) REFERENCES memberships(id, user_id, ride_id)
);

CREATE TABLE invitations (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL REFERENCES rides(id),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);

-- Consent is proposed and accepted in separate transactions, never with a lock
-- held while waiting for a person. Payload is validated per kind by the API.
CREATE TABLE consent_requests (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL REFERENCES rides(id),
    requester_member_id uuid NOT NULL,
    target_member_id uuid,
    kind text NOT NULL CHECK (kind IN ('pair', 'role_change', 'leadership')),
    payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
    challenge_hash bytea CHECK (challenge_hash IS NULL OR octet_length(challenge_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    canceled_at timestamptz,
    CHECK (requester_member_id <> target_member_id),
    CHECK (kind = 'pair' OR target_member_id IS NOT NULL),
    CHECK (accepted_at IS NULL OR target_member_id IS NOT NULL),
    CHECK (expires_at > created_at),
    CHECK (kind <> 'pair' OR (challenge_hash IS NOT NULL AND expires_at <= created_at + interval '5 minutes')),
    CHECK (accepted_at IS NULL OR (accepted_at >= created_at AND accepted_at < expires_at)),
    CHECK (accepted_at IS NULL OR canceled_at IS NULL),
    FOREIGN KEY (ride_id, requester_member_id) REFERENCES memberships(ride_id, id),
    FOREIGN KEY (ride_id, target_member_id) REFERENCES memberships(ride_id, id)
);

CREATE TABLE pairs (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL REFERENCES rides(id),
    rider_member_id uuid NOT NULL,
    pillion_member_id uuid NOT NULL,
    consent_request_id uuid NOT NULL UNIQUE REFERENCES consent_requests(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    CHECK (rider_member_id <> pillion_member_id),
    CHECK (ended_at IS NULL OR ended_at >= created_at),
    FOREIGN KEY (ride_id, rider_member_id) REFERENCES memberships(ride_id, id),
    FOREIGN KEY (ride_id, pillion_member_id) REFERENCES memberships(ride_id, id),
    UNIQUE (ride_id, id)
);
CREATE UNIQUE INDEX one_open_rider_pair ON pairs (rider_member_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX one_open_pillion_pair ON pairs (pillion_member_id) WHERE ended_at IS NULL;
CREATE TABLE active_pair_members (
    membership_id uuid PRIMARY KEY,
    pair_id uuid NOT NULL,
    ride_id uuid NOT NULL,
    FOREIGN KEY (ride_id, membership_id) REFERENCES memberships(ride_id, id),
    FOREIGN KEY (ride_id, pair_id) REFERENCES pairs(ride_id, id)
);

CREATE TABLE readiness (
    pair_id uuid PRIMARY KEY REFERENCES pairs(id),
    attesting_member_id uuid NOT NULL REFERENCES memberships(id),
    helmet_attested boolean NOT NULL CHECK (helmet_attested),
    ready_attested boolean NOT NULL CHECK (ready_attested),
    confirmed_at timestamptz NOT NULL,
    invalidated_at timestamptz
);
CREATE TABLE headcount_rounds (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL REFERENCES rides(id),
    leader_member_id uuid NOT NULL,
    pairing_revision bigint NOT NULL CHECK (pairing_revision >= 0),
    opened_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    FOREIGN KEY (ride_id, leader_member_id) REFERENCES memberships(ride_id, id),
    UNIQUE (ride_id, id)
);
CREATE TABLE headcount_confirmations (
    ride_id uuid NOT NULL,
    round_id uuid NOT NULL,
    pair_id uuid NOT NULL,
    scanned_by_member_id uuid NOT NULL,
    confirmed_at timestamptz NOT NULL,
    PRIMARY KEY (round_id, pair_id),
    FOREIGN KEY (ride_id, round_id) REFERENCES headcount_rounds(ride_id, id),
    FOREIGN KEY (ride_id, pair_id) REFERENCES pairs(ride_id, id),
    FOREIGN KEY (ride_id, scanned_by_member_id) REFERENCES memberships(ride_id, id)
);

CREATE TABLE scan_challenges (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL,
    pair_id uuid NOT NULL,
    round_id uuid,
    issued_by_member_id uuid NOT NULL,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
    CHECK (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at)),
    FOREIGN KEY (ride_id, pair_id) REFERENCES pairs(ride_id, id),
    FOREIGN KEY (ride_id, round_id) REFERENCES headcount_rounds(ride_id, id),
    FOREIGN KEY (ride_id, issued_by_member_id) REFERENCES memberships(ride_id, id)
);
CREATE TABLE scan_receipts (
    id uuid PRIMARY KEY,
    challenge_id uuid NOT NULL UNIQUE REFERENCES scan_challenges(id),
    ride_id uuid NOT NULL,
    scanned_by_member_id uuid NOT NULL,
    accepted_at timestamptz NOT NULL,
    FOREIGN KEY (ride_id, scanned_by_member_id) REFERENCES memberships(ride_id, id)
);
ALTER TABLE readiness ADD COLUMN scan_receipt_id uuid NOT NULL REFERENCES scan_receipts(id);
ALTER TABLE headcount_confirmations ADD COLUMN scan_receipt_id uuid NOT NULL UNIQUE REFERENCES scan_receipts(id);

-- Explicit consent intervals permit historical replay without restoring live
-- sharing. Final stop time is reconciled before any queued samples are accepted.
CREATE TABLE sharing_periods (
    membership_id uuid NOT NULL REFERENCES memberships(id),
    epoch bigint NOT NULL CHECK (epoch > 0),
    started_at timestamptz NOT NULL,
    stopped_at timestamptz,
    PRIMARY KEY (membership_id, epoch),
    CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);

-- Portable reference uses validated scalar coordinates. Day 4 may add PostGIS
-- generated geometry/geography + GiST indexes without changing the wire shape.
CREATE TABLE routes (
    ride_id uuid PRIMARY KEY REFERENCES rides(id),
    revision bigint NOT NULL CHECK (revision > 0),
    profile text NOT NULL CHECK (profile IN ('driving', 'cycling')),
    source text NOT NULL CHECK (source IN ('gpx', 'drawn')),
    points jsonb NOT NULL CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) BETWEEN 2 AND 10000),
    updated_at timestamptz NOT NULL,
    expires_at timestamptz
);
CREATE TABLE location_samples (
    id uuid PRIMARY KEY,
    membership_id uuid NOT NULL,
    user_id uuid NOT NULL,
    ride_id uuid NOT NULL,
    device_id uuid NOT NULL,
    consent_epoch bigint NOT NULL,
    captured_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
    accuracy_m double precision NOT NULL CHECK (accuracy_m >= 0 AND accuracy_m < 'Infinity'::double precision),
    speed_mps double precision CHECK (speed_mps >= 0 AND speed_mps < 'Infinity'::double precision),
    heading_deg double precision CHECK (heading_deg >= 0 AND heading_deg < 360),
    expires_at timestamptz,
    FOREIGN KEY (membership_id, user_id, ride_id) REFERENCES memberships(id, user_id, ride_id),
    FOREIGN KEY (device_id, user_id) REFERENCES devices(id, user_id),
    FOREIGN KEY (membership_id, consent_epoch) REFERENCES sharing_periods(membership_id, epoch),
    UNIQUE (membership_id, id)
);
CREATE INDEX sample_trail ON location_samples (membership_id, captured_at, id);
CREATE INDEX sample_retention ON location_samples (expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE location_latest (
    membership_id uuid PRIMARY KEY REFERENCES memberships(id),
    sample_id uuid NOT NULL,
    FOREIGN KEY (membership_id, sample_id) REFERENCES location_samples(membership_id, id)
);

CREATE TABLE media_assets (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL,
    owner_member_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('photo', 'voice')),
    object_key text NOT NULL UNIQUE,
    state text NOT NULL DEFAULT 'quarantined' CHECK (state IN ('quarantined', 'ready', 'rejected', 'deleting')),
    bytes bigint NOT NULL CHECK (bytes > 0),
    duration_seconds numeric CHECK (duration_seconds > 0 AND duration_seconds <= 30),
    lat double precision CHECK (lat BETWEEN -90 AND 90),
    lon double precision CHECK (lon BETWEEN -180 AND 180),
    expires_at timestamptz,
    CHECK ((lat IS NULL) = (lon IS NULL)),
    CHECK (kind <> 'voice' OR duration_seconds IS NOT NULL),
    CHECK (kind <> 'photo' OR bytes <= 10485760),
    CHECK (kind <> 'photo' OR state <> 'ready' OR bytes <= 2097152),
    FOREIGN KEY (ride_id, owner_member_id) REFERENCES memberships(ride_id, id),
    UNIQUE (ride_id, id)
);
CREATE TABLE messages (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL,
    sender_member_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('text', 'preset', 'pin', 'voice')),
    body text CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
    preset_code text,
    media_id uuid,
    lat double precision CHECK (lat BETWEEN -90 AND 90),
    lon double precision CHECK (lon BETWEEN -180 AND 180),
    captured_at timestamptz NOT NULL,
    accepted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    CHECK (
        (kind = 'text' AND body IS NOT NULL AND preset_code IS NULL AND media_id IS NULL AND lat IS NULL AND lon IS NULL) OR
        (kind = 'preset' AND preset_code IS NOT NULL AND body IS NULL AND media_id IS NULL AND lat IS NULL AND lon IS NULL) OR
        (kind = 'pin' AND body IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL AND preset_code IS NULL AND media_id IS NULL) OR
        (kind = 'voice' AND media_id IS NOT NULL AND body IS NULL AND preset_code IS NULL AND lat IS NULL AND lon IS NULL)
    ),
    FOREIGN KEY (ride_id, sender_member_id) REFERENCES memberships(ride_id, id),
    FOREIGN KEY (ride_id, media_id) REFERENCES media_assets(ride_id, id)
);
CREATE INDEX message_history ON messages (ride_id, accepted_at, id);

CREATE TABLE sos_events (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL,
    reporter_member_id uuid NOT NULL,
    reporter_user_id uuid NOT NULL,
    device_id uuid NOT NULL,
    source text NOT NULL CHECK (source IN ('manual', 'possible_crash_user_requested')),
    captured_at timestamptz NOT NULL,
    accepted_at timestamptz NOT NULL DEFAULT now(),
    pair_snapshot jsonb CHECK (pair_snapshot IS NULL OR jsonb_typeof(pair_snapshot) = 'object'),
    location_snapshot jsonb CHECK (location_snapshot IS NULL OR jsonb_typeof(location_snapshot) = 'object'),
    expires_at timestamptz,
    FOREIGN KEY (reporter_member_id, reporter_user_id, ride_id) REFERENCES memberships(id, user_id, ride_id),
    FOREIGN KEY (device_id, reporter_user_id) REFERENCES devices(id, user_id),
    UNIQUE (ride_id, id)
);
CREATE TABLE sos_updates (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL,
    sos_id uuid NOT NULL,
    actor_member_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('reporter_okay', 'coordination_closed')),
    reason text CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
    accepted_at timestamptz NOT NULL DEFAULT now(),
    CHECK (kind <> 'coordination_closed' OR reason IS NOT NULL),
    FOREIGN KEY (ride_id, sos_id) REFERENCES sos_events(ride_id, id),
    FOREIGN KEY (ride_id, actor_member_id) REFERENCES memberships(ride_id, id)
);
CREATE TABLE status_links (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL,
    owner_member_id uuid NOT NULL,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    lifetime_hours integer NOT NULL DEFAULT 4 CHECK (lifetime_hours IN (1, 4, 8, 24)),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at AND expires_at <= created_at + lifetime_hours * interval '1 hour'),
    FOREIGN KEY (ride_id, owner_member_id) REFERENCES memberships(ride_id, id)
);
CREATE INDEX owner_links ON status_links (owner_member_id) WHERE revoked_at IS NULL;
CREATE TABLE emergency_contacts (
    user_id uuid PRIMARY KEY REFERENCES profiles(id),
    ciphertext bytea NOT NULL,
    key_version text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE command_receipts (
    actor_id uuid NOT NULL REFERENCES profiles(id),
    command_id uuid NOT NULL,
    operation text NOT NULL,
    request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
    http_status integer NOT NULL CHECK (http_status BETWEEN 200 AND 499),
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'), -- IDs/metadata only, no bearer secrets.
    accepted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    PRIMARY KEY (actor_id, command_id)
);
CREATE TABLE outbox_events (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL REFERENCES rides(id),
    sequence bigint NOT NULL CHECK (sequence > 0),
    actor_member_id uuid,
    kind text NOT NULL,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    accepted_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    expires_at timestamptz,
    UNIQUE (ride_id, sequence),
    FOREIGN KEY (ride_id, actor_member_id) REFERENCES memberships(ride_id, id)
);
CREATE INDEX pending_outbox ON outbox_events (accepted_at, id) WHERE published_at IS NULL;
CREATE TABLE device_acknowledgements (
    event_id uuid NOT NULL REFERENCES outbox_events(id),
    device_id uuid NOT NULL REFERENCES devices(id),
    acknowledged_at timestamptz NOT NULL,
    PRIMARY KEY (event_id, device_id)
);
CREATE TABLE deletion_jobs (
    user_id uuid PRIMARY KEY REFERENCES profiles(id),
    requested_at timestamptz NOT NULL,
    active_store_due_at timestamptz NOT NULL,
    backup_due_at timestamptz NOT NULL,
    completed_at timestamptz,
    CHECK (active_store_due_at >= requested_at AND active_store_due_at <= requested_at + interval '7 days'),
    CHECK (backup_due_at >= requested_at AND backup_due_at <= requested_at + interval '30 days')
);
CREATE TABLE ad_entitlements (
    user_id uuid PRIMARY KEY REFERENCES profiles(id),
    ad_free_until timestamptz NOT NULL,
    provisioned_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ad_free_until > provisioned_at)
);

REVOKE ALL ON ALL TABLES IN SCHEMA ridr FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ridr FROM PUBLIC;
COMMIT;
