import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiUrl, checkConnection, type ConnectionResult } from '../src/connection';
import { Button, Notice, Page, styles } from '../src/auth/components';
import { useAuth } from '../src/auth/provider';
import { colors } from '../src/theme';

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
      <Page>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Text
            accessibilityLabel="Ridr"
            style={{ fontSize: 40, color: colors.ink, fontWeight: '900', letterSpacing: -2 }}
          >
            ridr.
          </Text>
          <Text style={styles.eyebrow}>DEVELOPMENT PREVIEW</Text>
        </View>
        {auth.state === 'ready' && auth.profile ? (
          <>
            <Text style={styles.eyebrow}>YOUR STARTING LINE</Text>
            <Text accessibilityRole="header" style={styles.title}>
              Hello, {auth.profile.displayName}.
            </Text>
            <Text style={styles.detail}>
              Your account is ready. Explore the map and choose what your phone can share.
            </Text>
            <Notice>
              Location sharing is off. Opening a map or signing in never starts tracking.
            </Notice>
            {auth.profile.activeMembership && (
              <Notice>
                Your account has an active ride. Ride controls will become available in the ride
                milestone.
              </Notice>
            )}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Make yourself at home</Text>
              <Link href="./map" style={styles.link}>
                Explore the map →
              </Link>
              <Link href="./permissions" style={styles.link}>
                Permissions & device checks →
              </Link>
              <Link href="./profile" style={styles.link}>
                Edit your profile →
              </Link>
            </View>
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
          Ride groups and live coordination will follow in the next milestones.
        </Text>
      </Page>
    </SafeAreaView>
  );
}
