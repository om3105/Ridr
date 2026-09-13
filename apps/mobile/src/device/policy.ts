export const DIAGNOSTIC_DURATION_MS = 120_000;
export const DIAGNOSTIC_SAMPLE_LIMIT = 24;

export type DiagnosticConsent = {
  startedAt: number;
  expiresAt: number;
  background: boolean;
};

export type PermissionState = {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
};

export function permissionLabel(permission: PermissionState | null) {
  if (!permission) return 'Not checked';
  if (permission.granted) return 'Allowed';
  if (permission.status === 'undetermined') return 'Not requested';
  return permission.canAskAgain ? 'Not allowed' : 'Enable in phone settings';
}

export function canCollect(
  consent: DiagnosticConsent | null,
  now: number,
  foregroundGranted: boolean,
  backgroundGranted: boolean,
) {
  return Boolean(
    consent &&
      now >= consent.startedAt &&
      now < consent.expiresAt &&
      consent.expiresAt - consent.startedAt <= DIAGNOSTIC_DURATION_MS &&
      foregroundGranted &&
      (!consent.background || backgroundGranted),
  );
}

// Keep timing evidence only. Coordinates, altitude, bearing and speed never enter storage.
export function sampleEvidence(
  sample: { timestamp: number; coords: { accuracy: number | null } },
  consent: DiagnosticConsent,
  receivedAt: number,
  inBackground: boolean,
) {
  if (
    !Number.isFinite(sample.timestamp) ||
    sample.timestamp < consent.startedAt ||
    sample.timestamp >= consent.expiresAt ||
    sample.timestamp > receivedAt ||
    receivedAt >= consent.expiresAt
  )
    return null;
  return {
    capturedAt: sample.timestamp,
    receivedAt,
    inBackground,
    accuracyMetres:
      sample.coords.accuracy !== null &&
      Number.isFinite(sample.coords.accuracy) &&
      sample.coords.accuracy >= 0
        ? Math.round(sample.coords.accuracy)
        : null,
  };
}

export function mapTilerStyle(key: string | undefined): string | null {
  if (!key || !/^[A-Za-z0-9_-]{10,100}$/.test(key) || /your|replace|example/i.test(key))
    return null;
  return `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`;
}
