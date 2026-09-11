"use strict";
// Local design fixtures only. No network, storage, device APIs, or emergency actions.
const screens = [
  [
    "signin",
    "Sign in",
    "Before the ride",
    "Verified account access",
    ["default", "error", "unverified"],
  ],
  [
    "home",
    "Home",
    "Before the ride",
    "Create, join, or resume a ride",
    ["default", "active", "empty"],
  ],
  [
    "create",
    "Create ride",
    "Before the ride",
    "Name the ride and select transport",
    ["default", "invalid"],
  ],
  [
    "join",
    "Join a group",
    "Before the ride",
    "Explicit join with a chosen role",
    ["default", "active", "expired", "full"],
  ],
  [
    "lobby",
    "Ride lobby",
    "Before the ride",
    "Prepare the group before departure",
    ["default", "ready"],
  ],
  [
    "route",
    "Plan route",
    "Before the ride",
    "Leader route preparation",
    ["default", "invalid", "unavailable"],
  ],
  [
    "pair",
    "Pair a pillion",
    "Ride together",
    "Scan and consent on both devices",
    ["default", "consented", "expired"],
  ],
  [
    "checkin",
    "Safety check-in",
    "Ride together",
    "Member-confirmed readiness",
    ["default", "ready"],
  ],
  [
    "map",
    "Live ride",
    "Ride together",
    "Location, presets, and SOS within reach",
    ["default", "stale", "unavailable", "not-sharing"],
  ],
  [
    "chat",
    "Group chat",
    "Ride together",
    "Read, send presets, and compose while stopped",
    ["default", "compose", "empty"],
  ],
  [
    "headcount",
    "Rest-stop headcount",
    "Ride together",
    "Fresh confirmation round for every stop",
    ["default", "complete"],
  ],
  [
    "sos",
    "Group SOS",
    "Safety and sharing",
    "Honest delivery state and resolution",
    [
      "default",
      "sending",
      "accepted",
      "unconfirmed",
      "offline",
      "aged",
      "resolved",
    ],
  ],
  [
    "crash",
    "Possible impact",
    "Safety and sharing",
    "Conditional detector check-in",
    ["default", "disabled"],
  ],
  [
    "share",
    "Share my status",
    "Safety and sharing",
    "Explicit, limited personal sharing",
    ["default", "created", "revoked"],
  ],
  [
    "external",
    "Status link viewer",
    "Safety and sharing",
    "Read-only owner status in a browser",
    ["default", "expired", "lease-expired"],
  ],
  [
    "permissions",
    "Permissions",
    "Safety and sharing",
    "Contextual permission recovery",
    ["default", "denied"],
  ],
  [
    "contacts",
    "My emergency contact",
    "Safety and sharing",
    "Private account-owned contact",
    ["default", "invalid"],
  ],
  [
    "end",
    "End ride",
    "After the ride",
    "Leader-controlled end and pending state",
    ["default", "pending"],
  ],
  [
    "summary",
    "Ride summary",
    "After the ride",
    "Your recorded route and participation",
    ["default", "gap", "zero"],
  ],
  [
    "history",
    "Ride history",
    "After the ride",
    "Past rides within beta retention",
    ["default", "empty"],
  ],
];
const notes = {
  map: [
    "Paired marker uses the rider position.",
    "Unknown speed keeps composition restricted.",
    "No advertising during an active ride.",
  ],
  sos: [
    "SOS sends in one tap; this screen is the result.",
    "Server acceptance is not recipient acknowledgement.",
    "No external emergency dispatch.",
  ],
  crash: [
    "Experimental and off by default in the beta.",
    "No countdown or unattended escalation.",
  ],
  share: [
    "Only your own status is shared.",
    "Anyone holding the link can view it until expiry.",
  ],
  external: [
    "No group, pairing, chat, contact, or history access.",
    "Clear content when the display lease cannot renew.",
  ],
  pair: [
    "Both people consent to pairing.",
    "Either person may unpair while stationary.",
  ],
  checkin: [
    "A human attestation, not verified helmet safety.",
    "A leader cannot attest for another member.",
  ],
  headcount: [
    "Each stop creates a new round.",
    "Old confirmations never carry forward.",
  ],
};
const references = {
  map: "FR-LOC-01–05 · FR-COM-02 · FR-SAF-01",
  sos: "FR-SAF-01/03 · D02",
  crash: "FR-SAF-02/03 · D02",
  share: "FR-SAF-04 · D06",
  external: "FR-SAF-04 · D06",
  pair: "FR-PIL-01/02 · D05",
  checkin: "FR-PIL-03 · D04",
  headcount: "FR-PIL-04 · D04",
  chat: "FR-COM-01–04 · FR-PIL-05",
  end: "FR-GRP-05 · D04",
  summary: "FR-SUM-01/02",
  history: "FR-SUM-03",
  contacts: "FR-PIL-06 · D06",
};
const state = {
  screen: "home",
  role: "leader",
  network: "online",
  movement: "stopped",
  scenario: "default",
  mode: "light",
  active: false,
  paired: false,
  ready: false,
  sharing: true,
  link: false,
  transport: "motorcycle",
  lifetime: "4 hours",
  sosStatus: null,
  pendingOkay: false,
  feedback: "",
};
const $ = (id) => document.getElementById(id);
const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${{ back: "M15 5l-7 7 7 7", map: "M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5zM9 3v16M15 5v16", chat: "M4 4h16v12H9l-5 4V4zM8 8h8M8 12h5", alert: "M12 3L2 21h20L12 3zM12 9v5M12 17v1", check: "M5 12l4 4L19 6", plus: "M12 5v14M5 12h14", people: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-3a6 6 0 0 1 12 0v3M17 4a4 4 0 0 1 0 8M17 15a5 5 0 0 1 5 5", home: "M3 10l9-7 9 7M5 9v12h14V9M10 21v-7h4v7", pause: "M8 5v14M16 5v14", route: "M5 4v12a4 4 0 0 0 8 0V8a3 3 0 0 1 6 0v12", share: "M12 16V3M7 8l5-5 5 5M5 13v8h14v-8", camera: "M3 7h5l2-3h4l2 3h5v14H3V7zM16 13a4 4 0 1 0-8 0 4 4 0 0 0 8 0", clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l4 2", pin: "M12 22s8-8 8-13a8 8 0 0 0-16 0c0 5 8 13 8 13zM15 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0", settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" }[name] || "M5 12h14"}"/></svg>`;
const button = (label, action, kind = "", disabled = false) =>
  `<button type="button" class="btn ${kind}" data-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
const go = (label, key, kind = "secondary", disabled = false) =>
  button(label, `go:${key}`, kind, disabled);
const notice = (text, kind = "") => `<div class="notice ${kind}">${text}</div>`;
const chip = (text, kind = "") => `<span class="chip ${kind}">${text}</span>`;
const stopped = () => state.movement === "stopped";
const restriction = () =>
  !stopped()
    ? notice(
        state.movement === "unknown"
          ? "Speed unavailable. Stop before typing, recording, or scanning."
          : "Riding mode. Stop before typing, recording, or scanning.",
        "warning",
      )
    : "";
const person = (initials, name, detail, status = "") =>
  `<div class="person"><span class="avatar">${initials}</span><div class="grow"><strong>${name}</strong><p>${detail}</p></div>${status}</div>`;
const field = (label, name, value = "", type = "text") =>
  `<label class="field">${label}<input name="${name}" type="${type}" value="${escapeHTML(value)}" autocomplete="off" required></label>`;
const submit = (label) => `<button class="btn" type="submit">${label}</button>`;
const safeName = () => (state.role === "pillion" ? "Asha" : "Om");
const locationLabel = () =>
  !state.sharing || state.scenario === "not-sharing"
    ? "Location unavailable"
    : state.network === "offline" || state.scenario === "stale"
      ? "Last position · 55s ago"
      : "Updated 2s ago";
function mapArt(preview = false, ownerOnly = false) {
  return `<div class="map-wrap ${preview ? "preview" : ""}"><svg class="map-art" viewBox="0 0 350 370" role="img" aria-label="Illustrative countryside route${ownerOnly ? " showing only the sharing owner" : ""}"><path class="water" d="M190 0l-20 40 35 43-30 49 33 51-15 55 46 27-5 65 38 40h78V0z"/><path class="road-edge" d="M-20 80L140 110 175 60 345 110M20 390L65 280 40 190 110 105 80-20M70 270L180 255 350 310"/><path class="road" d="M-20 80L140 110 175 60 345 110M20 390L65 280 40 190 110 105 80-20M70 270L180 255 350 310"/><path class="route-line" d="M70 260L54 193 100 146 112 83 172 67 215 115 188 167 218 225 175 286 107 304 70 260z"/><text class="place" x="20" y="131">PIRANGUT</text><text class="place" x="234" y="200">MULSHI</text><text class="place" x="234" y="216">RESERVOIR</text><text class="place" x="14" y="335">PUNE</text>${state.sharing || (preview && !ownerOnly) ? `<circle class="marker" cx="70" cy="260" r="12"/><rect class="marker-label" x="84" y="245" width="${ownerOnly ? 60 : 93}" height="29" rx="8"/><text x="94" y="264">${ownerOnly ? safeName() : "Om + Asha"}</text>` : ""}${ownerOnly ? "" : `<circle class="marker" cx="172" cy="67" r="9"/><rect class="marker-label" x="184" y="50" width="120" height="28" rx="8"/><text x="193" y="69">Ravi + Meera</text><circle class="marker" cx="175" cy="286" r="9"/><rect class="marker-label" x="190" y="275" width="65" height="28" rx="8"/><text x="200" y="294">Neha</text>`}</svg><span class="map-legend">Illustrative map</span></div>`;
}
function presets() {
  const items =
    state.role === "pillion"
      ? ["Need a stop", "Uncomfortable pace", "Cold/Tired"]
      : ["Stopping", "Flat tire", "Regrouping", "Turn missed", "Car back"];
  return `<div class="preset-grid">${items.map((x) => button(escapeHTML(x), `preset:${x}`, "soft")).join("")}</div>`;
}
function navigation() {
  return `<nav class="bottom-nav" aria-label="App navigation">${[
    ["home", "Home", "home"],
    ["history", "Rides", "route"],
    ["contacts", "Profile", "people"],
  ]
    .map(
      ([key, label, ico]) =>
        `<button type="button" data-action="go:${key}" ${state.screen === key ? 'aria-current="page"' : ""}>${icon(ico)}${label}</button>`,
    )
    .join("")}</nav>`;
}
function denied(text) {
  return `<div class="big-state">${icon("people")}</div><h3 class="center">Available to the ride leader</h3><p class="muted center">${text}</p>${go("Back to ride", state.active ? "map" : "lobby")}`;
}
function contents() {
  const s = state.scenario;
  switch (state.screen) {
    case "signin":
      return `<h3>Welcome back.</h3><p class="lead">Your next ride starts here.</p><form data-form="signin">${field("Email", "email", "rider@example.test", "email")}${field("Password", "password", "", "password")}${submit("Sign in")}</form>${s === "error" ? notice("Email or password not recognised. Try again.", "danger") : ""}${s === "unverified" ? notice("Check your email to verify your account before joining.", "warning") : ""}${button("Send password reset", "feedback:Reset email request preview. No email is sent.", "secondary")}<p class="small muted">Coordinate your ride. Follow local traffic rules and ride safely.</p>`;
    case "home":
      return `<p class="kicker">Morning, ${safeName()}</p><h3>${state.active ? "Your group is riding." : "Where are we riding?"}</h3><div class="card"><div class="row between"><h4>Sunday Loop</h4>${chip(state.active ? "Active ride" : "Tomorrow")}</div><p class="small muted">Pune · Motorcycle · 8 members</p>${mapArt(true)}${go(state.active ? "Resume ride" : "Create a ride", state.active ? "map" : "create", "")}</div>${!state.active ? go("Join with code or QR", "join") : ""}<h4>Recent rides</h4>${s === "empty" ? notice("Your completed rides will appear here.") : person("42", "Lakeside ride", "42.6 km · Your recorded distance")}${go("View ride history", "history")}${!state.active ? '<div class="sponsored"><span class="kicker">Sponsored</span><strong>Local ride essentials</strong><p>Example native placement.</p></div>' : ""}`;
    case "create":
      return `<h3>Bring your group together.</h3><form data-form="create">${field("Ride name", "rideName", "Sunday Loop")}<label class="field">Ride type<select name="transport"><option value="motorcycle">Motorcycle</option><option value="cycling">Cycling</option><option value="car">Car</option></select></label><p class="small muted">You’ll be the ride leader. Add a route and invite members in the lobby.</p>${s === "invalid" ? notice("Enter a ride name between 1 and 80 characters.", "danger") : ""}${submit("Create ride")}</form>`;
    case "join":
      return `<h3>Find your group.</h3><form data-form="join">${field("Ride code", "code", "RIDR24")}${button("Scan invite QR", "go:permissions", "secondary", !stopped())}<label class="field">Join as<select name="joinRole"><option value="rider">Rider</option><option value="pillion">Pillion</option></select></label>${["expired", "full"].includes(s) ? notice(s === "expired" ? "This invite has expired. Ask the leader for a new code." : "This ride has reached 50 members.", "danger") : '<div class="card soft"><h4>Sunday Loop</h4><p class="small">Om leads · Motorcycle</p><p class="small muted">Joining never starts location sharing automatically.</p></div>'}${submit(s === "active" ? "Join active ride" : "Join ride")}</form>`;
    case "lobby":
      return `<div class="row between"><h3>Sunday Loop</h3>${chip("Before departure")}</div><p class="small muted">Motorcycle · 8 members · Code RIDR24</p>${person("OM", "Om", "Ride leader", chip("You"))}${person("RA", "Ravi + Meera", "Paired unit", chip(state.ready ? "Ready" : "Pending", state.ready ? "" : "warning"))}${person("NE", "Neha", "Solo rider", chip("Joined"))}<div class="stack">${go(state.role === "leader" ? "Plan or import route" : "View planned route", "route")}${go("Pair with rider / pillion", "pair", "secondary", !stopped())}${go("My safety check-in", "checkin", "secondary", !stopped())}${state.role === "leader" ? button("Start ride", "start", "", !state.ready) : notice("Waiting for the leader to start.")}</div>${!state.ready ? notice("One pair still needs to confirm readiness. The leader cannot confirm for them.", "warning") : ""}`;
    case "route":
      return `${mapArt(true)}<div class="metric-grid"><div><strong>64.2<small>km</small></strong><span>Planned route</span></div><div><strong>Loop</strong><span>Route shape</span></div></div>${s === "invalid" ? notice("GPX could not be read. Your saved route is unchanged.", "danger") : ""}${s === "unavailable" ? notice("Route service unavailable. Try again when connected.", "warning") : ""}${state.role === "leader" && !state.active ? `${restriction()}<div class="two-col">${button("Import GPX", "feedback:Sample GPX selected. Actual file import is a later feature.", "secondary", !stopped())}${button("Draw route", "feedback:Route drawing interaction is specified in journeys.md.", "secondary", !stopped())}</div><p class="small muted">GPX only · Up to 5 MB / 10,000 points</p>${go("Save route and return", "lobby", "", !stopped())}` : notice("Route editing is available to the leader before departure.")} `;
    case "pair":
      return `${restriction()}<h3>One bike. Two people.</h3><p class="muted">Pair with someone in this motorcycle ride.</p>${state.transport !== "motorcycle" ? notice("Pillion pairing is only available for motorcycle rides.", "warning") : ""}<div class="qr-panel"><svg class="qr" viewBox="0 0 100 100" role="img" aria-label="Illustrative non-scannable pairing QR"><path fill="currentColor" d="M0 0h35v35H0zM65 0h35v35H65zM0 65h35v35H0zM45 0h10v20H45zM45 30h15v25H45zM70 45h30v10H70zM45 65h10v35H45zM65 65h15v15H65zM85 85h15v15H85z"/><path fill="white" d="M7 7h21v21H7zM72 7h21v21H72zM7 72h21v21H7z"/><path fill="currentColor" d="M12 12h11v11H12zM77 12h11v11H77zM12 77h11v11H12z"/></svg><p>Sample pairing code · Expires in 5 minutes</p></div>${s === "expired" ? notice("This pairing code expired. Request a new code.", "warning") : person(state.role === "pillion" ? "OM" : "AS", state.role === "pillion" ? "Om · Rider" : "Asha · Pillion", s === "consented" ? "Counterpart consent received" : "Waiting for counterpart consent")}${button("Confirm my pairing", "pair", "", !stopped() || s !== "consented" || state.transport !== "motorcycle")}${button("Scan counterpart code", "feedback:Sample scan preview. Both participants must consent.", "secondary", !stopped())}${state.paired ? button("Unpair", "unpair", "danger-outline", !stopped()) : ""}`;
    case "checkin":
      return `${restriction()}<h3>Ready for the road?</h3><p class="muted">Confirm your own readiness before departure.</p>${person("OA", "Om + Asha", "Motorcycle pair", chip(state.ready ? "Ready" : "Pending", state.ready ? "" : "warning"))}${state.role === "pillion" ? `<form data-form="checkin"><label class="check-row"><input name="helmet" type="checkbox" required ${state.ready ? "checked" : ""} ${!stopped() ? "disabled" : ""}>I have my helmet on</label><label class="check-row"><input name="ready" type="checkbox" required ${state.ready ? "checked" : ""} ${!stopped() ? "disabled" : ""}>I am ready to ride</label><p class="small muted">Confirmed by you. This is a member attestation, not a safety inspection.</p><button class="btn" type="submit" ${!stopped() ? "disabled" : ""}>Confirm readiness</button></form>` : notice(state.ready ? "Asha confirmed helmet and readiness." : "Waiting for Asha to confirm helmet and readiness. You cannot confirm for another member.", "warning")}${go("Back to ride", state.active ? "map" : "lobby")}`;
    case "map":
      return `${s === "unavailable" ? `<div class="app-body"><div class="big-state">${icon("map")}</div><h3>Map unavailable</h3><p>Group alerts and SOS are still available.</p></div>` : mapArt()}<div class="ride-tray"><div class="row between"><span class="small muted">${locationLabel()}</span>${chip(state.movement === "stopped" ? "Stopped" : "Riding mode")}</div><div class="metric-grid"><div><strong>${state.movement === "unknown" || state.network === "offline" || !state.sharing ? "—" : state.movement === "moving" ? "32" : "0"}<small>km/h</small></strong><span>Your speed</span></div><div><strong>${s === "stale" || state.network === "offline" || !state.sharing ? "—" : "120"}<small>m</small></strong><span>${s === "stale" || state.network === "offline" || !state.sharing ? "Order unavailable" : "Rider ahead"}</span></div><div><strong>${s === "stale" || state.network === "offline" || !state.sharing ? "—" : "85"}<small>m</small></strong><span>Rider behind</span></div></div><div class="quick-actions">${button(icon("pause") + (state.role === "pillion" ? "Need a stop" : "Stopping"), "preset:" + (state.role === "pillion" ? "Need a stop" : "Stopping"), "soft")}${button(icon("people") + "Regroup", "preset:Regrouping", "soft")}${go(icon("chat") + "Chat", "chat", "soft")}${button(icon("alert") + "SOS", "sos", "danger")}</div><div class="more-presets">${(state.role === "pillion" ? ["Uncomfortable pace", "Cold/Tired"] : ["Flat tire", "Turn missed", "Car back"]).map((x) => button(x, "preset:" + x, "soft")).join("")}</div>${state.sosStatus && state.sosStatus !== "resolved" ? button(state.pendingOkay ? "SOS active · Okay update pending" : "SOS · " + state.sosStatus, "open-sos", "danger-outline") : ""}${!state.sharing ? button("Location off · Review permissions", "enable-location", "secondary") : ""}${go("Ride options & sharing", "share", "secondary")}</div>`;
    case "chat":
      return `<div class="map-strip">${icon("map")}<div class="grow"><strong class="small">Sunday Loop</strong><p>${locationLabel()}</p></div>${go("Map", "map", "secondary")}</div>${s === "empty" ? notice("No messages yet. Send a preset to your group.") : '<div class="message"><div class="byline">NEHA · 9:38</div>Regroup at the next water stop.</div><div class="message own"><div class="byline">OM · 9:39</div>Stopping <span class="small muted">· Accepted by server</span></div>'}${restriction()}${presets()}${stopped() ? (state.role !== "pillion" || s === "compose" ? `<form data-form="chat"><label class="field">Message<textarea name="message" maxlength="1000" required placeholder="Write to your group"></textarea></label>${submit("Send message")}</form><div class="two-col">${button("Voice note", "feedback:Voice note preview · Maximum 30 seconds. No microphone is opened.", "secondary")}${button("Pin a place", "feedback:Choose a map point while stationary. No real location is used.", "secondary")}</div>` : button("Write message", "compose", "secondary")) : notice("Typing, voice recording, and pin creation are available when stopped.")}`;
    case "headcount":
      return state.role !== "leader"
        ? denied("Only the leader can open a group headcount round.")
        : `${restriction()}<h3>Everyone back?</h3><p class="muted">Rest-stop headcount · Round 2</p><div class="card soft"><h3>${s === "complete" ? "2 of 2" : "0 of 2"}</h3><p>Current pairs confirmed</p></div>${person("OA", "Om + Asha", "Current pair", chip(s === "complete" ? "Confirmed" : "Pending", s === "complete" ? "" : "warning"))}${person("RM", "Ravi + Meera", "Current pair", chip(s === "complete" ? "Confirmed" : "Pending", s === "complete" ? "" : "warning"))}<div class="stack">${button("Scan next pair", "feedback:Fresh scan required for each pair. Preview the Complete state using the review control.", "secondary", !stopped())}${button("Start a fresh round", "fresh-round", "secondary", !stopped())}${go("Complete headcount", "map", "", !stopped() || s !== "complete" || state.network !== "online")}</div><p class="small muted">Confirmations from earlier stops do not count.</p>`;
    case "sos": {
      const status =
        s === "default"
          ? state.network === "offline"
            ? "offline"
            : state.network === "uncertain"
              ? "unconfirmed"
              : "accepted"
          : s;
      const copy = {
        sending: "Sending",
        accepted: "Accepted by server",
        unconfirmed: "Delivery unconfirmed",
        offline: "Not sent — offline",
        aged: "Still need help?",
        resolved: "You reported okay",
      };
      return `<div class="big-state alert">${icon("alert")}</div><h3 class="center">${status === "resolved" ? "Status updated" : "Group SOS"}</h3><p class="sos-status center">${copy[status] || copy.accepted}</p><p class="center muted">${state.paired ? "Om + Asha may need assistance" : safeName() + " requested assistance"}</p><div class="card"><p><strong>Reported by ${safeName()}</strong></p><p class="small muted">${locationLabel()}</p><p class="small">${status === "accepted" ? "Recipient acknowledgements pending." : status === "unconfirmed" ? "The server may have received your alert. Its status will be checked before retrying." : status === "offline" ? "Your alert has not left this device." : status === "resolved" ? "The original request stays in the event history." : "Delivery status remains visible here."}</p></div>${status === "aged" ? button("Yes, help is still needed", "retry-sos", "danger") : ""}<div class="stack">${button("I'm okay", "resolve-sos", "secondary")}${go("Return to map", "map")}</div><p class="small center muted">Group alert only. No emergency services or saved contacts are called.</p>`;
    }
    case "crash":
      return s === "disabled"
        ? `<div class="big-state">${icon("check")}</div><h3>Crash detection is off</h3><p class="muted">Experimental detection is not enabled in the ordinary beta flow. Manual SOS remains available.</p>${go("Return to map", "map")}`
        : `<div class="big-state warning">${icon("alert")}</div><h3 class="center">Are you okay?</h3><p class="lead center">Possible impact detected.</p><p class="center muted">Please confirm your status.</p><div class="stack">${button("I'm okay", "dismiss-crash")}${button("Send group SOS", "crash-sos", "danger")}</div><p class="small center muted">No automatic escalation or emergency-service dispatch.</p>`;
    case "share":
      return `<h3>Your status. Your choice.</h3><p class="muted">Share only your location and ride status.</p>${notice("Anyone with this link can view your status until it expires.")}<label class="field">Link lifetime<select id="lifetime">${["1 hour", "4 hours", "8 hours", "24 hours"].map((x) => `<option ${x === state.lifetime ? "selected" : ""}>${x}</option>`).join("")}</select></label>${state.link ? notice("Status link created · Ends in " + state.lifetime + " or earlier when revoked / ride ends.") : s === "revoked" ? notice("Link revoked. No new viewer access.") : notice("Sharing link is off.")}<div class="stack">${button(state.link ? "Revoke status link" : "Create status link", state.link ? "revoke-link" : "create-link", "", !state.sharing && !state.link)}${state.link ? go("Preview status link", "external") : ""}${button(state.sharing ? "Stop my location sharing" : "Location sharing stopped", "stop-sharing", "secondary", !state.sharing)}${state.role === "leader" ? go("Rest-stop headcount", "headcount", "secondary", !stopped()) : go("My pairing", "pair", "secondary", !stopped())}${state.role === "leader" ? go("End ride for everyone", "end", "danger-outline") : button("Leave ride", "leave", "danger-outline")}</div><p class="small muted">Stopping location sharing keeps your group membership, chat, presets, and SOS.</p>`;
    case "external":
      return ["expired", "lease-expired"].includes(s) ||
        state.network === "offline"
        ? `<div class="big-state">${icon("clock")}</div><h3 class="center">${s === "expired" ? "This link has expired" : "Live status unavailable"}</h3><p class="center muted">${s === "expired" ? "Ask the owner for a new status link." : "Connection lost. Live details are hidden until access can be renewed."}</p>`
        : `<h3>${safeName()}'s ride status</h3><p class="small muted">Read-only shared status</p>${state.sharing ? mapArt(true, true) : notice("Location unavailable. No current position is shared.")}<div class="card"><h4>Ride in progress</h4><p>${locationLabel()}</p><p class="small muted">You can only see the status this person shared.</p></div>`;
    case "permissions":
      return `<h3>Stay connected on the ride.</h3><p class="muted">Choose the permissions you’re comfortable sharing.</p>${person("GPS", "Location", "Required to share your position", chip(s === "denied" ? "Denied" : "Ask when needed", s === "denied" ? "warning" : ""))}${person("QR", "Camera", "For invite and pillion QR scans")}${person("MIC", "Microphone", "For stationary voice notes")}${person("SOS", "Notifications", "For background group alerts")}<div class="stack">${button(s === "denied" ? "Open device settings" : "Review permissions", "feedback:Permission flow preview. No device settings or permission requests are opened.", "secondary")}${button("Share my location", "allow-location", "", s === "denied")}${button("Continue without location", "without-location", "secondary")}</div><p class="small muted">Without GPS, your position is unavailable. Presets and manual SOS remain accessible.</p>`;
    case "contacts":
      return `<h3>My emergency contact</h3><p class="muted">Private to your account. Pairing does not share this record.</p><form data-form="contact">${field("Contact name", "name", "Sam")}${field("Phone number", "phone", "+910000000000", "tel")}${s === "invalid" ? notice("Enter a phone number with its country code.", "danger") : ""}${submit("Save contact")}</form>${button("Remove contact", "feedback:Sample contact removed. No account data was changed.", "danger-outline")}<p class="small muted">Saving does not call, message, or invite this person.</p>${go("Permission settings", "permissions")}`;
    case "end":
      return state.role !== "leader"
        ? denied(
            "Members can leave their own ride; only the leader can end it for everyone.",
          )
        : `<div class="big-state">${icon("route")}</div><h3>End Sunday Loop?</h3><p class="muted">This ends the session for everyone, stops tracking as devices receive the update, and expires sharing links.</p>${s === "pending" ? notice("End pending — other members may still be active. Your local tracking has stopped.", "warning") : ""}<div class="stack">${button("End ride for everyone", "end-ride", "danger")}${go("Keep riding", "map", "secondary")}</div>`;
    case "summary":
      return `<p class="kicker">Sunday Loop · Ride complete</p><h3>Your ride, recorded.</h3>${mapArt(true)}<div class="metric-grid"><div><strong>${s === "zero" ? "0" : "64.2"}</strong><span>Your distance · km</span></div><div><strong>3:12</strong><span>Participation · h:m</span></div><div><strong>${s === "zero" ? "—" : "2:59"}</strong><span>Elapsed pace · /km</span></div></div>${s === "gap" ? notice("Tracking gap · 10 minutes. Your recorded distance may be incomplete.", "warning") : notice("Your recorded route · Stops included in elapsed time.")}<h4>Ride moments</h4>${restriction()}${button("Attach a route photo", "feedback:Photo attachment preview. A route point and validated photo are required.", "secondary", !stopped())}${go("View ride history", "history")}<p class="small muted">History available for 90 days in the beta.</p>`;
    case "history":
      return `<h3>Your past rides.</h3><p class="muted">The routes you’ve shared.</p>${s === "empty" ? `<div class="big-state">${icon("route")}</div><p class="center muted">Complete your first ride to see it here.</p>` : `<div class="card">${mapArt(true)}<h4>Sunday Loop</h4><p class="small muted">64.2 km · Your recorded distance</p>${go("Open summary", "summary")}</div>${person("42", "Lakeside ride", "42.6 km · 8 members")}`}<p class="small muted">Participated rides only · 90-day beta retention</p>`;
    default:
      return "";
  }
}
function render(focus = false) {
  const info = screens.find((x) => x[0] === state.screen);
  $("phone").dataset.mode = state.mode;
  $("screen-number").textContent =
    String(screens.indexOf(info) + 1).padStart(2, "0") + " / 20";
  $("inspector-title").textContent = info[1];
  $("screen-purpose").textContent = info[3];
  $("screen-notes").innerHTML = (
    notes[state.screen] || [
      "Keep role and movement restrictions visible.",
      "Use the scenario controls to review exceptional states.",
    ]
  )
    .map((x) => `<li>${x}</li>`)
    .join("");
  $("screen-reference").textContent =
    references[state.screen] || "Day 1 scope · SUP-06";
  $("scenario").innerHTML = info[4]
    .map(
      (x) =>
        `<option value="${x}" ${x === state.scenario ? "selected" : ""}>${x.replaceAll("-", " ")}</option>`,
    )
    .join("");
  let last = "";
  $("screen-nav").innerHTML = screens
    .map((x, i) => {
      const group = x[2] !== last ? `<p class="nav-group">${x[2]}</p>` : "";
      last = x[2];
      return (
        group +
        `<button type="button" class="nav-item" data-screen="${x[0]}" ${x[0] === state.screen ? 'aria-current="page"' : ""}><span class="number">${String(i + 1).padStart(2, "0")}</span>${x[1]}</button>`
      );
    })
    .join("");
  const safety =
    state.active && !["sos", "crash", "external"].includes(state.screen);
  $("screen").innerHTML =
    `<header class="app-header">${["home", "external"].includes(state.screen) ? '<span class="app-logo">Ridr</span>' : `<button class="icon-btn" type="button" data-action="go:${state.active ? "map" : "home"}" aria-label="${state.active ? "Return to map" : "Return home"}">${icon("back")}</button>`}<div class="heading"><h2 id="screen-title" tabindex="-1" ${state.screen === "home" ? 'class="sr-only"' : ""}>${info[1]}</h2><p>${state.screen === "external" ? "Shared personal status" : state.screen === "signin" ? "" : state.role === "leader" ? "Ride leader" : state.role === "pillion" ? "Pillion" : "Rider"}</p></div>${safety ? `<button class="icon-btn danger" type="button" data-action="sos" aria-label="Send group SOS">${icon("alert")}</button>` : ""}</header><div class="app-body ${state.screen === "map" ? "map-body" : ""}">${contents()}</div>${state.feedback ? `<div class="inline-feedback" role="status">${escapeHTML(state.feedback)}</div>` : ""}${["home", "history", "contacts"].includes(state.screen) ? navigation() : ""}`;
  document.querySelectorAll("[data-mode]").forEach((el) => {
    if (el.tagName === "BUTTON")
      el.setAttribute("aria-pressed", String(el.dataset.mode === state.mode));
  });
  $("role").value = state.role;
  if (focus) $("screen-title").focus({ preventScroll: true });
}
function feedback(text) {
  state.feedback = text;
  render();
  $("announcement").textContent = text;
}
function navigate(key, fixture = false) {
  state.screen = key;
  state.scenario = "default";
  state.feedback = "";
  if (fixture) {
    state.sosStatus = null;
    state.pendingOkay = false;
    state.transport = "motorcycle";
    state.active = [
      "map",
      "chat",
      "headcount",
      "sos",
      "crash",
      "share",
      "external",
      "end",
    ].includes(key);
    state.paired = ["map", "sos", "crash", "checkin", "headcount"].includes(
      key,
    );
    state.ready = false;
    state.sharing = true;
    state.link = false;
    if (key === "crash") state.scenario = "disabled";
    if (key === "sos") state.sosStatus = "accepted";
    if (key === "map") state.paired = true;
  }
  render(true);
}
function sendSOS() {
  state.active = true;
  state.screen = "sos";
  state.scenario =
    state.network === "offline"
      ? "offline"
      : state.network === "uncertain"
        ? "unconfirmed"
        : "accepted";
  state.sosStatus = state.scenario;
  state.pendingOkay = false;
  state.feedback = "";
  render(true);
}
function act(action) {
  if (action.startsWith("go:")) {
    navigate(action.slice(3));
    return;
  }
  if (action.startsWith("feedback:")) {
    feedback(action.slice(9));
    return;
  }
  if (action.startsWith("preset:")) {
    feedback(
      action.slice(7) +
        " · " +
        (state.network === "offline"
          ? "Queued — offline"
          : state.network === "uncertain"
            ? "Delivery unconfirmed"
            : "Accepted by server · Recipient delivery pending"),
    );
    return;
  }
  switch (action) {
    case "sos":
    case "crash-sos":
    case "retry-sos":
      sendSOS();
      break;
    case "open-sos":
      state.screen = "sos";
      state.scenario = state.sosStatus || "default";
      render(true);
      break;
    case "start":
      if (state.role !== "leader" || !state.ready) return;
      if (state.network !== "online") {
        feedback("Start pending. The group is not yet confirmed active.");
        return;
      }
      state.active = true;
      state.sharing = false;
      navigate("permissions");
      break;
    case "pair":
      if (
        !stopped() ||
        state.scenario !== "consented" ||
        state.transport !== "motorcycle"
      )
        return;
      if (state.network !== "online") {
        feedback(
          "Pairing confirmation pending. The pair is not yet confirmed.",
        );
        return;
      }
      state.paired = true;
      state.ready = false;
      navigate("checkin");
      break;
    case "unpair":
      if (!stopped()) return;
      state.paired = false;
      state.ready = false;
      feedback("Unpaired. Both members return to individual markers.");
      break;
    case "compose":
      if (!stopped()) return;
      state.scenario = "compose";
      render();
      break;
    case "fresh-round":
      if (!stopped() || state.role !== "leader") return;
      state.scenario = "default";
      render();
      break;
    case "resolve-sos":
      state.pendingOkay = state.network !== "online";
      if (!state.pendingOkay) {
        state.scenario = "resolved";
        state.sosStatus = "resolved";
      }
      feedback(
        state.network === "online"
          ? "Your okay update was accepted. The original request remains."
          : "Okay update pending. Other members may still see your SOS.",
      );
      break;
    case "dismiss-crash":
      navigate("map");
      feedback("Impact prompt dismissed. No SOS sent.");
      break;
    case "create-link":
      if (!state.sharing) {
        feedback("Turn on location sharing before creating a status link.");
        return;
      }
      state.lifetime = $("lifetime").value;
      if (state.network !== "online") {
        feedback("Link creation is not confirmed. Try again when connected.");
        return;
      }
      state.link = true;
      render();
      break;
    case "revoke-link":
      if (state.network !== "online") {
        feedback(
          "Revocation pending — your previous status may remain visible until connected or the link expires.",
        );
        return;
      }
      state.link = false;
      state.scenario = "revoked";
      render();
      break;
    case "without-location":
      state.sharing = false;
      state.link = false;
      navigate(state.active ? "map" : "home");
      break;
    case "enable-location":
      navigate("permissions");
      break;
    case "allow-location":
      if (state.scenario === "denied") {
        feedback(
          "Location permission is denied. Enable it in device settings first.",
        );
        return;
      }
      state.sharing = true;
      navigate(state.active ? "map" : "home");
      break;
    case "stop-sharing":
      state.sharing = false;
      if (state.network === "online") state.link = false;
      feedback(
        state.network === "online"
          ? "Location sharing stopped; status links revoked. You remain in the group."
          : "Location sharing stopped locally. Link revocation is pending; previous status may remain visible.",
      );
      break;
    case "leave":
      if (state.role === "leader") return;
      state.sharing = false;
      if (state.network !== "online") {
        feedback(
          "Leave pending. Local tracking stopped. Membership awaits server confirmation.",
        );
        return;
      }
      state.active = false;
      state.paired = false;
      state.link = false;
      navigate("home");
      break;
    case "end-ride":
      if (state.role !== "leader") return;
      state.sharing = false;
      if (state.network !== "online") {
        state.scenario = "pending";
        feedback("End pending — other members may still be active.");
        return;
      }
      state.active = false;
      state.paired = false;
      state.link = false;
      navigate("summary");
      break;
  }
}
document.addEventListener("click", (event) => {
  const el = event.target.closest("button");
  if (!el || el.disabled) return;
  if (el.dataset.screen) {
    navigate(el.dataset.screen, true);
    return;
  }
  if (el.dataset.mode) {
    state.mode = el.dataset.mode;
    render();
    return;
  }
  if (el.dataset.action) act(el.dataset.action);
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const values = new FormData(form);
  switch (form.dataset.form) {
    case "signin":
      if (state.scenario !== "default") {
        feedback("Resolve the account state before continuing.");
        return;
      }
      navigate("home");
      break;
    case "create":
      if (
        !String(values.get("rideName")).trim() ||
        String(values.get("rideName")).length > 80
      ) {
        feedback("Enter a ride name between 1 and 80 characters.");
        return;
      }
      if (state.network !== "online") {
        feedback("Ride creation not confirmed. Retry when connected.");
        return;
      }
      state.role = "leader";
      state.transport = values.get("transport");
      state.active = false;
      navigate("lobby");
      break;
    case "join":
      if (["expired", "full"].includes(state.scenario)) {
        feedback("Joining is unavailable for this invite.");
        return;
      }
      if (state.network !== "online") {
        feedback("Join not confirmed. Retry when connected.");
        return;
      }
      state.role = values.get("joinRole");
      state.active = state.scenario === "active";
      state.sharing = false;
      navigate(state.active ? "map" : "lobby");
      break;
    case "checkin":
      if (!stopped() || state.role !== "pillion") return;
      if (state.network !== "online") {
        feedback("Readiness confirmation pending — offline.");
        return;
      }
      state.ready = true;
      feedback("Your helmet and readiness confirmation was accepted.");
      break;
    case "chat":
      if (!stopped()) return;
      feedback(
        "Message " +
          (state.network === "online"
            ? "accepted by server."
            : state.network === "offline"
              ? "queued — offline."
              : "delivery unconfirmed."),
      );
      break;
    case "contact":
      if (!/^\+[1-9]\d{7,14}$/.test(String(values.get("phone")))) {
        feedback("Enter an international phone number starting with +.");
        return;
      }
      feedback("Sample contact saved. No call or message was sent.");
      break;
  }
});
$("role").addEventListener("change", (e) => {
  state.role = e.target.value;
  state.feedback = "";
  render();
});
$("network").addEventListener("change", (e) => {
  state.network = e.target.value;
  state.feedback = "";
  render();
});
$("movement").addEventListener("change", (e) => {
  state.movement = e.target.value;
  state.feedback = "";
  render();
});
$("scenario").addEventListener("change", (e) => {
  state.scenario = e.target.value;
  state.feedback = "";
  if (state.screen === "home") state.active = state.scenario === "active";
  if (["lobby", "checkin"].includes(state.screen))
    state.ready = state.scenario === "ready";
  if (state.screen === "share") state.link = state.scenario === "created";
  if (state.screen === "permissions" && state.scenario === "denied")
    state.sharing = false;
  if (state.screen === "map" && state.scenario === "not-sharing")
    state.sharing = false;
  if (state.screen === "sos") {
    state.sosStatus = state.scenario;
    state.pendingOkay = false;
  }
  render();
});
$("reset").addEventListener("click", () => {
  state.network = "online";
  state.movement = "stopped";
  $("network").value = "online";
  $("movement").value = "stopped";
  navigate(state.screen, true);
});
render();
