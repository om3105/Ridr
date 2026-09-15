import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Link } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '../auth/provider';
import { Notice, Page, styles } from '../auth/components';
import { apiUrl } from '../connection';
import type { RideClientOptions } from './api';
import { RideError } from './api';
import type { RideInvitation } from './models';
import { rideSessionGeneration } from './private-session';

type RideContextValue = {
  run<T>(request: (options: RideClientOptions) => Promise<T>): Promise<T>;
  invitations: Record<string, RideInvitation>;
  rememberInvitation(rideId: string, invitation: RideInvitation | null): void;
};
const RideContext = createContext<RideContextValue | null>(null);

export function RideProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const owner = auth.state === 'ready' ? auth.profile?.id : null;
  // Reset screens as well as cached data when the account becomes locked or changes.
  return <AccountRideProvider key={owner ?? 'locked'}>{children}</AccountRideProvider>;
}
function AccountRideProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const current = useRef(auth);
  current.current = auth;
  const [invitations, setInvitations] = useState<Record<string, RideInvitation>>({});
  const run = useCallback(async <T,>(request: (options: RideClientOptions) => Promise<T>) => {
    const account = current.current;
    const generation = rideSessionGeneration();
    if (account.state !== 'ready' || !account.session || !account.profile) {
      throw new Error('Sign in before opening your rides.');
    }
    let result: T;
    try {
      result = await request({
        apiUrl,
        accessToken: account.session.access_token,
        userId: account.profile.id,
      });
    } catch (error) {
      if (
        error instanceof RideError &&
        ['unauthorized', 'blocked'].includes(error.code) &&
        generation === rideSessionGeneration() &&
        current.current.profile?.id === account.profile.id
      )
        await account.reloadProfile();
      throw error;
    }
    if (
      generation !== rideSessionGeneration() ||
      current.current.state !== 'ready' ||
      current.current.profile?.id !== account.profile.id
    ) {
      throw new Error('Your session changed. Open your rides again.');
    }
    return result;
  }, []);
  const rememberInvitation = useCallback((rideId: string, invitation: RideInvitation | null) => {
    setInvitations((existing) => {
      const next = { ...existing };
      if (invitation) next[rideId] = invitation;
      else delete next[rideId];
      return next;
    });
  }, []);
  return (
    <RideContext.Provider value={{ run, invitations, rememberInvitation }}>
      {children}
    </RideContext.Provider>
  );
}
export function useRides() {
  const value = useContext(RideContext);
  if (!value) throw new Error('RideProvider is required.');
  return value;
}
export function RideAccess({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.state === 'ready' && auth.profile) return children;
  return (
    <Page>
      <Text style={styles.title}>Your ride is waiting.</Text>
      <Notice>
        {auth.state === 'restoring' || auth.state === 'loading-profile'
          ? 'Checking your account…'
          : 'Sign in with a verified account to create a ride or preview an invitation.'}
      </Notice>
      <Link href="/account" style={styles.link}>
        Open your account →
      </Link>
      <Link href="/" style={styles.link}>
        Back to home →
      </Link>
    </Page>
  );
}
