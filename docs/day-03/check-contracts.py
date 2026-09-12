"""Check v1 wire boundaries and local design references; no service is contacted.

Requires jsonschema with Draft 2020-12 support and rfc3339-validator.
Run from any working directory.
"""

from copy import deepcopy
import json
from pathlib import Path
import re

from jsonschema import Draft202012Validator, FormatChecker


FOLDER = Path(__file__).resolve().parent
SCHEMA = json.loads((FOLDER / "events.schema.json").read_text())
Draft202012Validator.check_schema(SCHEMA)
assert not FormatChecker().conforms("2026-02-30T09:00:00Z", "date-time"), (
    "Timestamp format checker unavailable: install rfc3339-validator"
)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
PUBLIC = Draft202012Validator(
    {"$ref": "#/$defs/PublicStatus", "$defs": SCHEMA["$defs"]},
    format_checker=FormatChecker(),
)


def identity(number):
    return f"00000000-0000-4000-8000-{number:012d}"


TIME = "2026-09-11T09:00:00Z"
POSITION = {"lat": 18.5, "lon": 73.8, "accuracyM": 10, "recordedAt": TIME}
MOTION = {"state": "stopped", "source": "speed", "observedAt": TIME}
LOCATION = {
    "consentEpoch": 1, "position": POSITION, "speedKph": None,
    "headingDegrees": None, "batteryPercent": 75,
}


def client(kind, payload):
    return {
        "v": 1, "type": kind, "id": identity(1), "rideId": identity(2),
        "capturedAt": TIME, "payload": deepcopy(payload),
    }


def server(payload):
    return {
        "v": 1, "type": "server.event", "id": identity(3), "rideId": identity(2),
        "sequence": 1, "acceptedAt": TIME, "actorMemberId": identity(4),
        "payload": deepcopy(payload),
    }


def main():
    valid = [
        client("location.sample", LOCATION),
        client("message.text", {"text": "Regroup at the next stop.", "motion": MOTION}),
        client("message.preset", {"preset": "need_stop"}),
        client("message.pin", {"coordinate": {"lat": 18.5, "lon": 73.8}, "text": "Stop here", "motion": MOTION}),
        client("message.voice", {"mediaId": identity(5), "motion": MOTION}),
        client("sos.request", {"kind": "manual", "position": None}),
        client("sos.request", {"kind": "possible_crash", "position": POSITION}),
        client("sos.resolve", {"sosId": identity(1), "resolution": "reporter_okay"}),
        client("sos.resolve", {"sosId": identity(1), "resolution": "coordination_closed", "reason": "Group coordination closed"}),
        {"v": 1, "type": "server.ack", "id": identity(3), "eventId": identity(1), "serverTime": TIME, "status": "accepted", "rideId": identity(2), "sequence": 1},
        {"v": 1, "type": "server.ack", "id": identity(3), "eventId": identity(1), "serverTime": TIME, "status": "rejected", "code": "SHARING_DISABLED", "retryable": False},
        server({"kind": "location.updated", "sampleId": identity(1), "memberId": identity(4), "sample": LOCATION}),
        server({"kind": "message.accepted", "messageId": identity(1), "authorMemberId": identity(4), "capturedAt": TIME, "body": {"kind": "text", "text": "Stopping"}}),
        server({"kind": "sos.accepted", "sosId": identity(1), "reporterMemberId": identity(4), "sosKind": "manual", "capturedAt": TIME, "position": None, "pairSnapshot": None, "linkedSosIds": []}),
        server({"kind": "sos.resolved", "resolutionId": identity(6), "capturedAt": TIME, "resolution": {"sosId": identity(1), "resolution": "reporter_okay"}}),
        server({"kind": "resource.invalidated", "resource": "ride", "resourceId": identity(2), "revision": 2}),
        server({"kind": "warning", "warningType": "straggler", "unitMemberId": identity(4), "distanceBehindM": 600, "thresholdM": 500, "observedAt": TIME, "expiresAt": "2026-09-11T09:00:30Z"}),
        server({"kind": "warning", "warningType": "battery", "memberId": identity(4), "batteryPercent": 19, "thresholdPercent": 20, "observedAt": TIME, "expiresAt": "2026-09-11T09:00:30Z"}),
    ]
    for example in valid:
        VALIDATOR.validate(example)

    invalid = []

    def changed(index, path, value):
        example = deepcopy(valid[index])
        target = example
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        invalid.append(example)

    changed(0, ["payload", "position", "lat"], 91)
    changed(0, ["payload", "position", "lon"], -181)
    changed(0, ["payload", "position", "accuracyM"], -1)
    changed(0, ["payload", "consentEpoch"], 0)
    changed(0, ["payload", "headingDegrees"], 360)
    changed(0, ["payload", "batteryPercent"], 101)
    changed(0, ["capturedAt"], "2026-02-30T09:00:00Z")
    changed(0, ["id"], "not-a-uuid")
    changed(0, ["v"], 2)
    changed(0, ["actorId"], identity(99))
    changed(1, ["payload", "text"], " " * 3)
    changed(1, ["payload", "text"], "x" * 1001)
    changed(1, ["payload", "motion", "state"], "moving")
    changed(1, ["payload", "motion", "source"], "unavailable")
    changed(2, ["payload", "preset"], "invented_alert")
    changed(5, ["payload", "kind"], "automatic_dispatch")
    changed(8, ["payload", "reason"], "")
    changed(9, ["sequence"], 0)
    changed(9, ["status"], "everyone_notified")
    changed(10, ["sequence"], 1)
    changed(13, ["payload", "pairSnapshot"], {"contactPhone": "+910000000000"})
    for example in invalid:
        assert not VALIDATOR.is_valid(example), f"Invalid event accepted: {example}"

    public = {
        "displayName": "Example owner", "rideState": "active", "lastPosition": POSITION,
        "sosState": "none", "servedAt": TIME, "leaseExpiresAt": "2026-09-11T09:00:15Z",
        "linkExpiresAt": "2026-09-11T13:00:00Z",
    }
    PUBLIC.validate(public)
    no_position = {**public, "lastPosition": None}
    PUBLIC.validate(no_position)
    for private_key in ("rideId", "members", "pairSnapshot", "emergencyContact", "chat", "photos", "token"):
        assert not PUBLIC.is_valid({**public, private_key: "must not be exposed"})
    assert not PUBLIC.is_valid({**public, "rideState": "ended"})
    print(f"PASS: {len(valid)} accepted and {len(invalid)} rejected v1 event examples.")
    print("PASS: 2 owner-status examples and 8 denied private/ended projections.")

    refs = 0

    def visit(node):
        nonlocal refs
        if isinstance(node, dict):
            if "$ref" in node:
                reference = node["$ref"]
                assert reference.startswith("#/"), "External schema reference requires explicit resolution"
                target = SCHEMA
                for segment in reference[2:].split("/"):
                    target = target[segment.replace("~1", "/").replace("~0", "~")]
                refs += 1
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(SCHEMA)
    links = 0
    for document in FOLDER.glob("*.md"):
        contents = document.read_text()
        columns = None
        for line in contents.splitlines():
            assert not line.startswith(r"\|---"), f"Escaped table separator: {document.name}"
            if line.startswith("|"):
                width = len(re.split(r"(?<!\\)\|", line)) - 2
                if columns is None:
                    columns = width
                assert width == columns, f"Inconsistent table columns: {document.name}"
            else:
                columns = None
        for link in re.findall(r"\[[^\]]*\]\(([^)]+)\)", contents):
            if re.match(r"[a-z]+://", link) or link.startswith("#"):
                continue
            target = document.parent / link.split("#", 1)[0]
            assert target.exists(), f"Broken link {document.name}: {link}"
            links += 1
    print(f"PASS: Draft 2020-12 schema, {refs} internal references, {links} local document links and Markdown tables.")


if __name__ == "__main__":
    main()
