import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Button, Notice, Page, styles } from '../src/auth/components';
import { InviteScanner } from '../src/rides/InviteScanner';
import { RideError, getRideManagement } from '../src/rides/api';
import { checkStationary } from '../src/rides/motion-check';
import type { MotionContext } from '../src/rides/models';
import { acceptScan, type ScanChallenge, type ScanReceipt } from '../src/rides/readiness';
import {
  beginHeadcount,
  completeHeadcount,
  confirmHeadcount,
  getHeadcount,
  headcountQr,
  issueHeadcountScan,
  parseHeadcountQr,
  type HeadcountRound,
} from '../src/rides/headcount';
import { RideAccess, useRides } from '../src/rides/provider';

export default function HeadcountScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <RideAccess>
      <HeadcountFlow id={typeof id === 'string' ? id : ''} />
    </RideAccess>
  );
}
type CommandAttempt = { motion: MotionContext; key: string; revision?: number };
type ScanAttempt = {
  qr: string;
  scan: CommandAttempt;
  receipt: ScanReceipt | null;
  confirm: CommandAttempt | null;
};
function HeadcountFlow({ id }: { id: string }) {
  const { run } = useRides();
  const [round, setRound] = useState<HeadcountRound | null>(null);
  const [leader, setLeader] = useState(false);
  const [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [challenge, setChallenge] = useState<ScanChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const currentRoundId = useRef<string | null>(null);
  const beginAttempt = useRef<CommandAttempt | null>(null);
  const completeAttempt = useRef<CommandAttempt | null>(null);
  const scanAttempt = useRef<ScanAttempt | null>(null);
  const refresh = useCallback(async () => {
    const [status, current] = await Promise.all([
      run((options) => getRideManagement(options, id)),
      run((options) => getHeadcount(options, id)),
    ]);
    setLeader(status.membership.role === 'leader');
    setActive(status.ride.state === 'active' && !status.membership.leftAt);
    if (currentRoundId.current !== current?.id) {
      currentRoundId.current = current?.id ?? null;
      setChallenge(null);
      scanAttempt.current = null;
      completeAttempt.current = null;
    }
    setRound(current);
    setLoaded(true);
  }, [id, run]);
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Rest-stop status is unavailable. Refresh to try again.'),
    );
    const timer = setInterval(() => {
      if (!busy) void refresh().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh, busy]);
  async function work(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Rest-stop check could not be confirmed.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function begin() {
    const attempt = beginAttempt.current ?? { motion: await checkStationary(), key: randomUUID() };
    beginAttempt.current = attempt;
    try {
      const result = await run((options) =>
        beginHeadcount(options, id, attempt.motion, attempt.key),
      );
      beginAttempt.current = null;
      currentRoundId.current = result.id;
      setRound(result);
      setMessage('New rest-stop round started. Every current pair needs a fresh scan.');
    } catch (error) {
      if (!(error instanceof RideError && error.unconfirmed)) beginAttempt.current = null;
      throw error;
    }
  }
  async function scan(qr: string) {
    if (!round || round.state !== 'open') return;
    const parsed = parseHeadcountQr(qr, id, round.id);
    const attempt =
      scanAttempt.current?.qr === qr
        ? scanAttempt.current
        : {
            qr,
            scan: { motion: await checkStationary(), key: randomUUID() },
            receipt: null,
            confirm: null,
          };
    scanAttempt.current = attempt;
    try {
      if (!attempt.receipt)
        attempt.receipt = await run((options) =>
          acceptScan(
            options,
            id,
            parsed.pairId,
            parsed.challengeId,
            parsed.scannedToken,
            attempt.scan.motion,
            attempt.scan.key,
          ),
        );
      if (!attempt.confirm)
        attempt.confirm = { motion: await checkStationary(), key: randomUUID() };
      const result = await run((options) =>
        confirmHeadcount(
          options,
          id,
          round.id,
          parsed.pairId,
          attempt.receipt!.scanReceiptId,
          attempt.confirm!.motion,
          attempt.confirm!.key,
        ),
      );
      scanAttempt.current = null;
      setRound(result);
      setMessage('Pair confirmed for this rest stop.');
    } catch (error) {
      if (!(error instanceof RideError && error.unconfirmed)) scanAttempt.current = null;
      throw error;
    }
  }
  async function complete() {
    if (!round || round.state !== 'open') return;
    const attempt =
      completeAttempt.current?.revision === round.revision
        ? completeAttempt.current
        : { motion: await checkStationary(), key: randomUUID(), revision: round.revision };
    completeAttempt.current = attempt;
    try {
      const result = await run((options) =>
        completeHeadcount(options, id, round.id, attempt.revision!, attempt.motion, attempt.key),
      );
      completeAttempt.current = null;
      setRound(result);
      setMessage('Rest-stop headcount completed.');
    } catch (error) {
      if (!(error instanceof RideError && error.unconfirmed)) completeAttempt.current = null;
      throw error;
    }
  }
  const current = round?.state === 'open';
  const showQr = current && !leader && round?.ownPair && !round.ownPair.confirmed;
  const currentChallenge =
    showQr && challenge && Date.parse(challenge.expiresAt) > Date.now() ? challenge : null;
  return (
    <Page>
      <Text style={styles.eyebrow}>REST STOP</Text>
      <Text accessibilityRole="header" style={styles.title}>
        Pair headcount
      </Text>
      <Notice>
        A rest stop is a fresh check of who is here. It does not repeat or replace the pillion’s
        helmet confirmation.
      </Notice>
      {!!message && <Notice>{message}</Notice>}
      <Button label="Refresh headcount" secondary busy={busy} onPress={() => void work(refresh)} />
      {!loaded && <Notice>Checking current rest stop…</Notice>}
      {loaded && !active && <Notice>Headcounts are available during an active ride.</Notice>}
      {active && leader && !current && (
        <Button
          label="Check speed and start a new headcount"
          busy={busy}
          onPress={() => void work(begin)}
        />
      )}
      {active && round && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {round.state === 'open' ? 'Headcount in progress' : 'Last headcount completed'}
          </Text>
          {leader && (
            <Text style={styles.detail}>
              {round.confirmedPairIds.length}/{round.pairIds.length} current pairs confirmed
            </Text>
          )}
          {!leader && round.ownPair && (
            <Text style={styles.detail}>
              Your pair: {round.ownPair.confirmed ? 'Confirmed' : 'Pending leader scan'}
            </Text>
          )}
          {leader &&
            round.pairs?.map((pair) => (
              <Text key={pair.id} style={styles.detail}>
                {pair.riderName} + {pair.pillionName}: {pair.confirmed ? 'Confirmed' : 'Pending'}
              </Text>
            ))}
          {current && leader && (
            <>
              <Notice>
                Ask a member of each pair to show their rest-stop QR. If you are paired, your
                partner must show the QR so you can scan it.
              </Notice>
              <InviteScanner
                label="Scan pair’s rest-stop QR"
                fallbackText="Ask the pair to show a new QR"
                disabled={busy || scanAttempt.current !== null}
                onScan={(value) => void work(() => scan(value))}
              />
              {scanAttempt.current && (
                <Button
                  label="Retry last scan"
                  secondary
                  busy={busy}
                  onPress={() => void work(() => scan(scanAttempt.current!.qr))}
                />
              )}
              <Button
                label={
                  completeAttempt.current ? 'Retry completing headcount' : 'Complete headcount'
                }
                busy={busy}
                disabled={round.confirmedPairIds.length !== round.pairIds.length}
                onPress={() => void work(complete)}
              />
            </>
          )}
          {showQr && (
            <>
              <Button
                label={challenge ? 'Issue a new rest-stop QR' : 'Check speed and show rest-stop QR'}
                secondary
                busy={busy}
                onPress={() =>
                  void work(async () => {
                    const motion = await checkStationary();
                    const result = await run((options) =>
                      issueHeadcountScan(options, id, round.id, round.ownPair!.id, motion),
                    );
                    setChallenge(result);
                  })
                }
              />
              {currentChallenge && (
                <View
                  accessible
                  accessibilityLabel="Rest-stop pair QR code"
                  style={{ alignSelf: 'center', padding: 12, backgroundColor: 'white' }}
                >
                  <QRCode
                    value={headcountQr(id, round.id, round.ownPair!.id, currentChallenge)}
                    size={200}
                  />
                </View>
              )}
              {currentChallenge && (
                <Text style={styles.detail}>
                  Expires {new Date(currentChallenge.expiresAt).toLocaleTimeString()}.
                </Text>
              )}
            </>
          )}
        </View>
      )}
    </Page>
  );
}
