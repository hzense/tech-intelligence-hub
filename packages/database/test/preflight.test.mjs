import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { inspectProductionTls } from '../src/preflight.mjs';

const expectedHost = 'db.example.com';

function peerCertificate(host = expectedHost) {
  return {
    raw: Buffer.from('certificate'),
    subject: { CN: host },
    subjectaltname: `DNS:${host}`,
  };
}

function secureStream(overrides = {}) {
  return {
    encrypted: true,
    authorized: true,
    authorizationError: null,
    getProtocol: () => 'TLSv1.3',
    getCipher: () => ({ standardName: 'TLS_AES_256_GCM_SHA384' }),
    getPeerCertificate: () => peerCertificate(),
    ...overrides,
  };
}

function tlsClient({ rows, stream, rejectUnauthorized = true }) {
  return {
    ssl: { rejectUnauthorized },
    connectionParameters: { ssl: { rejectUnauthorized } },
    connection: { stream },
    query: vi.fn().mockResolvedValue({ rowCount: rows.length, rows }),
  };
}

describe('production TLS evidence', () => {
  it('prefers PostgreSQL catalog evidence when the server observes TLS', async () => {
    const client = tlsClient({
      rows: [{ ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }],
      stream: secureStream(),
    });

    await expect(inspectProductionTls(client, expectedHost)).resolves.toEqual({
      source: 'postgres+client',
      version: 'TLSv1.3',
      cipher: 'TLS_AES_256_GCM_SHA384',
    });
  });

  it('accepts an authenticated client TLS socket behind a provider proxy', async () => {
    const client = tlsClient({
      rows: [{ ssl: false, version: null, cipher: null }],
      stream: secureStream(),
    });

    await expect(inspectProductionTls(client, expectedHost)).resolves.toEqual({
      source: 'client',
      version: 'TLSv1.3',
      cipher: 'TLS_AES_256_GCM_SHA384',
    });
  });

  it('accepts TLS 1.2 when the authenticated client socket is otherwise valid', async () => {
    const client = tlsClient({
      rows: [{ ssl: false, version: null, cipher: null }],
      stream: secureStream({
        getProtocol: () => 'TLSv1.2',
        getCipher: () => ({ standardName: 'ECDHE-RSA-AES256-GCM-SHA384' }),
      }),
    });

    await expect(inspectProductionTls(client, expectedHost)).resolves.toEqual({
      source: 'client',
      version: 'TLSv1.2',
      cipher: 'ECDHE-RSA-AES256-GCM-SHA384',
    });
  });

  it.each([
    {
      label: 'an unauthorized certificate',
      stream: secureStream({ authorized: false, authorizationError: 'untrusted issuer' }),
    },
    {
      label: 'a lingering authorization error',
      stream: secureStream({ authorizationError: 'certificate expired' }),
    },
    {
      label: 'a plaintext socket',
      stream: secureStream({
        encrypted: false,
        authorized: false,
        getProtocol: () => undefined,
        getCipher: () => undefined,
      }),
    },
    {
      label: 'missing negotiated protocol and cipher details',
      stream: secureStream({ getProtocol: () => null, getCipher: () => null }),
    },
    {
      label: 'a peer certificate without raw certificate data',
      stream: secureStream({
        getPeerCertificate: () => ({ subjectaltname: `DNS:${expectedHost}` }),
      }),
    },
    {
      label: 'a certificate for a different host',
      stream: secureStream({ getPeerCertificate: () => peerCertificate('other.example.com') }),
    },
    {
      label: 'a deprecated TLS protocol',
      stream: secureStream({ getProtocol: () => 'TLSv1.1' }),
    },
  ])('rejects $label when PostgreSQL does not observe TLS', async ({ stream }) => {
    const client = tlsClient({ rows: [{ ssl: false, version: null, cipher: null }], stream });

    await expect(inspectProductionTls(client, expectedHost)).rejects.toThrow(
      'Production database session is not protected by observable TLS',
    );
  });

  it('rejects disabled certificate verification before trusting PostgreSQL catalog evidence', async () => {
    const client = tlsClient({
      rows: [{ ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }],
      stream: secureStream(),
      rejectUnauthorized: false,
    });

    await expect(inspectProductionTls(client, expectedHost)).rejects.toThrow(
      'Production database TLS certificate verification is disabled',
    );
    expect(client.query).not.toHaveBeenCalled();
  });

  it.each(['client', 'connectionParameters'])('rejects an explicit %s.ssl=false', async (field) => {
    const client = tlsClient({
      rows: [{ ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }],
      stream: secureStream(),
    });
    if (field === 'client') client.ssl = false;
    else client.connectionParameters.ssl = false;

    await expect(inspectProductionTls(client, expectedHost)).rejects.toThrow(
      'Production database TLS certificate verification is disabled',
    );
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rejects a deprecated protocol reported by PostgreSQL', async () => {
    const client = tlsClient({
      rows: [{ ssl: true, version: 'TLSv1.1', cipher: 'ECDHE-RSA-AES256-SHA' }],
      stream: secureStream(),
    });

    await expect(inspectProductionTls(client, expectedHost)).rejects.toThrow(
      'Production database session is not protected by observable TLS',
    );
  });
});
