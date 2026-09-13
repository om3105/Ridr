import type { ExpoConfig } from 'expo/config';

const isDevelopment = process.env.APP_VARIANT !== 'production';

const config: ExpoConfig = {
  name: isDevelopment ? 'Ridr Dev' : 'Ridr',
  slug: 'ridr',
  version: '0.1.0',
  scheme: isDevelopment ? 'ridr-dev' : 'ridr',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  backgroundColor: '#ffffff',
  ios: {
    bundleIdentifier: isDevelopment ? 'com.ridr.app.dev' : 'com.ridr.app',
    supportsTablet: true,
    infoPlist: isDevelopment ? { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } } : {},
  },
  android: {
    package: isDevelopment ? 'com.ridr.app.dev' : 'com.ridr.app',
    permissions: [],
  },
  web: { bundler: 'metro', output: 'static', name: 'Ridr development preview' },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-secure-store',
    '@maplibre/maplibre-react-native',
    ['expo-sqlite', { useSQLCipher: true }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow Ridr to use your location only when you choose a location check.',
        locationAlwaysAndWhenInUsePermission:
          'Allow Ridr to test location briefly in the background. You can stop and clear the test at any time.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-build-properties',
      {
        android: { minSdkVersion: 30, usesCleartextTraffic: isDevelopment },
        ios: { deploymentTarget: '16.0' },
      },
    ],
  ],
  experiments: { typedRoutes: true },
};

export default config;
