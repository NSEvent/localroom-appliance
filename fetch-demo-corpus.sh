#!/bin/sh
set -eu

ROOT="${LOCALROOM_DATA_DIR:-$PWD/data}/corpus"
PDF="$ROOT/ftc-amazon-prime-complaint.pdf"
TEXT="$ROOT/ftc-amazon-prime-complaint.txt"
URL="https://www.ftc.gov/system/files/ftc_gov/pdf/1910134amazonecommercecomplaintrevisedredactions.pdf"

mkdir -p "$ROOT"
if [ ! -s "$PDF" ]; then
  curl -L --fail --silent --show-error \
    -A "Mozilla/5.0" -e "https://www.ftc.gov/" "$URL" -o "$PDF"
fi
if [ ! -s "$TEXT" ]; then
  pdftotext -layout "$PDF" "$TEXT"
fi

printf "LocalRoom corpus ready: "
wc -l -c "$TEXT"
