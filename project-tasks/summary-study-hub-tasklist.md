# MedQuiz AI - Danh Sách Nhiệm Vụ Phát Triển Kho Bài Học Tóm Tắt & Ôn Tập (Summary Study Hub)

## Specification Summary
**Tài liệu đặc tả**: `e:/APP/Tao-Trac-Nghiem/project-specs/summary-study-hub-spec.md`  
**Dự án**: MedQuiz AI - Hệ Thống Tạo Đề Thi & Ôn Luyện Y Khoa Chuẩn Active Recall  
**Yêu cầu gốc từ người dùng**:
> "Hãy thêm 1 tính năng nữa là giao diện ôn tập tự những tài liệu đã tóm tắt, có nghĩa là hiển thị các bài học đã được tóm tắt từ tài liệu tải lên, trong đó có chức năng tải tài liệu về dạng word, pdf. Bạn hãy phân công cho agency phù hợp để làm việc này."

**Mục tiêu cốt lõi**:
1. Cung cấp một không gian học tập (Study Hub) chuyên biệt dành cho các bài học đã được AI tổng hợp từ tài liệu y khoa tải lên, giúp sinh viên và bác sĩ ôn tập nhanh chóng mà không cần mở lại file tài liệu gốc cồng kềnh.
2. Tự động lưu trữ bài tóm tắt vào cơ sở dữ liệu ngay sau khi AI hoàn tất tóm tắt tài liệu trong tiến trình tạo câu hỏi.
3. Cung cấp giao diện Reader View tối ưu cho việc đọc và học tập (Active Recall), hỗ trợ tìm kiếm tức thì, lọc theo môn học, đếm số từ và ước tính thời gian đọc.
4. Xuất tài liệu bài học tóm tắt ra định dạng **Word (.docx)** và **PDF (.pdf)** chuẩn in ấn/học tập chuyên nghiệp.
5. Tạo liên kết học tập chủ động: Cho phép bấm "Tạo đề thi từ bài học này" để kiểm tra ngay mức độ ghi nhớ kiến thức.

**Technical Stack**:
- Backend: Fastify, TypeScript, Kysely, PGlite (Embedded Postgres) / PostgreSQL, docx (Word generation)
- Frontend: React 18, Vite, Tailwind CSS, Lucide Icons
- Testing: Node.js Test Runner (`tsx --test`), Supertest / Fastify Inject

---

## Development Tasks Breakdown

### [x] Task 1: Database Schema & Migration for Document Summaries
**Assigned Agency Role**: `agency-backend-architect`  
**Description**: Bổ sung bảng `document_summaries` vào CSDL cùng các indexes tối ưu và cập nhật TypeScript Database Schema types trong Kysely.

**Detailed Requirements & Implementation**:
1. **Cập nhật File Schema SQL (`docs/DATABASE_SCHEMA.sql`)**:
   - Thêm câu lệnh khởi tạo bảng `document_summaries`:
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
     ```
   - Thêm các index tối ưu truy vấn:
     ```sql
     CREATE INDEX IF NOT EXISTS idx_doc_summaries_subject ON document_summaries(subject_id);
     CREATE INDEX IF NOT EXISTS idx_doc_summaries_created ON document_summaries(created_at DESC);
     ```
2. **Cập nhật TypeScript Database Types (`src/core/database/types.ts`)**:
   - Khai báo interface `DocumentSummaryTable`:
     * `id: Generated<string>`
     * `title: string`
     * `subject_id: string | null`
     * `document_id: string | null`
     * `summary: string`
     * `key_takeaways: unknown | null`
     * `source_filename: string | null`
     * `word_count: Generated<number>`
     * `created_at: Generated<Date>`
     * `updated_at: Generated<Date>`
   - Đăng ký bảng `document_summaries: DocumentSummaryTable;` vào interface `DatabaseSchema`.
3. **Đảm bảo tính tương thích Migration (`src/core/database/migrate.ts`)**:
   - Kiểm tra `runMigrations()` thực thi an toàn trên cả PostgreSQL thật và embedded PGlite.

**Acceptance Criteria**:
- [x] Bảng `document_summaries` và 2 indexes được khai báo chuẩn trong `docs/DATABASE_SCHEMA.sql`.
- [x] `DatabaseSchema` trong `src/core/database/types.ts` có đầy đủ kiểu dữ liệu cho `document_summaries`.
- [x] Chạy `runMigrations()` không phát sinh lỗi cú pháp hay xung đột foreign key.

**Files to Create/Edit**:
- `docs/DATABASE_SCHEMA.sql` (Thêm định nghĩa bảng `document_summaries` và indexes)
- `src/core/database/types.ts` (Thêm interface `DocumentSummaryTable` và cập nhật `DatabaseSchema`)

---

### [x] Task 2: Backend CRUD Service & Endpoints for Summaries
**Assigned Agency Role**: `agency-backend-architect`  
**Description**: Xây dựng service quản lý bài học tóm tắt (`SummariesService`) và các route API RESTful `/api/v1/summaries/*`.

**Detailed Requirements & Implementation**:
1. **Tạo Service (`src/modules/summaries/summaries.service.ts`)**:
   - `listSummaries(query: { search?: string; subjectId?: string; limit?: number; offset?: number })`:
     * Truy vấn bảng `document_summaries`, `leftJoin` với `subjects` lấy `subjects.name as subject_name`.
     * Hỗ trợ tìm kiếm không phân biệt hoa thường theo `title`, `summary`, hoặc `source_filename`.
     * Sắp xếp giảm dần theo thời gian tạo (`created_at DESC`).
   - `getSummaryById(id: string)`:
     * Lấy chi tiết bài học tóm tắt, ném lỗi `NotFoundError` nếu không tìm thấy.
   - `createSummary(dto: { title: string; summary: string; subjectName?: string; subjectId?: string; documentId?: string; sourceFilename?: string; keyTakeaways?: any })`:
     * Tự động tra cứu hoặc tạo `subject` nếu truyền vào `subjectName` (tương tự như luồng tạo đề thi).
     * Tự động tính `word_count` nếu client không truyền (tính theo số từ trong `summary`).
     * Insert vào CSDL và trả về bản ghi hoàn chỉnh.
   - `deleteSummary(id: string)`:
     * Xoá bài học tóm tắt theo ID. Trả về thông báo thành công hoặc ném lỗi `NotFoundError`.
2. **Xây dựng Routes (`src/routes/summaries.routes.ts`)**:
   - `GET /api/v1/summaries`: Lấy danh sách tóm tắt (nhận query params `search`, `subject_id`, `limit`, `offset`).
   - `GET /api/v1/summaries/:id`: Lấy chi tiết một bài tóm tắt theo ID.
   - `POST /api/v1/summaries`: Tạo bài học tóm tắt mới (xác thực body bằng Zod schema: `title` bắt buộc, `summary` bắt buộc).
   - `DELETE /api/v1/summaries/:id`: Xoá bài học tóm tắt.
3. **Đăng ký Route vào Hệ Thống (`src/app.ts`)**:
   - Khởi tạo instance `SummariesService` và gọi `registerSummariesRoutes(app, summariesService, exportService)`.

**Acceptance Criteria**:
- [x] API trả về danh sách tóm tắt với cấu trúc phân trang, tìm kiếm và lọc môn học chính xác.
- [x] API tạo mới lưu trữ thành công dữ liệu với `word_count` được tính tự động.
- [x] API xoá bản ghi hoạt động chuẩn xác và báo lỗi 404 khi ID không tồn tại.
- [x] Xử lý validation dữ liệu đầu vào bằng Zod schema rõ ràng, trả về mã lỗi 400 kèm message thân thiện khi dữ liệu không hợp lệ.

**Files to Create/Edit**:
- `src/modules/summaries/summaries.service.ts` (Tạo mới: CRUD logic)
- `src/routes/summaries.routes.ts` (Tạo mới: Route handlers & Zod validation)
- `src/app.ts` (Đăng ký module summaries)

---

### [x] Task 3: Word (.docx) & PDF Export Services for Summaries
**Assigned Agency Role**: `agency-backend-architect`  
**Description**: Bổ sung tính năng xuất file Word (.docx) và PDF (.pdf/printable vector HTML) định dạng chuẩn Y khoa cho bài học tóm tắt trong `ExportService`.

**Detailed Requirements & Implementation**:
1. **Xuất file Word (`exportSummaryToDocx`) trong `src/modules/export/export.service.ts`**:
   - Đọc dữ liệu bài học tóm tắt từ CSDL qua `summaryId`.
   - Sử dụng thư viện `docx` dựng tài liệu chuẩn mực:
     * Tiêu đề tài liệu (Heading 1) màu chủ đạo MedQuiz AI.
     * Khối thông tin metadata: Môn học, Tên file tài liệu gốc, Số lượng từ, Ngày biên soạn.
     * Nội dung tóm tắt: Phân tách tiêu đề các cấp (Heading 2, Heading 3), danh sách gạch đầu dòng (bullet points), đoạn văn bản y khoa.
     * Khối ghi nhớ trọng tâm (Key takeaways / High-Yield Points): Đóng khung hoặc định dạng nổi bật.
     * Footer chân trang: Thông tin bản quyền học tập "MedQuiz AI - Active Recall Learning System".
   - Trả về `{ buffer: Buffer, filename: string }` với filename được làm sạch ký tự đặc biệt: `[Tom-tat]-${slugTitle}.docx`.
2. **Xuất file PDF / Printable Vector PDF (`exportSummaryToPdfHtml`)**:
   - Dựng template HTML in ấn chuẩn CSS `@media print` và `@page { size: A4; margin: 20mm; }`:
     * Typography chuẩn mực (Inter / Arial / Times New Roman), font-size và line-height tối ưu cho việc đọc trên giấy hoặc lưu PDF từ trình duyệt.
     * Header & Footer in ấn chuyên nghiệp, logo MedQuiz AI, ngày in và số trang.
     * Định dạng Markdown hiển thị đẹp mắt (tiêu đề, khối trích dẫn, bảng biểu nếu có).
     * Script tự động mở hộp thoại in của trình duyệt (`window.print()`) khi người dùng mở trang để xuất nhanh sang PDF chỉ bằng 1 phím nhấn.
   - Trả về `{ html: string, filename: string }`.
3. **Endpoint tải file trong Routes (`src/routes/summaries.routes.ts`)**:
   - `GET /api/v1/summaries/:id/export/docx`: Đặt header `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `Content-Disposition: attachment; filename="..."`.
   - `GET /api/v1/summaries/:id/export/pdf`: Đặt header `Content-Type: text/html; charset=utf-8`, `Content-Disposition: inline; filename="..."`.

**Acceptance Criteria**:
- [x] File Word (.docx) tải về mở tốt trên Microsoft Word / Google Docs, không bị lỗi font tiếng Việt, bố cục phân mục rõ ràng.
- [x] File PDF/Printable hiển thị định dạng trang in A4 chuẩn xác, typography sắc nét, cho phép in hoặc "Save as PDF" trực tiếp từ trình duyệt mà không bị vỡ layout.
- [x] Xử lý trường hợp bài tóm tắt không tồn tại (ném `NotFoundError` 404).

**Files to Create/Edit**:
- `src/modules/export/export.service.ts` (Thêm `exportSummaryToDocx` và `exportSummaryToPdfHtml`)
- `src/routes/summaries.routes.ts` (Đăng ký 2 endpoint xuất file)

---

### [x] Task 4: Frontend Summary Service & Integration in Generator Hook (Auto-Save)
**Assigned Agency Role**: `agency-frontend-developer`  
**Description**: Xây dựng `SummaryService` tại client và tích hợp tự động lưu bài học tóm tắt vào CSDL ngay khi AI hoàn thành tóm tắt trong hook `useQuizGenerator`.

**Detailed Requirements & Implementation**:
1. **Tạo Client Service (`client/src/services/summary.service.ts`)**:
   - Định nghĩa các interface TypeScript: `DocumentSummaryItem`, `CreateSummaryDto`, `SummaryFilterQuery`.
   - Các phương thức:
     * `getSummaries(query?: SummaryFilterQuery): Promise<DocumentSummaryItem[]>`
     * `getSummaryById(id: string): Promise<DocumentSummaryItem>`
     * `createSummary(data: CreateSummaryDto): Promise<DocumentSummaryItem>`
     * `deleteSummary(id: string): Promise<void>`
     * `getExportDocxUrl(id: string): string`
     * `getExportPdfUrl(id: string): string`
2. **Tích hợp Tự Động Lưu vào `client/src/hooks/useQuizGenerator.ts`**:
   - Thêm state `savedSummaryId: string | null`, `isSummarySaved: boolean`.
   - Trong `handleStartGeneration`, sau khi nhận tóm tắt từ `GeneratorService.summarizeDocument(rawText, config.subjectName)`:
     * Tự động gọi `SummaryService.createSummary(...)` với:
       - `title`: Tạo tiêu đề tự động, ví dụ `Bài tóm tắt: ${docData?.filename || config.subjectName}`.
       - `subjectName`: `config.subjectName`.
       - `documentId`: `docData?.id || undefined`.
       - `summary`: Nội dung AI vừa tóm tắt.
       - `sourceFilename`: `docData?.filename || selectedFile?.name`.
       - `wordCount`: Tính số từ của bản tóm tắt.
     * Cập nhật `savedSummaryId` và hiển thị toast thông báo: `"Đã tự động lưu bài tóm tắt vào Kho Ôn Tập!"`.
3. **Cập nhật Giao diện Review Tóm Tắt (`client/src/components/generator/QuestionReviewList.tsx`)**:
   - Thêm nút tắt "Xem trong Kho Ôn Tập" (mở tab `SUMMARIES`) khi bài tóm tắt đã được lưu thành công.
   - Bổ sung nút "Tải Word (.docx)" và "Tải PDF (.pdf)" trực tiếp tại màn hình review nếu bài học đã được lưu.

**Acceptance Criteria**:
- [x] Khi AI hoàn tất tóm tắt văn bản tài liệu, bản tóm tắt được tự động POST lên `/api/v1/summaries` và lưu vào CSDL.
- [x] Người dùng không bị mất nội dung tóm tắt khi tải lại trang hoặc chuyển tab.
- [x] Giao diện Review câu hỏi hiển thị trạng thái đã lưu bài tóm tắt kèm nút liên kết đến Kho Ôn Tập.

**Verification Notes**:
- Đã xác thực các phương thức trong `client/src/services/summary.service.ts`: `list()`, `get()`, `create()`, `delete()`, `downloadDocx()`, `openPdfPrintView()`.
- Đã xác thực hook `useQuizGenerator.ts` (dòng 209-248): tự động trigger `SummaryService.create()` khi AI hoàn tất tóm tắt, lưu trữ ID và thông báo toast.
- Đã xác thực `QuestionReviewList.tsx`: hiển thị tab tóm tắt kiến thức cốt lõi, nút "Xem trong Kho Tài Liệu Tóm Tắt", nút "Tải Word (.docx)" và "In / Tải PDF".

**Files to Create/Edit**:
- `client/src/services/summary.service.ts` (Đã tạo mới)
- `client/src/hooks/useQuizGenerator.ts` (Đã tích hợp auto-save summary)
- `client/src/components/generator/QuestionReviewList.tsx` (Đã thêm shortcut và nút xuất file nhanh)

---

### [x] Task 5: Frontend UI `SummaryStudyHub` & `App.tsx` Tab Integration
**Assigned Agency Role**: `agency-frontend-developer`  
**Description**: Xây dựng giao diện trung tâm học tập `SummaryStudyHub` hoàn chỉnh và tích hợp tab "Tài Liệu Tóm Tắt" vào thanh điều hướng chính của `App.tsx`.

**Detailed Requirements & Implementation**:
1. **Xây dựng Giao diện Kho Ôn Tập (`client/src/components/summaries/SummaryStudyHub.tsx`)**:
   - **Header & Thống kê**:
     * Tiêu đề: "Kho Bài Học Tóm Tắt & Ôn Tập (Summary Study Hub)".
     * Mô tả: "Không gian học tập kiến thức cốt lõi từ tài liệu y khoa. Đọc ôn tập, tra cứu và tải tài liệu Word/PDF."
     * Huy hiệu thống kê nhanh: Tổng số bài học, Số môn học có tài liệu, Tổng số từ đã tóm tắt.
   - **Thanh Công Cụ Tìm Kiếm & Lọc**:
     * Ô tìm kiếm tức thì theo từ khóa (tiêu đề, tên file tài liệu, nội dung tóm tắt).
     * Dropdown lọc theo môn học (dynamic lấy từ danh sách bài tóm tắt).
     * Nút làm mới danh sách dữ liệu.
   - **Bố Cục Hiển Thị Master-Detail / Reader Modal**:
     * **Danh sách bài học (Card / List View)**:
       - Hiển thị danh sách thẻ bài học với thiết kế hiện đại, tinh tế.
       - Mỗi thẻ hiển thị: Tiêu đề bài học, Môn học (Badge màu), Ngày tạo (format vi-VN), Tên file tài liệu gốc kèm icon định dạng, Số lượng từ & thời gian đọc ước lượng (~200 từ/phút).
       - Nút xem bài, nút xoá bài (có xác nhận), nút tải nhanh.
     * **Chế độ Đọc Bài Học (Lesson Reader View)**:
       - Khu vực đọc bài chuyên sâu, bố cục typography tối ưu mắt nhìn (chế độ sáng/tối đồng bộ với App).
       - Hiển thị nội dung tóm tắt định dạng Markdown đầy đủ (tiêu đề, danh sách, in đậm từ khóa chuyên môn).
       - **Thanh công cụ học tập & xuất file**:
         * 📥 **Tải Word (.docx)**: Tải file Word bài học về máy.
         * 📄 **Tải PDF (.pdf)**: Mở bản in ấn printable vector PDF để tải/in.
         * 📋 **Sao chép nội dung**: Copy Markdown/Text vào clipboard kèm thông báo toast.
         * 🎯 **Tạo đề thi từ bài này**: Nút bấm lấy nội dung tóm tắt đưa vào bộ sinh câu hỏi AI (`rawText` và `subjectName`) và chuyển ngay sang tab Tạo Đề AI để luyện tập Active Recall!
         * 🗑️ **Xoá bài học**: Xoá khỏi CSDL và quay lại danh sách.
   - **Trạng thái Trống (Empty State)**:
     * Nếu chưa có bài học tóm tắt nào: Hiển thị minh hoạ đẹp mắt, thông điệp hướng dẫn tải tài liệu y khoa lên để AI tự động tổng hợp bài học, kèm nút "Tải tài liệu tạo đề ngay" chuyển sang tab `GENERATE`.
2. **Tích hợp Tab vào Thanh Điều Hướng (`client/src/App.tsx`)**:
   - Cập nhật kiểu `type Tab = 'GENERATE' | 'SUMMARIES' | 'EXAM' | 'HISTORY' | 'SETTINGS';`.
   - Thêm nút điều hướng tab `"Tài Liệu Tóm Tắt"` trên header:
     * Icon: `BookOpen` (theo đúng đặc tả).
     * Dành icon `Clock` / `History` / `Award` cho tab Lịch Sử Thi để tạo sự phân biệt rõ ràng.
     * Khi click, chuyển sang `activeTab === 'SUMMARIES'`.
   - Render component `<SummaryStudyHub onNavigateToGenerator={handleCreateQuizFromSummary} />` khi `activeTab === 'SUMMARIES'`.
   - Xây dựng callback `handleCreateQuizFromSummary(summaryText, subjectName)`: nạp văn bản tóm tắt vào context và đưa người dùng sang màn hình cấu hình tạo đề thi.

**Acceptance Criteria**:
- [x] Tab "Tài Liệu Tóm Tắt" hiển thị nổi bật trên thanh điều hướng của ứng dụng và chuyển đổi mượt mà.
- [x] Giao diện danh sách bài học hỗ trợ tìm kiếm từ khoá tức thì và lọc theo từng môn học chính xác.
- [x] Chế độ đọc bài học (Reader View) hiển thị Markdown rõ ràng, dễ đọc, hỗ trợ chuyển đổi giao diện sáng/tối.
- [x] Đầy đủ các nút thao tác: Tải Word, Tải PDF, Sao chép, Tạo đề thi từ bài học này và Xoá bài học hoạt động trơn tru.
- [x] Nút "Tạo đề thi từ bài này" nạp đúng nội dung và môn học sang tab Tạo Đề AI.

**Verification Notes**:
- Đã xác thực giao diện `SummaryStudyHub.tsx` (853 dòng mã): responsive trên desktop và mobile với reader drawer/modal, tìm kiếm instant, lọc dynamic theo môn học, bộ đếm KPI bài học / số từ / thời gian đọc.
- Đã xác thực chuyển đổi tab trong `App.tsx`: Tab "Tài Liệu Tóm Tắt" với icon `BookOpen`, gọi `onNavigateToGenerator` kích hoạt `loadTextForGeneration` mượt mà.

**Files to Create/Edit**:
- `client/src/components/summaries/SummaryStudyHub.tsx` (Đã tạo mới)
- `client/src/App.tsx` (Đã cập nhật Tab types, header nav tab, switch content view, handle shortcut navigation)

---

### [x] Task 6: Integration QA & Automated Testing
**Assigned Agency Role**: `agency-reality-checker`  
**Description**: Viết bộ kiểm thử tích hợp tự động toàn diện `tests/summaries.test.ts` và chạy toàn bộ test suite dự án (`npm test`, `npm run build:all`) nhằm chứng thực chất lượng 100%.

**Detailed Requirements & Implementation**:
1. **Viết Test Suite (`tests/summaries.test.ts`)**:
   - Sử dụng Node.js Test Runner (`node:test`) và `node:assert/strict` trên môi trường PGlite embedded in-memory.
   - Bao phủ các ca kiểm thử:
     * **Test 1 - Schema & Table Creation**: Kiểm tra bảng `document_summaries` được khởi tạo thành công qua migrations.
     * **Test 2 - API Tạo Bài Học Tóm Tắt (`POST /api/v1/summaries`)**:
       - Báo lỗi validation khi payload không hợp lệ.
       - Tạo thành công bài tóm tắt với đầy đủ thông tin `title`, `summary`, `subject_name`, `source_filename`, `key_takeaways`.
       - Kiểm tra tính toán tự động `word_count` (> 50 từ).
     * **Test 3 - API Lấy Danh Sách (`GET /api/v1/summaries`)**:
       - Lấy danh sách, kiểm tra trả về đúng bài vừa tạo kèm `subject_name`.
       - Lọc theo từ khóa `search`.
       - Lọc theo `subject_id`.
     * **Test 4 - API Chi Tiết (`GET /api/v1/summaries/:id`)**:
       - Trả về đúng dữ liệu chi tiết bài tóm tắt.
       - Trả về lỗi 404 khi query ID không tồn tại.
     * **Test 5 - API Xuất File Word (`GET /api/v1/summaries/:id/export/docx`)**:
       - Kiểm tra header `content-type` là openxmlformats Word.
       - Kiểm tra `content-disposition` có tên file chứa `[Tom-tat]`.
       - Buffer trả về hợp lệ (> 500 bytes).
     * **Test 6 - API Xuất File PDF/Printable (`GET /api/v1/summaries/:id/export/pdf`)**:
       - Kiểm tra header `content-type` là `text/html; charset=utf-8`.
       - Kiểm tra nội dung chứa tiêu đề, nội dung tóm tắt, khối Key Takeaways, style `@media print` và script in ấn `window.print()`.
     * **Test 7 - API Xoá Bài Học Tóm Tắt (`DELETE /api/v1/summaries/:id`)**:
       - Xoá bài học thành công.
       - Query lại trả về 404.
2. **Cập nhật NPM Scripts trong `package.json`**:
   - Đã kiểm tra và đảm bảo `tests/summaries.test.ts` nằm trong lệnh `test` của `package.json`.
3. **Thực thi Kiểm Thử & Biên Dịch Dự Án**:
   - Chạy `npm test`: Đạt **161/161 tests PASS (100%)**, 31 suites, 0 fail, 0 skipped.
   - Chạy `npm run build:all`: Đạt **0 lỗi biên dịch** TypeScript cho cả client và server.

**Acceptance Criteria**:
- [x] File test `tests/summaries.test.ts` kiểm thử toàn diện toàn bộ 5 endpoints của tính năng mới.
- [x] Lệnh `npm test` vượt qua 100% tất cả các bài kiểm tra (zero regressions).
- [x] Lệnh `npm run build:all` hoàn thành với mã thoát 0 cho cả frontend và backend.

**Verification Notes**:
- `npm test`: 161 tests, 31 suites, 161 passed, 0 failed, duration 18.57s.
- `npm run build:all`: 1536 client modules built in 3.93s, tsc server build code 0.

**Files to Create/Edit**:
- `tests/summaries.test.ts` (196 dòng mã kiểm thử tự động)
- `package.json` (Đã cấu hình trong lệnh `test`)

---

## Quality Requirements
- [x] **No background processes in any commands**: Tuyệt đối không dùng `&` ngầm trong terminal.
- [x] **No server startup commands**: Giả định máy chủ dev đã được quản lý riêng.
- [x] **Data Safety & Integrity**: Lưu trữ chuẩn mực với Foreign Key Cascade an toàn; tự động lưu không chặn luồng giao diện chính.
- [x] **Mobile & Responsive UI**: Giao diện `SummaryStudyHub` hiển thị tốt trên cả màn hình di động, máy tính bảng và desktop.
- [x] **Format Consistency**: File Word (.docx) và file PDF chuẩn in ấn trình bày trang nhã, đúng phong cách Y khoa (Medical Blue & Clean Typography).
- [x] **Zero Compilation Warnings**: Code TypeScript chặt chẽ, không sử dụng type `any` bừa bãi.

---

## Technical Notes & Architecture Mapping

| Component | Đường dẫn File | Mô tả Trách Nhiệm |
| :--- | :--- | :--- |
| **Database Schema** | `docs/DATABASE_SCHEMA.sql` | Khai báo cấu trúc bảng `document_summaries` và indexes |
| **Database Types** | `src/core/database/types.ts` | Interface Kysely `DocumentSummaryTable` & `DatabaseSchema` |
| **Backend Service** | `src/modules/summaries/summaries.service.ts` | CRUD bài tóm tắt, tìm kiếm, liên kết môn học |
| **Export Service** | `src/modules/export/export.service.ts` | Sinh tài liệu Word (.docx) & Printable HTML PDF |
| **Backend Routes** | `src/routes/summaries.routes.ts` | Khai báo các endpoints RESTful và xác thực Zod |
| **App Server Setup** | `src/app.ts` | Đăng ký route và service vào Fastify app |
| **Frontend Service** | `client/src/services/summary.service.ts` | Client API wrapper kết nối backend |
| **Generator Hook** | `client/src/hooks/useQuizGenerator.ts` | Auto-save bài tóm tắt ngay khi AI sinh xong |
| **Review UI** | `client/src/components/generator/QuestionReviewList.tsx` | Nút tắt điều hướng và tải nhanh Word/PDF |
| **Study Hub UI** | `client/src/components/summaries/SummaryStudyHub.tsx` | Màn hình chính Kho Bài Học Tóm Tắt & Reader View |
| **Main App Navigation**| `client/src/App.tsx` | Tab "Tài Liệu Tóm Tắt", chuyển tab, liên kết tạo đề |
| **Integration Test** | `tests/summary-study-hub.test.ts` | Kiểm thử tích hợp tự động 100% |
