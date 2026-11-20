import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');

describe('Summary Study Hub: Database, CRUD API & Export (Word & PDF)', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    const { runMigrations } = await import('../src/core/database/migrate');
    await runMigrations();
    app = buildApp({ disableRateLimit: true });
    closeDatabase = dbModule.closeDatabase;
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  let createdSummaryId: string;
  let createdSubjectId: string;

  it('1. Tạo mới bài học tóm tắt thành công qua POST /api/v1/summaries', async () => {
    const markdownSummary = `
# Tổng quan về Tăng huyết áp
Tăng huyết áp là một bệnh mạn tính phổ biến, nguy cơ dẫn đến nhồi máu cơ tim và đột quỵ.

## Phân độ theo ESC 2024
- Huyết áp bình thường: < 120/80 mmHg.
- Huyết áp cao tiền lâm sàng: 120-139 / 80-89 mmHg.
- Tăng huyết áp độ 1: 140-159 / 90-99 mmHg.
- Tăng huyết áp độ 2: >= 160 / 100 mmHg.

### Điều trị nội khoa
1. Khởi đầu thuốc ức chế men chuyển (ACEi) hoặc ARB.
2. Phối hợp với chẹn kênh Canxi (CCB) hoặc lợi tiểu Thiazide.
> Lưu ý: Không phối hợp ACEi và ARB cùng lúc vì làm tăng nguy cơ suy thận cấp.
    `.trim();

    const payload = {
      title: 'Tăng Huyết Áp Y Khoa - Hướng Dẫn Điều Trị',
      summary: markdownSummary,
      subject_name: 'Nội Tim Mạch',
      source_filename: 'ESC_Hypertension_2024.pdf',
      key_takeaways: [
        'Mục tiêu HA: < 130/80 mmHg cho đa số bệnh nhân',
        'Thuốc lựa chọn đầu tay: ACEi/ARB kết hợp CCB hoặc Thiazide',
        'Theo dõi chức năng thận và kali máu định kỳ'
      ]
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summaries',
      headers: {
        'content-type': 'application/json',
        'x-app-token': 'medquiz-secret-dev-token'
      },
      payload
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    assert.equal(body.data.title, payload.title);
    assert.equal(body.data.subject_name, 'Nội Tim Mạch');
    assert.equal(body.data.source_filename, 'ESC_Hypertension_2024.pdf');
    assert.ok(body.data.word_count > 50, `Word count phải được tự động tính: ${body.data.word_count}`);

    createdSummaryId = body.data.id;
    createdSubjectId = body.data.subject_id;
  });

  it('2. Lấy danh sách tóm tắt qua GET /api/v1/summaries (hỗ trợ search và filter môn học)', async () => {
    // List all
    const resAll = await app.inject({
      method: 'GET',
      url: '/api/v1/summaries',
      headers: { 'x-app-token': 'medquiz-secret-dev-token' }
    });
    assert.equal(resAll.statusCode, 200);
    const bodyAll = JSON.parse(resAll.body);
    assert.equal(bodyAll.success, true);
    assert.ok(Array.isArray(bodyAll.data));
    assert.ok(bodyAll.data.length >= 1);

    // Filter by subject_id
    const resFiltered = await app.inject({
      method: 'GET',
      url: `/api/v1/summaries?subject_id=${createdSubjectId}`,
      headers: { 'x-app-token': 'medquiz-secret-dev-token' }
    });
    assert.equal(resFiltered.statusCode, 200);
    const bodyFiltered = JSON.parse(resFiltered.body);
    assert.ok(bodyFiltered.data.some((item: any) => item.id === createdSummaryId));

    // Search by title or content
    const resSearch = await app.inject({
      method: 'GET',
      url: '/api/v1/summaries?search=huyết+áp',
      headers: { 'x-app-token': 'medquiz-secret-dev-token' }
    });
    assert.equal(resSearch.statusCode, 200);
    const bodySearch = JSON.parse(resSearch.body);
    assert.ok(bodySearch.data.some((item: any) => item.id === createdSummaryId));
  });

  it('3. Lấy chi tiết bài học tóm tắt qua GET /api/v1/summaries/:id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/summaries/${createdSummaryId}`,
      headers: { 'x-app-token': 'medquiz-secret-dev-token' }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.data.id, createdSummaryId);
    assert.equal(body.data.subject_name, 'Nội Tim Mạch');

    // 404 khi không tìm thấy
    const resNotFound = await app.inject({
      method: 'GET',
      url: '/api/v1/summaries/00000000-0000-0000-0000-000000000999',
      headers: { 'x-app-token': 'medquiz-secret-dev-token' }
    });
    assert.equal(resNotFound.statusCode, 404);
  });

  it('4. Xuất bài học tóm tắt sang Word (.docx) qua GET /api/v1/summaries/:id/export/docx', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/summaries/${createdSummaryId}/export/docx`,
      headers: { 'x-app-token': 'medquiz-secret-dev-token' }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(
      res.headers['content-type'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    assert.ok(String(res.headers['content-disposition']).includes('attachment; filename='));
    assert.ok(res.rawPayload.length > 500, 'Kích thước file docx phải hợp lệ');
  });

  it('5. Xuất bài học tóm tắt sang PDF HTML qua GET /api/v1/summaries/:id/export/pdf', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/summaries/${createdSummaryId}/export/pdf`,
      headers: { 'x-app-token': 'medquiz-secret-dev-token' }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.ok(String(res.headers['content-disposition']).includes('inline; filename='));
    
    const html = res.body;
    assert.ok(html.includes('Tăng Huyết Áp Y Khoa'), 'HTML phải chứa tiêu đề bài học');
    assert.ok(html.includes('Nội Tim Mạch'), 'HTML phải chứa tên môn học');
    assert.ok(html.includes('Điểm Ghi Nhớ Trọng Tâm'), 'HTML phải chứa khối Key Takeaways');
    assert.ok(html.includes('window.print()'), 'HTML phải chứa lệnh gọi in ấn tự động');
    assert.ok(html.includes('@media print'), 'HTML phải có cấu hình style @media print');
  });

  it('6. Xoá bài học tóm tắt qua DELETE /api/v1/summaries/:id', async () => {
    const resDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/summaries/${createdSummaryId}`,
      headers: { 'x-app-token': 'medquiz-secret-dev-token' }
    });

    assert.equal(resDelete.statusCode, 200);
    const body = JSON.parse(resDelete.body);
    assert.equal(body.success, true);
    assert.equal(body.data.deleted, true);

    // Xác nhận đã xoá: GET tiếp theo phải báo 404
    const resGetAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/summaries/${createdSummaryId}`,
      headers: { 'x-app-token': 'medquiz-secret-dev-token' }
    });
    assert.equal(resGetAfter.statusCode, 404);
  });
});
