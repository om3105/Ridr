import { bindTracking, stopTracking } from '../location/tracker';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '../auth/provider';
import { Notice, Page, styles } from '../auth/components';
import { apiUrl } from '../connection';
import type { RideClientOptions } from './api';
import { RideError } from './api';
import type { RideInvitation } from './models';
import { rideSessionGeneration } from './private-session';
import type { SafetyAction } from './safety-action';

type RideContextValue = {
  run<T>(request: (options: RideClientOptions) => Promise<T>): Promise<T>;
  invitations: Record<string, RideInvitation>;
  rememberInvitation(rideId: string, invitation: RideInvitation | null): void;
  safetyActions: Record<string, SafetyAction>;
  rememberSafetyAction(rideId: string, action: SafetyAction | null): void;
};
const RideContext = createContext<RideContextValue | null>(null);

export function RideProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const owner = auth.state === 'ready' ? auth.profile?.id : null;
  useEffect(() => {
    if (auth.state === 'ready' && auth.session && auth.profile) {
      const userId = auth.profile.id;
      void bindTracking(
        {
          apiUrl,
          accessToken: auth.session.access_token,
          userId,
        },
        async () => {
          const result = await auth.client?.getSession();
          if (result?.error)
            throw new RideError(
              [400, 401, 403].includes(result.error.status ?? 0) ? 'unauthorized' : 'unavailable',
              'Session refresh is unavailable.',
              ![400, 401, 403].includes(result.error.status ?? 0),
            );
          const session = result?.data.session;
          if (!session || session.user.id !== userId)
            throw new RideError('unauthorized', 'Your session changed.');
          return { apiUrl, accessToken: session.access_token, userId };
        },
      ).catch(() => undefined);
    } else void stopTracking().catch(() => undefined);
  }, [auth.state, auth.session, auth.profile, auth.client]);
  // Reset screens as well as cached data when the account becomes locked or changes.
  return <AccountRideProvider key={owner ?? 'locked'}>{children}</AccountRideProvider>;
}
function AccountRideProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const current = useRef(auth);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  current.current = auth;
  const [invitations, setInvitations] = useState<Record<string, RideInvitation>>({});
  const [safetyActions, setSafetyActions] = useState<Record<string, SafetyAction>>({});
  const rememberSafetyAction = useCallback((rideId: string, action: SafetyAction | null) => {
    setSafetyActions((existing) => {
      const next = { ...existing };
      if (action) next[rideId] = action;
      else delete next[rideId];
      return next;
    });
  }, []);
  const run = useCallback(async <T,>(request: (options: RideClientOptions) => Promise<T>) => {
    const account = current.current;
    const generation = rideSessionGeneration();
    if (!mounted.current || account.state !== 'ready' || !account.session || !account.profile) {
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
      !mounted.current ||
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
    <RideContext.Provider
      value={{ run, invitations, rememberInvitation, safetyActions, rememberSafetyAction }}
    >
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
