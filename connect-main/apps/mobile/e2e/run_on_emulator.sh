#!/bin/bash
# Installs the test APK and drives it. Called from CI once the emulator has booted.
set -uo pipefail
adb install -r connect-main/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk > /tmp/install.txt 2>&1 || { cat /tmp/install.txt; exit 1; }
node connect-main/apps/mobile/e2e/android_meeting.mjs > /tmp/android.txt 2>&1
status=$?
cat /tmp/android.txt
adb logcat -d -b crash | tail -20
exit "${status}"
