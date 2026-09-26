-- Rejected statements must fail with the intended constraint class, not merely
-- with any SQL error. All sample records are rolled back at the end.
BEGIN;
SET LOCAL search_path = ridr, pg_catalog;
CREATE TEMP TABLE check_results (label text PRIMARY KEY);
CREATE FUNCTION pg_temp.reject(label text, statement text, expected_state text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
        IF actual_state <> expected_state THEN
            RAISE EXCEPTION '%: expected SQLSTATE %, received %', label, expected_state, actual_state;
        END IF;
        INSERT INTO check_results VALUES (label);
        RETURN;
    END;
    RAISE EXCEPTION '%: invalid operation was accepted', label;
END;
$$;

INSERT INTO profiles(id, display_name) VALUES
    ('00000000-0000-4000-8000-000000000001', 'First rider'),
    ('00000000-0000-4000-8000-000000000002', 'Second rider'),
    ('00000000-0000-4000-8000-000000000003', 'First pillion'),
    ('00000000-0000-4000-8000-000000000004', 'Second pillion');
INSERT INTO rides(id, name, transport, leader_member_id) VALUES
    ('00000000-0000-4000-8000-000000000011', 'First loop', 'motorcycle', '00000000-0000-4000-8000-000000000101'),
    ('00000000-0000-4000-8000-000000000012', 'Second loop', 'motorcycle', '00000000-0000-4000-8000-000000000201');
INSERT INTO memberships(id, ride_id, user_id, physical_role) VALUES
    ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'rider'),
    ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000002', 'rider'),
    ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000003', 'pillion'),
    ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000004', 'pillion'),
    ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'rider');
SET CONSTRAINTS ALL IMMEDIATE;
INSERT INTO check_results VALUES ('valid ride creation resolves deferred leader references');

SELECT pg_temp.reject('leader cannot reference another ride', $$
    UPDATE rides SET leader_member_id = '00000000-0000-4000-8000-000000000201'
    WHERE id = '00000000-0000-4000-8000-000000000011'$$, '23503');
SELECT pg_temp.reject('active state requires start time', $$
    UPDATE rides SET state = 'active' WHERE id = '00000000-0000-4000-8000-000000000011'$$, '23514');
SELECT pg_temp.reject('same account cannot have duplicate current membership', $$
    INSERT INTO memberships(id,ride_id,user_id,physical_role) VALUES
    ('00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','rider')$$, '23505');

INSERT INTO active_memberships VALUES
    ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000011');
SELECT pg_temp.reject('one account cannot hold two active claims', $$
    INSERT INTO active_memberships VALUES
    ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000012')$$, '23505');
SELECT pg_temp.reject('active claim must belong to the account', $$
    INSERT INTO active_memberships VALUES
    ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000012')$$, '23503');
SELECT pg_temp.reject('departure cannot leave sharing enabled', $$
    UPDATE memberships SET sharing=true,left_at=now()
    WHERE id='00000000-0000-4000-8000-000000000102'$$, '23514');

INSERT INTO consent_requests(id,ride_id,requester_member_id,target_member_id,kind,challenge_hash,expires_at,accepted_at) VALUES
    ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000103','pair',decode(repeat('01',32),'hex'),now()+interval '5 minutes',now());
SELECT pg_temp.reject('pair challenge cannot outlive five minutes', $$
    UPDATE consent_requests SET expires_at=created_at+interval '6 minutes'
    WHERE id='00000000-0000-4000-8000-000000000301'$$, '23514');
INSERT INTO pairs(id,ride_id,rider_member_id,pillion_member_id,consent_request_id) VALUES
    ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000301');
SELECT pg_temp.reject('pair cannot contain the same member twice', $$
    UPDATE pairs SET pillion_member_id=rider_member_id
    WHERE id='00000000-0000-4000-8000-000000000401'$$, '23514');
INSERT INTO active_pair_members VALUES
    ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000011');
SELECT pg_temp.reject('pair occupancy is unique per person', $$
    INSERT INTO active_pair_members SELECT * FROM active_pair_members LIMIT 1$$, '23505');

INSERT INTO headcount_rounds(id,ride_id,leader_member_id,pairing_revision,completed_at) VALUES
    ('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',1,now()),
    ('00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',1,NULL);
SELECT pg_temp.reject('only one rest-stop round can stay open per ride', $$
    INSERT INTO headcount_rounds(id,ride_id,leader_member_id,pairing_revision) VALUES
    ('00000000-0000-4000-8000-000000000503','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',1)$$, '23505');
INSERT INTO scan_challenges(id,ride_id,pair_id,round_id,issued_by_member_id,token_hash,expires_at,consumed_at) VALUES
    ('00000000-0000-4000-8000-000000000511','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000103',decode(repeat('03',32),'hex'),now()+interval '5 minutes',now()),
    ('00000000-0000-4000-8000-000000000512','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000103',decode(repeat('04',32),'hex'),now()+interval '5 minutes',now());
INSERT INTO scan_receipts VALUES
    ('00000000-0000-4000-8000-000000000521','00000000-0000-4000-8000-000000000511','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',now()),
    ('00000000-0000-4000-8000-000000000522','00000000-0000-4000-8000-000000000512','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',now());
SELECT pg_temp.reject('QR challenge cannot be consumed for two receipts', $$
    INSERT INTO scan_receipts SELECT '00000000-0000-4000-8000-000000000523',challenge_id,ride_id,scanned_by_member_id,accepted_at FROM scan_receipts LIMIT 1$$, '23505');
INSERT INTO headcount_confirmations VALUES
    ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000101',now(),'00000000-0000-4000-8000-000000000521');
SELECT pg_temp.reject('duplicate scan cannot count twice in one round', $$
    INSERT INTO headcount_confirmations SELECT * FROM headcount_confirmations LIMIT 1$$, '23505');
INSERT INTO headcount_confirmations SELECT ride_id,'00000000-0000-4000-8000-000000000502',pair_id,scanned_by_member_id,now(),'00000000-0000-4000-8000-000000000522'
    FROM headcount_confirmations WHERE round_id='00000000-0000-4000-8000-000000000501';
INSERT INTO check_results VALUES ('same pair can confirm separately in a fresh round');

INSERT INTO devices(id,user_id,platform) VALUES
    ('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000001','ios');
INSERT INTO sharing_periods VALUES ('00000000-0000-4000-8000-000000000101',1,now(),NULL);
INSERT INTO location_samples(id,membership_id,user_id,ride_id,device_id,consent_epoch,captured_at,lat,lon,accuracy_m) VALUES
    ('00000000-0000-4000-8000-000000000701','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000601',1,now(),18.5,73.8,10);
SELECT pg_temp.reject('latitude outside valid range is rejected', $$
    UPDATE location_samples SET lat=91$$, '23514');
SELECT pg_temp.reject('NaN coordinates are rejected', $$
    UPDATE location_samples SET lon='NaN'::double precision$$, '23514');
SELECT pg_temp.reject('infinite accuracy is rejected', $$
    UPDATE location_samples SET accuracy_m='Infinity'::double precision$$, '23514');
SELECT pg_temp.reject('sample device must belong to the member account', $$
    UPDATE location_samples SET membership_id='00000000-0000-4000-8000-000000000102', user_id='00000000-0000-4000-8000-000000000002'$$, '23503');
SELECT pg_temp.reject('unknown consent epoch cannot accept samples', $$
    UPDATE location_samples SET consent_epoch=2$$, '23503');

INSERT INTO status_links(id,ride_id,owner_member_id,token_hash,expires_at) VALUES
    ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',decode(repeat('02',32),'hex'),now()+interval '4 hours');
SELECT pg_temp.reject('status link lifetime choices are bounded', $$
    UPDATE status_links SET lifetime_hours=48$$, '23514');
SELECT pg_temp.reject('status link expiry cannot exceed chosen lifetime', $$
    UPDATE status_links SET expires_at=created_at+interval '5 hours'$$, '23514');
SELECT pg_temp.reject('status link requires a full token hash', $$
    UPDATE status_links SET token_hash=decode('ff','hex')$$, '23514');
SELECT pg_temp.reject('message variant cannot omit required text', $$
    INSERT INTO messages(id,ride_id,sender_member_id,kind,captured_at) VALUES
    ('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101','text',now())$$, '23514');

INSERT INTO outbox_events(id,ride_id,sequence,kind,payload) VALUES
    ('00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000011',1,'ride.changed','{}');
SELECT pg_temp.reject('durable ride sequence cannot duplicate', $$
    INSERT INTO outbox_events(id,ride_id,sequence,kind,payload) VALUES
    ('00000000-0000-4000-8000-000000000912','00000000-0000-4000-8000-000000000011',1,'ride.changed','{}')$$, '23505');
SELECT pg_temp.reject('deletion active-store deadline cannot exceed seven days', $$
    INSERT INTO deletion_jobs(user_id,requested_at,active_store_due_at,backup_due_at) VALUES
    ('00000000-0000-4000-8000-000000000001',now(),now()+interval '8 days',now()+interval '30 days')$$, '23514');

SELECT 'PASS: ' || count(*) || ' database integrity cases' FROM check_results;
ROLLBACK;
