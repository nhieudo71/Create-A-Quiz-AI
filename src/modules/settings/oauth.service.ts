import { randomBytes, createHash } from 'crypto';
import { AppError } from '../../core/errors';
import { OAuthTokens, ProviderConfig } from './settings.types';
import { settingsStore } from './settings.store';

/**
 * Đăng nhập ChatGPT theo luồng OAuth PKCE công khai mà Codex CLI (mã nguồn mở,
 * Apache-2.0, của chính OpenAI) sử dụng để đổi phiên ChatGPT Plus/Pro lấy quyền
 * gọi API mà không trả theo token.
 *
 * ĐÂY LÀ LUỒNG KHÔNG CHÍNH THỨC: OpenAI có thể đổi hoặc chặn bất cứ lúc nào.
 * client_id dưới đây là giá trị công khai dùng cho Codex CLI, không phải bí mật riêng.
 */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access';

interface PendingLogin {
  providerId: string;
  codeVerifier: string;
  createdAt: number;
}

// state -> phiên đang chờ. Một tiến trình, một người dùng nên Map trong bộ nhớ là đủ.
const pendingLogins = new Map<string, PendingLogin>();
const LOGIN_TTL_MS = 10 * 60 * 1000;

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [state, login] of pendingLogins) {
    if (now - login.createdAt > LOGIN_TTL_MS) pendingLogins.delete(state);
  }
}

/** Bắt đầu đăng nhập: sinh cặp PKCE, trả về URL để mở trên trình duyệt. */
export function startOAuthLogin(providerId: string): { authorizeUrl: string; state: string } {
  cleanupExpired();
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  const state = base64url(randomBytes(16));
  pendingLogins.set(state, { providerId, codeVerifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true'
  });
  return { authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}`, state };
}

/** Hoàn tất đăng nhập sau khi nhận `code` + `state` tại trang callback. */
export async function completeOAuthLogin(code: string, state: string): Promise<ProviderConfig> {
  const pending = pendingLogins.get(state);
  if (!pending) {
    throw new AppError('Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Hãy thử đăng nhập lại.', 400);
  }
  pendingLogins.delete(state);

  const tokens = await exchangeCodeForTokens(code, pending.codeVerifier);
  const settings = settingsStore.get();
  const provider = settings.providers.find((p) => p.id === pending.providerId);
  if (!provider) {
    throw new AppError('Không tìm thấy cấu hình nhà cung cấp để lưu phiên đăng nhập.', 404);
  }

  const updated: ProviderConfig = { ...provider, oauth: tokens };
  settingsStore.upsertProvider(updated);
  return updated;
}

async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AppError(
      `OpenAI từ chối đổi mã đăng nhập (${response.status}). Hãy thử đăng nhập lại. ${text.slice(0, 200)}`,
      502
    );
  }

  const json: any = await response.json();
  return parseTokenResponse(json);
}

/** Làm mới access token khi gần hết hạn (dùng refresh_token đã lưu). */
export async function refreshOAuthTokens(provider: ProviderConfig): Promise<ProviderConfig> {
  const refreshToken = provider.oauth?.refreshToken;
  if (!refreshToken) {
    throw new AppError(
      `Phiên đăng nhập ChatGPT của "${provider.label}" đã hết hạn và không thể tự làm mới. Hãy đăng nhập lại trong Cài đặt.`,
      401
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      scope: SCOPE
    })
  });

  if (!response.ok) {
    throw new AppError(
      `Không làm mới được phiên đăng nhập ChatGPT của "${provider.label}". Hãy đăng nhập lại trong Cài đặt.`,
      401
    );
  }

  const json2: any = await response.json();
  const tokens = parseTokenResponse(json2, provider.oauth);
  const updated: ProviderConfig = { ...provider, oauth: tokens };
  settingsStore.upsertProvider(updated);
  return updated;
}

function parseTokenResponse(json: any, previous?: OAuthTokens | null): OAuthTokens {
  const accessToken = json?.access_token;
  if (!accessToken) {
    throw new AppError('Phản hồi đăng nhập từ OpenAI thiếu access_token.', 502);
  }
  const expiresInSec = Number(json?.expires_in ?? 3600);
  // Lấy sớm hơn 60s để không dùng token sát hạn ngay lúc gọi API
  const expiresAt = Date.now() + Math.max(0, expiresInSec - 60) * 1000;

  return {
    accessToken,
    refreshToken: json?.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt,
    accountId: extractAccountId(json?.id_token) ?? previous?.accountId ?? null
  };
}

/**
 * accountId nằm trong claim tuỳ biến của id_token. Chỉ đọc claim công khai để
 * gắn header — xác thực chữ ký JWT thật do OpenAI thực hiện.
 */
function extractAccountId(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return json?.['https://api.openai.com/auth']?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

/** Token còn hạn dùng ngay không (có dư ít nhất 30s). */
export function isTokenFresh(oauth?: OAuthTokens | null): boolean {
  return Boolean(oauth?.accessToken && oauth.expiresAt && oauth.expiresAt > Date.now() + 30_000);
}

