# Day 24 — restricted sponsored cards

1. Confirm the Day 1 allowlist and existing profile entitlement/active-ride fields. Do not add purchases, contextual targeting, rewards or an ad SDK in this milestone.
2. Add one authenticated server read for approved, non-personalized card content. Recheck current active membership and ad-free entitlement in the database for every request; return no fill by default and never send ride or location data to a sponsor.
3. Add one central mobile eligibility rule and a native card component used only on Home, History and a loaded completed summary. Clear pending/displayed content on focus loss, account/ride-state change and app backgrounding; ignore late responses. Keep failure and no-fill invisible.
4. Style the card with a distinct Sponsored label, readable action and both display modes. Never mount it on map, chat, alerts, SOS or check-in screens.
5. Verify allowlist, active-ride and entitlement suppression, stale response cancellation, API authorization, no-fill, rendering boundaries, type/lint/build, and document any real advertiser/device acceptance gates.
