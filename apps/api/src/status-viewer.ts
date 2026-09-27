export function statusViewerHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Ridr shared status</title>
<style nonce="${nonce}">
body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f8faf5;color:#142b22}
main{max-width:34rem;margin:0 auto;padding:2rem 1.25rem}h1{font-size:2.5rem;margin:.5rem 0}
.card{background:#fff;border:1px solid #cdd7cb;border-radius:1.2rem;padding:1.25rem;margin:1rem 0}
.muted{color:#52675c}.alert{background:#fff4e6}dt{font-weight:700;margin-top:.8rem}dd{margin:0}
</style></head><body><main><p class="muted">RIDR · SHARED STATUS</p><h1>One rider's status</h1>
<p class="muted">Anyone with this link can view the limited status until it expires or the rider revokes it. This page never shows the group.</p>
<section class="card" aria-live="polite"><h2 id="state">Checking link…</h2><div id="details"></div></section>
<p class="muted">Location may be old or unavailable. This link does not contact emergency services.</p></main>
<script nonce="${nonce}">
(() => {
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname + location.search);
  const state = document.getElementById('state');
  const details = document.getElementById('details');
  let deadline = 0, inFlight = false, lastRequest = 0;
  const clear = (message) => { deadline = 0; details.replaceChildren(); state.textContent = message; };
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { clear('This link is unavailable.'); return; }
  const line = (label, value) => {
    const wrap = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const description = document.createElement('dd'); description.textContent = value;
    wrap.append(term, description); details.append(wrap);
  };
  const refresh = async () => {
    if (inFlight || document.hidden) return;
    inFlight = true; lastRequest = performance.now();
    const started = lastRequest;
    try {
      const response = await fetch('/v1/public/status', {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw new Error('unavailable');
      const value = (await response.json()).data;
      const leaseMs = Date.parse(value.leaseExpiresAt) - Date.parse(value.servedAt);
      if (document.hidden || !Number.isFinite(leaseMs) || leaseMs <= 0 || leaseMs > 15000 ||
          performance.now() >= started + leaseMs) throw new Error('expired');
      deadline = started + leaseMs;
      details.replaceChildren(); state.textContent = value.displayName + ' · active ride';
      line('Link expires', new Date(value.linkExpiresAt).toLocaleString());
      line('SOS', ({ none:'No reported SOS', open:'Assistance requested',
        reporter_okay:'Reporter said they are okay', coordination_closed:'Coordination closed' })[value.sosState] || 'Unknown');
      if (value.lastPosition) {
        const point = value.lastPosition;
        line('Last shared position', point.lat.toFixed(5) + ', ' + point.lon.toFixed(5));
        line('Recorded', new Date(point.recordedAt).toLocaleString() + ' · accuracy ±' + Math.round(point.accuracyM) + ' m');
        const age = Date.now() - Date.parse(point.recordedAt);
        line('Freshness', !Number.isFinite(age) || age < -5000 ? 'Time uncertain' :
          age > 30000 ? 'Old position · do not assume the rider is here now' : 'Recently shared');
      } else line('Position', 'Not available');
    } catch { clear('Status unavailable or connection lost.'); }
    finally { inFlight = false; }
  };
  document.addEventListener('visibilitychange', () => {
    clear('Checking link…');
    if (!document.hidden) void refresh();
  });
  setInterval(() => {
    if (deadline && performance.now() >= deadline) clear('Status expired. Rechecking…');
    if (!document.hidden && !inFlight && performance.now() - lastRequest >= 5000) void refresh();
  }, 500);
  void refresh();
})();
</script></body></html>`;
}
