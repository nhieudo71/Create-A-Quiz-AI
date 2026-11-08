import { z } from 'zod';
import { PROVIDER_TYPES } from './settings.types';

/**
 * Schema cho các request chỉnh sửa cấu hình provider.
 * Tách khỏi settings.types.ts (schema lưu trữ) vì request KHÔNG có id/createdAt
 * (server tự sinh) và field nào cũng optional khi cập nhật.
 */
export const createProviderBodySchema = z.object({
  type: z.enum(PROVIDER_TYPES),
  label: z.string().trim().min(1, 'Tên hiển thị không được để trống').max(80),
  model: z.string().trim().max(160).optional().default(''),
  baseUrl: z.string().trim().max(500).nullish(),
  apiKey: z.string().trim().max(1000).nullish(),
  enabled: z.boolean().optional().default(true)
});

export const updateProviderBodySchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  model: z.string().trim().max(160).optional(),
  baseUrl: z.string().trim().max(500).nullish(),
  // Chuỗi rỗng = xoá khoá hiện có; undefined = giữ nguyên khoá cũ
  apiKey: z.string().trim().max(1000).nullish(),
  enabled: z.boolean().optional()
});

export const updateAISettingsBodySchema = z.object({
  activeProviderId: z.string().uuid().nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  requestTimeoutMs: z.number().int().min(5_000).max(600_000).optional()
});
