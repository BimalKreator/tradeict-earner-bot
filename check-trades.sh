#!/bin/bash

echo "======================================================"
echo "📊 TREND ARBITRAGE - TRADE HISTORY & DECISIONS"
echo "======================================================"

# PM2 ka native command use kar rahe hain (File path ki zaroorat nahi)
pm2 logs tradeict-worker --lines 5000 --nostream | grep -E --color=always "(HT-CLOSE-FLIP|evaluating simultaneous|dispatched_primary|D2-TP|stop_loss_hit|close_primary|virtual_order_recorded_failure|insufficient_margin)"

echo "======================================================"
echo "✅ Log Filtering Complete."
