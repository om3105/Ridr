import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../src/theme';
import { AuthProvider } from '../src/auth/provider';
import { RideProvider } from '../src/rides/provider';
import { SosNotificationNavigation } from '../src/sos/SosNotificationNavigation';

export default function RootLayout() {
  return (
    <AuthProvider>
      <RideProvider>
        <SosNotificationNavigation />
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
          <Stack.Screen name="contact" options={{ title: 'Emergency contact' }} />
          <Stack.Screen name="headcount" options={{ title: 'Rest-stop headcount' }} />
          <Stack.Screen name="map" options={{ title: 'Explore the map' }} />
          <Stack.Screen name="permissions" options={{ title: 'Permissions & device checks' }} />
          <Stack.Screen name="rides" options={{ title: 'Your rides' }} />
          <Stack.Screen name="create" options={{ title: 'Create a ride' }} />
          <Stack.Screen name="join" options={{ title: 'Join a ride' }} />
          <Stack.Screen name="route" options={{ title: 'Ride route' }} />
          <Stack.Screen name="sharing" options={{ title: 'Location sharing' }} />
          <Stack.Screen name="ride" options={{ title: 'Your ride' }} />
        </Stack>
      </RideProvider>
    </AuthProvider>
  );
}
