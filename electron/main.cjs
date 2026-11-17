const { app, BrowserWindow, dialog, ipcMain, utilityProcess } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow = null;
let serverProcess = null;
let backendPort = 3000;
const isDev = process.env.NODE_ENV === 'development';

function findFreePort(preferred = 3000) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => {
      const srv2 = net.createServer();
      srv2.unref();
      srv2.listen(0, '127.0.0.1', () => {
        const port = srv2.address().port;
        srv2.close(() => resolve(port));
      });
    });
    srv.listen(preferred, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

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

  const userDataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(userDataDir, { recursive: true });
  const schemaPath = path.join(rootPath, 'docs', 'DATABASE_SCHEMA.sql');

  const serverEnv = {
    ...process.env,
    PORT: backendPort.toString(),
    HOST: '127.0.0.1',
    NODE_ENV: isDev ? 'development' : 'production',
    DB_MODE: 'embedded',
    DB_DATA_DIR: userDataDir,
    APP_SCHEMA_PATH: schemaPath,
    APP_AUTH_TOKEN: AUTH_TOKEN
  };

  if (isDev) {
    serverProcess = spawn(process.execPath, args, {
      cwd: rootPath,
      env: { ...serverEnv, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit'
    });
  } else {
    // utilityProcess chạy trong tiến trình riêng nhưng vẫn đọc được file bên trong app.asar
    serverProcess = utilityProcess.fork(serverScript, [], {
      cwd: rootPath,
      env: serverEnv,
      stdio: 'inherit'
    });
  }

  serverProcess.on('exit', (code) => {
    console.log(`[Electron] Backend đã dừng với mã ${code}`);
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
    show: true
  });

  // Hiện ngay màn hình chờ để người dùng biết app đang khởi động (tránh cảm giác bấm không phản hồi)
  const loadingHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f8fafc;font-family:Segoe UI,sans-serif;color:#0f172a}
    .spinner{width:38px;height:38px;border:3px solid #e2e8f0;border-top-color:#0284c7;border-radius:50%;animation:s .8s linear infinite;margin-bottom:16px}
    @keyframes s{to{transform:rotate(360deg)}}
    h2{margin:0 0 6px;font-size:18px}p{margin:0;font-size:13px;color:#64748b}
  </style></head><body><div class="spinner"></div><h2>Đang khởi động MedQuiz AI...</h2><p>Vui lòng chờ vài giây để nạp cơ sở dữ liệu</p></body></html>`;
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`);

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
    : `http://127.0.0.1:${backendPort}`;

  try {
    console.log(`[Electron] Đang chờ server tại ${targetUrl}...`);
    if (isDev) {
      // Dev: cần cả Vite (giao diện) lẫn backend (API) sẵn sàng
      await Promise.all([
        waitForServer(targetUrl, 30000),
        waitForServer(`http://127.0.0.1:${backendPort}/health`, 30000)
      ]);
    } else {
      await waitForServer(`http://127.0.0.1:${backendPort}/health`, 20000);
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
  backendPort = isDev ? 3000 : await findFreePort(3000);
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
