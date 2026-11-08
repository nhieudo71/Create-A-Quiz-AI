# TÀI LIỆU YÊU CẦU SẢN PHẨM (LEAN PRD) & SPRINT 1

## 1. Vấn đề cốt lõi (Core Problem)
Sinh viên Y khoa đối mặt với khối lượng tài liệu khổng lồ (Giải phẫu, Dược lý, Bệnh học...). Phương pháp ôn thi hiệu quả nhất là làm trắc nghiệm lặp lại (Active Recall), nhưng việc tự tạo câu hỏi bám sát slide bài giảng tốn nhiều giờ đồng hồ.

## 2. Phạm vi MVP (Minimum Viable Product)
- **Tải lên tài liệu:** Hỗ trợ PDF, DOCX, XLSX, TXT, ảnh chụp (tối đa 500MB).
- **AI sinh câu hỏi:** Lựa chọn số lượng linh hoạt (10, 20, 35, 50, 100 câu), phân loại Dễ / Trung bình / Khó, có giải thích y khoa chi tiết.
- **2 Chế độ làm bài:**
  - Ôn tập: Tự do chọn số lượng câu, không áp lực thời gian.
  - Thi thử: 60 câu ngẫu nhiên, giới hạn 30 phút, đồng hồ đếm ngược chốt chặn Server-side.
- **Xem kết quả:** Chấm điểm tức thì, xem đáp án và giải thích sau khi nộp bài.

## 3. Sprint 1 Goal
> "Xây dựng luồng khép kín (End-to-End Walking Skeleton): Upload tài liệu bài giảng -> AI sinh câu hỏi có giải thích -> Sinh viên làm bài và xem kết quả trực tiếp."
