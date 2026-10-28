#!/bin/bash
# Rewrites headed Playwright launches in this folder to headless (same Metal GPU), every second, for 4 hours.
cd "$(dirname "$0")" || exit 1
end=$((SECONDS + 4 * 3600))
while (( SECONDS < end )); do
  for f in $(grep -l "headless: false" -- *.mjs 2>/dev/null); do
    perl -pi -e "s/headless: false, args: \['--use-angle=metal'\]/headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist']/g; s/headless: false/headless: true/g" "$f"
    echo "$(date +%T) patched $f"
  done
  sleep 1
done
