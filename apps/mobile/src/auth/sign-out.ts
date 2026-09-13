import { isAuthApiError, type GoTrueClient } from '@supabase/auth-js';

export async function revokeSession(client: GoTrueClient): Promise<void> {
  await client.stopAutoRefresh();
  const current = await client.getSession();
  if (current.error) throw current.error;
  if (current.data.session) {
    // auth-js signOut removes local credentials even on a network error. Obtain a
    // server response first so an offline retry keeps its securely stored session.
    const revoked = await client.admin.signOut(current.data.session.access_token, 'local');
    if (
      revoked.error &&
      !(
        isAuthApiError(revoked.error) &&
        ['session_not_found', 'user_not_found'].includes(revoked.error.code ?? '')
      )
    ) {
      throw revoked.error;
    }
  }
  // Server revocation is confirmed (or the provider no longer recognizes the session).
  // A second network failure here still clears local credentials in auth-js.
  await client.signOut({ scope: 'local' });
}
