import type { GoTrueClient, Session } from '@supabase/auth-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { apiUrl } from '../connection';
import { initializeDiagnostics, stopAndClearDiagnostics } from '../device/diagnostics';
import { clearRideSession } from '../rides/private-session';
import { createAuthClient, logoutIntentKey, recoveryIntentKey } from './client';
import { ProfileError, requestProfile, type Profile } from './profile-api';
import { sessionStorage } from './session-storage';
import { revokeSession } from './sign-out';

type State =
  | 'restoring'
  | 'signed-out'
  | 'loading-profile'
  | 'ready'
  | 'unavailable'
  | 'blocked'
  | 'not-configured'
  | 'recovery';
type AuthContextValue = {
  state: State;
  session: Session | null;
  profile: Profile | null;
  client: GoTrueClient | null;
  message: string;
  reloadProfile(): Promise<void>;
  saveProfile(displayName: string, revision: number, idempotencyKey: string): Promise<void>;
  signOut(): Promise<void>;
  beginRecovery(): Promise<void>;
  finishRecovery(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('restoring');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [client, setClient] = useState<GoTrueClient | null>(null);
  const [message, setMessage] = useState('');
  const [recovery, setRecovery] = useState(false);
  const currentSession = useRef<Session | null>(null);
  const epoch = useRef(0);
  const invalidate = useCallback(() => {
    ++epoch.current;
  }, []);
  const currentProfile = useRef<Profile | null>(null);
  const privacyCleanup = useRef<Promise<void>>(Promise.resolve());
  const loggingOut = useRef(false);
  const mounted = useRef(true);

  const stopDiagnostics = useCallback(async () => {
    try {
      await stopAndClearDiagnostics();
    } catch {
      if (mounted.current) {
        setState('blocked');
        setMessage(
          'The location check could not be cleared. Turn off location access in Settings, then retry sign-out.',
        );
      }
      throw new Error('The location check could not be cleared. Retry sign-out.');
    }
  }, []);

  const loadProfile = useCallback(
    async (candidate: Session) => {
      const requestEpoch = ++epoch.current;
      if (currentProfile.current?.id !== candidate.user.id) {
        setProfile(null);
        setState('loading-profile');
      }
      setMessage('');
      try {
        await privacyCleanup.current;
        if (requestEpoch !== epoch.current || loggingOut.current) return;
        const result = await requestProfile({
          apiUrl,
          accessToken: candidate.access_token,
          userId: candidate.user.id,
        });
        if (!mounted.current || requestEpoch !== epoch.current || loggingOut.current) return;
        currentProfile.current = result;
        setProfile(result);
        setState('ready');
      } catch (error) {
        if (!mounted.current || requestEpoch !== epoch.current || loggingOut.current) return;
        const issue =
          error instanceof ProfileError
            ? error
            : new ProfileError('unavailable', 'Your account could not be loaded. Try again.');
        currentProfile.current = null;
        setProfile(null);
        setMessage(issue.message);
        setState(
          issue.code === 'unauthorized' || issue.code === 'blocked' ? 'blocked' : 'unavailable',
        );
        clearRideSession();
        await stopDiagnostics().catch(() => undefined);
      }
    },
    [stopDiagnostics],
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let instance: GoTrueClient | null = null;
    let subscription: { unsubscribe(): void } | undefined;
    async function restore() {
      try {
        await initializeDiagnostics();
        if (!active) return;
        loggingOut.current = (await sessionStorage.getItem(logoutIntentKey)) === 'pending';
        setRecovery((await sessionStorage.getItem(recoveryIntentKey)) === 'pending');
        if (!active) return;
        instance = createAuthClient();
        if (!instance) {
          setState('not-configured');
          return;
        }
        setClient(instance);
        subscription = instance.onAuthStateChange((event, next) => {
          if (!active) return;
          invalidate();
          const previousId = currentSession.current?.user.id;
          currentSession.current = next;
          setSession(next);
          if (previousId !== next?.user.id) {
            if (previousId) clearRideSession();
            currentProfile.current = null;
            setProfile(null);
            privacyCleanup.current = stopDiagnostics();
            void privacyCleanup.current.catch(() => undefined);
          }
          if (event === 'PASSWORD_RECOVERY') setRecovery(true);
          if (!next) {
            setRecovery(false);
            setState(loggingOut.current ? 'blocked' : 'signed-out');
            // SDK callbacks stay synchronous; cleanup runs outside its auth operation.
            void stopDiagnostics().catch(() => undefined);
          }
        }).data.subscription;
        const restoreEpoch = epoch.current;
        const result = await instance.getSession();
        if (!active) return;
        if (result.error) throw result.error;
        if (restoreEpoch === epoch.current) {
          currentSession.current = result.data.session;
          setSession(result.data.session);
        }
        if (loggingOut.current) {
          setState('blocked');
          setMessage(
            'Sign-out is waiting for a connection. Retry to finish revoking this session.',
          );
        } else if (!result.data.session && restoreEpoch === epoch.current) setState('signed-out');
      } catch {
        if (active) {
          setState('blocked');
          setMessage(
            'Ridr could not restore your session securely. Reopen the app after unlocking your device.',
          );
        }
      }
    }
    void restore();
    return () => {
      active = false;
      mounted.current = false;
      invalidate();
      subscription?.unsubscribe();
      void instance?.dispose();
    };
  }, [stopDiagnostics, invalidate]);

  useEffect(() => {
    if (!session || loggingOut.current) return;
    if (recovery) {
      setState('recovery');
      return;
    }
    if (!session.user.email_confirmed_at) {
      setState('blocked');
      setMessage('Verify your email before opening your account.');
      return;
    }
    void loadProfile(session);
  }, [session, recovery, loadProfile]);

  useEffect(() => {
    if (!client) return;
    const refresh = (next: string) => {
      if (next === 'active' && !loggingOut.current) {
        void client.startAutoRefresh();
        const activeSession = currentSession.current;
        if (activeSession && !recovery) void loadProfile(activeSession);
      } else void client.stopAutoRefresh();
    };
    refresh(AppState.currentState);
    const listener = AppState.addEventListener('change', refresh);
    return () => {
      listener.remove();
      void client.stopAutoRefresh();
    };
  }, [client, recovery, loadProfile]);

  const reloadProfile = useCallback(async () => {
    const candidate = currentSession.current;
    if (candidate && !loggingOut.current) await loadProfile(candidate);
  }, [loadProfile]);

  const saveProfile = useCallback(
    async (displayName: string, revision: number, idempotencyKey: string) => {
      const candidate = currentSession.current;
      const requestEpoch = epoch.current;
      if (!candidate || loggingOut.current) throw new Error('Sign in again before saving.');
      try {
        const result = await requestProfile({
          apiUrl,
          accessToken: candidate.access_token,
          userId: candidate.user.id,
          change: { displayName, revision, idempotencyKey },
        });
        if (
          !mounted.current ||
          requestEpoch !== epoch.current ||
          currentSession.current?.user.id !== candidate.user.id ||
          loggingOut.current
        )
          throw new Error('Your session changed. Reload your profile.');
        currentProfile.current = result;
        setProfile(result);
      } catch (error) {
        if (
          requestEpoch === epoch.current &&
          error instanceof ProfileError &&
          ['unauthorized', 'blocked'].includes(error.code)
        ) {
          currentProfile.current = null;
          setProfile(null);
          setState('blocked');
          setMessage(error.message);
          await stopDiagnostics().catch(() => undefined);
        }
        throw error;
      }
    },
    [stopDiagnostics],
  );

  const signOut = useCallback(async () => {
    clearRideSession();
    loggingOut.current = true;
    ++epoch.current;
    currentProfile.current = null;
    setProfile(null);
    setState('blocked');
    setMessage('Signing out…');
    try {
      await sessionStorage.setItem(logoutIntentKey, 'pending');
      await stopDiagnostics();
      await client?.stopAutoRefresh();
      if (client) {
        await revokeSession(client);
      }
      await sessionStorage.removeItem(logoutIntentKey);
      await sessionStorage.removeItem(recoveryIntentKey);
      loggingOut.current = false;
      currentSession.current = null;
      setSession(null);
      setRecovery(false);
      setMessage('');
      setState(client ? 'signed-out' : 'not-configured');
    } catch {
      setMessage(
        'Sign-out could not finish. Local ride tools are locked. Check your connection and retry to revoke this session.',
      );
      throw new Error('Sign-out could not finish. Check your connection and retry.');
    }
  }, [client, stopDiagnostics]);

  return (
    <AuthContext.Provider
      value={{
        state,
        session,
        profile,
        client,
        message,
        reloadProfile,
        saveProfile,
        signOut,
        beginRecovery: async () => {
          await sessionStorage.setItem(recoveryIntentKey, 'pending');
          setRecovery(true);
        },
        finishRecovery: async () => {
          await sessionStorage.removeItem(recoveryIntentKey);
          setRecovery(false);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
