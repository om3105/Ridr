# Day 21 — post-ride summary

1. Add an ended-ride, participant-only summary read using retained records. Derive the viewing member's participation interval, validated recorded distance, elapsed pace and average speed without using the planned route as distance.
2. Show the member's recorded trace as disconnected segments and explicitly identify sample gaps, sharing stops and departures. Bound map detail with a clear partial-preview label for unusually long rides; keep the full metric calculation independent of that display limit.
3. Add a mobile summary screen reachable after an acknowledged end or from an ended ride. Refresh it so eligible late historical uploads update the metrics and timestamp. Do not implement the Day 22 history index or Day 23 photos here.
4. Test zero distance, sample ordering/duplicates, poor accuracy, implausible jumps, consent changes, gaps, late samples and participant access. Run the API/mobile checks and build, review the diff, commit in meaningful increments and document unmeasured device behavior.
