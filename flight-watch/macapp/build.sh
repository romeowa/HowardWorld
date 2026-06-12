#!/bin/bash
# FlightWatch 메뉴바 앱 빌드 → build/FlightWatch.app
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p build

echo "▸ 컴파일..."
swiftc -O -swift-version 5 -parse-as-library Sources/main.swift -o build/FlightWatchBar

APP=build/FlightWatch.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp build/FlightWatchBar "$APP/Contents/MacOS/"
cp Info.plist "$APP/Contents/"

# 앱 아이콘 (public/icon-512.png 재사용)
if [ -f ../public/icon-512.png ] && [ ! -f build/AppIcon.icns ]; then
  echo "▸ 아이콘 생성..."
  ICONSET=build/AppIcon.iconset
  rm -rf "$ICONSET" && mkdir -p "$ICONSET"
  for s in 16 32 64 128 256 512; do
    sips -z $s $s ../public/icon-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o build/AppIcon.icns
fi
[ -f build/AppIcon.icns ] && cp build/AppIcon.icns "$APP/Contents/Resources/"

codesign --force -s - "$APP" 2>/dev/null
echo "✅ 빌드 완료: $APP"
echo "   설치: cp -R $APP ~/Applications/  (또는 /Applications)"
