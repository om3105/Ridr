# Day 25 — ad-free entitlement and release checkpoint

1. Verify the Day 24 placement gate and the Day 1 Day 25 acceptance criteria. Preserve the conditional scope of contextual targeting and rewards; do not enable checkout or an ad SDK.
2. Give an operator a bounded, server-side way to provision and revoke a test account's ad-free entitlement. Keep the database connection and authority off the phone; reject malformed account IDs and expiry dates.
3. Verify an active entitlement suppresses the sponsored API and mobile placement, including account and ride-state transitions. Fix any real gap found in the existing implementation.
4. Record the Day 25 decisions and evidence: contextual/reward status, ad-free partial scope, included-feature gaps, and target-market/deployment prerequisites. Do not infer a public launch from the Pune test dataset.
5. Run relevant tests, lint/type checks and build, inspect the diff, then commit only Day 25 files. Report unverified device or owner decisions explicitly.
