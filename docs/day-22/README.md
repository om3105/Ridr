# Day 22 — ride history

Home now opens a paginated history of completed rides the signed-in account actually joined. Newest rides appear first; opening one shows the participant-only Day 21 summary. Each card shows the ride end date, that rider's recorded distance, participation time and elapsed pace. Missing location data does not become estimated travel.

The API reads from the existing ride and membership records. It returns at most 100 rows per page, uses an account-bound keyset cursor, and excludes rides after the same 90-day history window for every account. A former participant opening an expired summary receives an expiry message; an outsider or a deleted ride remains unavailable. History is held only in screen memory, and a failed refresh clears it so stale rows are not presented as current. Changing account resets the screen.

To verify locally, start the test database and run `NODE_ENV=test npm run test:history --workspace @ridr/api` and `npm test --workspace @ridr/mobile`. Run the workspace type checks and build before a release build. The integration test covers ownership, ordering, pagination, changed-account cursors, late location metrics and retention. Phone navigation and the response time for a long 100-row history have not been measured in this milestone.

Ride photos, subscription features and a downloadable history export are outside Day 22.
