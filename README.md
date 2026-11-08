# Hệ Thống Tạo Đề Thi Trắc Nghiệm Tự Động Với AI (Tao-Trac-Nghiem AI)

Hệ thống chuyên sâu dành cho sinh viên, đặc biệt tập trung cho sinh viên ngành Y khoa:
- Tự động trích xuất tài liệu học tập **đa định dạng**:
  - **Tài liệu**: PDF, Word (.docx)
  - **Bảng tính**: Excel (.xlsx)
  - **Văn bản**: .txt, .md/.markdown, .csv, .html/.htm
  - **Ảnh chụp tài liệu**: PNG, JPG/JPEG, WebP, BMP, TIFF (nhận diện chữ bằng OCR)
- **Đọc được cả PDF scan hình ảnh**: khi file không có text layer (tài liệu chụp/scan),
  hệ thống tự render từng trang và nhận diện chữ bằng OCR (Tesseract, tiếng Việt + Anh),
  giới hạn 20 trang đầu mỗi lần.
- Tự nhận diện định dạng theo **nội dung file** (magic bytes), không tin vào đuôi file
  người dùng gửi lên — đổi đuôi `.exe` thành `.pdf` cũng bị từ chối.
- Tự dò bảng mã văn bản: UTF-8, UTF-16 (có BOM) và Windows-1258 cho tài liệu tiếng Việt cũ.
- Ứng dụng AI (Google Gemini 1.5) biên soạn câu hỏi trắc nghiệm 4 lựa chọn có phân loại độ khó và lời giải thích y khoa chi tiết.
- Cơ chế chia lô (Batching) linh hoạt hỗ trợ sinh **10, 20, 35, 50, 100 câu hỏi** mà không bị timeout.
- Hệ thống phòng thi: Chế độ Ôn tập tự do & Thi thử 60 câu ngẫu nhiên 30 phút chống gian lận thời gian.
- **Thư viện đề thi theo môn học** trong Phòng thi: mọi đề đã tạo (từ "Tạo Đề AI") được lưu vĩnh viễn
  trong CSDL theo danh mục môn học, có thể làm bài lại, đổi tên/đổi môn (sửa), hoặc xoá vĩnh viễn
  cho tới khi người dùng chủ động xoá.

---

## 📁 Cấu Trúc Thư Mục Dự Án

```text
Tao-Trac-Nghiem/
├── .env.example                  # File mẫu biến môi trường
├── package.json                  # Cấu hình dependencies & scripts
├── tsconfig.json                 # Cấu hình TypeScript ES2022
├── docs/
│   ├── DATABASE_SCHEMA.sql       # Script DDL PostgreSQL & chiến lược Indexing
│   └── PRD.md                    # Tài liệu yêu cầu sản phẩm rút gọn (Lean PRD)
├── uploads/                      # Thư mục chứa file tải lên tạm thời
└── src/
    ├── app.ts                    # Khởi tạo Fastify instance & routes
    ├── server.ts                 # Điểm khởi chạy HTTP Server
    ├── config/                   # Quản lý cấu hình & biến môi trường
    │   └── env.config.ts
    ├── core/
    │   ├── database/             # Kysely Query Builder & Schema Types
    │   │   ├── db.ts
    │   │   └── types.ts
    │   ├── redis/                # Kết nối Redis Cache & Queue
    │   │   └── redis.connection.ts
    │   └── errors/               # Centralized AppError classes
    │       └── index.ts
    └── modules/
        ├── ai-generator/         # AI Service gọi Google Gemini & Batch Chunking
        │   └── ai.service.ts
        ├── documents/            # Trích xuất văn bản đa định dạng
        │   └── parsers/
        │       ├── pdf.parser.ts     # Nhận diện định dạng & điều phối (pdf/docx/xlsx/text/html/image)
        │       ├── text.parser.ts    # .txt .md .csv .html — dò bảng mã, chuyển HTML sang text
        │       ├── excel.parser.ts   # .xlsx qua exceljs
        │       └── ocr.ts            # OCR PDF scan (pdfjs + canvas) và ảnh rời (tesseract.js)
        ├── questions/            # Repository quản lý câu hỏi & đáp án
        │   └── questions.repository.ts
        └── attempts/             # Engine làm bài, nộp bài & chấm điểm Server-side
            └── attempts.service.ts
```

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Dự Án

### 1. Cài đặt các thư viện phụ thuộc:
```bash
npm install
```

### 2. Thiết lập biến môi trường:
Tạo file `.env` từ `.env.example`:
```bash
cp .env.example .env
```
Điền `GEMINI_API_KEY` của bạn vào file `.env`.

### 3. Chạy ở môi trường Development:
```bash
npm run dev
```

### 4. Build sản phẩm:
```bash
npm run build
npm start
```
