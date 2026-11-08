import React, { createContext, useContext } from 'react';
import { useQuizGenerator } from '../hooks/useQuizGenerator';

/**
 * Giữ toàn bộ trạng thái tạo đề ở cấp App thay vì trong GeneratorContainer.
 *
 * GeneratorContainer nằm trong một nhánh `activeTab === 'GENERATE'`, nên khi người
 * dùng chuyển tab React sẽ unmount nó và xoá sạch state của useQuizGenerator —
 * tiến trình đang chạy biến mất dù request vẫn đang bay. Đặt state ở provider
 * bọc ngoài giúp tiến trình sống tiếp khi đổi tab.
 */
type QuizGeneratorState = ReturnType<typeof useQuizGenerator>;

const QuizGeneratorContext = createContext<QuizGeneratorState | null>(null);

export const QuizGeneratorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useQuizGenerator();
  return <QuizGeneratorContext.Provider value={value}>{children}</QuizGeneratorContext.Provider>;
};

export function useQuizGeneratorContext(): QuizGeneratorState {
  const ctx = useContext(QuizGeneratorContext);
  if (!ctx) {
    throw new Error('useQuizGeneratorContext phải được dùng bên trong QuizGeneratorProvider');
  }
  return ctx;
}
