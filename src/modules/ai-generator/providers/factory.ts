import { AppError } from '../../../core/errors';
import { ProviderConfig } from '../../settings/settings.types';
import { AIProvider } from './types';
import { GeminiProvider } from './gemini.provider';
import { OpenAICompatibleProvider, GenericOpenAICompatibleProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';
import { LocalAIProvider } from './local.provider';
import { ChatGPTOAuthProvider } from './chatgpt-oauth.provider';

/**
 * Điểm duy nhất biết ánh xạ loại provider -> lớp cài đặt.
 * Thêm nhà cung cấp mới: viết lớp mới cài đặt AIProvider rồi thêm một case ở đây.
 */
export function createProvider(config: ProviderConfig): AIProvider {
  switch (config.type) {
    case 'gemini':
      return new GeminiProvider(config);
    case 'openai':
      return new OpenAICompatibleProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai-compatible':
      return new GenericOpenAICompatibleProvider(config);
    case 'local':
      return new LocalAIProvider(config);
    case 'chatgpt-oauth':
      return new ChatGPTOAuthProvider(config);
    default: {
      const exhaustive: never = config.type;
      throw new AppError(`Loại nhà cung cấp AI không được hỗ trợ: ${exhaustive}`, 400);
    }
  }
}
