import request from 'supertest';
import { expect, test } from 'vitest';
import { createApp } from '../src/app';
import { createTestDb } from './helpers/test-db';
import { testEnv } from './helpers/test-env';

test('GET /api/health', async () => {
  const app = createApp({ env: testEnv(), db: await createTestDb() });
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200); expect(res.body).toEqual({ ok: true });
});
