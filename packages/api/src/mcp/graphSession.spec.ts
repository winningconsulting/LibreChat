import type { IUser } from '@librechat/data-schemas';
import { MCPAuthenticationRefreshError } from './errors';
import { refreshUserForGraphToken } from './graphSession';
import { OpenIDReauthRequiredError } from '~/utils/oidc';

const user = { id: 'user-1', federatedTokens: { access_token: 'snapshot' } } as IUser;

describe('refreshUserForGraphToken', () => {
  it('keeps the request snapshot when there is no live session to refresh', async () => {
    await expect(refreshUserForGraphToken({ user })).resolves.toBe(user);
  });

  it('uses the live access token when the session can refresh it', async () => {
    const upstreamTokenProvider = jest.fn().mockResolvedValue({
      access_token: 'live-access',
      id_token: 'live-id',
      expires_at: 1_800_000_000,
    });

    const refreshed = await refreshUserForGraphToken({ user, upstreamTokenProvider });

    expect(refreshed.federatedTokens?.access_token).toBe('live-access');
    expect(user.federatedTokens?.access_token).toBe('snapshot');
  });

  it('keeps the snapshot when the session has no upstream token', async () => {
    const upstreamTokenProvider = jest.fn().mockResolvedValue(null);
    await expect(refreshUserForGraphToken({ user, upstreamTokenProvider })).resolves.toBe(user);
  });

  it('leaves a cancelled refresh as a cancellation', async () => {
    const controller = new AbortController();
    const reason = new Error('stopped');
    const upstreamTokenProvider = jest.fn(async () => {
      controller.abort(reason);
      throw reason;
    });

    await expect(
      refreshUserForGraphToken({ user, upstreamTokenProvider, signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it('asks for a new sign-in when the refresh is rejected', async () => {
    const upstreamTokenProvider = jest.fn().mockRejectedValue(new Error('invalid_grant'));
    await expect(refreshUserForGraphToken({ user, upstreamTokenProvider })).rejects.toBeInstanceOf(
      OpenIDReauthRequiredError,
    );
  });

  it('reports a temporary failure when the refresh itself is unavailable', async () => {
    const upstreamTokenProvider = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('upstream timeout'), { retryable: true }));
    await expect(refreshUserForGraphToken({ user, upstreamTokenProvider })).rejects.toBeInstanceOf(
      MCPAuthenticationRefreshError,
    );
  });
});
