#!/usr/bin/env bash
# _auto-publish.sh — 自动探测 npm 账号是否解禁，一解禁就发出去
#
# 为什么需要它：账号被 npm 风控临时暂停（新注册 + 刚启用 2FA）。
# 解禁时间不确定（数小时到 24h），而 publish 每次都要一个 30 秒过期的验证码。
# ⇒ 人不可能盯着等；脚本可以。
#
# 状态机：
#   .publish-done   已发布成功 ⇒ 立刻退出
#   .publish-stuck  验证码用尽/需要人工 ⇒ 立刻退出
#   .npm-recovery   剩余可用的一次性验证码（每行一个）
set -uo pipefail
cd "$(dirname "$0")/.."

DONE=.publish-done
STUCK=.publish-stuck
POOL=.npm-recovery
LOG=/tmp/auto-publish.log

[ -f "$DONE" ] && { echo "SKIP 已发布成功"; exit 0; }
[ -f "$STUCK" ] && { echo "SKIP 已标记为需要人工"; exit 0; }
[ -s "$POOL" ] || { echo "STUCK 验证码池为空"; echo "验证码池已空" > "$STUCK"; exit 0; }

CODE="$(head -1 "$POOL")"
echo "=== $(date '+%F %T') 尝试，用第 1 个码 ===" | tee -a "$LOG"

OUT="$(npm publish --ignore-scripts --otp="$CODE" 2>&1)"
echo "$OUT" | tail -6 >> "$LOG"

if echo "$OUT" | grep -qE "suspended due to a recent security-sensitive action"; then
  # 还没解禁。**不消耗验证码** —— 这次请求根本没走到 OTP 校验那一层。
  echo "WAIT 账号仍在风控暂停期，下次再试（验证码未消耗）"
  exit 0
fi

if echo "$OUT" | grep -qE "invalid one-time password|EOTP|one-time password is not valid|incorrect or expired"; then
  # 这个码废了，换成下一个
  tail -n +2 "$POOL" > "$POOL.tmp" && mv "$POOL.tmp" "$POOL"
  LEFT=$(grep -c . "$POOL" 2>/dev/null || echo 0)
  echo "ROTATE 码已失效，剩余 $LEFT 个"
  [ "$LEFT" -eq 0 ] && echo "验证码用尽，需要人工介入" > "$STUCK"
  exit 0
fi

if echo "$OUT" | grep -qE "^\+ agentcss@|npm notice Publishing" && \
   ! echo "$OUT" | grep -qE "npm error"; then
  echo "发布成功 $(date '+%F %T')" > "$DONE"
  # 一次性验证码用完即焚
  rm -f "$POOL"
  echo "OK 已发布 agentcss@0.9.0"
  exit 0
fi

# 其它未知错误：记下来但不消耗码，等人工看
echo "UNKNOWN 未识别的结果，详见 $LOG"
echo "$OUT" | grep -E "npm error" | head -3
exit 0
