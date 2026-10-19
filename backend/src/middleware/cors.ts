import { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import { logger } from './structuredLogging';
import { sendApiError } from './apiError';

/**
 * CORS Configuration Middleware
 * 
 * Restricts cross-origin access to the API to only trusted frontend origins in production.
 * Supports an explicit allowlist of origins via environment variables.
 */

/**
 * Validates CORS configuration for the current environment.
 *
 * In production (`NODE_ENV === 'production'`), `CORS_ALLOWED_ORIGINS` is strictly required.
 * It must not be unset, empty, or whitespace-only. If it is invalid or missing, an Error
 * is thrown with clear remediation instructions so the application fails fast before listening.
 */
export function validateCorsConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    const origins = env.CORS_ALLOWED_ORIGINS;
    if (!origins || origins.trim().length === 0) {
      throw new Error(
        'Missing required environment variable: CORS_ALLOWED_ORIGINS is not set or is empty in production. ' +
        'Please set CORS_ALLOWED_ORIGINS to a comma-separated list of trusted origins (e.g., ' +
        'CORS_ALLOWED_ORIGINS="https://app.yieldvault.finance,https://www.yieldvault.finance") in your environment.'
      );
    }
  }
}

export const getCORSOrigins = (env: NodeJS.ProcessEnv = process.env): (string | RegExp)[] => {
  validateCorsConfig(env);
  const envOrigins = env.CORS_ALLOWED_ORIGINS;
  
  if (!envOrigins || envOrigins.trim().length === 0) {
    // In development, allow localhost by default if no origins are specified
    if (env.NODE_ENV !== 'production') {
      return [/http:\/\/localhost:\d+/];
    }
    return [];
  }

  return envOrigins.split(',').map(origin => {
    const trimmed = origin.trim();
    // Support regex patterns if origin is wrapped in / /
    if (trimmed.startsWith('/') && trimmed.endsWith('/')) {
      return new RegExp(trimmed.slice(1, -1));
    }
    return trimmed;
  });
};

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = getCORSOrigins();

    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }

    const currentAllowedOrigins = getCORSOrigins();
    const isAllowed = currentAllowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      logger.log('warn', 'CORS request blocked from unauthorized origin', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-api-key', 'x-idempotency-key', 'x-correlation-id'],
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};

/**
 * Custom CORS middleware wrapper to handle rejection with 403
 */
export const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  return cors(corsOptions)(req, res, (err) => {
    if (err) {
      sendApiError(req, res, {
        status: 403,
        code: 'AUTH_ORIGIN_FORBIDDEN',
        message: 'CORS policy: This origin is not allowed access.',
        retryable: false,
      });
      return;
    }

    next();
    return;
  });
};
