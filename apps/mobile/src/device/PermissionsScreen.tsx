import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import {
  getDiagnosticStatus,
  initializeDiagnostics,
  startDiagnostics,
  stopAndClearDiagnostics,
  subscribeDiagnostics,
} from './diagnostics';
import { permissionLabel, type PermissionState } from './policy';

type Confirmation = 'background-permission' | 'foreground-check' | 'background-check' | null;

export default function PermissionsScreen() {
  const [foreground, setForeground] = useState<PermissionState | null>(null);
  const [background, setBackground] = useState<PermissionState | null>(null);
  const [services, setServices] = useState<boolean | null>(null);
  const [diagnostic, setDiagnostic] = useState(getDiagnosticStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [nextForeground, nextBackground, nextServices] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
        Location.hasServicesEnabledAsync(),
      ]);
      if (!mounted.current) return;
      setForeground(nextForeground);
      setBackground(nextBackground);
      setServices(nextServices);
    } catch {
      if (mounted.current)
        setMessage('Phone permissions could not be checked. Try again or open phone settings.');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeDiagnostics(setDiagnostic);
    void initializeDiagnostics()
      .then(refresh)
      .catch(() => {
        if (mounted.current)
          setMessage(
            'A previous check needs cleanup. Use Stop and clear, or turn off Ridr location access in settings.',
          );
      });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      appState.remove();
    };
  }, [refresh]);

  useFocusEffect(
    useCallback(
      () => () => {
        // Navigation away revokes consent; backgrounding on this screen is allowed
        // only for the explicitly started background check.
        void stopAndClearDiagnostics().catch(() => undefined);
      },
      [],
    ),
  );

  async function perform(work: () => Promise<unknown>, failureCopy: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch {
      if (mounted.current) setMessage(failureCopy);
    } finally {
      await refresh();
      if (mounted.current) setBusy(false);
    }
  }

  function acceptConfirmation() {
    const action = confirmation;
    setConfirmation(null);
    if (action === 'background-permission') {
      void perform(async () => {
        const current = await Location.getForegroundPermissionsAsync();
        if (!current.granted) {
          setMessage('Allow location while using the app first.');
          return;
        }
        const result = await Location.requestBackgroundPermissionsAsync();
        if (!result.granted && mounted.current)
          setMessage(
            'Background access is off. You can keep using the app. To test it later, choose “Always” or “Allow all the time” in phone settings.',
          );
      }, 'Background access could not be requested. You can review it in phone settings.');
    } else if (action) {
      void perform(
        () => startDiagnostics({ background: action === 'background-check', consentGiven: true }),
        'The check could not start. Review the status below before trying again.',
      );
    }
  }

  const checking = diagnostic.state === 'running' || diagnostic.state === 'starting';
  const permissionBusy = busy || checking;
  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>YOU CHOOSE WHAT TO SHARE</Text>
        <Text accessibilityRole="header" style={styles.heading}>
          Location stays{'\n'}in your hands.
        </Text>
        <Text style={styles.copy}>
          You can sign in, edit your profile and browse the map without location access. Granting a
          permission does not start a ride or share your position.
        </Text>

        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            While you use Ridr
          </Text>
          <Text style={styles.copy}>
            Allow access for a location check you choose to start. Leaving this screen stops a
            foreground check.
          </Text>
          <Text style={styles.permission}>Foreground: {permissionLabel(foreground)}</Text>
          <Action
            label="Allow location while using Ridr"
            disabled={permissionBusy || foreground?.granted}
            onPress={() => {
              void perform(async () => {
                const result = await Location.requestForegroundPermissionsAsync();
                if (!result.granted && mounted.current)
                  setMessage(
                    'Location access is off. Your account and the map are still available. You can enable access later in phone settings.',
                  );
              }, 'Location access could not be requested. Try phone settings.');
            }}
          />
        </View>

        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            When the screen is locked
          </Text>
          <Text style={styles.copy}>
            Background access lets you test updates while Ridr is away from the screen. This
            permission is optional and is requested separately.
          </Text>
          <Text style={styles.permission}>Background: {permissionLabel(background)}</Text>
          <Action
            label="Review background access"
            disabled={permissionBusy || !foreground?.granted || background?.granted}
            secondary
            onPress={() => setConfirmation('background-permission')}
          />
          <Text style={styles.small}>
            If you chose “Allow Once” on iOS, enable “Always” in phone settings to test background
            access.
          </Text>
        </View>

        <Text style={styles.permission}>
          Phone location services: {services === null ? 'Not checked' : services ? 'On' : 'Off'}
        </Text>
        <Action
          label="Open phone settings"
          secondary
          disabled={busy}
          onPress={() => {
            void perform(
              () => Linking.openSettings(),
              'Phone settings could not open. Open Settings and select Ridr manually.',
            );
          }}
        />
        <Action
          label="Refresh permission status"
          secondary
          disabled={busy}
          onPress={() => {
            void refresh();
          }}
        />
        {message !== '' && (
          <Text accessibilityRole="alert" style={styles.notice}>
            {message}
          </Text>
        )}

        <View style={[styles.card, styles.checkCard]}>
          <Text style={styles.eyebrow}>OPTIONAL DEVICE CHECK</Text>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Try a brief location check
          </Text>
          <Text style={styles.copy}>
            This early preview can check location callbacks and encrypted storage on your phone. It
            saves up to 24 timing and accuracy records locally, without saving coordinates or
            sending them anywhere.
          </Text>
          <Text style={styles.small}>
            The check accepts samples for up to 2 minutes. Your phone can delay callbacks or pause
            the app; when that happens, stopping happens at the next callback or when you return.
            Stop and clear is always available here.
          </Text>
          <View accessibilityLiveRegion="polite" style={styles.result}>
            <Text style={styles.resultTitle}>{diagnostic.message}</Text>
            <Text style={styles.small}>
              Encrypted storage:{' '}
              {diagnostic.encryption === 'verified'
                ? 'write, wrong-key rejection and reopen passed'
                : 'not checked in this run'}
            </Text>
            <Text style={styles.small}>
              {diagnostic.count} callbacks recorded · {diagnostic.backgroundCount} received while
              the app was away
            </Text>
            {diagnostic.lastSampleAt && (
              <Text style={styles.small}>
                Last sample at {new Date(diagnostic.lastSampleAt).toLocaleTimeString()}
              </Text>
            )}
          </View>
          <Action
            label="Start foreground check"
            disabled={busy || checking || !foreground?.granted || !services}
            onPress={() => setConfirmation('foreground-check')}
          />
          <Action
            label="Start background check"
            disabled={busy || checking || !foreground?.granted || !background?.granted || !services}
            secondary
            onPress={() => setConfirmation('background-check')}
          />
          <Action
            label="Stop and clear check"
            secondary
            onPress={() => {
              void stopAndClearDiagnostics().catch(() => {
                if (mounted.current)
                  setMessage(
                    'Cleanup needs attention. Turn off Ridr location access in settings and try Stop and clear again.',
                  );
              });
            }}
          />
          {busy && (
            <ActivityIndicator color={colors.primary} accessibilityLabel="Checking device setup" />
          )}
          <Text style={styles.small}>
            A successful simulator check does not prove locked-screen delivery on a physical phone.
            No always-running guarantee is made.
          </Text>
        </View>
      </ScrollView>
      <Modal
        visible={confirmation !== null}
        transparent
        animationType="none"
        onRequestClose={() => setConfirmation(null)}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.modalCard}>
            <Text accessibilityRole="header" style={styles.cardTitle}>
              {confirmation === 'background-permission'
                ? 'Allow background access?'
                : 'Start this local check?'}
            </Text>
            <Text style={styles.copy}>
              {confirmation === 'background-permission'
                ? 'Ridr will ask your phone for “Always” or “Allow all the time” location access. Android may open Settings. Choose this only if you want to try a brief background check; granting access does not start it.'
                : `Ridr will receive location callbacks ${confirmation === 'background-check' ? 'while the app is in the background or the screen is locked' : 'while this screen is open'}. It keeps only timing and accuracy evidence in encrypted storage, never coordinates. The check accepts samples for 2 minutes, and clears stored evidence on stop. Return here to stop it; the phone may delay stopping while the app is suspended.`}
            </Text>
            <Action
              label={
                confirmation === 'background-permission'
                  ? 'Continue to permission'
                  : 'Start local check'
              }
              onPress={acceptConfirmation}
            />
            <Action label="Not now" secondary onPress={() => setConfirmation(null)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Action({
  label,
  disabled = false,
  secondary = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  secondary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        (disabled || pressed) && styles.dimmed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  page: { padding: 24, width: '100%', maxWidth: 600, alignSelf: 'center', gap: 14 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.3, color: colors.muted },
  heading: {
    fontSize: 34,
    lineHeight: 39,
    letterSpacing: -1,
    fontWeight: '800',
    color: colors.ink,
  },
  copy: { fontSize: 14, lineHeight: 22, color: colors.muted },
  small: { fontSize: 12, lineHeight: 19, color: colors.muted },
  card: { padding: 18, borderWidth: 1, borderColor: colors.border, borderRadius: 16, gap: 12 },
  cardTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.3,
  },
  permission: { color: colors.primary, fontWeight: '600', fontSize: 13, lineHeight: 21 },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  secondaryButton: { backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.border },
  buttonText: {
    color: colors.paper,
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  secondaryText: { color: colors.primary },
  dimmed: { opacity: 0.5 },
  notice: {
    fontSize: 13,
    lineHeight: 21,
    color: colors.warning,
    backgroundColor: colors.warningBackground,
    padding: 14,
    borderRadius: 10,
  },
  checkCard: { marginTop: 12, backgroundColor: colors.canvas },
  result: { padding: 14, gap: 8, backgroundColor: colors.paper, borderRadius: 10 },
  resultTitle: { color: colors.ink, fontSize: 14, fontWeight: '600', lineHeight: 21 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(23,44,36,0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 18,
    padding: 22,
    gap: 16,
    backgroundColor: colors.paper,
  },
});
