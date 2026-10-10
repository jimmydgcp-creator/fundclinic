@echo off
chcp 65001 >nul
title 基金复诊台 FundClinic
cd /d "%~dp0"

echo.
echo   基金复诊台 FundClinic
echo   ============================================

rem ---- 检查 1: 有没有装 Node ----
where node >nul 2>nul
if errorlevel 1 goto NO_NODE

rem ---- 检查 2: 是不是只把 bat 单独拷出来了 ----
if not exist "server.mjs" goto NO_FILES

echo.
echo   正在启动本地服务, 稍等 2-3 秒会自动打开浏览器...
echo   如果浏览器没有自动打开, 请看下面窗口里打印的地址, 手动访问。
echo   关闭本窗口即停止服务。
echo.

rem 浏览器由服务端在 listen 成功之后自己打开 —— 端口被占而顺延时,
rem 打开的仍然是真实端口, 不会出现"打开了却是空白页"。
set FUNDCLINIC_OPEN=1
node server.mjs
goto END

:NO_NODE
echo.
echo   [缺少 Node.js] 没有找到 node 命令。
echo.
echo   这个工具需要一个本地 Node 服务来抓取公开数据,
echo   因为浏览器直接抓天天基金 / 东方财富会被跨域安全策略拦住。
echo.
echo   安装方式:
echo     1. 打开 https://nodejs.org
echo     2. 下载 LTS 版本, 一路"下一步"装完
echo     3. 关掉这个窗口, 重新双击本文件
echo.
echo   装好之后不需要再做任何配置。
echo.
pause
goto END

:NO_FILES
echo.
echo   [文件不完整] 本目录下找不到 server.mjs。
echo.
echo   这个 bat 只是启动器, 它需要和整个项目文件夹放在一起。
echo   请不要把 bat 单独复制出来 一一 请把整个文件夹一起拷过去,
echo   或者解压收到的压缩包, 再双击里面的本文件。
echo.
pause
goto END

:END
