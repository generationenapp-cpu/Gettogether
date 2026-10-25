@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title GetTogether samlet af Malik

:menu
cls
echo.
echo   GetTogether samlet af Malik
echo   ===========================
echo.
echo   Hjemmesiden (se START-HER.md for rækkefølgen):
echo     1  Tjek at alt er klar
echo     2  Læg hjemmesiden op (Netlify)
echo.
echo   Android-appen (Google Play):
echo     3  Gør Android-appen klar - kun første gang
echo     4  Åbn Android-appen i Android Studio (prøv og byg)
echo.
echo     0  Luk
echo.
choice /c 12340 /n /m "  Tryk på et tal: "
set VALG=%errorlevel%
if "%VALG%"=="5" exit /b 0
goto valg%VALG%

rem ------------------------------------------------------------
:valg1
call :tjek
pause
goto menu

rem ------------------------------------------------------------
:valg2
call :tjek
if "%KLAR%"=="0" goto stop
echo.
echo   Lægger hjemmesiden op. Første gang skal du logge ind hos Netlify
echo   og vælge siden "gettogether-by-malik" (eller oprette den).
echo.
call npm install || goto fejl
call npx netlify-cli deploy --prod || goto fejl
echo.
echo   Færdig. Hjemmesiden er opdateret.
pause
goto menu

rem ------------------------------------------------------------
:valg3
call :tjek
if "%KLAR%"=="0" goto stop
pushd .mobil
echo.
echo   [1/2] Installerer appens pakker ...
call npm install || goto fejlapp
if exist "android\" (
  echo   [2/2] Android-projektet findes allerede - opdaterer det ...
  call npm run klar || goto fejlapp
) else (
  echo   [2/2] Laver Android-projektet, ikoner og startskærm ...
  call npm run android:opret || goto fejlapp
)
popd
echo.
echo   Færdig! Vælg 4 for at åbne appen i Android Studio.
pause
goto menu

rem ------------------------------------------------------------
:valg4
if not exist ".mobil\android\" (
  echo.
  echo   Vælg 3 først - Android-appen er ikke lavet endnu.
  pause
  goto menu
)
pushd .mobil
call npm run android || goto fejlapp
popd
echo.
echo   Android Studio er åbnet. Tryk på den grønne pil for at prøve appen på din telefon.
echo   Filen til Google Play: Build - Generate Signed App Bundle or APK.
pause
goto menu

rem ------------------------------------------------------------
:tjek
set KLAR=1
echo.
echo   Tjekker ...
echo.
set NODEV=
for /f "delims=." %%v in ('node -p "process.versions.node" 2^>nul') do set NODEV=%%v
if not defined NODEV (
  echo   X  Node.js mangler. Hent LTS-udgaven på https://nodejs.org og start mig igen.
  set KLAR=0
  goto tjek2
)
if %NODEV% LSS 22 (
  echo   X  Node.js er for gammel. Hent den nyeste LTS-udgave på https://nodejs.org
  set KLAR=0
) else (
  echo   OK Node.js %NODEV%
)
:tjek2
findstr /c:"DIT-PROJEKT" /c:"DIN-ANON" "faellesskab\config.js" >nul
if not errorlevel 1 (
  echo   X  config.js: SUPABASE_URL og SUPABASE_ANON_KEY er ikke udfyldt.
  set KLAR=0
) else (
  echo   OK Supabase er udfyldt
)
findstr /c:"DIT-DOM" "faellesskab\config.js" >nul
if not errorlevel 1 (
  echo   X  config.js: LOGIN_DOMAIN er ikke udfyldt.
  set KLAR=0
) else (
  echo   OK LOGIN_DOMAIN er udfyldt
)
findstr /c:"Dit navn eller virksomhedsnavn" /c:"CVR-nr. eller adresse" /c:"kontakt@ditdom" "faellesskab\config.js" >nul
if not errorlevel 1 (
  echo   X  config.js: CONTROLLER_NAME, CONTROLLER_ID og CONTACT_EMAIL til privatlivspolitikken er ikke udfyldt.
  set KLAR=0
) else (
  echo   OK Privatlivspolitikken er udfyldt
)
if exist "%LOCALAPPDATA%\Android\Sdk\" (
  echo   OK Android Studio
) else (
  echo   -  Android Studio mangler - kun nødvendig til Android-appen
)
echo.
if "%KLAR%"=="0" echo   Ret det, der har et X, og prøv igen. Se START-HER.md.
exit /b 0

:stop
pause
goto menu

:fejlapp
popd
:fejl
echo.
echo   Noget gik galt - læs den sidste tekst ovenfor.
echo   Kopiér den til Claude, så hjælper jeg dig videre.
pause
goto menu
