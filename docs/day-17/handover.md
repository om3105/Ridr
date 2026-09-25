# Day 17 handover — pillion readiness

The current pair's readiness is visible to both members; the leader sees every current pair as ready or pending. Only the pillion can explicitly attest their helmet and readiness. A fresh, stationary scan of the rider's QR is required when the pairing scan was not performed by the pillion. QR challenges expire after five minutes, can be used once, and are stored as hashes. Pair changes invalidate readiness, and the existing ride-start gate blocks pending pairs. A late pair can complete this check while the ride is active and stationary.

The pairing response now includes the exact expiry time of its initial scan receipt so the pillion screen does not infer a false validity period. The scan is a human check-in, not automatic helmet detection. Rest-stop headcount rounds remain Day 18 scope.

Verification completed against local PostgreSQL and the HTTP/client suites; lint, type checks, and the Android/iOS/web export build passed. A two-phone camera and on-road acceptance check was not performed in this session.
