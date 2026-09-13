import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiUrl, checkConnection, type ConnectionResult } from '../src/connection';
import { Button } from '../src/auth/components';
import { colors } from '../src/theme';

function configuredOrigin(): string {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return 'Not configured';
  }
}

export default function EnvironmentScreen() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  async function testConnection() {
    if (checking) return;
    setChecking(true);
    try {
      setResult(await checkConnection(apiUrl));
    } finally {
      setChecking(false);
    }
  }
  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.page}>
          <Text style={styles.eyebrow}>DEVELOPMENT PREVIEW</Text>
          <Text accessibilityRole="header" style={styles.heading}>
            A place to test{'\n'}the connection.
          </Text>
          <Text style={styles.body}>
            This preview checks whether the Ridr service and database can be reached. It does not
            sign you in or share your location.
          </Text>

          <View style={styles.card}>
            <Text style={styles.label}>TEST SERVICE ADDRESS</Text>
            <Text selectable style={styles.address}>
              {configuredOrigin()}
            </Text>
            <Text style={styles.note}>
              The check uses /v1/health/ready and waits up to five seconds.
            </Text>
            <Button
              label={checking ? 'Checking…' : 'Test connection'}
              disabled={checking}
              onPress={() => {
                void testConnection();
              }}
            />
            {result && (
              <Text accessibilityLiveRegion="polite" style={styles.note}>
                {result.status === 'ready'
                  ? `Service and database ready. Checked at ${new Date(result.checkedAt).toLocaleTimeString()}.`
                  : result.status === 'not-configured'
                    ? 'Set the service address before testing.'
                    : 'The service could not be verified. Check the address and connection, then retry.'}
              </Text>
            )}
          </View>

          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Connect a phone
          </Text>
          <Text style={styles.body}>
            Keep your phone and computer on the same network. Set EXPO_PUBLIC_API_URL in the mobile
            app’s local environment file to your computer’s network address, then restart the
            preview.
          </Text>
          <Text style={styles.example}>Example: http://192.168.1.10:3000</Text>
          <Text style={styles.body}>
            The iOS simulator can use localhost. The Android emulator uses 10.0.2.2 to reach the
            computer. A real phone needs the computer’s network address.
          </Text>

          <View style={styles.notice}>
            <Text accessibilityRole="header" style={styles.noticeTitle}>
              A local test environment
            </Text>
            <Text style={styles.noticeText}>
              The app address is public configuration. Never put passwords or private keys in it.
              Development builds permit local HTTP; production builds require secure connections.
            </Text>
          </View>

          <Text accessibilityRole="header" style={styles.sectionTitle}>
            What this check tells us
          </Text>
          <Text style={styles.body}>
            A successful result confirms readiness at the displayed check time. Device permissions,
            maps and background location have separate native checks after sign-in. Real ride
            behavior remains in later milestones.
          </Text>
          <Text style={styles.support}>Target devices: iOS 16 or later · Android 11 or later</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  scrollContent: { alignItems: 'center' },
  page: { width: '100%', maxWidth: 520, paddingHorizontal: 24, paddingTop: 25, paddingBottom: 35 },
  eyebrow: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 14,
  },
  heading: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
    letterSpacing: -0.8,
    marginBottom: 16,
  },
  body: { color: colors.muted, fontSize: 15, lineHeight: 24, marginBottom: 15 },
  card: { marginVertical: 10, padding: 18, backgroundColor: colors.soft, borderRadius: 16 },
  label: {
    color: colors.muted,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1.1,
    marginBottom: 10,
  },
  address: { color: colors.ink, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  note: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  sectionTitle: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 22,
    lineHeight: 28,
    marginTop: 25,
    marginBottom: 12,
  },
  example: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 21,
    marginBottom: 16,
  },
  notice: {
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    marginTop: 8,
  },
  noticeTitle: { color: colors.ink, fontWeight: '700', fontSize: 15, marginBottom: 9 },
  noticeText: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  support: { color: colors.muted, fontSize: 12, lineHeight: 20, marginTop: 12 },
});
