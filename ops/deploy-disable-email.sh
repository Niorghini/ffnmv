#!/usr/bin/env bash
# 关闭 prod 邮箱确认(GOTRUE_MAILER_AUTOCONFIRM=true)
# 2026-06-20 临时修复:prod SMTP 配的是 supabase-mail (inbucket),容器没起来,
# 注册时邮件发不出去 → 500。用户可读性 0,注册全失败。
# 关掉邮件确认后,新注册自动 active,无邮件流程。
#
# 警告:这是降级方案,丢失 SEC-002 邮箱验证防抢注。
# 接真 SMTP 后,需改 ENABLE_EMAIL_AUTOCONFIRM=false + GOTRUE_MAILER_AUTOCONFIRM=false
# 才能恢复验证。
#
# 用法: bash ops/deploy-disable-email.sh
# 回滚:
#   ssh root@118.89.118.126 "ls -t /opt/supabase/docker/.env.bak.disableemail.* | head -1 | xargs -I{} cp {} /opt/supabase/docker/.env && cd /opt/supabase/docker && docker compose up -d --force-recreate --no-deps auth"

set -euo pipefail

SERVER="root@118.89.118.126"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
SUPABASE_DIR="/opt/supabase/docker"
ENV_FILE="$SUPABASE_DIR/.env"
BAK="$(date +%Y%m%d_%H%M%S)"

echo "════════════════════════════════════════════"
echo " 关闭 prod 邮箱确认到 $SERVER"
echo " 备份后缀: $BAK"
echo "════════════════════════════════════════════"

echo ""
echo "▶ 1. 备份 .env"
ssh "${SSH_OPTS[@]}" "$SERVER" "cp $ENV_FILE $ENV_FILE.bak.disableemail.$BAK && echo '  · 备份完成'"

echo "▶ 2. 改 ENABLE_EMAIL_AUTOCONFIRM=true(已 true 跳过)"
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s -- "$ENV_FILE" <<'REMOTE'
set -e
ENV_FILE="$1"
if grep -q "^ENABLE_EMAIL_AUTOCONFIRM=true" "$ENV_FILE"; then
    echo "  · 已是 true,跳过"
else
    sed -i 's|^ENABLE_EMAIL_AUTOCONFIRM=.*|ENABLE_EMAIL_AUTOCONFIRM=true|' "$ENV_FILE"
    echo "  · ENABLE_EMAIL_AUTOCONFIRM → true"
fi
grep "^ENABLE_EMAIL_AUTOCONFIRM" "$ENV_FILE"
REMOTE

echo ""
echo "▶ 3. 重启 supabase-auth(--force-recreate 才重读 env)"
if ! ssh "${SSH_OPTS[@]}" "$SERVER" "cd $SUPABASE_DIR && docker compose up -d --force-recreate --no-deps auth" 2>&1; then
    echo "✗ 重启失败,回滚 .env + 再 up"
    ssh "${SSH_OPTS[@]}" "$SERVER" "cp $ENV_FILE.bak.disableemail.$BAK $ENV_FILE && cd $SUPABASE_DIR && docker compose up -d --force-recreate --no-deps auth"
    exit 1
fi

sleep 5
echo ""
echo "▶ 4. 验 auth 起来 + 注册流程通"
ssh "${SSH_OPTS[@]}" "$SERVER" 'docker ps --format "{{.Names}} {{.Status}}" | grep "^supabase-auth"'
echo ""
ANON_KEY=$(ssh "${SSH_OPTS[@]}" "$SERVER" 'grep ^ANON_KEY= /opt/supabase/docker/.env | cut -d= -f2-')
echo "  -- curl 测注册(应该 HTTP 200,返回 access_token + email_confirmed_at) --"
curl -s -w "\n  HTTP %{http_code}\n" -X POST "http://118.89.118.126/auth/v1/signup" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" \
  -d '{"email":"deploy-disable-email-verify@ffnmv.local","password":"verify1234"}' \
  | tail -3

echo ""
echo "════════════════════════════════════════════"
echo " ✓ 完成  备份: $ENV_FILE.bak.disableemail.$BAK"
echo "════════════════════════════════════════════"
echo ""
echo "⚠️ 提醒:这是降级方案。接真 SMTP 后:"
echo "  1. 改 ENABLE_EMAIL_AUTOCONFIRM=false"
echo "  2. docker compose up -d --force-recreate --no-deps auth"
echo "  3. 跑 ops/deploy-rate-limit.sh 等恢复"
