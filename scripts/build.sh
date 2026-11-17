#!/bin/sh
# クラウドフレアのページ用：app/ をそのまま dist/ に写すだけ（2026/11/17 作り直し）
set -e
rm -rf dist && mkdir -p dist
cp -R app/. dist/
cp app/icons/apple-touch-icon.png app/icons/icon-192.png app/icons/icon-512.png dist/
printf 'User-agent: *\nDisallow: /\n' > dist/robots.txt
echo "dist/ を作りました"
