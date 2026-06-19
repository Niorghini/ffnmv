#!/usr/bin/env bash
# 部署 Supabase 密码策略 (GOTRUE_PASSWORD_MIN_LENGTH) 到 118.89.118.126
#
# 流程:
#   1. 备份 /opt/supabase/docker/.env 和 docker-compose.yml
#   2. 追加 GOTRUE_PASSWORD_MIN_LENGTH=8 到 .env(已存在则跳过,幂等)
#   3. 在 auth 服务 environment 块里追加 GOTRUE_PASSWORD_MIN_LENGTH 行(已存在则跳过,幂等)
#   4. docker compose up -d --force-recreate --no-deps auth
#
# 用法: bash ops/deploy-password.sh
# 回滚:
#   ssh root@118.89.118.126 "ls -t /opt/supabase/docker/.env.bak.* | head -1 | xargs -I{} cp {} /opt/supabase/docker/.env"
#   ssh root@118.89.118.126 "ls -t /opt/supabase/docker/docker-compose.yml.bak.* | head -1 | xargs -I{} cp {} /opt/supabase/docker/docker-compose.yml"
#   然后: cd /opt/supabase/docker && docker compose up -d --force-recreate --no-deps auth

set -euo pipefail

SERVER="root@118.89.118.126"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
SUPABASE_DIR="/opt/supabase/docker"
ENV_FILE="$SUPABASE_DIR/.env"
COMPOSE_FILE="$SUPABASE_DIR/docker-compose.yml"
BAK="$(date +%Y%m%d_%H%M%S)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNIPPET="$SCRIPT_DIR/snippets/auth-password-min-length.yml"

[ -f "$SNIPPET" ] || { echo "✗ ops/snippets/auth-password-min-length.yml 不存在"; exit 1; }

echo "════════════════════════════════════════════"
echo " 部署 Supabase 密码策略到 $SERVER"
echo " 备份后缀: $BAK"
echo "════════════════════════════════════════════"

echo ""
echo "▶ 1. 备份 .env 和 docker-compose.yml"
ssh "${SSH_OPTS[@]}" "$SERVER" "cp $ENV_FILE $ENV_FILE.bak.$BAK && cp $COMPOSE_FILE $COMPOSE_FILE.bak.$BAK && echo '  · 备份完成'"

echo "▶ 2. 追加 GOTRUE_PASSWORD_MIN_LENGTH=8 到 .env(已存在则跳过)"
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s -- "$ENV_FILE" <<'REMOTE'
set -e
ENV_FILE="$1"
KEY="GOTRUE_PASSWORD_MIN_LENGTH"
if grep -q "^${KEY}=" "$ENV_FILE"; then
    echo "  · ${KEY} 已存在,跳过"
else
    echo "${KEY}=8" >> "$ENV_FILE"
    echo "  · 追加 ${KEY}=8"
fi
REMOTE

echo "▶ 3. 在 auth 服务 environment 块追加 1 行 compose 字段(已存在则跳过)"
scp "${SSH_OPTS[@]}" "$SNIPPET" "$SERVER:/tmp/auth-password-min-length.yml"
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s -- "$COMPOSE_FILE" <<'REMOTE'
set -e
COMPOSE_FILE="$1"

if grep -q "GOTRUE_PASSWORD_MIN_LENGTH:" "$COMPOSE_FILE"; then
    echo "  · 行已存在,跳过"
else
    # 在 GOTRUE_MAILER_AUTOCONFIRM 行后插入
    sed -i '/GOTRUE_MAILER_AUTOCONFIRM:/r /tmp/auth-password-min-length.yml' "$COMPOSE_FILE"
    echo "  · 插入 1 行到 auth environment 块"
fi
rm -f /tmp/auth-password-min-length.yml
REMOTE

echo "▶ 4. 验证 compose 渲染"
ssh "${SSH_OPTS[@]}" "$SERVER" "cd $SUPABASE_DIR && docker compose config 2>/dev/null | grep GOTRUE_PASSWORD_MIN_LENGTH"

echo "▶ 5. docker compose up -d --force-recreate --no-deps auth"
if ! ssh "${SSH_OPTS[@]}" "$SERVER" "cd $SUPABASE_DIR && docker compose up -d --force-recreate --no-deps auth" 2>&1; then
    echo "✗ up -d 失败,回滚 .env + compose + 再 up"
    ssh "${SSH_OPTS[@]}" "$SERVER" "cp $ENV_FILE.bak.$BAK $ENV_FILE && cp $COMPOSE_FILE.bak.$BAK $COMPOSE_FILE && cd $SUPABASE_DIR && docker compose up -d --force-recreate --no-deps auth"
    exit 1
fi

sleep 3
echo ""
echo "▶ 6. 验证容器内 env 已加载"
ssh "${SSH_OPTS[@]}" "$SERVER" 'docker exec supabase-auth sh -c "env" 2>&1 | grep GOTRUE_PASSWORD_MIN_LENGTH'

echo ""
echo "════════════════════════════════════════════"
echo " ✓ 部署完成  备份后缀: $BAK"
echo "════════════════════════════════════════════"
echo ""
echo "验证脚本(6 位应被拒,8 位应通过):"
echo "  ANON_KEY=\$(ssh root@118.89.118.126 'grep ^ANON_KEY= /opt/supabase/docker/.env | cut -d= -f2-')"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -X POST http://118.89.118.126/auth/v1/signup \\"
echo "    -H 'Content-Type: application/json' -H \"apikey: \$ANON_KEY\" \\"
echo "    -d '{\"email\":\"test6@x.com\",\"password\":\"123456\"}'    # 期望 400"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -X POST http://118.89.118.126/auth/v1/signup \\"
echo "    -H 'Content-Type: application/json' -H \"apikey: \$ANON_KEY\" \\"
echo "    -d '{\"email\":\"test8@x.com\",\"password\":\"12345678\"}'  # 期望 200"
