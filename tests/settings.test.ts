import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

// DB_DATA_DIR=memory:// khiến SettingsStore không ghi xuống đĩa (xem settings.store.ts),
// nên test này không chạm tới hệ thống file hay CSDL thật.
process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';

describe('API: Cài đặt nhà cung cấp AI', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    app = buildApp({ disableRateLimit: true });
    closeDatabase = dbModule.closeDatabase;
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it('GET /api/v1/settings trả bảng providerMeta cho mọi loại provider', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/settings' });
    assert.equal(res.statusCode, 200);
    const data = res.json().data;
    assert.deepEqual(data.providers, []);
    assert.ok(data.providerMeta.gemini);
    assert.ok(data.providerMeta.openai);
    assert.ok(data.providerMeta.anthropic);
    assert.ok(data.providerMeta['openai-compatible']);
    assert.ok(data.providerMeta.local);
    assert.ok(data.providerMeta['chatgpt-oauth']);
  });

  it('POST /api/v1/settings/providers tạo provider và KHÔNG trả lại khoá API thật', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/providers',
      payload: { type: 'openai', label: 'OpenAI của tôi', model: 'gpt-4o-mini', apiKey: 'sk-bi-mat-123' }
    });
    assert.equal(res.statusCode, 201);
    const providers = res.json().data.providers;
    assert.equal(providers.length, 1);
    assert.equal(providers[0].hasApiKey, true);
    assert.equal('apiKey' in providers[0], false);
    assert.ok(!JSON.stringify(res.json()).includes('sk-bi-mat-123'));
  });

  it('POST /api/v1/settings/providers: thiếu label -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/providers',
      payload: { type: 'openai', label: '' }
    });
    assert.equal(res.statusCode, 400);
  });

  it('POST /api/v1/settings/providers: loại không hợp lệ -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/providers',
      payload: { type: 'chatgpt', label: 'X' }
    });
    assert.equal(res.statusCode, 400);
  });

  it('local provider không cần apiKey vẫn tạo được', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/providers',
      payload: { type: 'local', label: 'Ollama máy tôi', model: 'qwen2.5:7b' }
    });
    assert.equal(res.statusCode, 201);
    const created = res.json().data.providers.find((p: any) => p.label === 'Ollama máy tôi');
    assert.equal(created.hasApiKey, false);
    assert.equal(created.type, 'local');
  });

  it('PATCH /api/v1/settings/providers/:id cập nhật model, không đổi khoá nếu không gửi apiKey', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/providers',
      payload: { type: 'anthropic', label: 'Claude', model: 'claude-x', apiKey: 'sk-ant-abc' }
    });
    const id = createRes.json().data.providers.find((p: any) => p.label === 'Claude').id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/settings/providers/${id}`,
      payload: { model: 'claude-y' }
    });
    assert.equal(patchRes.statusCode, 200);
    const updated = patchRes.json().data.providers.find((p: any) => p.id === id);
    assert.equal(updated.model, 'claude-y');
    assert.equal(updated.hasApiKey, true);
  });

  it('PATCH với apiKey rỗng thì xoá khoá đang lưu', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/providers',
      payload: { type: 'openai-compatible', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_x' }
    });
    const id = createRes.json().data.providers.find((p: any) => p.label === 'Groq').id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/settings/providers/${id}`,
      payload: { apiKey: '' }
    });
    const updated = patchRes.json().data.providers.find((p: any) => p.id === id);
    assert.equal(updated.hasApiKey, false);
  });

  it('PATCH provider không tồn tại -> 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings/providers/11111111-1111-4111-8111-111111111111',
      payload: { model: 'x' }
    });
    assert.equal(res.statusCode, 404);
  });

  it('DELETE /api/v1/settings/providers/:id xoá provider', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/providers',
      payload: { type: 'gemini', label: 'Tạm xoá', apiKey: 'key' }
    });
    const id = createRes.json().data.providers.find((p: any) => p.label === 'Tạm xoá').id;

    const delRes = await app.inject({ method: 'DELETE', url: `/api/v1/settings/providers/${id}` });
    assert.equal(delRes.statusCode, 200);
    assert.equal(delRes.json().data.providers.some((p: any) => p.id === id), false);
  });

  it('PATCH /api/v1/settings/ai cập nhật activeProviderId và temperature', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/providers',
      payload: { type: 'gemini', label: 'Gemini chính', apiKey: 'key' }
    });
    const id = createRes.json().data.providers.find((p: any) => p.label === 'Gemini chính').id;

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings/ai',
      payload: { activeProviderId: id, temperature: 0.5 }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.ai.activeProviderId, id);
    assert.equal(res.json().data.ai.temperature, 0.5);
  });

  it('PATCH /api/v1/settings/ai: temperature ngoài khoảng -> 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/settings/ai', payload: { temperature: 5 } });
    assert.equal(res.statusCode, 400);
  });

  it('nhà cung cấp chưa đăng nhập OAuth: test connection trả ok=false, không 500', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/providers',
      payload: { type: 'chatgpt-oauth', label: 'ChatGPT' }
    });
    const id = createRes.json().data.providers.find((p: any) => p.label === 'ChatGPT').id;

    const res = await app.inject({ method: 'POST', url: `/api/v1/settings/providers/${id}/test` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.ok, false);
  });
});


