import { Link, Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Field, Notice, Page, styles } from '../src/auth/components';
import { useAuth } from '../src/auth/provider';
import {
  authError,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '../src/auth/validation';

type Mode = 'login' | 'signup' | 'verify' | 'recover' | 'recovery-code' | 'password';
const titles: Record<Mode, string> = {
  login: 'Welcome back.',
  signup: 'Find your people.',
  verify: 'Check your inbox.',
  recover: 'Let’s get you back in.',
  'recovery-code': 'Check your inbox.',
  password: 'A fresh start.',
};

export default function AccountScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  useEffect(() => {
    if (auth.state === 'recovery') {
      setMode('password');
      setPassword('');
    }
  }, [auth.state]);

  function switchMode(next: Mode) {
    if (busy) return;
    if (!auth.session) void auth.finishRecovery().catch(() => undefined);
    setMode(next);
    setMessage('');
    setPassword('');
    setCode('');
  }

  async function submit() {
    if (!auth.client || working.current) return;
    const issue = mode !== 'password' ? validateEmail(email) : null;
    const passwordIssue = ['signup', 'password'].includes(mode) ? validatePassword(password) : null;
    const nameIssue = mode === 'signup' ? validateDisplayName(name) : null;
    if (issue || passwordIssue || nameIssue || (mode === 'login' && !password)) {
      setMessage(issue ?? passwordIssue ?? nameIssue ?? 'Enter your password.');
      return;
    }
    if (['verify', 'recovery-code'].includes(mode) && !/^\d{6,10}$/.test(code.trim())) {
      setMessage('Enter the code from your email.');
      return;
    }
    working.current = true;
    setBusy(true);
    setMessage('');
    try {
      const address = email.trim();
      if (mode === 'login') {
        const result = await auth.client.signInWithPassword({ email: address, password });
        if (result.error) {
          if (result.error.code === 'email_not_confirmed') setMode('verify');
          throw result.error;
        }
        setPassword('');
      } else if (mode === 'signup') {
        const result = await auth.client.signUp({
          email: address,
          password,
          options: { data: { display_name: name.trim() } },
        });
        if (result.error) throw result.error;
        setPassword('');
        setMode('verify');
        setMessage(
          'If this address can be registered, a verification code is on its way. Enter it below.',
        );
      } else if (mode === 'recover') {
        const result = await auth.client.resetPasswordForEmail(address);
        if (result.error) throw result.error;
        setMode('recovery-code');
        setMessage('If there is an account for this address, a recovery code is on its way.');
      } else if (mode === 'verify' || mode === 'recovery-code') {
        const result = await auth.client.verifyOtp({
          email: address,
          token: code.trim(),
          type: mode === 'verify' ? 'signup' : 'recovery',
        });
        if (result.error) throw result.error;
        setCode('');
        if (mode === 'recovery-code') {
          await auth.beginRecovery();
          setMode('password');
          setPassword('');
        }
      } else {
        const result = await auth.client.updateUser({ password });
        if (result.error) throw result.error;
        setPassword('');
        await auth.finishRecovery();
      }
    } catch (error) {
      setMessage(authError(error));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function resend() {
    if (!auth.client || working.current) return;
    const issue = validateEmail(email);
    if (issue) {
      setMessage(issue);
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const result =
        mode === 'verify'
          ? await auth.client.resend({ type: 'signup', email: email.trim() })
          : await auth.client.resetPasswordForEmail(email.trim());
      if (result.error) throw result.error;
      setMessage(
        'If the address is eligible, a new code is on its way. Check your inbox and spam folder.',
      );
    } catch (error) {
      setMessage(authError(error));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  if (auth.state === 'ready' || ['blocked', 'unavailable', 'loading-profile'].includes(auth.state))
    return <Redirect href="/" />;
  const verifying = mode === 'verify' || mode === 'recovery-code';
  return (
    <Page>
      <Text style={styles.eyebrow}>YOUR ROAD STARTS HERE</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {titles[mode]}
      </Text>
      <Text style={styles.detail}>
        {mode === 'signup'
          ? 'A name for your group. A private email for your account.'
          : verifying
            ? 'Enter the code sent to your email. Your code stays out of browser links and history.'
            : mode === 'recover'
              ? 'Enter your email to request a password recovery code.'
              : mode === 'password'
                ? 'Set a new password to finish recovering your account.'
                : 'Sign in to open your profile and prepare for your next ride.'}
      </Text>
      {auth.state === 'not-configured' && (
        <Notice>
          Account sign-in needs the Supabase Auth address and public app key. Open the environment
          guide to finish setup.
        </Notice>
      )}
      {mode === 'signup' && (
        <Field
          label="Display name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoComplete="name"
          maxLength={160}
          editable={!busy}
        />
      )}
      {mode !== 'password' && (
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          maxLength={254}
          editable={!busy}
        />
      )}
      {['login', 'signup', 'password'].includes(mode) && (
        <Field
          label={mode === 'password' ? 'New password' : 'Password'}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          textContentType={mode === 'login' ? 'password' : 'newPassword'}
          maxLength={128}
          editable={!busy}
          onSubmitEditing={() => {
            void submit();
          }}
        />
      )}
      {['signup', 'password'].includes(mode) && (
        <Text style={styles.detail}>
          Use 12–128 characters. A long, unique passphrase works well.
        </Text>
      )}
      {verifying && (
        <Field
          label="Email code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={10}
          editable={!busy}
          onSubmitEditing={() => {
            void submit();
          }}
        />
      )}
      {!!message && <Notice>{message}</Notice>}
      <Button
        label={
          busy
            ? 'Please wait…'
            : mode === 'login'
              ? 'Sign in'
              : mode === 'signup'
                ? 'Create account'
                : mode === 'recover'
                  ? 'Send recovery code'
                  : mode === 'password'
                    ? 'Save new password'
                    : 'Verify code'
        }
        busy={busy}
        disabled={!auth.client}
        onPress={() => {
          void submit();
        }}
      />
      {verifying && (
        <Button
          label="Send a new code"
          secondary
          disabled={busy || !auth.client}
          onPress={() => {
            void resend();
          }}
        />
      )}
      {mode !== 'password' && (
        <View style={{ gap: 12 }}>
          <Button
            label={mode === 'login' ? 'Create an account' : 'Back to sign in'}
            secondary
            disabled={busy}
            onPress={() => switchMode(mode === 'login' ? 'signup' : 'login')}
          />
          {mode === 'login' && (
            <Button
              label="Forgot your password?"
              secondary
              disabled={busy}
              onPress={() => switchMode('recover')}
            />
          )}
        </View>
      )}
      {mode === 'password' && (
        <Button
          label="Cancel and sign out"
          secondary
          disabled={busy}
          onPress={() => {
            void auth.signOut().catch(() => undefined);
          }}
        />
      )}
      {Platform.OS === 'web' && (
        <Notice>
          In this browser preview, reloading ends your session. Use the mobile build for secure
          session restoration.
        </Notice>
      )}
      <Link href="/environment" style={styles.link}>
        Test environment details ↗
      </Link>
    </Page>
  );
}
