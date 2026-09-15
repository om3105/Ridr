export type InvitationCredential =
  | { code: string; token?: never }
  | { token: string; code?: never };

export const invitationCodePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;
export const invitationTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export class InvitationError extends Error {
  constructor() {
    super('Enter a valid 10-character invitation code or Ridr invitation link.');
  }
}

/** Accept only the invitation route; never follow an arbitrary scanned URL. */
export function parseInvitationLink(input: string): { token: string } | null {
  const match = /^(?:ridr|ridr-dev):\/\/join\?token=([A-Za-z0-9_-]{43})$/.exec(input);
  return match?.[1] ? { token: match[1] } : null;
}

export function parseInvitation(input: string): InvitationCredential {
  if (input.length > 512) throw new InvitationError();
  const value = input.trim();
  const code = value.replace(/[ -]/g, '').toUpperCase();
  if (invitationCodePattern.test(code)) return { code };
  const credential = parseInvitationLink(value);
  if (credential) return credential;
  throw new InvitationError();
}
