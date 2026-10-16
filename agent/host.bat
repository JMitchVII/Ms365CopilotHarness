@echo off
rem Native messaging host launcher (Chrome needs an .exe or .bat on Windows).
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0host.ps1" %*
