export function validateDisplayName(value: string): string | null {
  const name = value.trim();
  if (!name || [...name].length > 80) return 'Use a name between 1 and 80 characters.';
  if (
    Array.from(value).some((point) => {
      const code = point.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159) || point === '<' || point === '>';
    })
  )
    return 'Use a name without line breaks, control characters, or angle brackets.';
  return null;
}

export function validateEmail(value: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 254
    ? null
    : 'Enter a valid email address.';
}

export function validatePassword(value: string): string | null {
  return value.length >= 12 && value.length <= 128
    ? null
    : 'Use a password between 12 and 128 characters.';
}

export function authError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'invalid_credentials') return 'The email or password is incorrect. Try again.';
  if (code === 'email_not_confirmed')
    return 'Verify your email with the code in your inbox before signing in.';
  if (code === 'otp_expired') return 'That code has expired or is incorrect. Request a new code.';
  if (code === 'weak_password') return 'Choose a stronger password with at least 12 characters.';
  if (code === 'same_password') return 'Choose a password you have not used for this account.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit')
    return 'Too many attempts. Wait a minute before trying again.';
  if (code === 'signup_disabled') return 'New accounts are currently unavailable. Try again later.';
  return 'We could not complete that request. Check your connection and try again.';
}
