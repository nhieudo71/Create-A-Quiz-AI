import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { AppError } from '../core/errors';
import { parseOrThrow, uuidParamsSchema } from '../core/validation/schemas';
import { settingsStore } from '../modules/settings/settings.store';
import { providerConfigSchema, PROVIDER_META } from '../modules/settings/settings.types';
import {
  createProviderBodySchema,
  updateAISettingsBodySchema,
  updateProviderBodySchema
} from '../modules/settings/settings.requests';
import { beginChatGPTLogin, getChatGPTLoginStatus } from '../modules/settings/oauth.server';
import { createProvider } from '../modules/ai-generator/providers/factory';

export function registerSettingsRoutes(app: FastifyInstance): void {
  // ============================================================================
  // 5. CÀI ĐẶT: NHÀ CUNG CẤP AI
  // ============================================================================
  app.get('/api/v1/settings', async (req, reply) => {
    return reply.send({ success: true, data: settingsStore.toPublic() });
  });

  app.patch('/api/v1/settings/ai', async (req, reply) => {
    const body = parseOrThrow(updateAISettingsBodySchema, req.body);
    const settings = settingsStore.updateAI(body);
    return reply.send({ success: true, data: settingsStore.toPublic(settings) });
  });

  app.post('/api/v1/settings/providers', async (req, reply) => {
    const body = parseOrThrow(createProviderBodySchema, req.body);
    const meta = PROVIDER_META[body.type];
    const provider = providerConfigSchema.parse({
      id: randomUUID(),
      type: body.type,
      label: body.label,
      model: body.model || meta.defaultModel,
      baseUrl: body.baseUrl ?? null,
      apiKey: body.apiKey ?? null,
      enabled: body.enabled,
      oauth: null,
      createdAt: new Date().toISOString()
    });
    const settings = settingsStore.upsertProvider(provider);
    return reply.status(201).send({ success: true, data: settingsStore.toPublic(settings) });
  });

  app.patch('/api/v1/settings/providers/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const body = parseOrThrow(updateProviderBodySchema, req.body);
    const current = settingsStore.get().providers.find((p) => p.id === id);
    if (!current) throw new AppError('Không tìm thấy nhà cung cấp AI này.', 404);

    const updated = {
      ...current,
      ...body,
      // apiKey undefined = giữ nguyên; chuỗi rỗng/null = xoá khoá đang lưu
      apiKey: body.apiKey === undefined ? current.apiKey : body.apiKey || null,
      baseUrl: body.baseUrl === undefined ? current.baseUrl : body.baseUrl || null
    };
    const settings = settingsStore.upsertProvider(providerConfigSchema.parse(updated));
    return reply.send({ success: true, data: settingsStore.toPublic(settings) });
  });

  app.delete('/api/v1/settings/providers/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const settings = settingsStore.removeProvider(id);
    return reply.send({ success: true, data: settingsStore.toPublic(settings) });
  });

  app.post('/api/v1/settings/providers/:id/test', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const config = settingsStore.get().providers.find((p) => p.id === id);
    if (!config) throw new AppError('Không tìm thấy nhà cung cấp AI này.', 404);

    const provider = createProvider(config);
    const result = await provider.testConnection();
    return reply.send({ success: true, data: result });
  });

  // Đăng nhập ChatGPT OAuth (thử nghiệm, xem oauth.service.ts)
  app.post('/api/v1/settings/providers/:id/oauth/start', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const config = settingsStore.get().providers.find((p) => p.id === id);
    if (!config) throw new AppError('Không tìm thấy nhà cung cấp AI này.', 404);
    if (config.type !== 'chatgpt-oauth') {
      throw new AppError('Nhà cung cấp này không dùng đăng nhập OAuth.', 400);
    }
    const { authorizeUrl } = await beginChatGPTLogin(id);
    return reply.send({ success: true, data: { authorizeUrl } });
  });

  app.get('/api/v1/settings/providers/:id/oauth/status', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const status = getChatGPTLoginStatus(id);
    return reply.send({ success: true, data: status });
  });
}
