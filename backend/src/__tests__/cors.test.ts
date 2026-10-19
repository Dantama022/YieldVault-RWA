import request from 'supertest';
import express, { Express } from 'express';
import { corsMiddleware, validateCorsConfig, getCORSOrigins } from '../middleware/cors';

describe('CORS Middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Configuration validation (#1677)', () => {
    it('fails fast when NODE_ENV=production and CORS_ALLOWED_ORIGINS is unset', () => {
      delete process.env.CORS_ALLOWED_ORIGINS;
      process.env.NODE_ENV = 'production';

      expect(() => validateCorsConfig()).toThrow(
        /Missing required environment variable: CORS_ALLOWED_ORIGINS is not set or is empty in production/i,
      );
      expect(() => getCORSOrigins()).toThrow(
        /Missing required environment variable: CORS_ALLOWED_ORIGINS/i,
      );
    });

    it('fails fast when NODE_ENV=production and CORS_ALLOWED_ORIGINS is empty', () => {
      process.env.CORS_ALLOWED_ORIGINS = '';
      process.env.NODE_ENV = 'production';

      expect(() => validateCorsConfig()).toThrow(
        /Missing required environment variable: CORS_ALLOWED_ORIGINS is not set or is empty in production/i,
      );
    });

    it('fails fast when NODE_ENV=production and CORS_ALLOWED_ORIGINS is whitespace-only', () => {
      process.env.CORS_ALLOWED_ORIGINS = '   \t  \n  ';
      process.env.NODE_ENV = 'production';

      expect(() => validateCorsConfig()).toThrow(
        /Missing required environment variable: CORS_ALLOWED_ORIGINS is not set or is empty in production/i,
      );
    });

    it('provides clear corrective instructions in the error message', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.CORS_ALLOWED_ORIGINS;

      expect(() => validateCorsConfig()).toThrow(
        /Please set CORS_ALLOWED_ORIGINS to a comma-separated list of trusted origins/i,
      );
    });

    it('allows valid origins in production without wildcard fallback', () => {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ALLOWED_ORIGINS = 'https://app.yieldvault.finance, https://admin.yieldvault.finance';

      expect(() => validateCorsConfig()).not.toThrow();
      const origins = getCORSOrigins();
      expect(origins).toEqual([
        'https://app.yieldvault.finance',
        'https://admin.yieldvault.finance',
      ]);
      expect(origins).not.toContain('*');
    });

    it('leaves development behavior unchanged when CORS_ALLOWED_ORIGINS is unset', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CORS_ALLOWED_ORIGINS;

      expect(() => validateCorsConfig()).not.toThrow();
      const origins = getCORSOrigins();
      expect(origins).toHaveLength(1);
      expect(origins[0]).toBeInstanceOf(RegExp);
      expect((origins[0] as RegExp).test('http://localhost:3000')).toBe(true);
    });

    it('respects explicitly configured origins in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173,http://localhost:3000';

      expect(() => validateCorsConfig()).not.toThrow();
      const origins = getCORSOrigins();
      expect(origins).toEqual(['http://localhost:5173', 'http://localhost:3000']);
    });
  });

  describe('HTTP request handling', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      process.env.CORS_ALLOWED_ORIGINS = 'http://trusted-frontend.com,https://app.yieldvault.finance';
      process.env.NODE_ENV = 'production';

      app.use(corsMiddleware);
      app.get('/test', (req, res) => {
        res.status(200).json({ message: 'Success' });
      });
    });

    it('should allow requests from a trusted origin', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'http://trusted-frontend.com');

      expect(response.status).toBe(200);
      expect(response.header['access-control-allow-origin']).toBe('http://trusted-frontend.com');
      expect(response.header['access-control-allow-credentials']).toBe('true');
    });

    it('should allow requests from another trusted origin', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'https://app.yieldvault.finance');

      expect(response.status).toBe(200);
      expect(response.header['access-control-allow-origin']).toBe('https://app.yieldvault.finance');
    });

    it('should reject requests from an untrusted origin with 403', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'http://malicious-site.com');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(response.body).toHaveProperty('message', 'CORS policy: This origin is not allowed access.');
      expect(response.header['access-control-allow-origin']).toBeUndefined();
    });

    it('should allow requests with no origin (e.g., mobile apps, curl)', async () => {
      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Success');
    });

    it('should return correct headers for preflight OPTIONS requests from trusted origin', async () => {
      const response = await request(app)
        .options('/test')
        .set('Origin', 'http://trusted-frontend.com')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBe(200);
      expect(response.header['access-control-allow-origin']).toBe('http://trusted-frontend.com');
      expect(response.header['access-control-allow-methods']).toContain('POST');
    });

    it('should reject preflight OPTIONS requests from untrusted origin with 403', async () => {
      const response = await request(app)
        .options('/test')
        .set('Origin', 'http://malicious-site.com')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBe(403);
    });
  });
});

