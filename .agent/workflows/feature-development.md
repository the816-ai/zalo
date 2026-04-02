---
description: Phát triển tính năng mới mà không phá logic hiện có
---

## Yêu cầu bắt buộc:
1. Đọc và hiểu luồng hiện tại trước khi sửa
2. Tóm tắt logic hiện tại trước khi code
3. Giữ nguyên hành vi cũ nếu task không yêu cầu thay đổi
4. Chỉ thay đổi phạm vi tối thiểu cần thiết
5. Không refactor lan sang phần không liên quan
6. Nếu có nguy cơ ảnh hưởng logic cũ, phải nêu rõ trước khi sửa
7. Sau khi code xong, tự review để tìm regression risk, edge case và logic bị ảnh hưởng
8. Cuối cùng báo lại:
   - Logic cũ là gì
   - Đã sửa gì
   - Phần nào được giữ nguyên
   - Rủi ro còn lại
