# Day 18 handover — rest stops and pillion tools

The leader can start a headcount during an active ride while stationary. Each current pair shows a new round-specific QR from a member's phone; the leader scans and confirms it. The round stays pending until every current pair is confirmed. New rounds never reuse old scans. Pair and leadership changes update the pending round and remove affected confirmations; completed rounds retain their accepted record. A database constraint permits only one open round per ride.

The active pillion map now places ride messages and the three existing one-tap presets near the top. Freeform text, pins, and voice continue to use their existing stationary rules. Manual SOS is scheduled for Day 19, so this milestone does not claim an SOS control.

An account owner can privately add, edit, read, or remove one emergency contact from the profile screen. The phone must use international `+` format and the name must be 1–80 plain-text characters. The API encrypts the record using a contact-specific key derived from the configured private `PUSH_TOKEN_KEY`; the contact is not included in ride/member responses, messages, or plaintext command receipts. The database removes it if the profile is deleted. No call, SMS, or invitation is sent. Keep the private key stable so saved contacts remain readable.

The database migration and automated API, mobile, and PostgreSQL checks passed along with lint, type checks, and Android/iOS/web exports. A live two-phone camera check at a rest stop was not performed in this session.
