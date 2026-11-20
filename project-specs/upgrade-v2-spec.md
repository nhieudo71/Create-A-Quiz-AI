# Đặc Tả Nâng Cấp Hệ Thống MedQuiz AI (Phiên Bản 2.0)
**Ngày lập**: 20/11/2026
**Điều phối**: agency-agents-orchestrator
**Dự án**: MedQuiz AI - Tạo Đề Thi Trắc Nghiệm Y Khoa Tự Động

---

## 1. Yêu Cầu Gốc Từ Người Dùng (Exact User Requirements)
1. **Thoát phòng thi sau khi thi xong**: Hiện tại thi xong mở lại vẫn còn ở phòng thi. Cần thêm tính năng thoát phòng thi sau khi thi xong và cơ chế thoát phòng thi linh hoạt.
2. **Tóm tắt tổng hợp kiến thức từ tài liệu tải lên**: Chạy tính năng này tự động sau khi tạo câu hỏi xong.
3. **Tự động lưu câu hỏi sau khi đã tạo xong**: Tự động lưu đề thi và bộ câu hỏi vào CSDL ngay khi sinh xong (100%), không để mất dữ liệu.
4. **Phím tắt chọn đáp án bằng số và Enter chuyển câu**: Chọn đáp án bằng số trên bàn phím (1-4, bao gồm Numpad) và nhấn Enter để qua câu tiếp theo.
5. **Tự động load model AI sau khi nhập API key xong**: Sau khi dán/nhập API key của nhà cung cấp AI, tự động truy vấn danh sách model thật và hiển thị dropdown lựa chọn.

---

## 2. Technical Stack
- **Backend**: Fastify, TypeScript, Kysely, PGlite (Embedded Postgres)
- **Frontend**: React, Vite, Tailwind CSS, Lucide Icons
- **AI SDK**: Google Generative AI, OpenAI / Anthropic REST APIs
- **Testing**: Node.js Test Runner (`tsx --test`), Vitest
- **Packaging**: Electron, Electron-builder (Portable & Installer .exe)
