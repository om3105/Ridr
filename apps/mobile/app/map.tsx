import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/provider';
import MapScreen from '../src/device/MapScreen';

export default function MapRoute() {
  const { state } = useAuth();
  if (state !== 'ready') return <Redirect href="/" />;
  return <MapScreen />;
}
