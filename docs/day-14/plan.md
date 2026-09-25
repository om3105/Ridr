# Day 14 — quick presets and voice notes

Scope: FR-COM-02, FR-COM-04 and the Day 14 portion of FR-PIL-05. Do not start Day 15 work.

1. Extend the message parser, ordered write/read path and tests for the eight allowed preset codes. Presets need no stationary proof, retain stable IDs through retry, and remain authorized only for current active-ride members.
2. Put the five rider presets and three pillion presets directly on the active map. Persist immediate pending/accepted/offline/unsent state with the Day 13 encrypted queue and reconcile without opening chat. Keep controls reachable while moving.
3. Add a private voice-media write/read path with bounded upload, validated audio format/duration, same-ride ownership and per-read membership checks. Only a ready asset can be attached to an ordered voice message; retries cannot duplicate it.
4. Add native microphone permission, stationary record/preview/cancel/send/play controls. Stop or discard recording when interrupted or the app backgrounds; show recovery on denied permission, upload and playback errors. Keep voice controls behind the pillion secondary composer.
5. Run relevant API/mobile/database tests, type checks, lint and builds; exercise a native build where available. Review and commit coherent changes, update the handoff, and preserve unrelated local edits.
