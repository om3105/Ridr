import { ApiError } from './api-errors.js';
import { stationary, type ManagementContext } from './ride-management.js';
import { validatePoints, type RouteChange, type SavedRoute } from './route-planning.js';

export async function readRoute(context: ManagementContext): Promise<{ route: SavedRoute | null }> {
  if (context.own.left_at || context.ride.state === 'ended')
    throw new ApiError(404, 'NOT_FOUND', 'Route unavailable.');
  const result = await context.client.query<SavedRoute>(
    'SELECT ride_id AS id, source, profile, points, revision FROM ridr.routes WHERE ride_id = $1',
    [context.ride.id],
  );
  const row = result.rows[0];
  return { route: row ? { ...row, revision: Number(row.revision) } : null };
}
export async function routeGuard(context: ManagementContext, change: RouteChange) {
  if (context.own.left_at || context.own.id !== context.ride.leader_member_id)
    throw new ApiError(403, 'FORBIDDEN', 'Only the current leader can edit the route.');
  if (context.ride.state !== 'lobby')
    throw new ApiError(
      409,
      'RIDE_STATE_CONFLICT',
      'Routes can only be changed before the ride starts.',
    );
  await stationary(context.client, context.own.id, change);
  const previous = (await readRoute(context)).route;
  if ((previous?.revision ?? 0) !== change.revision)
    throw new ApiError(
      412,
      'REVISION_CONFLICT',
      'The saved route changed. Reload it before saving.',
    );
}
export async function writeRoute(
  context: ManagementContext,
  change: RouteChange,
): Promise<SavedRoute> {
  await routeGuard(context, change);
  const points = validatePoints(change.points);
  const result = await context.client.query<SavedRoute>(
    `INSERT INTO ridr.routes (ride_id, revision, profile, source, points, updated_at)
     VALUES ($1, 1, $2, $3, $4::jsonb, clock_timestamp())
     ON CONFLICT (ride_id) DO UPDATE SET revision = ridr.routes.revision + 1,
       profile = EXCLUDED.profile, source = EXCLUDED.source, points = EXCLUDED.points, updated_at = EXCLUDED.updated_at
     RETURNING ride_id AS id, revision, profile, source, points`,
    [
      context.ride.id,
      context.ride.transport === 'cycling' ? 'cycling' : 'driving',
      change.source,
      JSON.stringify(points),
    ],
  );
  await context.client.query('UPDATE ridr.rides SET revision = revision + 1 WHERE id = $1', [
    context.ride.id,
  ]);
  return { ...result.rows[0]!, revision: Number(result.rows[0]!.revision) };
}
