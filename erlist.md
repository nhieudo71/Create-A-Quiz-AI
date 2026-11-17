# Báo cáo kiểm tra lỗi

Ngày kiểm tra: 2026-11-17

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | Đạt: 127/127 test, không có test lỗi hoặc bị bỏ qua |
| `npm run build:all` | Đạt: TypeScript client, Vite production build và TypeScript server |
| `npx tsx tests\smoke-flow.tmp.ts` | Đạt sau khi sửa lỗi kịch bản smoke test |
| `node --check electron\main.cjs` và `node --check electron\preload.cjs` | Đạt |

## Lỗi đã phát hiện và sửa

- `tests/smoke-flow.tmp.ts` chọn phương án đầu tiên trong danh sách làm đáp án đúng. Danh sách đáp án được xáo trộn theo từng lượt thi, nên giả định này làm smoke test thất bại với kết quả `0/3` thay vì `2/3`.
- Sửa kịch bản để tìm phương án đúng theo nội dung của bộ câu hỏi kiểm thử (`Đúng`), không dựa vào vị trí đã bị xáo trộn. Không cần thay đổi logic ứng dụng.

## Kiểm tra lại

Sau khi sửa, smoke test chạy trọn luồng tạo đề, bắt đầu thi, chấm điểm, ngăn nộp lần hai, xem lại đáp án, xem lịch sử, làm lại đề và chế độ ôn tập không giới hạn thời gian. Toàn bộ kiểm tra đều đạt; không còn lỗi được phát hiện trong phạm vi các lệnh và luồng đã chạy.
