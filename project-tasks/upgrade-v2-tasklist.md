# MedQuiz AI - Danh Sách Nhiệm Vụ Phát Triển Phiên Bản 2.0 (Upgrade v2 Task List)

## Specification Summary
**Tài liệu đặc tả**: `e:/APP/Tao-Trac-Nghiem/project-specs/upgrade-v2-spec.md`  
**Dự án**: MedQuiz AI - Hệ Thống Tạo Đề Thi & Ôn Luyện Y Khoa Chuẩn Active Recall  
**Yêu cầu gốc từ người dùng**:
1. *Thoát phòng thi sau khi thi xong*: Hiện tại thi xong mở lại vẫn còn ở phòng thi. Cần thêm tính năng thoát phòng thi sau khi thi xong và cơ chế thoát phòng thi linh hoạt.
2. *Tóm tắt tổng hợp kiến thức từ tài liệu tải lên*: Chạy tính năng này tự động sau khi tạo câu hỏi xong.
3. *Tự động lưu câu hỏi sau khi đã tạo xong*: Tự động lưu đề thi và bộ câu hỏi vào CSDL ngay khi sinh xong (100%), không để mất dữ liệu.
4. *Phím tắt chọn đáp án bằng số và Enter chuyển câu*: Chọn đáp án bằng số trên bàn phím (1-4, bao gồm Numpad) và nhấn Enter để qua câu tiếp theo.
5. *Tự động load model AI sau khi nhập API key xong*: Sau khi dán/nhập API key của nhà cung cấp AI, tự động truy vấn danh sách model thật và hiển thị dropdown lựa chọn.

**Technical Stack**:
- Backend: Fastify, TypeScript, Kysely, PGlite (Embedded Postgres)
- Frontend: React 18, Vite, Tailwind CSS, Lucide Icons
- AI Providers: Google Generative AI, OpenAI / Anthropic APIs, Ollama / Local AI
- Testing: Node.js Test Runner (`tsx --test`), Vitest

---

## Development Tasks

### [x] Task 1: Thoát Phòng Thi Sau Khi Thi Xong & Cơ Chế Thoát Linh Hoạt
**Description**: Bổ sung cơ chế thoát phòng thi triệt để sau khi hoàn thành bài thi (không bị kẹt lại giao diện phòng thi cũ khi chuyển tab hoặc mở lại), đồng thời bổ sung nút "Rời phòng thi" kèm modal điều hướng linh hoạt (lưu nháp tiếp tục sau / nộp bài sớm / huỷ lượt) khi đang trong phòng thi.

**Detailed Requirements & Implementation**:
1. **Màn hình Kết Quả (Result Screen) trong `ExamRoom.tsx`**:
   - Thêm nút chính "Thoát Phòng Thi / Về Danh Sách Đề" và "Xem Lại Trong Lịch Sử".
   - Khi bấm thoát: gọi callback `onExit()`, dọn dẹp sạch `activeQuizId`, `resumeAttemptId`, đưa người dùng về giao diện Thư viện đề thi (`QuizLibrary`).
2. **Quản lý trạng thái tại `App.tsx`**:
   - Cập nhật hàm `onAttemptFinished()`: xoá bỏ `activeQuizId` hoặc đánh dấu phiên thi đã kết thúc.
   - Khi người dùng bấm vào tab "Phòng Thi" (`activeTab === 'EXAM'`), nếu không có lượt thi đang làm dở hợp lệ thì mặc định hiển thị Thư viện đề thi / Study Hub thay vì render màn hình kết quả của lượt thi đã kết thúc trước đó.
3. **Cơ chế thoát linh hoạt khi đang làm bài (Exam Header)**:
   - Thêm nút "Rời phòng thi" (icon `ArrowLeft` / `LogOut`) trên thanh trạng thái bài thi cạnh đồng hồ đếm ngược.
   - Bổ sung `ExitExamModal` khi người dùng bấm rời phòng thi với 3 lựa chọn:
     * **Lưu nháp & Tạm dừng**: Giữ nguyên các câu đã trả lời trên máy chủ, giải phóng `activeQuizId`. Banner "Bạn có bài thi đang làm dở" sẽ xuất hiện để người dùng tiếp tục làm bất cứ lúc nào.
     * **Nộp bài ngay**: Thu bài và chấm điểm các câu đã làm.
     * **Huỷ lượt thi này**: Gọi `QuizService.abandonAttempt(attemptId)`, xoá lượt thi và trở về màn hình chính.

**Acceptance Criteria**:
- [x] Sau khi nộp bài xong và xem kết quả, người dùng có nút bấm thoát rõ ràng về Thư viện đề thi.
- [x] Sau khi đã thi xong, chuyển sang tab khác ("Tạo Đề AI", "Lịch Sử") rồi bấm quay lại tab "Phòng Thi", hệ thống hiển thị Thư viện đề thi/Chọn đề, tuyệt đối không bị kẹt lại phòng thi của lượt vừa xong.
- [x] Trong khi đang làm bài, người dùng có thể bấm "Rời phòng thi" và chọn lưu nháp để tiếp tục sau hoặc huỷ lượt thi an toàn.
- [x] Điểm số và lượt thi đã nộp được ghi nhận chính xác trong tab "Lịch Sử Thi".

**Files Created/Edited**:
- `client/src/components/exam/ExamRoom.tsx` (ExitExamModal, header button, result screen button)
- `client/src/App.tsx` (handleExamExit, clean tab navigation)
- `src/routes/attempts.routes.ts` (`POST /api/v1/attempts/:id/abandon`, `POST /api/v1/attempts/:id/complete`)

**Verification Evidence**:
- Test suite `tests/upgrade-v2.test.ts` đã kiểm thử: Bắt đầu lượt thi -> Huỷ lượt thi qua `/api/v1/attempts/:id/abandon` -> Giải phóng phiên thi -> Hoàn thành bài thi qua `/api/v1/attempts/:id/complete` -> Lưu kết quả và xoá khỏi in-progress (100% Passed).

---

### [x] Task 2: Tự Động Tóm Tắt Tổng Hợp Kiến Thức Từ Tài Liệu Tải Lên Sau Khi Tạo Câu Hỏi
**Description**: Bổ sung tính năng AI tự động tóm tắt và tổng hợp kiến thức y khoa cốt lõi (High-Yield Medical Review) từ nội dung tài liệu tải lên. Tính năng này tự động kích hoạt ngay sau khi tiến trình sinh câu hỏi hoàn tất (100%).

**Detailed Requirements & Implementation**:
1. **Backend Prompt & Service (`src/modules/ai-generator/`)**:
   - Bổ sung phương thức `summarizeDocument(textChunk: string, subjectName: string)` trong `AIService`:
     * System prompt chuyên biệt cho giáo dục Y khoa: Trích xuất các khái niệm trọng tâm, cơ chế bệnh sinh, dược lý học cơ bản, tiêu chuẩn chẩn đoán, phác đồ điều trị, các bẫy câu hỏi thường gặp và bảng tra cứu nhanh.
     * Định dạng trả về: Markdown chuẩn mực, rõ ràng, phân mục mạch lạc.
2. **Backend API Endpoint (`src/routes/documents.routes.ts` hoặc `src/routes/questions.routes.ts`)**:
   - Thêm route `POST /api/v1/generator/summarize`:
     * Input schema: `{ text_content: string, subject_name: string }`.
     * Output schema: `{ summary: string, subject_name: string }`.
3. **Frontend Service & Hook (`client/src/services/generator.service.ts`, `client/src/hooks/useQuizGenerator.ts`)**:
   - Bổ sung hàm `GeneratorService.summarizeDocument(...)`.
   - Trong `useQuizGenerator.ts`: Thêm state `documentSummary: string | null`, `isSummarizing: boolean`.
   - Ngay sau khi `generateQuestionsStream` đạt 100% (`status === 'COMPLETED'`), tự động kích hoạt tiến trình tóm tắt kiến thức từ `rawText` ở chế độ background/non-blocking.
4. **Frontend UI Panel (`client/src/components/generator/QuestionReviewList.tsx`)**:
   - Thêm khối/tab hiển thị "Tóm Tắt & Tổng Hợp Kiến Thức Cốt Lõi" bên cạnh danh sách câu hỏi.
   - Hiển thị nội dung tóm tắt Markdown đẹp mắt, có nút "Sao chép tóm tắt" và "Xuất file ghi chú (.md)".

**Acceptance Criteria**:
- [x] Ngay khi quá trình tạo câu hỏi đạt 100%, tính năng tóm tắt tài liệu tự động chạy mà không cần người dùng thao tác thêm.
- [x] Bản tóm tắt kiến thức phân tách rõ ràng các mục: Định nghĩa then chốt, Cơ chế tác động, Dấu hiệu chẩn đoán, Phác đồ xử trí và Điểm cần lưu ý khi thi.
- [x] Giao diện Review câu hỏi hiển thị bảng tóm tắt mượt mà, hỗ trợ đọc, sao chép và tải về.
- [x] Nếu tài liệu quá ngắn hoặc lỗi mạng khi tóm tắt, có cơ chế thông báo nhẹ nhàng (toast/retry), không làm gián đoạn việc xem và làm bài của bộ câu hỏi đã tạo.

**Files Created/Edited**:
- `src/modules/ai-generator/ai.service.ts` (`summarizeDocument` method)
- `src/routes/questions.routes.ts` (`POST /api/v1/generator/summarize`, `summarizeBodySchema`)
- `client/src/services/generator.service.ts` (`summarizeDocument`)
- `client/src/hooks/useQuizGenerator.ts` (Auto-trigger summarization upon 100% complete)
- `client/src/components/generator/QuestionReviewList.tsx` (Summary tab, Markdown view, copy & export .md buttons)

**Verification Evidence**:
- Test suite `tests/upgrade-v2.test.ts` & `tests/phase4-docs-ai.test.ts` kiểm thử: Thiếu `text_content` (400), text dưới 10 ký tự (400), thiếu `subject_name` (400), xử lý thông báo thân thiện khi chưa cấu hình AI (100% Passed).

---

### [x] Task 3: Tự Động Lưu Đề Thi & Bộ Câu Hỏi Vào CSDL Ngay Khi Sinh Xong (100%)
**Description**: Đảm bảo an toàn dữ liệu tuyệt đối (Zero Data Loss): ngay khi AI hoàn tất sinh câu hỏi (100%), hệ thống tự động lưu đề thi và toàn bộ các câu hỏi vào CSDL máy chủ mà không đòi hỏi người dùng phải bấm nút lưu thủ công.

**Detailed Requirements & Implementation**:
1. **Cơ chế Auto-save tại `client/src/hooks/useQuizGenerator.ts`**:
   - Thêm state `savedQuizId: string | null`, `isAutoSaved: boolean`, `savedAt: Date | null`.
   - Trong `handleStartGeneration`, ngay sau khi nhận trọn vẹn danh sách câu hỏi (`setProgress({ status: 'COMPLETED' })`):
     * Tự động gọi `QuizService.createQuiz({ title: `Đề thi ${config.subjectName} (${generated.length} câu) - ${new Date().toLocaleDateString('vi-VN')}`, subjectName: config.subjectName, mode: 'EXAM', questions: generated })`.
     * Lưu `quiz.id` trả về vào `savedQuizId`, set `isAutoSaved = true`, lưu mốc thời gian `savedAt`.
2. **Cập nhật UI trong `client/src/components/generator/QuestionReviewList.tsx`**:
   - Thay thế nút bấm "Lưu vào Ngân Hàng Đề" thủ công bằng trạng thái thông báo trực quan:
     * Huy hiệu trạng thái: `✓ Đã tự động lưu vào CSDL lúc [HH:mm:ss] (Mã đề: [quizId])`.
     * Nếu người dùng chỉnh sửa hoặc xoá bớt câu hỏi trong màn hình review: hiển thị nút "Đồng bộ thay đổi vào CSDL" để cập nhật lại đề đã lưu.
   - Thêm nút thao tác nhanh: "Vào phòng thi ngay với đề vừa tạo" (chuyển thẳng tới `startExamWithQuestions`).
3. **Backend kiểm thử tính toàn vẹn (`src/routes/quizzes.routes.ts`)**:
   - Đảm bảo transaction lưu đồng thời quiz, subject và danh sách questions an toàn tuyệt đối, phản hồi nhanh chóng kể cả với đề thi lớn (50-100 câu).
   - Thêm route `GET /api/v1/quizzes/:id` trả về chi tiết đề thi, môn học, câu hỏi và phương án trả lời.

**Acceptance Criteria**:
- [x] Khi AI sinh xong 100% câu hỏi, toàn bộ câu hỏi và đề thi được lưu thành công vào CSDL tự động.
- [x] Người dùng làm mới ứng dụng (F5) hoặc chuyển ngay sang tab "Phòng Thi" / Thư viện đề thi, đề thi mới tạo đã sẵn sàng để thi hoặc ôn tập.
- [x] Hiển thị thông báo toast và huy hiệu màu xanh xác nhận đã lưu thành công kèm thời gian cụ thể.
- [x] Các thao tác sửa/xoá câu hỏi sau khi tự động lưu được hỗ trợ cập nhật lại vào đề thi đã lưu.

**Files Created/Edited**:
- `client/src/hooks/useQuizGenerator.ts` (Auto-save logic on completion)
- `client/src/components/generator/QuestionReviewList.tsx` (Auto-saved status badge, quick exam button)
- `client/src/services/quiz.service.ts` (`getQuiz`)
- `src/modules/attempts/attempts.service.ts` (`getQuizById`)
- `src/routes/quizzes.routes.ts` (`GET /api/v1/quizzes/:id`)

**Verification Evidence**:
- Test suite `tests/upgrade-v2.test.ts` kiểm thử: `POST /api/v1/quizzes` tạo đề kèm 2 câu hỏi (MCQ và TRUE_FALSE) -> `GET /api/v1/quizzes/:id` xác thực toàn vẹn quiz, subject_name, danh sách câu hỏi và các options -> Kiểm tra 404 với ID không tồn tại (100% Passed).

---

### [x] Task 4: Phím Tắt Chọn Đáp Án Bằng Số (1-4, Numpad) & Enter Chuyển Câu
**Description**: Hiện thực hóa hệ thống phím tắt tăng tốc độ làm bài: bấm phím số `1`, `2`, `3`, `4` (hỗ trợ cả dãy phím số trên và bàn phím phụ Numpad) để chọn phương án tương ứng (A, B, C, D) và bấm `Enter` để chuyển ngay sang câu tiếp theo.

**Detailed Requirements & Implementation**:
1. **Lắng nghe sự kiện bàn phím trong `client/src/components/exam/ExamRoom.tsx`**:
   - Bổ sung `useEffect` bắt sự kiện `window.addEventListener('keydown', handleKeyDown)`:
     * **Bảo vệ input**: Kiểm tra `e.target` nếu là thẻ `<input>`, `<textarea>`, `<select>` thì bỏ qua để không cản trở việc gõ câu hỏi điền khuyết.
     * **Bảo vệ trạng thái**: Bỏ qua nếu modal xác nhận đang mở hoặc bài thi đã nộp (`result !== null`).
     * **Xử lý phím chọn đáp án**:
       - `Digit1` hoặc `Numpad1` -> chọn phương án 1 (A).
       - `Digit2` hoặc `Numpad2` -> chọn phương án 2 (B).
       - `Digit3` hoặc `Numpad3` -> chọn phương án 3 (C).
       - `Digit4` hoặc `Numpad4` -> chọn phương án 4 (D).
       - Áp dụng chọn ngay cho `MCQ`, `TRUE_FALSE` (1: Đúng, 2: Sai) và toggle cho `MULTI_SELECT`.
     * **Xử lý phím `Enter`**:
       - Nếu chưa phải câu cuối cùng: tự động chuyển `currentIdx` sang `currentIdx + 1`.
       - Nếu đang ở câu cuối cùng: mở modal xác nhận nộp bài (`setShowConfirmModal(true)`).
2. **Giao diện hiển thị trực quan (`QuestionAnswerPanel.tsx` & `ExamRoom.tsx`)**:
   - Trong `QuestionAnswerPanel.tsx`: Bổ sung badge phím tắt nhỏ gọn `[1]`, `[2]`, `[3]`, `[4]` bên cạnh nhãn phương án A, B, C, D.
   - Thêm thanh gợi ý phím tắt thanh lịch ở chân trang phòng thi: `💡 Mẹo làm bài: [1-4] Chọn đáp án • [Enter] Chuyển câu tiếp • [Space] Đặt cờ theo dõi`.

**Acceptance Criteria**:
- [x] Bấm phím 1, 2, 3, 4 (cả hàng số chính và bàn phím số phụ Numpad) chọn chính xác đáp án A, B, C, D tương ứng mà không cần dùng chuột.
- [x] Bấm Enter chuyển mượt mà sang câu tiếp theo; ở câu cuối cùng nhấn Enter sẽ mở modal xác nhận nộp bài.
- [x] Khi đang gõ câu trả lời điền khuyết (FILL_BLANK), phím số và Enter hoạt động bình thường như văn bản nhập liệu, không kích hoạt phím tắt thi.
- [x] Hiển thị trực quan nhãn phím tắt trên từng phương án để người dùng dễ dàng thao tác.

**Files Created/Edited**:
- `client/src/components/exam/ExamRoom.tsx` (keydown listener, event cleanup, navigation guards)
- `client/src/components/exam/QuestionAnswerPanel.tsx` (Visual shortcut badges [1], [2], [3], [4])

**Verification Evidence**:
- Đã kiểm tra trực tiếp mã nguồn trong `ExamRoom.tsx` và `QuestionAnswerPanel.tsx`. Build client `tsc && vite build` hoàn thành với 0 lỗi cảnh báo TypeScript.

---

### [x] Task 5: Tự Động Tải Danh Sách Model AI Thật Sau Khi Nhập API Key
**Description**: Nâng cấp giao diện cấu hình nhà cung cấp AI: khi người dùng dán hoặc nhập API key của nhà cung cấp (Gemini, OpenAI, Anthropic, Local AI), hệ thống tự động truy vấn danh sách model thật từ máy chủ nhà cung cấp và hiển thị dưới dạng dropdown lựa chọn trực quan, loại bỏ hoàn toàn việc phải gõ tên model thủ công.

**Detailed Requirements & Implementation**:
1. **Backend Discovery Service & Endpoint (`src/modules/ai-generator/providers/`, `src/routes/settings.routes.ts`)**:
   - Thêm route `POST /api/v1/settings/models/discover`:
     * Input schema: `{ type: ProviderType, apiKey?: string, baseUrl?: string, providerId?: string }`.
     * Cơ chế truy vấn thật theo từng nhà cung cấp:
       - **Gemini**: Gọi Google Generative Language API `GET https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}` -> lọc các model hỗ trợ `generateContent` (ví dụ: `gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash`, `gemini-2.5-flash`...).
       - **OpenAI**: Gọi `GET https://api.openai.com/v1/models` kèm Bearer token -> lọc các model thông dụng (`gpt-4o`, `gpt-4o-mini`, `o1`, `gpt-4-turbo`...).
       - **Anthropic**: Trả về danh sách model chuẩn (`claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`...).
       - **Local AI / OpenAI-compatible**: Gọi `GET ${baseUrl}/v1/models` hoặc `/api/tags`.
     * Bắt lỗi chuẩn mực: Bọc try/catch, xử lý lỗi mạng / offline fallback an toàn, không sập server.
2. **Frontend Service (`client/src/services/settings.service.ts`)**:
   - Thêm hàm `SettingsService.discoverModels(type, apiKey, baseUrl): Promise<Array<{ id: string, name: string }>>`.
3. **Frontend Modal UI (`client/src/components/settings/ProviderFormModal.tsx`)**:
   - Tự động kích hoạt truy vấn model khi người dùng nhập API key (sau khi debounce 500ms hoặc khi blur ô nhập):
     * Hiển thị trạng thái loading "Đang tải danh sách model thật...".
     * Khi tải xong, chuyển ô nhập model thành dropdown `<select>` danh sách model thật.
     * Tự động chọn model đề xuất phù hợp nhất nếu model hiện tại đang rỗng.
     * Cung cấp nút chuyển đổi "Nhập model tuỳ chỉnh" linh hoạt cho người dùng nâng cao.

**Acceptance Criteria**:
- [x] Khi nhập hoặc dán API key hợp lệ vào form, danh sách model thật được tự động tải về mà không cần bấm thêm nút nào.
- [x] Danh sách model hiển thị dạng dropdown rõ ràng, phân loại model tối ưu và model tiêu chuẩn.
- [x] Hỗ trợ chuyển đổi qua lại giữa chọn từ dropdown và nhập mã model tuỳ chỉnh.
- [x] Nếu API key sai hoặc mất kết nối mạng, hiển thị thông báo lỗi thân thiện và cho phép người dùng nhập thủ công bình thường.

**Files Created/Edited**:
- `src/routes/settings.routes.ts` (`POST /api/v1/settings/models/discover`, `discoverProviderModels`)
- `client/src/services/settings.service.ts` (`SettingsService.discoverModels`)
- `client/src/components/settings/ProviderFormModal.tsx` (Auto-discovery trigger, dropdown select, custom toggle)

**Verification Evidence**:
- Test suite `tests/upgrade-v2.test.ts` kiểm thử: Sai loại provider (400), Gemini fallback (200), OpenAI fallback (200), Anthropic models (200), Local fallback (200), Gemini lỗi mạng/sai key xử lý mượt mà (100% Passed).

---

### [x] Integration QA: Kiểm Thử Toàn Diện & Đảm Bảo Không Hồi Quy
**Description**: Thực hiện kiểm thử toàn bộ hệ thống sau khi tích hợp cả 5 tính năng, bảo đảm 100% test case vượt qua và ứng dụng vận hành trơn tru cả trên nền tảng Web và ứng dụng Desktop Electron.

**Detailed Testing Steps**:
1. **Automated Unit & Integration Tests**:
   - Tạo bộ test mới `tests/upgrade-v2.test.ts` kiểm tra:
     * Endpoint tóm tắt tài liệu `/api/v1/generator/summarize`.
     * Endpoint khám phá model `/api/v1/settings/models/discover`.
     * Quy trình auto-save quiz và chống trùng lặp dữ liệu (`POST /api/v1/quizzes`, `GET /api/v1/quizzes/:id`).
     * Quy trình abandon/complete attempt và thoát phòng thi (`/api/v1/attempts/:id/complete`, `/api/v1/attempts/:id/abandon`).
   - Chạy toàn bộ test suite (`npm test`), đảm bảo toàn bộ 155 test case pass 100%.
2. **TypeScript & Bundler Verification**:
   - Chạy `npm run build:server` (`tsc`) kiểm tra type-checking backend: 0 lỗi.
   - Chạy `npm run build:client` (`vite build`) kiểm tra build frontend: 0 lỗi.
   - Chạy `npm run build:all`: Exit code 0.
3. **End-to-End User Flow Verification**:
   - Kịch bản 1: Tải tài liệu -> Tự động sinh đề -> Tự động tóm tắt kiến thức -> Đề thi tự động lưu vào CSDL (Task 2 & 3).
   - Kịch bản 2: Vào phòng thi -> Dùng phím số 1-4 chọn đáp án -> Nhấn Enter chuyển câu nhanh chóng (Task 4).
   - Kịch bản 3: Nộp bài thi -> Bấm thoát phòng thi -> Quay lại tab Phòng thi hiển thị thư viện đề, không bị kẹt bài cũ (Task 1).
   - Kịch bản 4: Mở Cài đặt -> Nhập Gemini API key -> Dropdown tự động hiển thị model thật (Task 5).

**Acceptance Criteria**:
- [x] `npm test` pass 100% không có lỗi (155/155 passed).
- [x] `npm run build:all` hoàn tất thành công với mã thoát 0.
- [x] Tất cả 5 tính năng phối hợp đồng bộ, giao diện nhất quán và không phát sinh lỗi ngoại lệ.

---

## Quality Requirements
- [x] Tuyệt đối không chạy background process trong command (`&`).
- [x] Không khởi động server chạy ngầm trong task — mặc định môi trường phát triển đã có server.
- [x] Đảm bảo thiết kế responsive đầy đủ cho cả màn hình laptop và desktop.
- [x] Toàn bộ chuỗi văn bản giao diện sử dụng tiếng Việt chuẩn Y khoa, giao diện hiện đại với Tailwind CSS và Lucide Icons.
- [x] Không làm phá vỡ cơ chế bảo mật xác thực token (`x-app-token`) hiện tại.

## Technical Notes
- **Database**: PGlite dialect với Kysely, lưu trữ dữ liệu tại thư mục `data/` an toàn cho bản cài đặt Electron.
- **Frontend State**: Tận dụng `QuizGeneratorContext` và hook React để duy trì trạng thái mượt mà giữa các tab.
- **Test Matrix**: 17 tệp test tự động với 155 test cases chạy qua Node.js native test runner.
