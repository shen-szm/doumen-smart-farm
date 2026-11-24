@echo off
rem ============================================================
rem  Runs on the server PC. Unpacks a release zip into a staging
rem  tree, builds it there, and only after a successful build
rem  syncs the sources and switches the live build directory.
rem  A failed build leaves the live site untouched.
rem
rem  Usage: apply-release.bat <release-name>
rem         (zip expected at C:\doumen\incoming\<release-name>.zip)
rem ============================================================
setlocal
set "NAME=%~1"
if "%NAME%"=="" ( echo [apply-release] missing release name & exit /b 2 )
cd /d C:\doumen || exit /b 2
set "PATH=C:\doumen\node;%PATH%"
set "ZIP=incoming\%NAME%.zip"
set "STAGE=C:\doumen\incoming\%NAME%.src"
set "OUT=C:\doumen\dist\staging"

if not exist "%ZIP%" ( echo [apply-release] release zip not found: %ZIP% & exit /b 2 )
if exist "%STAGE%" rmdir /s /q "%STAGE%"
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%STAGE%"
tar -xf "%ZIP%" -C "%STAGE%"
if errorlevel 1 ( echo [apply-release] unzip failed & exit /b 3 )
if not exist "%STAGE%\index.html" ( echo [apply-release] unexpected zip layout & exit /b 3 )

rem  Build inside the staging tree. Dependencies resolve from C:\doumen\node_modules.
rem  If package-lock.json changed in this release, run npm ci on the server first.
echo [apply-release] building %NAME% ...
pushd "%STAGE%"
call "C:\doumen\node_modules\.bin\vite.cmd" build --outDir "%OUT%" --emptyOutDir
set "BUILD_RC=%errorlevel%"
popd
if not "%BUILD_RC%"=="0" ( echo [apply-release] BUILD FAILED - live site untouched & exit /b 4 )
if not exist "%OUT%\index.html" ( echo [apply-release] build output missing - live site untouched & exit /b 4 )

rem  Keep hashed assets of the previous build so pages already open keep working.
if exist dist\client\assets robocopy dist\client\assets "%OUT%\assets" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 ( echo [apply-release] merging previous assets failed & exit /b 4 )

rem  Sources and API modules: mirror. public: add/update only, never delete server files.
robocopy "%STAGE%\src" "src" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 ( echo [apply-release] sync src failed & exit /b 5 )
robocopy "%STAGE%\server" "server" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 ( echo [apply-release] sync server failed & exit /b 5 )
robocopy "%STAGE%\public" "public" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 ( echo [apply-release] sync public failed & exit /b 5 )
copy /y "%STAGE%\index.html" "index.html" >nul
copy /y "%STAGE%\vite.config.mjs" "vite.config.mjs" >nul
copy /y "%STAGE%\package.json" "package.json" >nul
copy /y "%STAGE%\package-lock.json" "package-lock.json" >nul

if exist dist\client rmdir /s /q dist\client
ren "%OUT%" client
if errorlevel 1 ( echo [apply-release] SWITCH FAILED - check dist\staging and dist\client & exit /b 6 )
rmdir /s /q "%STAGE%"
echo [apply-release] OK %NAME%
endlocal
exit /b 0
