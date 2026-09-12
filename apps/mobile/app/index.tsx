import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiUrl, checkConnection, type ConnectionResult } from '../src/connection';
import { colors } from '../src/theme';

type ConnectionState = ConnectionResult | { status: 'idle' | 'checking' };

const connectionCopy: Record<ConnectionState['status'], { title: string; detail: string }> = {
  idle: {
    title: 'Your starting line',
    detail: 'Check that this preview can reach the Ridr test environment.',
  },
  checking: { title: 'Checking the connection…', detail: 'This should only take a few seconds.' },
  ready: { title: 'You’re connected', detail: 'The test service and its database are ready.' },
  unavailable: {
    title: 'The service needs a moment',
    detail: 'Ridr answered, but the test environment is not ready. Try again shortly.',
  },
  offline: {
    title: 'We couldn’t connect',
    detail: 'Check your network and make sure the test service is running, then try again.',
  },
  timeout: {
    title: 'That took too long',
    detail: 'The connection timed out. Check your network and try again.',
  },
  'invalid-response': {
    title: 'Something isn’t ready yet',
    detail:
      'The test service returned an unexpected response. Review the environment and try again.',
  },
  'not-configured': {
    title: 'One setup step to go',
    detail: 'Add the test service address to this preview. The environment guide explains how.',
  },
};

export default function HomeScreen() {
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' });
  const [focused, setFocused] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const checking = connection.status === 'checking';
  const failed = !['idle', 'checking', 'ready'].includes(connection.status);
  const copy = connectionCopy[connection.status];

  async function testConnection() {
    if (checking) return;
    setConnection({ status: 'checking' });
    const result = await checkConnection(apiUrl);
    if (mounted.current) setConnection(result);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.page}>
          <View style={styles.header}>
            <Text accessibilityLabel="Ridr" style={styles.wordmark}>
              ridr<Text style={styles.wordmarkDot}>.</Text>
            </Text>
            <View style={styles.previewBadge}>
              <Text style={styles.previewText}>DEVELOPMENT PREVIEW</Text>
            </View>
          </View>

          <View style={styles.hero}>
            <Text style={styles.eyebrow}>A SHARED ROAD. A CLOSER GROUP.</Text>
            <Text accessibilityRole="header" style={styles.heading}>
              Every ride,{'\n'}together.
            </Text>
            <Text style={styles.introduction}>
              More moments with your people.{'\n'}Less wondering where they are.
            </Text>
          </View>

          <View
            style={styles.illustration}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={styles.roadOuter} />
            <View style={styles.roadInner} />
            <View style={[styles.roadDot, styles.roadDotFirst]}>
              <View style={styles.roadDotCenter} />
            </View>
            <View style={[styles.roadDot, styles.roadDotMiddle]}>
              <View style={styles.roadDotCenter} />
            </View>
            <View style={[styles.roadDot, styles.roadDotLast]}>
              <View style={styles.roadDotCenter} />
            </View>
            <View style={styles.illustrationLabel}>
              <Text style={styles.illustrationText}>One road. Your people.</Text>
            </View>
            <Text style={styles.compass}>N ↑</Text>
          </View>

          <View style={[styles.connectionCard, failed && styles.warningCard]}>
            <View style={styles.sectionHeading}>
              <View
                style={[
                  styles.statusDot,
                  connection.status === 'ready' && styles.statusDotReady,
                  failed && styles.statusDotWarning,
                ]}
              />
              <Text style={styles.sectionLabel}>TEST CONNECTION</Text>
            </View>
            <View accessibilityLiveRegion="polite" accessibilityRole="text">
              <Text accessibilityRole="header" style={styles.cardTitle}>
                {copy.title}
              </Text>
              <Text style={styles.cardDetail}>{copy.detail}</Text>
              {connection.status === 'ready' && (
                <Text style={styles.checkedAt}>
                  Last checked at{' '}
                  {new Date(connection.checkedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: checking, busy: checking }}
              disabled={checking}
              onPress={() => {
                void testConnection();
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                focused && styles.buttonFocused,
              ]}
            >
              {checking && <ActivityIndicator color={colors.paper} />}
              <Text style={styles.buttonText}>
                {checking
                  ? 'Checking…'
                  : connection.status === 'idle'
                    ? 'Test connection'
                    : connection.status === 'ready'
                      ? 'Check again'
                      : 'Try again'}
              </Text>
              {!checking && (
                <Text style={styles.buttonArrow} accessible={false}>
                  →
                </Text>
              )}
            </Pressable>
          </View>

          <Link href="/environment" asChild>
            <Pressable
              accessibilityRole="link"
              style={({ pressed }) => [styles.environmentLink, pressed && styles.linkPressed]}
            >
              <Text style={styles.environmentLinkText}>Test environment details</Text>
              <Text style={styles.environmentLinkArrow} accessible={false}>
                ↗
              </Text>
            </Pressable>
          </Link>

          <View style={styles.footer}>
            <Text style={styles.footerTitle}>The journey starts here.</Text>
            <Text style={styles.footerText}>
              This is an early app preview. Accounts, maps and ride tools are coming in the next
              milestones.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  page: { width: '100%', maxWidth: 520, paddingHorizontal: 24, paddingBottom: 28 },
  header: {
    minHeight: 84,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    paddingVertical: 12,
  },
  wordmark: { fontSize: 36, fontWeight: '900', letterSpacing: -2, color: colors.ink },
  wordmarkDot: { color: colors.primary },
  previewBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: colors.soft,
  },
  previewText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: colors.primary },
  hero: { paddingTop: 20, paddingBottom: 25 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.muted,
    marginBottom: 16,
  },
  heading: {
    fontSize: 46,
    lineHeight: 49,
    fontWeight: '800',
    letterSpacing: -1.7,
    color: colors.ink,
  },
  introduction: { marginTop: 16, fontSize: 16, lineHeight: 24, color: colors.muted },
  illustration: {
    height: 162,
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: colors.soft,
    marginBottom: 26,
  },
  roadOuter: {
    position: 'absolute',
    width: 200,
    height: 185,
    left: -27,
    top: -76,
    borderWidth: 26,
    borderColor: '#d6e4ce',
    borderRadius: 70,
    transform: [{ rotate: '-20deg' }],
  },
  roadInner: {
    position: 'absolute',
    width: 250,
    height: 154,
    right: -25,
    top: 68,
    borderWidth: 26,
    borderColor: '#d6e4ce',
    borderRadius: 60,
    transform: [{ rotate: '-20deg' }],
  },
  roadDot: {
    position: 'absolute',
    width: 24,
    height: 24,
    backgroundColor: colors.paper,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roadDotCenter: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  roadDotFirst: { left: 37, top: 77 },
  roadDotMiddle: { left: 124, top: 39 },
  roadDotLast: { right: 43, top: 53 },
  illustrationLabel: {
    position: 'absolute',
    bottom: 16,
    left: 17,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: colors.paper,
  },
  illustrationText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  compass: {
    position: 'absolute',
    top: 15,
    right: 16,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  connectionCard: { padding: 20, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  warningCard: { backgroundColor: colors.warningBackground },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted },
  statusDotReady: { backgroundColor: colors.primary },
  statusDotWarning: { backgroundColor: colors.warning },
  sectionLabel: { color: colors.muted, fontWeight: '700', fontSize: 10, letterSpacing: 1.2 },
  cardTitle: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 23,
    lineHeight: 29,
    letterSpacing: -0.5,
  },
  cardDetail: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 7 },
  checkedAt: { marginTop: 8, fontSize: 12, color: colors.muted, lineHeight: 18 },
  button: {
    minHeight: 54,
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 11,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonPressed: { backgroundColor: '#103c2b' },
  buttonFocused: { borderColor: '#56a3ff' },
  buttonText: { color: colors.paper, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  buttonArrow: { color: colors.paper, fontSize: 22, lineHeight: 24 },
  environmentLink: {
    display: 'flex',
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 3,
    marginTop: 8,
    gap: 16,
  },
  linkPressed: { opacity: 0.7 },
  environmentLinkText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    flexShrink: 1,
  },
  environmentLinkArrow: { color: colors.primary, fontSize: 19 },
  footer: { marginTop: 20, paddingTop: 20, borderTopColor: '#e6ece4', borderTopWidth: 1 },
  footerTitle: { color: colors.ink, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  footerText: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 5, maxWidth: 380 },
});
