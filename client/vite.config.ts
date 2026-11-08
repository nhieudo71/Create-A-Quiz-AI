import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    // Giữ đúng cổng 5273: nếu cổng bận, báo lỗi ngay thay vì tự nhảy sang cổng khác
    // (run.bat và Electron đều trỏ cứng tới 5273).
    strictPort: true,
    proxy: {
      // Bản web chạy dev dùng chung origin với Vite: phải chuyển tiếp cả đường dẫn
      // lấy cấu hình (token xác thực) chứ không chỉ /api, nếu không client không
      // lấy được token và mọi request API sẽ 401.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      },
      '/app-config.json': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  }
});
