import request from 'supertest';
import express from 'express';
import { specs, setupSwagger, isSwaggerEnabled } from '../swagger';

describe('OpenAPI documentation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const spec = specs as unknown as {
    openapi: string;
    info: { title: string; description: string };
    paths: Record<string, unknown>;
    components: { securitySchemes?: Record<string, unknown> };
  };

  it('produces a valid OpenAPI 3.1 spec with documented paths', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toContain('YieldVault');
    const paths = Object.keys(spec.paths ?? {});
    expect(paths).toEqual(
      expect.arrayContaining([
        '/health',
        '/auth/login',
        '/api/v1/vault/deposits',
        '/admin/webhooks',
      ]),
    );
  });

  it('documents authentication and rate limiting', () => {
    const components = spec.components as { securitySchemes?: Record<string, unknown> };
    expect(components.securitySchemes).toBeDefined();
    expect(components.securitySchemes?.apiKeyAuth).toBeDefined();
    expect(components.securitySchemes?.bearerAuth).toBeDefined();
    expect(spec.info.description).toMatch(/Rate limit/i);
  });

  it('documents the indexer health dependency', () => {
    const health = spec.paths['/health'] as {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { $ref: string };
              };
            };
          };
        };
      };
    };
    expect(health.get.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/HealthResponse',
    );
  });

  describe('isSwaggerEnabled policy (#1674)', () => {
    it('is disabled by default in production', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
      expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: undefined })).toBe(false);
      expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: '' })).toBe(false);
    });

    it('is enabled in production when SWAGGER_ENABLED=true', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })).toBe(true);
    });

    it('rejects invalid or missing SWAGGER_ENABLED values in production', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: '1' })).toBe(false);
      expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'yes' })).toBe(false);
      expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'TRUE' })).toBe(false);
      expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'false' })).toBe(false);
    });

    it('is disabled in production even if SWAGGER_ENABLED=true when DISABLE_SWAGGER=true', () => {
      expect(
        isSwaggerEnabled({
          NODE_ENV: 'production',
          SWAGGER_ENABLED: 'true',
          DISABLE_SWAGGER: 'true',
        }),
      ).toBe(false);
    });

    it('is enabled by default in development', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
      expect(isSwaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' })).toBe(true);
    });

    it('is enabled by default in test', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
    });

    it('is enabled when NODE_ENV is unset or empty', () => {
      expect(isSwaggerEnabled({})).toBe(true);
      expect(isSwaggerEnabled({ NODE_ENV: '' })).toBe(true);
    });

    it('is disabled in non-production when DISABLE_SWAGGER=true', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'development', DISABLE_SWAGGER: 'true' })).toBe(false);
      expect(isSwaggerEnabled({ NODE_ENV: 'test', DISABLE_SWAGGER: 'true' })).toBe(false);
      expect(isSwaggerEnabled({ DISABLE_SWAGGER: 'true' })).toBe(false);
    });
  });

  describe('HTTP mount behavior', () => {
    it('serves the spec and Swagger UI over HTTP in non-production', async () => {
      delete process.env.DISABLE_SWAGGER;
      delete process.env.SWAGGER_ENABLED;
      process.env.NODE_ENV = 'development';

      const app = express();
      setupSwagger(app);

      const res = await request(app).get('/docs/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');

      const ui = await request(app).get('/docs/');
      expect(ui.status).toBe(200);
      expect(ui.text).toMatch(/swagger/i);
    });

    it('does not mount Swagger UI or openapi.json in production by default', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SWAGGER_ENABLED;
      delete process.env.DISABLE_SWAGGER;

      const app = express();
      setupSwagger(app);

      const res = await request(app).get('/docs/openapi.json');
      expect(res.status).toBe(404);

      const ui = await request(app).get('/docs/');
      expect(ui.status).toBe(404);
    });

    it('mounts Swagger UI and openapi.json in production when SWAGGER_ENABLED=true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SWAGGER_ENABLED = 'true';
      delete process.env.DISABLE_SWAGGER;

      const app = express();
      setupSwagger(app);

      const res = await request(app).get('/docs/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');

      const ui = await request(app).get('/docs/');
      expect(ui.status).toBe(200);
      expect(ui.text).toMatch(/swagger/i);
    });

    it('does not mount Swagger in production when SWAGGER_ENABLED=true but DISABLE_SWAGGER=true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SWAGGER_ENABLED = 'true';
      process.env.DISABLE_SWAGGER = 'true';

      const app = express();
      setupSwagger(app);

      const res = await request(app).get('/docs/openapi.json');
      expect(res.status).toBe(404);

      const ui = await request(app).get('/docs/');
      expect(ui.status).toBe(404);
    });
  });
});

