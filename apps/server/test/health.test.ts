import request from 'supertest';
import { expect, test } from 'vitest';
import { createTestApp } from './helpers/test-app';

test('GET /api/health', async () => {
  const { app } = await createTestApp();
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200); expect(res.body).toEqual({ ok: true });
});
