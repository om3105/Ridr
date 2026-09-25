import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Button, Field, Notice, Page, styles } from '../src/auth/components';
import { validateDisplayName } from '../src/auth/validation';
import {
  deleteEmergencyContact,
  getEmergencyContact,
  saveEmergencyContact,
  validPhone,
  type EmergencyContact,
} from '../src/auth/emergency-contact';
import { RideError } from '../src/rides/api';
import { RideAccess, useRides } from '../src/rides/provider';

export default function ContactScreen() {
  return (
    <RideAccess>
      <ContactForm />
    </RideAccess>
  );
}

function ContactForm() {
  const { run } = useRides();
  const [contact, setContact] = useState<EmergencyContact | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const saveAttempt = useRef<{ name: string; phone: string; revision: number; key: string } | null>(
    null,
  );
  const deleteAttempt = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const result = await run(getEmergencyContact);
    setContact(result);
    setName(result?.name ?? '');
    setPhone(result?.phone ?? '');
    setLoaded(true);
    saveAttempt.current = null;
    deleteAttempt.current = null;
  }, [run]);
  useEffect(() => {
    void refresh().catch(() => setMessage('Contact is unavailable. Refresh to try again.'));
  }, [refresh]);
  async function work(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Contact could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const trimmed = name.trim(),
      number = phone.trim();
    const nameIssue = validateDisplayName(trimmed);
    if (nameIssue) {
      setMessage(nameIssue);
      return;
    }
    if (!validPhone(number)) {
      setMessage('Use an international phone number: + followed by 8–15 digits.');
      return;
    }
    const revision = contact?.revision ?? 0;
    const attempt =
      saveAttempt.current?.name === trimmed &&
      saveAttempt.current.phone === number &&
      saveAttempt.current.revision === revision
        ? saveAttempt.current
        : { name: trimmed, phone: number, revision, key: randomUUID() };
    saveAttempt.current = attempt;
    try {
      const saved = await run((options) =>
        saveEmergencyContact(options, trimmed, number, revision, attempt.key),
      );
      setContact(saved);
      saveAttempt.current = null;
      setMessage('Emergency contact saved privately. No call or message was sent.');
    } catch (error) {
      if (!(error instanceof RideError && error.unconfirmed)) saveAttempt.current = null;
      throw error;
    }
  }
  async function remove() {
    const key = deleteAttempt.current ?? randomUUID();
    deleteAttempt.current = key;
    try {
      await run((options) => deleteEmergencyContact(options, key));
      deleteAttempt.current = null;
      saveAttempt.current = null;
      setContact(null);
      setName('');
      setPhone('');
      setMessage('Emergency contact removed.');
    } catch (error) {
      if (!(error instanceof RideError && error.unconfirmed)) deleteAttempt.current = null;
      throw error;
    }
  }
  return (
    <Page>
      <Text style={styles.eyebrow}>PRIVATE TO YOU</Text>
      <Text accessibilityRole="header" style={styles.title}>
        Emergency contact
      </Text>
      <Notice>
        This name and phone stay in your account. Pairing does not share them with your rider or
        group. Saving will not call or message this person.
      </Notice>
      {!!message && <Notice>{message}</Notice>}
      <Button label="Refresh contact" secondary busy={busy} onPress={() => void work(refresh)} />
      {loaded && (
        <>
          <Field
            label="Contact name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            maxLength={160}
            editable={!busy}
          />
          <Field
            label="Phone with country code"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+919876543210"
            maxLength={16}
            editable={!busy}
          />
          <Button
            label={saveAttempt.current ? 'Retry saving contact' : 'Save contact'}
            busy={busy}
            disabled={
              !name.trim() ||
              !phone.trim() ||
              (contact?.name === name.trim() && contact?.phone === phone.trim())
            }
            onPress={() => void work(save)}
          />
          {contact && (
            <Button
              label={deleteAttempt.current ? 'Retry removing contact' : 'Remove contact'}
              secondary
              busy={busy}
              onPress={() => void work(remove)}
            />
          )}
        </>
      )}
    </Page>
  );
}
