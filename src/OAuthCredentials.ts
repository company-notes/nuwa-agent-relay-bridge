import { BridgeError } from './BridgeError.js';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

import { PrivateJSON } from './PrivateJSON.js';

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number };
type SavedCredentials = { origin: string; client_id: string; access_token: string; refresh_token?: string; expires_at: number | null };

export class OAuthCredentials
{
  private static readonly origin = 'https://address.company-notes.com';
  private static readonly callbackPort = 43183;
  private static readonly redirectURI = 'http://127.0.0.1:43183/oauth/callback';

  constructor(private readonly storage: PrivateJSON) {}

  private async request<T>(path: string, body: URLSearchParams | string): Promise<T>
  {
    const response = await fetch(OAuthCredentials.origin + path, {
      method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': typeof body === 'string' ? 'application/json' : 'application/x-www-form-urlencoded' },
    });

    if (!response.ok)
    {
      throw new BridgeError('Agent Address OAuth request failed: HTTP ' + response.status);
    }

    return await response.json() as T;
  }

  private save(clientID: string, tokens: Tokens, previousRefresh?: string): SavedCredentials
  {
    if (typeof tokens.access_token !== 'string' || !tokens.access_token)
    {
      throw new BridgeError('OAuth response lacks an access token.');
    }

    const credentials: SavedCredentials = {
      origin: OAuthCredentials.origin, client_id: clientID,
      access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? previousRefresh,
      expires_at: typeof tokens.expires_in === 'number' ? Date.now() + tokens.expires_in * 1000 : null,
    };
    this.storage.write(credentials);
    return credentials;
  }

  private async receiveCode(state: string, authorizeURL: URL): Promise<string>
  {
    let complete: (code: string) => void;
    let fail: (error: Error) => void;
    const code = new Promise<string>((resolve, reject) =>
    {
      complete = resolve;
      fail = reject;
    });
    const server = createServer((request, response) =>
    {
      const url = new URL(request.url ?? '/', OAuthCredentials.redirectURI);

      if (url.pathname !== '/oauth/callback' || url.searchParams.get('state') !== state)
      {
        response.writeHead(400).end('Invalid OAuth callback.');
        return;
      }

      const authorizationCode = url.searchParams.get('code');

      if (!authorizationCode || url.searchParams.has('error'))
      {
        response.writeHead(400).end('Authorization did not complete.');
        fail(new BridgeError('OAuth authorization did not complete.'));
        return;
      }

      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' })
        .end('Authorization complete. Return to the Nuwa Bridge terminal.');
      complete(authorizationCode);
    });
    server.once('error', error => fail(error));
    const timer = setTimeout(() => fail(new BridgeError('OAuth authorization timed out.')), 180_000);

    try
    {
      server.listen(OAuthCredentials.callbackPort, '127.0.0.1', () =>
      {
        console.log('Open this authorization URL in your browser:');
        console.log(authorizeURL.href);
      });
      return await code;
    }
    finally
    {
      clearTimeout(timer);
      server.close();
    }
  }

  async login(): Promise<void>
  {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(24).toString('base64url');
    const registration = await this.request<{ client_id: string }>('/register', JSON.stringify({
      client_name: 'Nuwa Agent Relay Bridge', redirect_uris: [OAuthCredentials.redirectURI],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none',
    }));

    if (!registration.client_id)
    {
      throw new BridgeError('OAuth registration did not return a client identifier.');
    }

    const authorizeURL = new URL('/authorize', OAuthCredentials.origin);
    authorizeURL.search = new URLSearchParams({
      response_type: 'code', client_id: registration.client_id, redirect_uri: OAuthCredentials.redirectURI,
      state, code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();
    const code = await this.receiveCode(state, authorizeURL);
    const tokens = await this.request<Tokens>('/token', new URLSearchParams({
      grant_type: 'authorization_code', client_id: registration.client_id,
      redirect_uri: OAuthCredentials.redirectURI, code, code_verifier: verifier,
    }));

    this.save(registration.client_id, tokens);
  }

  async accessToken(): Promise<string>
  {
    const saved = this.storage.read<SavedCredentials>();

    if (saved.origin !== OAuthCredentials.origin || !saved.access_token || !saved.client_id)
    {
      throw new BridgeError('Invalid saved Nuwa authorization.');
    }

    if (saved.expires_at === null || saved.expires_at > Date.now() + 60_000)
    {
      return saved.access_token;
    }

    if (!saved.refresh_token)
    {
      throw new BridgeError('Nuwa authorization expired; administrator recovery is required.');
    }

    const tokens = await this.request<Tokens>('/token', new URLSearchParams({
      grant_type: 'refresh_token', client_id: saved.client_id, refresh_token: saved.refresh_token,
    }));
    return this.save(saved.client_id, tokens, saved.refresh_token).access_token;
  }
}
