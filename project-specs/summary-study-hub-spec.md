# MedQuiz AI - Đặc Tả Kỹ Thuật Tính Năng Kho Bài Học Tóm Tắt & Ôn Tập (Summary Study Hub)

## 1. Yêu Cầu Gốc Từ Người Dùng
> "Hãy thêm 1 tính năng nữa là giao diện ôn tập tự những tài liệu đã tóm tắt, có nghĩa là hiển thị các bài học đã được tóm tắt từ tài liệu tải lên, trong đó có chức năng tải tài liệu về dạng word, pdf. Bạn hãy phân công cho agency phù hợp để làm việc này."

---

## 2. Mục Tiêu Nghiệp Vụ & Người Dùng
- **Mục tiêu**: Cung cấp một không gian học tập (Study Hub) chuyên biệt dành cho các bài học đã được AI tổng hợp từ tài liệu y khoa tải lên, giúp sinh viên và bác sĩ ôn tập nhanh chóng mà không cần mở lại file tài liệu cồng kềnh.
- **Tính năng trọng tâm**:
  1. **Lưu trữ & Quản lý bài học tóm tắt**: Tự động lưu bài tóm tắt sau khi sinh câu hỏi hoặc lưu trực tiếp từ tài liệu; hỗ trợ xem lại bất cứ lúc nào.
  2. **Giao diện Ôn tập (Reader View)**: Hiển thị các bài học tóm tắt trực quan, tìm kiếm theo từ khóa, lọc theo môn học, định dạng chuẩn Y khoa.
  3. **Xuất tài liệu đa định dạng**: Cho phép người dùng tải bài học tóm tắt về máy dưới dạng **Word (.docx)** và **PDF (.pdf)** chuẩn in ấn/học tập.
  4. **Liên kết học tập chủ động**: Cho phép bấm "Tạo đề thi từ bài học này" để kiểm tra ngay mức độ ghi nhớ kiến thức.

---

## 3. Kiến Trúc Kỹ Thuật

### 3.1. CSDL (Database)
Tạo bảng `document_summaries`:
```sql
CREATE TABLE IF NOT EXISTS document_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    key_takeaways JSONB,
    source_filename VARCHAR(255),
    word_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_summaries_subject ON document_summaries(subject_id);
CREATE INDEX IF NOT EXISTS idx_doc_summaries_created ON document_summaries(created_at DESC);
```

### 3.2. Backend APIs (`src/routes/summaries.routes.ts` & `src/modules/export/export.service.ts`)
1. `GET /api/v1/summaries`: Lấy danh sách các bài học tóm tắt (hỗ trợ search, filter subject).
2. `GET /api/v1/summaries/:id`: Lấy chi tiết bài học tóm tắt.
3. `POST /api/v1/summaries`: Lưu bài học tóm tắt mới vào kho.
4. `DELETE /api/v1/summaries/:id`: Xoá bài học tóm tắt khỏi kho.
5. `GET /api/v1/summaries/:id/export/docx`: Xuất file Word (.docx) định dạng chuyên nghiệp với thư viện `docx`.
6. `GET /api/v1/summaries/:id/export/pdf`: Xuất file PDF hoặc phiên bản HTML printable chuẩn vector PDF cho việc lưu trữ và in ấn.

### 3.3. Frontend (`client/src/`)
1. Thêm tab `'SUMMARIES'` vào `App.tsx` với tiêu đề "Tài Liệu Tóm Tắt" (icon `BookOpen`).
2. Component `SummaryStudyHub`:
   - Giao diện danh sách bài học (Card view / List view) với bộ lọc môn học và ô tìm kiếm tức thì.
   - Thẻ bài học hiển thị: Tiêu đề, Môn học, Ngày tạo, Tên file gốc, Thời gian đọc dự tính.
   - Chế độ xem bài học (Lesson Reader): Định dạng Markdown chuyên nghiệp, thanh công cụ xuất file:
     * 📥 **Tải Word (.docx)**
     * 📄 **Tải PDF (.pdf)**
     * 📋 **Sao chép nội dung**
     * 🎯 **Tạo đề thi từ bài này**
     * 🗑️ **Xoá bài**
3. Tích hợp tự động lưu: Tại `useQuizGenerator.ts`, khi AI hoàn tất tóm tắt tài liệu, tự động gửi yêu cầu lưu bài tóm tắt vào `document_summaries`.

---

## 4. Kế Hoạch Phân Công Đội Ngũ Agency (Agents Orchestrator)
1. **Senior Project Manager (`agency-senior-project-manager`)**:
   - Khảo sát đặc tả và tạo danh sách nhiệm vụ chi tiết tại `project-tasks/summary-study-hub-tasklist.md`.
2. **Backend Architect (`agency-backend-architect`)**:
   - Cập nhật database types, schema SQL, và viết service lưu trữ bài học tóm tắt.
   - Viết tính năng xuất file Word (.docx) và PDF trong `export.service.ts`.
   - Đăng ký các route `/api/v1/summaries/*`.
3. **Frontend Developer (`agency-frontend-developer`)**:
   - Viết `SummaryService` tại `client/src/services/summary.service.ts`.
   - Xây dựng component `SummaryStudyHub.tsx` và tích hợp vào thanh điều hướng `App.tsx`.
   - Kết nối tự động lưu bài học tóm tắt từ `useQuizGenerator.ts`.
4. **Reality Checker QA (`agency-reality-checker`)**:
   - Viết integration test `tests/summary-study-hub.test.ts`.
   - Chạy `npm test` và `npm run build:all`, chứng thực chất lượng 100%.
