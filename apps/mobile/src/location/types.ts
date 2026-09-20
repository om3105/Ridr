export interface Sample {
  v: 1;
  type: 'location.sample';
  id: string;
  rideId: string;
  capturedAt: string;
  payload: {
    consentEpoch: number;
    position: { lat: number; lon: number; accuracyM: number; recordedAt: string };
    speedKph: number | null;
    headingDegrees: number | null;
    batteryPercent: null;
  };
}
export interface Consent {
  rideId: string;
  epoch: number;
  since: string;
  interval: 5 | 10 | 15;
}
export interface StopIntent {
  rideId: string;
  consentEpoch: number;
  stoppedAt: string;
  idempotencyKey: string;
}
export interface QueueState {
  owner: string;
  deviceId: string;
  consent: Consent | null;
  samples: Sample[];
  pendingStop: StopIntent | null;
  enableIntent: {
    rideId: string;
    revision: number;
    idempotencyKey: string;
    epoch: number;
    interval: 5 | 10 | 15;
  } | null;
}
export interface Sharing {
  enabled: boolean;
  consentEpoch: number;
  revision: number;
  effectiveAt: string;
}
export interface LocationSnapshot {
  serverTime: string;
  sequence: number;
  items: {
    memberId: string;
    sampleId: string;
    position: Sample['payload']['position'];
    speedKph: number | null;
    headingDegrees: number | null;
    freshness: 'fresh' | 'degraded' | 'stale';
  }[];
}
export interface TrackingStatus {
  sharing: boolean;
  queued: number;
  lastCapturedAt: string | null;
  lastAckAt: string | null;
  message: string;
  pendingStop: boolean;
}
