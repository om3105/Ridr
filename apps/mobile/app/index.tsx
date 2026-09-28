import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiUrl, checkConnection, type ConnectionResult } from '../src/connection';
import { Button, Notice, Page, styles } from '../src/auth/components';
import { useAuth } from '../src/auth/provider';
import { colors } from '../src/theme';
import SponsoredCard from '../src/sponsored/SponsoredCard';
import { PrimaryNavigation } from '../src/navigation/PrimaryNavigation';

export default function HomeScreen() {
  const auth = useAuth();
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  async function testConnection() {
    setChecking(true);
    setConnection(await checkConnection(apiUrl));
    setChecking(false);
  }
  async function signOut() {
    setSigningOut(true);
    try {
      await auth.signOut();
    } catch {
      /* The provider keeps recovery guidance visible. */
    } finally {
      setSigningOut(false);
    }
  }
  if (auth.state === 'recovery') return <Redirect href="./account" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <Page footer={auth.state === 'ready' ? <PrimaryNavigation active="home" /> : undefined}>
        <View style={homeStyles.brandRow}>
          <Text accessibilityLabel="Ridr" style={homeStyles.brand}>
            ridr.
          </Text>
          <Text style={homeStyles.preview}>PREVIEW</Text>
        </View>
        {auth.state === 'ready' && auth.profile ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>
              Hello, {auth.profile.displayName}.
            </Text>
            <Text style={styles.detail}>Where will your group ride today?</Text>
            {auth.profile.activeMembership && (
              <View style={homeStyles.activeCard}>
                <Text style={styles.eyebrow}>YOUR RIDE IS IN PROGRESS</Text>
                <Text style={styles.cardTitle}>Back with your group</Text>
                <Link href="/rides" style={homeStyles.activeLink}>
                  Open your ride →
                </Link>
              </View>
            )}
            <View style={homeStyles.actions}>
              <Link href="/create" style={homeStyles.actionPrimary}>
                ＋ Create a ride
              </Link>
              <Link href="/join" style={homeStyles.actionSecondary}>
                Join with an invite →
              </Link>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Your ride space</Text>
              <Link href="/rides" style={homeStyles.rowLink}>
                Your rides <Text>→</Text>
              </Link>
              <Link href="/history" style={homeStyles.rowLink}>
                Ride history <Text>→</Text>
              </Link>
              <Link href="./map" style={homeStyles.rowLink}>
                Explore the map <Text>→</Text>
              </Link>
            </View>
            <Notice>Location sharing starts only when you choose to turn it on.</Notice>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Your account & device</Text>
              <Link href="./profile" style={homeStyles.rowLink}>
                Edit your profile <Text>→</Text>
              </Link>
              <Link href="./permissions" style={homeStyles.rowLink}>
                Permissions & device checks <Text>→</Text>
              </Link>
            </View>
            <SponsoredCard placement="home" />
            <Button
              label="Sign out"
              secondary
              busy={signingOut}
              onPress={() => {
                void signOut();
              }}
            />
          </>
        ) : auth.state === 'restoring' || auth.state === 'loading-profile' ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>
              {auth.state === 'restoring' ? 'Welcome back.' : 'Opening your account…'}
            </Text>
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your account" />
            <Text style={styles.detail}>
              Checking your session and account before opening your home.
            </Text>
          </>
        ) : auth.state === 'unavailable' || auth.state === 'blocked' ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>
              Let’s reconnect.
            </Text>
            <Notice>{auth.message}</Notice>
            {auth.state === 'unavailable' && (
              <Button
                label="Retry account connection"
                onPress={() => {
                  void auth.reloadProfile();
                }}
              />
            )}
            <Button
              label="Retry sign-out"
              secondary
              busy={signingOut}
              onPress={() => {
                void signOut();
              }}
            />
          </>
        ) : (
          <>
            <Text style={styles.eyebrow}>A SHARED ROAD. A CLOSER GROUP.</Text>
            <Text
              accessibilityRole="header"
              style={[styles.title, { fontSize: 44, lineHeight: 48 }]}
            >
              Every ride,{'\n'}together.
            </Text>
            <Text style={styles.detail}>
              More moments with your people. Less wondering where they are.
            </Text>
            <View style={[styles.card, { backgroundColor: colors.soft, borderWidth: 0 }]}>
              <Text style={styles.cardTitle}>One road. Your people.</Text>
              <Text style={styles.detail}>
                Create your account, set your name and get your phone ready for the road.
              </Text>
            </View>
            {auth.state === 'not-configured' ? (
              <Notice>
                Account sign-in needs the Supabase Auth address and its public app key in the test
                environment.
              </Notice>
            ) : (
              <Link
                href="./account"
                style={[
                  styles.link,
                  {
                    textAlign: 'center',
                    backgroundColor: colors.primary,
                    color: colors.paper,
                    borderRadius: 11,
                    paddingVertical: 17,
                  },
                ]}
              >
                Sign in or create an account →
              </Link>
            )}
            <Text style={styles.detail}>
              Your email stays private. Location sharing starts only when you explicitly turn it on.
            </Text>
          </>
        )}
        {Platform.OS === 'web' && (
          <Text style={styles.detail}>
            Browser preview: your session is kept only in this tab’s memory and ends when you
            reload.
          </Text>
        )}
        <View style={styles.card}>
          <Text style={styles.eyebrow}>TEST CONNECTION</Text>
          {connection && (
            <Notice>
              {connection.status === 'ready'
                ? 'You’re connected. The test service and database are ready.'
                : 'The test service is unavailable. Check the environment and try again.'}
            </Notice>
          )}
          <Button
            label={checking ? 'Checking…' : connection ? 'Check again' : 'Test connection'}
            secondary
            busy={checking}
            onPress={() => {
              void testConnection();
            }}
          />
        </View>
        <Link href="/environment" style={styles.link}>
          Test environment details ↗
        </Link>
        <Text style={styles.detail}>
          Open a ride to manage your group, location sharing, messages and safety.
        </Text>
      </Page>
    </SafeAreaView>
  );
}

const homeStyles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontSize: 36, color: colors.primary, fontWeight: '900', letterSpacing: -2 },
  preview: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  actions: { gap: 10 },
  actionPrimary: {
    backgroundColor: colors.primary,
    color: colors.paper,
    borderRadius: 11,
    overflow: 'hidden',
    padding: 17,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  actionSecondary: {
    backgroundColor: colors.paper,
    color: colors.primary,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 11,
    overflow: 'hidden',
    padding: 16,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  activeCard: { backgroundColor: colors.soft, borderRadius: 16, padding: 16, gap: 8 },
  activeLink: { color: colors.primary, fontSize: 16, fontWeight: '700', paddingVertical: 8 },
  rowLink: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 12,
    minHeight: 48,
  },
});
