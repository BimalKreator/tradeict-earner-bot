#!/bin/bash

echo "======================================================"
echo "📈 HEDGE SCALPING - LIVE MONITORING (IST Time)"
echo "======================================================"

TZ=Asia/Kolkata pm2 logs all --lines 100 --timestamp="YYYY-MM-DD HH:mm:ss" | grep --line-buffered -E --color=always "(HS-SIGNAL|HS-POLLER|HS-WORKER|insufficient_margin|error|ERROR)"
