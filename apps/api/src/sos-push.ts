import type { Pool } from 'pg';
import { openPush } from './warning-push.js';

export function sosPushMessage(token: string, rideId: string, sosId: string) {
  return {
    to: token,
    title: 'Ridr SOS',
    body: 'Someone in your ride requested help. Open Ridr for the current status.',
    data: { kind: 'sos', rideId, sosId },
    ttl: 120,
    priority: 'high',
    channelId: 'ride-sos',
  };
}
type Ticket = { status?: string; id?: string; details?: { error?: string } };
export class SosPush {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  constructor(
    private readonly pool: Pool,
    private readonly key: Buffer,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  start() {
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, 2000);
    this.timer.unref();
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.work().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async work() {
    await this.pool.query(
      "UPDATE ridr.sos_push_deliveries SET state='unknown',updated_at=now() WHERE state='pending' AND updated_at<now()-interval '1 minute'",
    );
    await this.receipts().catch(() => undefined);
    const rows = await this.pool.query<{
      sos_id: string;
      ride_id: string;
      device_id: string;
      user_id: string;
      push_token_ciphertext: Buffer;
    }>(
      `SELECT s.id AS sos_id,s.ride_id,d.id AS device_id,d.user_id,d.push_token_ciphertext
       FROM ridr.sos_events s JOIN ridr.rides r ON r.id=s.ride_id AND r.state='active'
       JOIN ridr.memberships m ON m.ride_id=s.ride_id AND m.left_at IS NULL
       JOIN ridr.devices d ON d.user_id=m.user_id AND d.revoked_at IS NULL AND d.push_token_ciphertext IS NOT NULL
       WHERE s.accepted_at>now()-interval '24 hours' AND d.id<>s.device_id
         AND NOT EXISTS (SELECT 1 FROM ridr.sos_updates u WHERE u.sos_id=s.id)
       ORDER BY s.accepted_at DESC LIMIT 200`,
    );
    for (const row of rows.rows) {
      const claimed = await this.pool.query(
        `INSERT INTO ridr.sos_push_deliveries(sos_id,device_id,state) VALUES ($1,$2,'pending') ON CONFLICT DO NOTHING RETURNING sos_id`,
        [row.sos_id, row.device_id],
      );
      if (!claimed.rowCount) continue;
      let token: string;
      try {
        const registration = openPush(row.push_token_ciphertext, this.key, row.device_id);
        if (
          registration.account.id !== row.user_id ||
          registration.account.expiresAt * 1000 <= Date.now()
        )
          throw new Error('expired');
        token = registration.token;
      } catch {
        await this.pool.query(
          "UPDATE ridr.sos_push_deliveries SET state='failed',updated_at=now() WHERE sos_id=$1 AND device_id=$2",
          [row.sos_id, row.device_id],
        );
        continue;
      }
      try {
        const response = await this.fetcher('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sosPushMessage(token, row.ride_id, row.sos_id)),
          signal: AbortSignal.timeout(5000),
        });
        const json = (await response.json()) as { data?: Ticket };
        const ticket = json.data;
        const state = response.ok && ticket?.status === 'ok' && ticket.id ? 'accepted' : 'failed';
        await this.pool.query(
          'UPDATE ridr.sos_push_deliveries SET state=$3,ticket_id=$4,updated_at=now() WHERE sos_id=$1 AND device_id=$2',
          [row.sos_id, row.device_id, state, ticket?.id ?? null],
        );
        if (ticket?.details?.error === 'DeviceNotRegistered')
          await this.pool.query(
            'UPDATE ridr.devices SET push_token_ciphertext=NULL WHERE id=$1 AND push_token_ciphertext=$2',
            [row.device_id, row.push_token_ciphertext],
          );
      } catch {
        // A timeout after submission is uncertain. Never blindly send the same SOS push twice.
        await this.pool.query(
          "UPDATE ridr.sos_push_deliveries SET state='unknown',updated_at=now() WHERE sos_id=$1 AND device_id=$2",
          [row.sos_id, row.device_id],
        );
      }
    }
  }
  private async receipts() {
    const rows = await this.pool.query<{ sos_id: string; device_id: string; ticket_id: string }>(
      "SELECT sos_id,device_id,ticket_id FROM ridr.sos_push_deliveries WHERE state='accepted' AND updated_at<now()-interval '15 minutes' ORDER BY updated_at LIMIT 100",
    );
    if (!rows.rows.length) return;
    const response = await this.fetcher('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: rows.rows.map((r) => r.ticket_id) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const json = (await response.json()) as { data?: Record<string, Ticket> };
    for (const row of rows.rows) {
      const receipt = json.data?.[row.ticket_id];
      if (!receipt) continue;
      await this.pool.query(
        "UPDATE ridr.sos_push_deliveries SET state=$3,updated_at=now() WHERE sos_id=$1 AND device_id=$2 AND state='accepted'",
        [row.sos_id, row.device_id, receipt.status === 'ok' ? 'delivered' : 'failed'],
      );
    }
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }
}
