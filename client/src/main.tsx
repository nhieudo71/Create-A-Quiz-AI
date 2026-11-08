import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { QuizGeneratorProvider } from './context/QuizGeneratorContext';
import { resolveAuthToken } from './services/http';
import './index.css';

// Lấy token một lần trước khi render. Không có token thì vẫn render bình thường
// (chế độ phát triển cục bộ không bật xác thực), nhưng khi có thì phải có sẵn
// trước request API đầu tiên để tránh 401 thoáng qua.
void resolveAuthToken().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QuizGeneratorProvider>
        <App />
      </QuizGeneratorProvider>
    </React.StrictMode>
  );
});
