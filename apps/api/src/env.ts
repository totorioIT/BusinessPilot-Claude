import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://bp@localhost:5432/businesspilot'),
  /** Public base URL of the API, used to show webhook URLs in the dashboard. */
  PUBLIC_URL: z.string().default('http://localhost:3001'),
  /** Directory with the built dashboard; served at / when set. */
  DASHBOARD_DIST: z.string().optional(),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  RUN_JOBS: z.enum(['true', 'false']).default('true'),
  /** First start on an empty database: create the demo workshop with this owner login. */
  OWNER_EMAIL: z.string().email().optional(),
  OWNER_PASSWORD: z.string().min(10).optional(),
  OWNER_NAME: z.string().optional(),
  /** Commit the image was built from, shown by /api/health. */
  GIT_COMMIT: z.string().default('dev'),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
