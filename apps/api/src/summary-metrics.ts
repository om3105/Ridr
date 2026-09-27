import { distance } from './ride-geometry.js';

export interface SummarySample {
  id: string;
  capturedAt: string;
  receivedAt: string;
  lat: number;
  lon: number;
  accuracyM: number;
  consentEpoch: number;
}
export interface SummaryPeriod {
  startedAt: string;
  stoppedAt: string;
}
export interface SummaryGap {
  from: string;
  to: string;
  reason:
    | 'missing_samples'
    | 'poor_accuracy'
    | 'implausible_jump'
    | 'sharing_change'
    | 'sharing_off';
}
export interface SummaryTrace {
  segments: { lat: number; lon: number }[][];
  previewComplete: boolean;
  shownPoints: number;
}

const MAX_PREVIEW_POINTS = 2000;
const MAX_GAP_DETAILS = 100;

export function deriveSummaryMetrics(
  samples: SummarySample[],
  periods: SummaryPeriod[],
  participationStart: string,
  participationEnd: string,
) {
  const start = Date.parse(participationStart);
  const end = Date.parse(participationEnd);
  const ordered = [...new Map(samples.map((sample) => [sample.id, sample])).values()].sort(
    (a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.id.localeCompare(b.id),
  );
  const gaps: SummaryGap[] = [];
  let gapCount = 0;
  const addGap = (from: string, to: string, reason: SummaryGap['reason']) => {
    if (Date.parse(to) <= Date.parse(from)) return;
    gapCount++;
    if (gaps.length < MAX_GAP_DETAILS) gaps.push({ from, to, reason });
  };
  let recordedDistanceM = 0;
  let excludedSamples = 0;
  let previous: SummarySample | null = null;
  let poorAccuracy = false;
  let shownPoints = 0;
  let validPoints = 0;
  let segment: { lat: number; lon: number }[] = [];
  const segments: SummaryTrace['segments'] = [];
  const finish = () => {
    if (segment.length) segments.push(segment);
    segment = [];
  };
  for (const sample of ordered) {
    const captured = Date.parse(sample.capturedAt);
    if (
      !Number.isFinite(captured) ||
      captured < start ||
      captured > end ||
      !Number.isFinite(sample.accuracyM) ||
      sample.accuracyM > 50 ||
      sample.accuracyM < 0
    ) {
      excludedSamples++;
      poorAccuracy = true;
      continue;
    }
    if (previous) {
      const dt = (captured - Date.parse(previous.capturedAt)) / 1000;
      const length = distance(previous, sample);
      const reason: SummaryGap['reason'] | null =
        sample.consentEpoch !== previous.consentEpoch
          ? 'sharing_change'
          : poorAccuracy
            ? 'poor_accuracy'
            : dt <= 0 || dt > 30
              ? 'missing_samples'
              : length > dt * 60 + previous.accuracyM + sample.accuracyM
                ? 'implausible_jump'
                : null;
      if (reason) {
        addGap(previous.capturedAt, sample.capturedAt, reason);
        finish();
      } else recordedDistanceM += length;
    }
    validPoints++;
    if (shownPoints < MAX_PREVIEW_POINTS) {
      segment.push({ lat: sample.lat, lon: sample.lon });
      shownPoints++;
    }
    previous = sample;
    poorAccuracy = false;
  }
  finish();

  const intervals = periods
    .map((period) => ({
      from: Math.max(start, Date.parse(period.startedAt)),
      to: Math.min(end, Date.parse(period.stoppedAt)),
    }))
    .filter(
      (period) =>
        Number.isFinite(period.from) && Number.isFinite(period.to) && period.to > period.from,
    )
    .sort((a, b) => a.from - b.from);
  let cursor = start;
  for (const interval of intervals) {
    if (interval.from > cursor)
      addGap(new Date(cursor).toISOString(), new Date(interval.from).toISOString(), 'sharing_off');
    const first = ordered.find((sample) => {
      const at = Date.parse(sample.capturedAt);
      return at >= interval.from && at <= interval.to && sample.accuracyM <= 50;
    });
    const last = [...ordered].reverse().find((sample) => {
      const at = Date.parse(sample.capturedAt);
      return at >= interval.from && at <= interval.to && sample.accuracyM <= 50;
    });
    if (!first)
      addGap(
        new Date(interval.from).toISOString(),
        new Date(interval.to).toISOString(),
        'missing_samples',
      );
    else {
      if (Date.parse(first.capturedAt) - interval.from > 30000)
        addGap(new Date(interval.from).toISOString(), first.capturedAt, 'missing_samples');
      if (last && interval.to - Date.parse(last.capturedAt) > 30000)
        addGap(last.capturedAt, new Date(interval.to).toISOString(), 'missing_samples');
    }
    cursor = Math.max(cursor, interval.to);
  }
  if (cursor < end)
    addGap(new Date(cursor).toISOString(), new Date(end).toISOString(), 'sharing_off');
  gaps.sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const participationDurationSeconds = Math.max(0, Math.floor((end - start) / 1000));
  return {
    recordedDistanceM: Math.round(recordedDistanceM * 10) / 10,
    participationDurationSeconds,
    elapsedPaceMinPerKm:
      recordedDistanceM > 0
        ? Math.round((participationDurationSeconds / 60 / (recordedDistanceM / 1000)) * 100) / 100
        : null,
    averageSpeedKmh:
      participationDurationSeconds > 0
        ? Math.round((recordedDistanceM / participationDurationSeconds) * 3.6 * 100) / 100
        : null,
    sampleCount: ordered.length,
    excludedSamples,
    gapCount,
    gaps,
    trace: {
      segments,
      shownPoints,
      previewComplete: shownPoints === validPoints,
    } satisfies SummaryTrace,
    latestSampleReceivedAt: ordered.reduce(
      (latest, sample) => (sample.receivedAt > latest ? sample.receivedAt : latest),
      participationEnd,
    ),
  };
}
