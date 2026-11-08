@echo off
chcp 65001 >nul <nul
setlocal enabledelayedexpansion
title MedQuiz AI - Trinh Dieu Khien He Thong
color 0B

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

:MENU
cls
echo ===============================================================================
echo                MEDQUIZ AI - HE THONG TAO DE THI TRAC NGHIEM AI
echo                      Danh cho Sinh Vien va Y Khoa Chuyen Sau
echo ===============================================================================
echo.
echo  Chon che do ban muon khoi dong:
echo.
echo  [1] Chay ung dung Desktop (Electron Window)
echo  [2] Chay ung dung Web (Backend cong 3000 + Trinh duyet Web cong 5273)
echo  [3] Dong goi thanh file cai dat Windows (.exe)
echo  [4] Thoat
echo.
echo ===============================================================================
set "CHOICE="
set /p CHOICE="Nhap lua chon cua ban (1, 2, 3 hoac 4) roi nhan Enter: "

if "%CHOICE%"=="1" goto RUN_ELECTRON
if "%CHOICE%"=="2" goto RUN_WEB
if "%CHOICE%"=="3" goto BUILD_EXE
if "%CHOICE%"=="4" goto END
goto MENU

:CHECK_DEPS
:: Kiem tra thu vien that su (khong chi thu muc), vi node_modules co the thieu binary
if not exist "%ROOT%\node_modules\tsx" (
    echo [1/3] Dang cai dat thu vien Backend...
    pushd "%ROOT%"
    call npm install
    if errorlevel 1 (
        echo.
        echo LOI: npm install that bai. Xem thong bao phia tren.
        popd
        pause
        exit /b 1
    )
    popd
)
if not exist "%ROOT%\node_modules\electron\path.txt" (
    echo [2/3] Dang cai dat Electron...
    pushd "%ROOT%"
    call npm install
    if errorlevel 1 (
        echo.
        echo LOI: Khong cai duoc Electron. Kiem tra ket noi mang.
        popd
        pause
        exit /b 1
    )
    popd
)
if not exist "%ROOT%\client\node_modules\vite" (
    echo [3/3] Dang cai dat thu vien Frontend...
    pushd "%ROOT%\client"
    call npm install
    if errorlevel 1 (
        echo.
        echo LOI: npm install frontend that bai. Xem thong bao phia tren.
        popd
        pause
        exit /b 1
    )
    popd
)
exit /b 0

:RUN_ELECTRON
cls
echo [Dang khoi dong MedQuiz AI Desktop...]
echo.
call :CHECK_DEPS
if errorlevel 1 goto MENU

echo Dang khoi dong Vite (cong 5273)...
start "MedQuiz Frontend (Vite)" /D "%ROOT%\client" cmd /k "npm run dev"

echo Cho Vite san sang...
call :WAIT_PORT 5273
if errorlevel 1 (
    echo.
    echo LOI: Vite khong khoi dong duoc tren cong 5273.
    echo Xem cua so "MedQuiz Frontend (Vite)" de biet chi tiet.
    pause
    goto MENU
)

echo Dang mo cua so ung dung...
pushd "%ROOT%"
set "NODE_ENV=development"
call npx electron .
popd
goto MENU

:RUN_WEB
cls
echo [Dang khoi dong MedQuiz AI ban Web...]
echo.
call :CHECK_DEPS
if errorlevel 1 goto MENU

start "MedQuiz Backend" /D "%ROOT%" cmd /k "npm run dev"
start "MedQuiz Frontend" /D "%ROOT%\client" cmd /k "npm run dev"

echo Cho may chu san sang...
call :WAIT_PORT 5273
if errorlevel 1 (
    echo.
    echo CANH BAO: Frontend chua phan hoi tren cong 5273.
    echo Van mo trinh duyet, hay cho them vai giay roi tai lai trang.
) else (
    start "" http://localhost:5273
)
goto MENU

:BUILD_EXE
cls
call "%ROOT%\build-exe.bat"
goto MENU

:WAIT_PORT
:: Cho toi da ~30 giay de cong mo. Dung PowerShell de kiem tra TCP.
::
:: Phai thu "localhost" (chu khong phai "127.0.0.1" rieng le): Vite khong khai
:: bao "host" nen tren Windows no chi lang nghe tren ::1 (IPv6), con 127.0.0.1
:: thi bi tu choi. Dung ham dung New-Object Net.Sockets.TcpClient(host, port)
:: (constructor tu resolve dung ho dia chi) chu KHONG duoc tao TcpClient() rong
:: roi goi .Connect('::1', port): .NET mac dinh ho dia chi la IPv4 nen Connect
:: voi chuoi IPv6 se nem loi du cong dang mo that.
set "PORT=%~1"
set /a "WAIT_TRIES=0"
:WAIT_PORT_LOOP
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient('localhost', %PORT%); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 exit /b 0
set /a "WAIT_TRIES+=1"
if !WAIT_TRIES! geq 30 exit /b 1
timeout /t 1 /nobreak >nul
goto :WAIT_PORT_LOOP

:END
endlocal
exit /b 0
