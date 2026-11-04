#!/bin/sh
# Cloudflare Pages 用に app/index.html を完全な HTML にして dist/ に出力します。
set -e
mkdir -p dist
{
  printf '%s\n' '<!doctype html>' '<html lang="ja"><head><meta charset="utf-8">' \
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' \
    '<meta name="pfx-live" content="1">' \
    '<meta name="robots" content="noindex,nofollow">' \
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">' \
    '<link rel="manifest" href="manifest.webmanifest">' \
    '<meta name="theme-color" content="#000000">' \
    '<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">' \
    '<meta name="apple-mobile-web-app-title" content="金銀シグナル検証">' \
    '<meta name="apple-mobile-web-app-capable" content="yes">' \
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
  cat app/index.html
  printf '\n%s\n' '</html>'
} > dist/index.html
printf 'User-agent: *\nDisallow: /\n' > dist/robots.txt
cp app/icons/apple-touch-icon.png app/icons/icon-192.png app/icons/icon-512.png app/sw.js app/manifest.webmanifest dist/
echo "built dist/index.html"
