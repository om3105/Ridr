import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/provider';
import PermissionsScreen from '../src/device/PermissionsScreen';

export default function PermissionsRoute() {
  const { state } = useAuth();
  if (state !== 'ready') return <Redirect href="/" />;
  return <PermissionsScreen />;
}
