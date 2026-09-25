-- A ride can have only one unfinished rest-stop check, including direct SQL writes.
CREATE UNIQUE INDEX one_open_headcount_round_per_ride
  ON ridr.headcount_rounds (ride_id) WHERE completed_at IS NULL;

-- The separately owned contact must disappear with the account's profile.
ALTER TABLE ridr.emergency_contacts
  DROP CONSTRAINT emergency_contacts_user_id_fkey,
  ADD CONSTRAINT emergency_contacts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES ridr.profiles(id) ON DELETE CASCADE;
