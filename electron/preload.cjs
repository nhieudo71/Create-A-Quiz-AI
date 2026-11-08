const { contextBridge, ipcRenderer } = require('electron');

// Phơi bày các API an toàn từ Electron sang React Renderer Process
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,
  isDesktop: true,
  /**
   * Token xác thực cho header `x-app-token`. Tiến trình main sinh token này
   * và truyền cùng giá trị cho máy chủ Backend, nên giao diện phải dùng đúng
   * token đó thì /api/* mới không trả 401.
   */
  getAuthToken: () => ipcRenderer.invoke('app:get-auth-token')
});
