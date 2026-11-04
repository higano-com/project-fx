#!/bin/sh
# Cloudflare Pages 用に app/index.html を完全な HTML にして dist/ に出力します。
set -e
mkdir -p dist
{
  printf '%s\n' '<!doctype html>' '<html lang="ja"><head><meta charset="utf-8">' \
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' \
    '<meta name="pfx-live" content="1">' \
    '<meta name="robots" content="noindex,nofollow">' \
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
  cat app/index.html
  printf '\n%s\n' '</html>'
} > dist/index.html
printf 'User-agent: *\nDisallow: /\n' > dist/robots.txt
echo "built dist/index.html"
