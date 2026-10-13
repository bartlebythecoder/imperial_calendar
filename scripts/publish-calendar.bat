@echo off
rem Builds the Imperial Calendar from ss6_timeline.md and publishes it if anything changed.
rem Called from quartz-publish\run_sync.bat. Always exits 0 so a calendar problem
rem never stops the wiki from publishing; read the [calendar] lines for the outcome.
node "%~dp0publish-calendar.mjs"
exit /b 0
