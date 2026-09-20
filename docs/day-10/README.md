# Day 10 — live group map

Day 10 implementation is complete within the owner's physical-device and simulator waiver. The physical 50-member responsiveness gate remains unverified.

## What is available

An active ride opens on the native group map. Lobby and ended-ride screens retain their existing controls. The map links to location sharing, ride controls/invitations and the saved route. Viewing never enables tracking or requests location permission.

- Named markers use one GeoJSON source and native map layers. Valid live speed appears with the label and valid heading as a direction arrow; unknown movement stays unavailable. Stale and low-accuracy positions have distinct colors and text. Member details show accuracy, last report time, coordinates, role and sharing state.
- Sharing-off and waiting members remain in the roster without fabricated positions. Stopped, departed or removed positions disappear when a replacement snapshot arrives.
- Existing rider/pillion pairs use only the rider's position. A stale rider remains stale; a missing rider has no combined marker even if the pillion reports. Each person's own position and state remain separately labelled in the roster. Pair creation remains a later milestone.
- Fit group, manual refresh and tile-load retry are available. Automatic data refresh preserves camera position while members move. The initial map centers on Pune until positions arrive. Provider attribution remains enabled.
- Web shows the member roster and a native-map availability notice; the interactive road map is an Android/iOS feature, consistent with the existing native map setup.

## Delivery and recovery

The authorized HTTP and socket snapshots now include `rideId`, `ownMemberId`, `members` and `pairs`, alongside the existing sequence, server time and samples. No migration or additional dependency is needed. Deploy the updated API before the new mobile bundle.

Socket delivery is backed by a five-second HTTP refresh. Token changes and server disconnects cause renewed connection/subscription. Every snapshot replaces the whole position collection; older sequence/time snapshots cannot restore removed positions. The client rejects another ride, duplicate identities, invalid pair references and positions for non-sharing members. Invalid speed/heading values become unknown without discarding a valid position.

On background, blur, access loss or connection failure the map clears cached coordinates. Generation checks ignore responses from an earlier screen/connection lifetime. Foreground and refresh recover through a newly authorized snapshot. Ageing uses server time plus elapsed local time. This screen does not change Day 9's consent, collection or encrypted queue behavior.

## Verification (2026-09-20)

- API unit/HTTP/socket suite: 26 passed, including denied ride fetch/subscription and revoked socket disconnection.
- Mobile suite: 74 passed, including five group-map tests for 50-member updates, pairing, freshness, parsing and snapshot replacement.
- PostgreSQL management integration: 16 passed, including member/pair snapshot assertions, outsider isolation, stop-sharing removal and session/ride termination.
- Lint and API/mobile type checks passed. API compilation and Android/iOS/web JavaScript exports passed.
- A 500-iteration, 50-member parse/projection run measured 3.451 ms p95 in Node while other checks ran. This measures data processing only, not map rendering, network latency or production capacity.

The owner waived native-device and simulator verification. Native map interactions, socket recovery through real app suspension, frame times, control latency and the 30-minute memory gate remain unverified. No fresh APK was produced in this milestone. The physical SUP-08 acceptance procedure remains in `docs/day-01/acceptance-and-release.md` for later device testing. Gap calculations, trails, straggler detection and pairing creation were not pulled into Day 10.
