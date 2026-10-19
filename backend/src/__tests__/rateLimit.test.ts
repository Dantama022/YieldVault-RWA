import express, { Request, Response } from 'express';
import request from 'supertest';
import { createLimiter, extractRateLimitKey, resolveClientIp, parseTrustProxyConfig } from '../rateLimiter';

function fakeReq(opts: {
  trustProxy?: unknown;
  ip?: string;
  remoteAddress?: string;
}): Request {
  return {
    headers: {},
    ip: opts.ip,
    socket: { remoteAddress: opts.remoteAddress },
    app: { get: (k: string) => (k === 'trust proxy' ? opts.trustProxy : undefined) },
  } as unknown as Request;
}

describe('rate limiter client IP resolution', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('assigns the same bucket key to different X-Forwarded-For values from one socket', () => {
    const a = fakeReq({ ip: '1.1.1.1', remoteAddress: '10.0.0.5' });
    const b = fakeReq({ ip: '2.2.2.2', remoteAddress: '10.0.0.5' });
    expect(extractRateLimitKey(a)).toBe('10.0.0.5');
    expect(extractRateLimitKey(b)).toBe('10.0.0.5');
  });

  it('uses req.ip when trust proxy is enabled', () => {
    const req = fakeReq({ trustProxy: true, ip: '1.1.1.1', remoteAddress: '10.0.0.5' });
    expect(resolveClientIp(req)).toBe('1.1.1.1');
  });

  it('warns once per app when trust proxy is unset', () => {
    const req = fakeReq({ ip: '1.1.1.1', remoteAddress: '10.0.0.5' });
    resolveClientIp(req);
    resolveClientIp(req);
    const warns = logSpy.mock.calls.filter(([m]) => String(m).includes('rate_limit_trust_proxy_unset'));
    expect(warns).toHaveLength(1);
  });

  it('does not warn when trust proxy is explicitly set', () => {
    resolveClientIp(fakeReq({ trustProxy: false, remoteAddress: '10.0.0.5' }));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('cannot be bypassed by rotating X-Forwarded-For (no trust proxy)', async () => {
    const app = express();
    app.get('/t', createLimiter({ tier: 'xff-test', max: 1, windowMs: 60000 }), (_q: Request, r: Response) => {
      r.json({ ok: true });
    });

    const first = await request(app).get('/t').set('X-Forwarded-For', '1.1.1.1');
    const second = await request(app).get('/t').set('X-Forwarded-For', '2.2.2.2');
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it('works for plain local dev requests without proxy headers', async () => {
    const app = express();
    app.get('/t', createLimiter({ tier: 'dev-test', max: 2, windowMs: 60000 }), (_q: Request, r: Response) => {
      r.json({ ok: true });
    });

    expect((await request(app).get('/t')).status).toBe(200);
    expect((await request(app).get('/t')).status).toBe(200);
    expect((await request(app).get('/t')).status).toBe(429);
  });
});

describe('TRUST_PROXY configuration and rate limiter integration (#1678)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('parseTrustProxyConfig', () => {
    it('defaults to 0 when absent or empty', () => {
      expect(parseTrustProxyConfig(undefined)).toBe(0);
      expect(parseTrustProxyConfig('')).toBe(0);
    });

    it('parses valid non-negative integer hop counts', () => {
      expect(parseTrustProxyConfig('0')).toBe(0);
      expect(parseTrustProxyConfig('1')).toBe(1);
      expect(parseTrustProxyConfig('2')).toBe(2);
      expect(parseTrustProxyConfig(' 3 ')).toBe(3);
    });

    it('rejects whitespace-only values with a descriptive error', () => {
      expect(() => parseTrustProxyConfig('   ')).toThrow(
        /Invalid TRUST_PROXY configuration: value cannot be whitespace-only/i,
      );
    });

    it('rejects negative numbers', () => {
      expect(() => parseTrustProxyConfig('-1')).toThrow(
        /TRUST_PROXY must be a non-negative integer hop count/i,
      );
    });

    it('rejects fractional numbers', () => {
      expect(() => parseTrustProxyConfig('1.5')).toThrow(
        /TRUST_PROXY must be a non-negative integer hop count/i,
      );
    });

    it('rejects non-numeric strings and booleans to prevent permissive true fallback', () => {
      expect(() => parseTrustProxyConfig('true')).toThrow(
        /TRUST_PROXY must be a non-negative integer hop count/i,
      );
      expect(() => parseTrustProxyConfig('yes')).toThrow(
        /TRUST_PROXY must be a non-negative integer hop count/i,
      );
      expect(() => parseTrustProxyConfig('none')).toThrow(
        /TRUST_PROXY must be a non-negative integer hop count/i,
      );
    });
  });

  describe('Express trust proxy rate-limit behavior with real middleware chain', () => {
    it('isolates different client IPs behind a trusted single-hop proxy (TRUST_PROXY=1)', async () => {
      const app = express();
      app.set('trust proxy', parseTrustProxyConfig('1'));
      app.get(
        '/api/test',
        createLimiter({ tier: 'test-proxy-1', max: 1, windowMs: 60000 }),
        (_req: Request, res: Response) => {
          res.json({ ok: true });
        },
      );

      // Client A makes request through proxy (X-Forwarded-For: 203.0.113.1)
      const resA1 = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '203.0.113.1');
      expect(resA1.status).toBe(200);

      // Client A hits the rate limit
      const resA2 = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '203.0.113.1');
      expect(resA2.status).toBe(429);

      // Client B from a different IP (203.0.113.2) is NOT blocked
      const resB1 = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '203.0.113.2');
      expect(resB1.status).toBe(200);
    });

    it('prevents IP spoofing: cannot rotate client IP when TRUST_PROXY=1', async () => {
      const app = express();
      app.set('trust proxy', parseTrustProxyConfig('1'));
      app.get(
        '/api/test-spoof',
        createLimiter({ tier: 'test-spoof', max: 1, windowMs: 60000 }),
        (_req: Request, res: Response) => {
          res.json({ ok: true });
        },
      );

      // Real client is 203.0.113.50. Client tries to prepend a fake IP 198.51.100.1.
      // The load balancer appends real client IP: "198.51.100.1, 203.0.113.50"
      const res1 = await request(app)
        .get('/api/test-spoof')
        .set('X-Forwarded-For', '198.51.100.1, 203.0.113.50');
      expect(res1.status).toBe(200);

      // Client attempts to spoof a new IP by rotating the prefix: "198.51.100.2, 203.0.113.50"
      // Express trust proxy (1 hop) resolves req.ip to the rightmost hop (203.0.113.50).
      // The rate limiter must see 203.0.113.50 and return 429.
      const res2 = await request(app)
        .get('/api/test-spoof')
        .set('X-Forwarded-For', '198.51.100.2, 203.0.113.50');
      expect(res2.status).toBe(429);
    });

    it('ignores X-Forwarded-For entirely when TRUST_PROXY=0 (direct connection)', async () => {
      const app = express();
      app.set('trust proxy', parseTrustProxyConfig('0'));
      app.get(
        '/api/test-direct',
        createLimiter({ tier: 'test-direct', max: 1, windowMs: 60000 }),
        (_req: Request, res: Response) => {
          res.json({ ok: true });
        },
      );

      // Request 1 with arbitrary XFF
      const res1 = await request(app)
        .get('/api/test-direct')
        .set('X-Forwarded-For', '203.0.113.10');
      expect(res1.status).toBe(200);

      // Request 2 with different XFF from the same socket is still rate limited
      const res2 = await request(app)
        .get('/api/test-direct')
        .set('X-Forwarded-For', '203.0.113.20');
      expect(res2.status).toBe(429);
    });

    it('works as expected without any X-Forwarded-For header', async () => {
      const app = express();
      app.set('trust proxy', parseTrustProxyConfig('1'));
      app.get(
        '/api/test-no-header',
        createLimiter({ tier: 'test-no-header', max: 1, windowMs: 60000 }),
        (_req: Request, res: Response) => {
          res.json({ ok: true });
        },
      );

      const res1 = await request(app).get('/api/test-no-header');
      expect(res1.status).toBe(200);

      const res2 = await request(app).get('/api/test-no-header');
      expect(res2.status).toBe(429);
    });
  });
});

