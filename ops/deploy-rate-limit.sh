#!/usr/bin/env bash
# 部署 Supabase 登录限速 (GOTRUE_RATE_LIMIT_*) 到 118.89.118.126
#
# 流程:
#   1. 备份 /opt/supabase/docker/.env 和 docker-compose.yml
#   2. 追加 4 个 GOTRUE_RATE_LIMIT_* 变量到 .env(已存在则跳过,幂等)
#   3. 在 auth 服务 environment 块里追加对应的 4 行 compose 字段(已存在则跳过,幂等)
#   4. docker compose up -d --force-recreate --no-deps auth(让新 env 进去)
#
# 注意:
#   - supabase 官方 docker-compose 的 auth 服务用 `environment:` 块,不是 `env_file:`,
#     .env 里的新变量不会自动进容器。必须在 compose 里显式列。
#   - `docker compose restart` 不重读 compose 文件,要用 `up -d --force-recreate`。
#
# 用法: bash ops/deploy-rate-limit.sh
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
SNIPPET="$SCRIPT_DIR/snippets/auth-rate-limit.yml"

[ -f "$SNIPPET" ] || { echo "✗ ops/snippets/auth-rate-limit.yml 不存在"; exit 1; }

echo "════════════════════════════════════════════"
echo " 部署 Supabase 登录限速到 $SERVER"
echo " 备份后缀: $BAK"
echo "════════════════════════════════════════════"

echo ""
echo "▶ 1. 备份 .env 和 docker-compose.yml"
ssh "${SSH_OPTS[@]}" "$SERVER" "cp $ENV_FILE $ENV_FILE.bak.$BAK && cp $COMPOSE_FILE $COMPOSE_FILE.bak.$BAK && echo '  · 备份完成'"

echo "▶ 2. 追加 4 个 GOTRUE_RATE_LIMIT_* 变量到 .env(已存在则跳过)"
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s -- "$ENV_FILE" <<'REMOTE'
set -e
ENV_FILE="$1"

for ENTRY in \
    "GOTRUE_RATE_LIMIT_SIGN_IN_SIGNUPS=10" \
    "GOTRUE_RATE_LIMIT_TOKEN_VERIFICATIONS=10" \
    "GOTRUE_RATE_LIMIT_TOKEN_REFRESH=30" \
    "GOTRUE_RATE_LIMIT_EMAIL_SENT=2" ; do
    KEY="${ENTRY%%=*}"
    if grep -q "^${KEY}=" "$ENV_FILE"; then
        echo "  · ${KEY} 已存在,跳过"
    else
        echo "$ENTRY" >> "$ENV_FILE"
        echo "  · 追加 $ENTRY"
    fi
done
REMOTE

echo "▶ 3. 在 auth 服务 environment 块追加 4 行 compose 字段(已存在则跳过)"
scp "${SSH_OPTS[@]}" "$SNIPPET" "$SERVER:/tmp/auth-rate-limit.yml"
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s -- "$COMPOSE_FILE" <<'REMOTE'
set -e
COMPOSE_FILE="$1"

if grep -q "GOTRUE_RATE_LIMIT_SIGN_IN_SIGNUPS:" "$COMPOSE_FILE"; then
    echo "  · 4 行已存在,跳过"
else
    # 在 GOTRUE_MAILER_AUTOCONFIRM 行后插入
    sed -i '/GOTRUE_MAILER_AUTOCONFIRM:/r /tmp/auth-rate-limit.yml' "$COMPOSE_FILE"
    echo "  · 插入 4 行到 auth environment 块"
fi
rm -f /tmp/auth-rate-limit.yml
REMOTE

echo "▶ 4. 验证 compose 渲染(env 变量进去了)"
ssh "${SSH_OPTS[@]}" "$SERVER" "cd $SUPABASE_DIR && docker compose config 2>/dev/null | grep GOTRUE_RATE_LIMIT | sort"

echo "▶ 5. docker compose up -d --force-recreate --no-deps auth"
if ! ssh "${SSH_OPTS[@]}" "$SERVER" "cd $SUPABASE_DIR && docker compose up -d --force-recreate --no-deps auth" 2>&1; then
    echo "✗ up -d 失败,回滚 .env + compose + 再 up"
    ssh "${SSH_OPTS[@]}" "$SERVER" "cp $ENV_FILE.bak.$BAK $ENV_FILE && cp $COMPOSE_FILE.bak.$BAK $COMPOSE_FILE && cd $SUPABASE_DIR && docker compose up -d --force-recreate --no-deps auth"
    exit 1
fi

sleep 3
echo ""
echo "▶ 6. 验证容器内 env 已加载"
ssh "${SSH_OPTS[@]}" "$SERVER" 'docker exec supabase-auth sh -c "env" 2>&1 | grep -E "GOTRUE_RATE_LIMIT" | sort'

echo ""
echo "════════════════════════════════════════════"
echo " ✓ 部署完成  备份后缀: $BAK"
echo "════════════════════════════════════════════"
echo ""
echo "GoTrue 层验证(可选,需要真 email):"
echo "  for i in {1..12}; do curl -s -o /dev/null -w '%{http_code} ' -X POST http://118.89.118.126/auth/v1/token?grant_type=password -H 'Content-Type: application/json' -H \"apikey: \$ANON_KEY\" -d '{\"email\":\"<真email>\",\"password\":\"wrong\"}'; done; echo"
