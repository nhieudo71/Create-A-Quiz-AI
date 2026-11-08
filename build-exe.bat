@echo off
chcp 65001 >nul
title MedQuiz AI - Đóng Gói Ứng Dụng Desktop (.exe)
color 0A

echo ===============================================================================
echo            MEDQUIZ AI - QUY TRÌNH ĐÓNG GÓI ỨNG DỤNG WINDOWS (.EXE)
echo ===============================================================================
echo.

:: 1. Kiểm tra Node.js
echo [1/5] Kiểm tra môi trường Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [LỖI] Chưa cài đặt Node.js! Vui lòng cài đặt tại https://nodejs.org/
    pause
    exit /b
)
echo - Node.js OK.
echo.

:: 2. Cài đặt thư viện nếu còn thiếu
echo [2/5] Kiểm tra và đồng bộ thư viện npm...
if not exist "%~dp0node_modules\electron" (
    echo - Đang cài đặt Electron và các công cụ đóng gói...
    cd /d "%~dp0"
    call npm install
)

if not exist "%~dp0client\node_modules" (
    echo - Đang cài đặt thư viện Client...
    cd /d "%~dp0client"
    call npm install
)
echo - Thư viện OK.
echo.

:: 3. Build Frontend (React + Vite)
echo [3/5] Đang biên dịch giao diện Frontend (Client SPA)...
cd /d "%~dp0client"
call npm run build
if %errorlevel% neq 0 (
    color 0C
    echo [LỖI] Biên dịch Frontend thất bại!
    pause
    exit /b
)
echo - Frontend build thành công: client/dist.
echo.

:: 4. Build Backend (Fastify TypeScript)
echo [4/5] Đang biên dịch mã nguồn Backend TypeScript...
cd /d "%~dp0"
call npm run build:server
if %errorlevel% neq 0 (
    color 0C
    echo [LỖI] Biên dịch Backend thất bại!
    pause
    exit /b
)
echo - Backend build thành công: dist/.
echo.

:: 5. Đóng gói bằng Electron Builder
echo [5/5] Đang đóng gói file cài đặt Windows (.exe)...
echo Quá trình này có thể mất từ 1 - 3 phút, vui lòng không đóng cửa sổ...
call npx electron-builder --win --x64

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [LỖI] Đóng gói Electron thất bại! Hãy kiểm tra thông báo lỗi ở trên.
    pause
    exit /b
)

echo.
echo ===============================================================================
echo   CHÚC MỪNG! ĐÃ TẠO FILE .EXE THÀNH CÔNG!
echo ===============================================================================
echo Tệp cài đặt được lưu tại thư mục:
echo %~dp0dist-electron\
echo.
echo Bạn có thể mở thư mục dist-electron để lấy file:
echo - File cài đặt Setup: MedQuiz AI Setup 1.0.0.exe
echo - File chạy ngay Portable: MedQuiz AI 1.0.0.exe
echo ===============================================================================
echo.

:: Tự động mở thư mục chứa file .exe sau khi build xong
explorer "%~dp0dist-electron"

pause
