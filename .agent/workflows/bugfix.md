---
description: Fix bug mà không phá logic đang hoạt động đúng
---

## Yêu cầu bắt buộc:
1. Xác định root cause, không sửa triệu chứng
2. Đọc kỹ code liên quan trước khi chỉnh sửa
3. Giữ nguyên business logic cũ ngoài phạm vi bug
4. Áp dụng cách sửa nhỏ nhất nhưng an toàn nhất
5. Kiểm tra các flow lân cận để tránh tạo bug mới
6. Không đổi response, state flow, validation hoặc behavior cũ nếu không thật sự cần
7. Sau khi sửa, tự review lại toàn bộ phần bị ảnh hưởng
8. Báo cáo theo format:
   - Root cause
   - Fix
   - Vì sao fix này không phá logic cũ
   - Edge cases đã kiểm tra
   - Regression risks
