import { Redirect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Button, Field, Notice, Page, styles } from '../src/auth/components';
import { useAuth } from '../src/auth/provider';
import { ProfileError } from '../src/auth/profile-api';
import { validateDisplayName } from '../src/auth/validation';

export default function ProfileScreen() {
  const auth = useAuth();
  const [name, setName] = useState(auth.profile?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const attempt = useRef<{ name: string; revision: number; key: string } | null>(null);
  const working = useRef(false);

  useEffect(() => {
    setName(auth.profile?.displayName ?? '');
    attempt.current = null;
  }, [auth.profile?.id, auth.profile?.revision, auth.profile?.displayName]);

  async function save() {
    if (!auth.profile || working.current) return;
    const issue = validateDisplayName(name);
    if (issue) {
      setMessage(issue);
      return;
    }
    const trimmed = name.trim();
    if (
      !attempt.current ||
      attempt.current.name !== trimmed ||
      attempt.current.revision !== auth.profile.revision
    ) {
      attempt.current = { name: trimmed, revision: auth.profile.revision, key: randomUUID() };
    }
    working.current = true;
    setBusy(true);
    setMessage('');
    try {
      await auth.saveProfile(trimmed, attempt.current.revision, attempt.current.key);
      setMessage('Your profile is saved.');
      attempt.current = null;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Your changes could not be confirmed. Try again.',
      );
      if (error instanceof ProfileError && error.code === 'conflict') setConflict(true);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  if (auth.state !== 'ready' || !auth.profile) return <Redirect href="/" />;
  return (
    <Page>
      <Text style={styles.eyebrow}>A NAME YOUR PEOPLE KNOW</Text>
      <Text accessibilityRole="header" style={styles.title}>
        Your profile.
      </Text>
      <Text style={styles.detail}>
        This is the name your ride group will see. Your email is private.
      </Text>
      <Field
        label="Display name"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        autoCapitalize="words"
        maxLength={160}
        editable={!busy && !conflict}
      />
      <Text style={styles.detail}>Signed in as {auth.session?.user.email}</Text>
      {!!message && <Notice>{message}</Notice>}
      {conflict ? (
        <Button
          label="Reload latest profile"
          onPress={() => {
            setConflict(false);
            void auth.reloadProfile();
          }}
        />
      ) : (
        <Button
          label={busy ? 'Saving…' : 'Save profile'}
          busy={busy}
          disabled={name.trim() === auth.profile.displayName}
          onPress={() => {
            void save();
          }}
        />
      )}
      <Notice>Editing your name never turns on location sharing.</Notice>
    </Page>
  );
}
