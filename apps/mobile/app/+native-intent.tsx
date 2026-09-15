import { parseInvitationLink } from '../src/rides/invitations';
import { receiveInvitation } from '../src/rides/private-session';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // Strip credentials before Expo Router can put them into navigation state.
  const credential = parseInvitationLink(path);
  if (credential) {
    receiveInvitation(credential);
    return '/join';
  }
  if (/join|token|invite/i.test(path)) {
    receiveInvitation(null);
    return '/join';
  }
  // Only known, credential-free destinations may enter from external URLs.
  if (['/', '/account', '/profile', '/rides', '/create', '/join'].includes(path)) return path;
  return '/';
}
