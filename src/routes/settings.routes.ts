import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';
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

  // Tự động khám phá / truy vấn danh sách model thật từ nhà cung cấp AI
  app.post('/api/v1/settings/models/discover', async (req, reply) => {
    const schema = z.object({
      type: z.enum(['gemini', 'openai', 'anthropic', 'openai-compatible', 'local', 'chatgpt-oauth']),
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
      providerId: z.string().uuid().optional()
    });
    const body = parseOrThrow(schema, req.body);

    let key = body.apiKey?.trim();
    let url = body.baseUrl?.trim();

    if (!key && body.providerId) {
      const stored = settingsStore.get().providers.find((p) => p.id === body.providerId);
      if (stored?.apiKey) key = stored.apiKey;
      if (!url && stored?.baseUrl) url = stored.baseUrl;
    }

    const models = await discoverProviderModels(body.type, key, url);
    return reply.send({ success: true, data: { models } });
  });
}

interface DiscoveredModel {
  id: string;
  name: string;
  recommended?: boolean;
}

async function discoverProviderModels(
  type: string,
  apiKey?: string,
  baseUrl?: string
): Promise<DiscoveredModel[]> {
  if (type === 'gemini') {
    if (!apiKey) {
      return [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Khuyên dùng)', recommended: true },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Mạnh nhất)' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
      ];
    }
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as any;
        throw new AppError(err?.error?.message || `Lỗi từ Google Gemini: HTTP ${res.status}`, 400);
      }
      const data = (await res.json()) as {
        models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
      };
      const list: DiscoveredModel[] = [];
      for (const m of data.models ?? []) {
        if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
        const cleanId = m.name.replace(/^models\//, '');
        if (!cleanId.startsWith('gemini')) continue;
        const isRec = cleanId === 'gemini-2.5-flash' || cleanId === 'gemini-2.0-flash';
        list.push({
          id: cleanId,
          name: `${m.displayName || cleanId}${isRec ? ' (Khuyên dùng)' : ''}`,
          recommended: isRec
        });
      }
      list.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
      return list.length > 0
        ? list
        : [
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Khuyên dùng)', recommended: true },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
          ];
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      return [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Khuyên dùng)', recommended: true },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Mạnh nhất)' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
      ];
    }
  }

  if (type === 'openai') {
    if (!apiKey) {
      return [
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Khuyên dùng)', recommended: true },
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'o3-mini', name: 'o3-mini' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' }
      ];
    }
    try {
      const endpoint = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/models`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as any;
        throw new AppError(err?.error?.message || `Lỗi từ OpenAI: HTTP ${res.status}`, 400);
      }
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const chatPrefixes = ['gpt-4', 'gpt-3.5', 'o1', 'o3', 'chatgpt'];
      const list: DiscoveredModel[] = [];
      for (const m of data.data ?? []) {
        if (chatPrefixes.some((p) => m.id.startsWith(p))) {
          const isRec = m.id === 'gpt-4o-mini';
          list.push({
            id: m.id,
            name: `${m.id}${isRec ? ' (Khuyên dùng)' : ''}`,
            recommended: isRec
          });
        }
      }
      list.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
      return list.length > 0 ? list : [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini', recommended: true }];
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      return [
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Khuyên dùng)', recommended: true },
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'o3-mini', name: 'o3-mini' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' }
      ];
    }
  }

  if (type === 'anthropic') {
    return [
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Mới nhất & Khuyên dùng)', recommended: true },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Nhanh)' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
    ];
  }

  if (type === 'local' || type === 'openai-compatible') {
    const root = (baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    try {
      const res = await fetch(`${root}/v1/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        if (Array.isArray(data.data) && data.data.length > 0) {
          return data.data.map((m) => ({ id: m.id, name: m.id }));
        }
      }
      const ollamaRes = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (ollamaRes.ok) {
        const odata = (await ollamaRes.json()) as { models?: Array<{ name: string }> };
        if (Array.isArray(odata.models) && odata.models.length > 0) {
          return odata.models.map((m) => ({ id: m.name, name: m.name }));
        }
      }
    } catch {
      // fallback nếu chưa bật server local
    }
    return [
      { id: 'llama3.2', name: 'Llama 3.2 (Local)' },
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 (Local)' },
      { id: 'deepseek-r1:8b', name: 'DeepSeek R1 (Local)' },
      { id: 'meditron:7b', name: 'Meditron 7B (Chuyên Y khoa)' }
    ];
  }

  return [];
}
