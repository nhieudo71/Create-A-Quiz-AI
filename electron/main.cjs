const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow = null;
let serverProcess = null;
const BACKEND_PORT = 3000;
const isDev = process.env.NODE_ENV === 'development';

/**
 * Token dùng chung giữa Electron và máy chủ Backend trong suốt phiên chạy.
 * Sinh mới mỗi lần khởi động: không ghi ra đĩa, không tái sử dụng giữa các phiên.
 * 32 byte ngẫu nhiên -> 64 ký tự hex, thoả ràng buộc tối thiểu 32 ký tự của env.config.
 */
const AUTH_TOKEN = crypto.randomBytes(32).toString('hex');

// Renderer hỏi token qua IPC (không nhét vào process.argv để tránh lộ qua danh sách tiến trình)
ipcMain.handle('app:get-auth-token', () => AUTH_TOKEN);

/**
 * Kiểm tra xem máy chủ Backend đã sẵn sàng nhận kết nối hay chưa
 */
function waitForServer(url, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        // Server đã phản hồi là đủ để biết nó đang sống.
        // 503 ở /health chỉ có nghĩa DB chưa sẵn sàng, không phải server chết.
        if (res.statusCode < 500) {
          resolve(true);
        } else {
          retry();
        }
      });

      req.on('error', () => {
        retry();
      });

      req.end();
    };

    const retry = () => {
      if (Date.now() - start > timeout) {
        reject(new Error('Hết thời gian chờ máy chủ Backend khởi động.'));
      } else {
        setTimeout(check, 500);
      }
    };

    check();
  });
}

/**
 * Khởi động máy chủ Fastify ngầm bên trong Electron
 */
function startBackendServer() {
  const rootPath = path.join(__dirname, '..');
  const serverScript = isDev
    ? path.join(rootPath, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    : path.join(rootPath, 'dist', 'server.js');

  const args = isDev
    ? [path.join(rootPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'watch', path.join(rootPath, 'src', 'server.ts')]
    : [serverScript];

  console.log(`[Electron] Đang khởi động Backend: ${serverScript}`);

  // Trong Electron, process.execPath là electron.exe chứ không phải node.exe.
  // ELECTRON_RUN_AS_NODE=1 buộc tiến trình con chạy như Node thuần, nếu không
  // nó sẽ mở thêm một cửa sổ Electron thay vì khởi động máy chủ.
  serverProcess = spawn(process.execPath, args, {
    cwd: rootPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: BACKEND_PORT.toString(),
      HOST: '127.0.0.1',
      NODE_ENV: isDev ? 'development' : 'production',
      // Bắt buộc: phải khớp token mà renderer sẽ gửi trong header x-app-token,
      // nếu không mọi request /api/* trả 401.
      APP_AUTH_TOKEN: AUTH_TOKEN
    },
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron] Lỗi khi chạy Backend:', err);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Backend đã dừng với mã ${code}, signal: ${signal}`);
  });
}

/**
 * Tạo cửa sổ giao diện chính của Desktop App
 */
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    title: 'MedQuiz AI - Tạo Đề Thi Trắc Nghiệm Y Khoa',
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    show: false
  });

  // Chờ hiển thị khi đã nạp DOM để tránh màn hình trắng
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Nếu tải trang thất bại, phải báo cho người dùng thay vì im lặng
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron] Tải trang thất bại (${errorCode}): ${errorDescription} - ${validatedURL}`);
    mainWindow.show();
    dialog.showErrorBox(
      'Không tải được giao diện',
      `Không mở được ${validatedURL}\n\n${errorDescription} (${errorCode})\n\n` +
        'Hãy kiểm tra cửa sổ "MedQuiz Frontend (Vite)" xem máy chủ có lỗi không, rồi chạy lại run.bat.'
    );
  });

  // Lưới an toàn: nếu vì lý do nào đó ready-to-show không bao giờ bắn, vẫn phải hiện cửa sổ
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 15000);
  mainWindow.on('closed', () => clearTimeout(showFallback));

  // Đích URL tải trang
  const targetUrl = isDev
    ? 'http://localhost:5273'
    : `http://127.0.0.1:${BACKEND_PORT}`;

  try {
    console.log(`[Electron] Đang chờ server tại ${targetUrl}...`);
    if (isDev) {
      // Dev: cần cả Vite (giao diện) lẫn backend (API) sẵn sàng
      await Promise.all([
        waitForServer(targetUrl, 30000),
        waitForServer(`http://127.0.0.1:${BACKEND_PORT}/health`, 30000)
      ]);
    } else {
      await waitForServer(`http://127.0.0.1:${BACKEND_PORT}/health`, 15000);
    }
    await mainWindow.loadURL(targetUrl);
  } catch (err) {
    console.warn('[Electron] Không kết nối được qua HTTP, tải file cục bộ...', err.message);
    const fallbackPath = path.join(__dirname, '..', 'client', 'dist', 'index.html');
    if (fs.existsSync(fallbackPath)) {
      await mainWindow.loadFile(fallbackPath);
    } else {
      dialog.showErrorBox(
        'Không khởi động được máy chủ',
        `Không kết nối được tới ${targetUrl} và không tìm thấy bản build giao diện.\n\n` +
          `Chi tiết: ${err.message}\n\n` +
          'Hãy chạy "npm run build:all" hoặc dùng chế độ [2] trong run.bat để xem log lỗi.'
      );
      mainWindow.show();
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Vòng đời ứng dụng Electron
app.whenReady().then(async () => {
  startBackendServer();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Tắt hoàn toàn Backend khi đóng cửa sổ Electron
app.on('window-all-closed', () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch (e) {}
  }
});
