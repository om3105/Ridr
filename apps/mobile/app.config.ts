import type { ExpoConfig } from 'expo/config';

const isDevelopment = process.env.APP_VARIANT !== 'production';

const config: ExpoConfig = {
  name: isDevelopment ? 'Ridr Dev' : 'Ridr',
  slug: 'ridr',
  owner: 'omdeos-team',
  extra: { eas: { projectId: '324bae2b-d412-4d75-8d66-af4f13ef778f' } },
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
    ...(isDevelopment
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json' }
      : {}),
    permissions: [],
  },
  web: { bundler: 'metro', output: 'static', name: 'Ridr development preview' },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-notifications',
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission: 'Allow Ridr to scan a ride invitation when you choose Scan invite QR.',
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    '@maplibre/maplibre-react-native',
    ['expo-sqlite', { useSQLCipher: true }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow Ridr to use your location when you choose to share an active ride or run a device check.',
        locationAlwaysAndWhenInUsePermission:
          'Allow Ridr to keep sharing your active ride when the screen is locked. You can stop sharing at any time.',
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
