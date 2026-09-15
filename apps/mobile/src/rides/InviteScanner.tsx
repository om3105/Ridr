import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { Button, Notice } from '../auth/components';

export function InviteScanner({
  onScan,
  disabled = false,
}: {
  onScan(value: string): void;
  disabled?: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const accepted = useRef(false);
  const permissionRequest = useRef(0);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
        permissionRequest.current++;
        setScanning(false);
        setBusy(false);
      };
    }, []),
  );
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        permissionRequest.current++;
        setScanning(false);
        setBusy(false);
      }
    });
    return () => listener.remove();
  }, []);
  async function scan() {
    const request = ++permissionRequest.current;
    setBusy(true);
    setMessage('');
    try {
      const result = permission?.granted ? permission : await requestPermission();
      if (
        !active.current ||
        AppState.currentState !== 'active' ||
        request !== permissionRequest.current
      )
        return;
      if (!result.granted) {
        setMessage(
          'Camera access is off. Use the code or link, or enable camera access in Settings.',
        );
        return;
      }
      accepted.current = false;
      setScanning(true);
    } catch {
      if (active.current && request === permissionRequest.current)
        setMessage('The camera is unavailable. Use the code or link instead.');
    } finally {
      if (active.current && request === permissionRequest.current) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      {scanning && !disabled && (
        <CameraView
          style={{ height: 290, borderRadius: 16, overflow: 'hidden' }}
          facing="back"
          mode="picture"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onMountError={() => {
            setScanning(false);
            setMessage('The camera is unavailable. Use the code or link instead.');
          }}
          onBarcodeScanned={({ data, type }) => {
            if (
              accepted.current ||
              !active.current ||
              AppState.currentState !== 'active' ||
              type !== 'qr'
            )
              return;
            accepted.current = true;
            setScanning(false);
            onScan(data);
          }}
        />
      )}
      <Button
        label={scanning ? 'Close camera' : 'Scan invite QR'}
        secondary
        busy={busy}
        disabled={disabled}
        onPress={() => {
          if (scanning) setScanning(false);
          else void scan();
        }}
      />
      {!!message && <Notice>{message}</Notice>}
      {!!message && permission?.canAskAgain === false && (
        <Button
          label="Open camera settings"
          secondary
          onPress={() => {
            void Linking.openSettings().catch(() =>
              setMessage('Open your device Settings to enable camera access.'),
            );
          }}
        />
      )}
    </View>
  );
}
