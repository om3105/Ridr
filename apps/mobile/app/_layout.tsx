import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../src/theme';
import { AuthProvider } from '../src/auth/provider';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.ink,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.paper },
          headerBackTitle: 'Home',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: 'Ridr' }} />
        <Stack.Screen name="environment" options={{ title: 'Test environment' }} />
        <Stack.Screen name="account" options={{ title: 'Your account' }} />
        <Stack.Screen name="profile" options={{ title: 'Your profile' }} />
        <Stack.Screen name="map" options={{ title: 'Explore the map' }} />
        <Stack.Screen name="permissions" options={{ title: 'Permissions & device checks' }} />
      </Stack>
    </AuthProvider>
  );
}
