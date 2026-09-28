# Day 23 — private ride photos

1. Reuse the private `media_assets` table and completed-ride membership guard. Add only the ordering/index fields needed for a bounded photo list. Store processed files outside the public app tree.
2. Accept a bounded image upload with a stable photo ID, an explicit route point, and a fresh stopped-motion check. Decode the real image, rotate/resize/recompress it to a metadata-free JPEG of at most 2 MB, and reject malformed or oversized input. Validate that the chosen point lies on the completed route or the participant's recorded trail.
3. Make duplicate retries return the original attachment, while conflicting reuse is rejected. Add participant-only list/content endpoints and owner-only delete. Ensure interrupted writes and deletion do not leave readable orphan files; keep responses and logs free of file paths.
4. Add photo selection, route-point selection, upload/retry/cancel, viewing and own-photo removal to the completed summary. Keep private images and draft state scoped to the signed-in account, with clear empty/error states.
5. Verify image validation and EXIF removal, ownership/cross-ride access, duplicate/canceled uploads, migration rerun, client behavior, type/lint/build. Document any device and future account-deletion/retention gates that cannot be exercised locally.
