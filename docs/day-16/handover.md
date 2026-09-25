# Day 16 handover

Motorcycle riders and pillions can open **Rider and pillion pairing** from the ride controls or active map. Either person may show a five-minute QR while stopped. The other scans it, sees the named counterpart, and explicitly agrees. The issuer's QR creation records their consent. Reissuing the QR cancels the earlier one. Either member can end the pair while stopped.

The API validates current same-ride membership, opposite motorcycle roles, fresh motion evidence, the issuer's unchanged role revision, both unpaired guards, and a single-use token. Pair creation and both active-member guards commit together. The current-pair read works in the lobby as well as during an active ride. Leave, role change, and ride end continue to clear live pairs. Historical pair rows remain for later emergency event snapshots.

On the live map, a pair appears at the rider's position with a passenger count, both names, and each person's authorized detail. Rider staleness remains visible; the pillion's location is never substituted for the rider's. Unpairing restores separate markers at the next live refresh without erasing location history.

Validation completed: 40 API tests, 91 mobile tests, and 22 local PostgreSQL management checks cover request shape, QR secrecy in URLs, expiry, replacement, wrong ride, replay, concurrent scans, unpair, and marker behavior. Lint, type checks, and Android/iOS/web bundle export passed. A two-phone camera and motion check remains a device acceptance check; it is not represented by automated tests.

Day 17 adds the pillion's helmet and readiness attestation. Day 18 adds rest-stop headcounts. NFC is deferred.
