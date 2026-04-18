#!/bin/bash

echo "======================================================"
echo "📈 HEDGE SCALPING - LIVE MONITORING (IST Time)"
echo "======================================================"

# 1. TZ=Asia/Kolkata ensures time is strictly in IST regardless of server timezone.
# 2. --timestamp adds the date & time.
# 3. Removed --nostream so it runs continuously.
# 4. --line-buffered ensures logs appear instantly without delay.

TZ=Asia/Kolkata pm2 logs tradeict-worker --lines 100 --timestamp="YYYY-MM-DD HH:mm:ss" | grep --line-buffered -E --color=always "(HS-SIGNAL|HS-POLLER|insufficient_margin)"
