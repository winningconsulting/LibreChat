import type { IUser } from '@librechat/data-schemas';
import type { UpstreamTokenProvider } from './oauth/obo';
import { isRetryableOboExchangeError } from './oauth/obo';
import { MCPAuthenticationRefreshError } from './errors';
import { OpenIDReauthRequiredError } from '~/utils/oidc';
import { userWithUpstreamAccessToken } from '~/utils/graph';
import { isOwnedAbortError } from '~/utils/errors';

const GRAPH_REAUTH_MESSAGE =
  'Microsoft 365 needs a fresh sign-in. Please sign out and sign in again.';

/**
 * Replaces the request-time token snapshot with the live session tokens before a Graph
 * placeholder is exchanged. A missing Express session falls through to that snapshot.
 * A rejected refresh fails closed instead of leaving the placeholder for Graph to reject.
 */
export async function refreshUserForGraphToken({
  user,
  upstreamTokenProvider,
  signal,
}: {
  user: IUser;
  upstreamTokenProvider?: UpstreamTokenProvider;
  signal?: AbortSignal;
}): Promise<IUser> {
  if (!upstreamTokenProvider) {
    return user;
  }

  let tokens;
  try {
    tokens = await upstreamTokenProvider(signal ? { signal } : undefined);
    signal?.throwIfAborted();
  } catch (error) {
    if (isOwnedAbortError(error, signal) || signal?.aborted) {
      throw error;
    }
    if (isRetryableOboExchangeError(error)) {
      throw new MCPAuthenticationRefreshError(error);
    }
    const reauthError = new OpenIDReauthRequiredError(GRAPH_REAUTH_MESSAGE);
    reauthError.cause = error;
    throw reauthError;
  }

  if (!tokens?.access_token) {
    return user;
  }

  return userWithUpstreamAccessToken(user, tokens);
}
