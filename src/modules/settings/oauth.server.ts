import http from 'http';
import { URL } from 'url';
import { startOAuthLogin, completeOAuthLogin } from './oauth.service';

export type OAuthLoginStatus = 'pending' | 'done' | 'error';

interface LoginState {
  status: OAuthLoginStatus;
  message?: string;
}

// providerId -> trạng thái lần đăng nhập gần nhất, để endpoint /status trả lời khi client polling.
const loginStates = new Map<string, LoginState>();

const CALLBACK_PORT = 1455;
let callbackServer: http.Server | null = null;

/**
 * Máy chủ HTTP tạm trên cổng 1455 để nhận redirect OAuth từ OpenAI.
 * Cổng này CỐ ĐỊNH vì nó khớp với redirect_uri đã đăng ký sẵn cho client_id
 * công khai của Codex CLI — không thể đổi sang cổng khác (3000) của app chính.
 * Mở một lần, dùng lại cho mọi lượt đăng nhập trong suốt phiên chạy ứng dụng.
 */
function ensureCallbackServer(): Promise<void> {
  if (callbackServer) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);
        if (url.pathname !== '/auth/callback') {
          res.writeHead(404).end('Not found');
          return;
        }
        void handleCallback(url, res);
      } catch (err: any) {
        res.writeHead(500).end('Lỗi xử lý callback đăng nhập.');
      }
    });

    server.once('error', (err: any) => {
      callbackServer = null;
      reject(err);
    });

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      callbackServer = server;
      resolve();
    });
  });
}

async function handleCallback(url: URL, res: http.ServerResponse): Promise<void> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    markError(state, `OpenAI từ chối đăng nhập: ${errorParam}`);
    sendHtml(res, false, 'Đăng nhập bị từ chối. Bạn có thể đóng tab này và thử lại.');
    return;
  }

  if (!code || !state) {
    sendHtml(res, false, 'Thiếu mã đăng nhập. Bạn có thể đóng tab này và thử lại.');
    return;
  }

  try {
    const provider = await completeOAuthLogin(code, state);
    loginStates.set(provider.id, { status: 'done' });
    sendHtml(res, true, `Đăng nhập "${provider.label}" thành công! Bạn có thể đóng tab này và quay lại ứng dụng.`);
  } catch (err: any) {
    markError(state, err?.message ?? 'Lỗi không xác định khi đăng nhập.');
    sendHtml(res, false, err?.message ?? 'Đăng nhập thất bại. Bạn có thể đóng tab này và thử lại.');
  }
}

function markError(state: string | null, message: string): void {
  // Không biết providerId nếu state đã hỏng; dùng khoá đặc biệt để endpoint status chung vẫn đọc được lỗi gần nhất.
  if (state) loginStates.set(`state:${state}`, { status: 'error', message });
}

function sendHtml(res: http.ServerResponse, ok: boolean, message: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8" />
<title>${ok ? 'Đăng nhập thành công' : 'Đăng nhập thất bại'}</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border-radius:16px;padding:32px 40px;box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center;max-width:420px}
h1{font-size:18px;color:${ok ? '#059669' : '#dc2626'}}p{color:#475569;font-size:14px}</style></head>
<body><div class="card"><h1>${ok ? '✅ Thành công' : '❌ Thất bại'}</h1><p>${escapeHtml(message)}</p></div></body></html>`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Bắt đầu một lượt đăng nhập: mở máy chủ callback (nếu chưa mở) rồi trả URL để mở trình duyệt. */
export async function beginChatGPTLogin(providerId: string): Promise<{ authorizeUrl: string }> {
  await ensureCallbackServer();
  loginStates.set(providerId, { status: 'pending' });
  const { authorizeUrl } = startOAuthLogin(providerId);
  return { authorizeUrl };
}

export function getChatGPTLoginStatus(providerId: string): LoginState {
  return loginStates.get(providerId) ?? { status: 'pending' };
}
