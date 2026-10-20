@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title GetTogether by Malik

:menu
cls
echo.
echo   GetTogether by Malik
echo   ====================
echo.
echo   Første gang - i denne rækkefølge (se START-HER.md):
echo     1  Tjek at alt er klar
echo     2  Læg hjemmesiden op (Netlify)
echo     3  Gør appen klar (Expo) - kun første gang
echo.
echo   Appen:
echo     4  Prøv appen på telefonen (Expo Go)
echo     5  Byg en testapp til din Android-telefon
echo     6  Byg til Google Play
echo     7  Byg til iPhone (App Store)
echo     8  Send det seneste build til en butik
echo     9  Send en rettelse ud til alle telefoner (uden butikkerne)
echo.
echo     0  Luk
echo.
choice /c 1234567890 /n /m "  Tryk på et tal: "
set VALG=%errorlevel%
if "%VALG%"=="10" exit /b 0
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
pushd expo-app
echo.
echo   [1/6] Installerer Expo-værktøjet (eas-cli) ...
call npm install -g eas-cli || goto fejlapp
echo   [2/6] Installerer appens pakker ...
call npm install || goto fejlapp
echo   [3/6] Retter versioner, så de passer til Expo ...
call npx expo install --fix || goto fejlapp
echo   [4/6] Log ind på din Expo-konto (opret den gratis på expo.dev) ...
call eas login || goto fejlapp
echo   [5/6] Opretter appen hos Expo - svar ja (Y) ...
call eas init || goto fejlapp
echo   [6/6] Gør opdateringer uden butikkerne klar - svar ja (Y) ...
call eas update:configure || goto fejlapp
call npm run web
popd
echo.
echo   Færdig! Vælg 4 for at prøve appen på din telefon.
pause
goto menu

rem ------------------------------------------------------------
:valg4
pushd expo-app
echo.
echo   Scan QR-koden med Expo Go-appen på din telefon.
echo   Tryk Ctrl+C for at stoppe, når du er færdig.
echo.
call npm start
popd
pause
goto menu

rem ------------------------------------------------------------
:valg5
pushd expo-app
call npm run build:test || goto fejlapp
popd
echo.
echo   Åbn linket ovenfor på din Android-telefon og installer appen.
pause
goto menu

rem ------------------------------------------------------------
:valg6
pushd expo-app
call npm run build:android || goto fejlapp
popd
echo.
echo   Første gang: hent .aab-filen fra linket og upload den i hånden i Play Console.
echo   Senere gange: vælg 8.
pause
goto menu

rem ------------------------------------------------------------
:valg7
pushd expo-app
call npm run build:ios || goto fejlapp
popd
echo.
echo   Vælg 8 for at sende den til TestFlight.
pause
goto menu

rem ------------------------------------------------------------
:valg8
echo.
echo     G  Google Play
echo     A  App Store (TestFlight)
echo.
choice /c GA /n /m "  Hvilken butik? "
pushd expo-app
if errorlevel 2 (call npm run send:ios) else (call npm run send:android)
if errorlevel 1 goto fejlapp
popd
pause
goto menu

rem ------------------------------------------------------------
:valg9
pushd expo-app
call npm run opdater || goto fejlapp
popd
echo.
echo   Rettelsen er sendt. Telefonerne henter den, næste gang appen åbnes.
echo   Husk også at lægge hjemmesiden op (vælg 2).
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
  echo   X  faellesskab\config.js: SUPABASE_URL og SUPABASE_ANON_KEY er ikke udfyldt.
  set KLAR=0
) else (
  echo   OK Supabase er udfyldt i faellesskab\config.js
)
findstr /c:"DIT-DOM" "faellesskab\config.js" >nul
if not errorlevel 1 (
  echo   X  faellesskab\config.js: LOGIN_DOMAIN er ikke udfyldt.
  set KLAR=0
) else (
  echo   OK LOGIN_DOMAIN er udfyldt
)
if exist "expo-app\google-services.json" (
  echo   OK google-services.json til push på Android
) else (
  echo   -  google-services.json mangler endnu - push på Android virker først, når den er lagt i expo-app
)
where eas >nul 2>nul
if errorlevel 1 (
  echo   -  Expo-værktøjet er ikke installeret endnu - det klarer punkt 3
) else (
  echo   OK Expo-værktøjet er installeret
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
echo   Noget gik galt - læs den røde/sidste tekst ovenfor.
echo   Kopiér den til Claude, så hjælper jeg dig videre.
pause
goto menu
