import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <>
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
      </Stack>
    </>
  );
}
