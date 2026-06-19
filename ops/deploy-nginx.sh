#!/usr/bin/env bash
# 部署 nginx 安全头 + 登录限速到 118.89.118.126
#
# 流程:
#   1. scp ops/nginx.conf        → /etc/nginx/sites-available/ffnmv.new
#   2. scp ops/rate-limit.conf   → /etc/nginx/conf.d/rate-limit.conf.new
#   3. 备份现有 ffnmv + rate-limit.conf
#   4. 替换文件 + nginx -t(失败则回滚)
#   5. nginx -s reload
#
# 用法: bash ops/deploy-nginx.sh
# 回滚: ssh root@118.89.118.126 "ls -t /etc/nginx/sites-available/ffnmv.bak.* | head -1 | xargs -I{} cp {} /etc/nginx/sites-available/ffnmv && nginx -s reload"

set -euo pipefail

SERVER="root@118.89.118.126"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
SITE_NAME="ffnmv"
BAK="$(date +%Y%m%d_%H%M%S)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$SCRIPT_DIR/nginx.conf" ]      || { echo "✗ ops/nginx.conf 不存在"; exit 1; }
[ -f "$SCRIPT_DIR/rate-limit.conf" ] || { echo "✗ ops/rate-limit.conf 不存在"; exit 1; }

echo "════════════════════════════════════════════"
echo " 部署 nginx 到 $SERVER"
echo " 备份后缀: $BAK"
echo "════════════════════════════════════════════"

echo ""
echo "▶ 1. scp ops/nginx.conf"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/nginx.conf" "$SERVER:/etc/nginx/sites-available/$SITE_NAME.new"

echo "▶ 2. scp ops/rate-limit.conf"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/rate-limit.conf" "$SERVER:/etc/nginx/conf.d/rate-limit.conf.new"

echo "▶ 3. 备份 + 替换 + nginx -t + reload"
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s -- "$BAK" <<'REMOTE'
set -e
BAK="$1"

backup_if_exists() {
    local f="$1"
    if [ -f "$f" ] && [ ! -L "$f" ]; then
        cp "$f" "$f.bak.$BAK"
        echo "  · 备份 $f → $(basename "$f").bak.$BAK"
    fi
}

backup_if_exists /etc/nginx/sites-available/ffnmv
backup_if_exists /etc/nginx/conf.d/rate-limit.conf

mv /etc/nginx/sites-available/ffnmv.new   /etc/nginx/sites-available/ffnmv
mv /etc/nginx/conf.d/rate-limit.conf.new /etc/nginx/conf.d/rate-limit.conf

# nginx -t 检查整个 config(所有 conf.d + sites-enabled)
# 这是唯一可靠的 syntax check(server 块单独 nginx -t -c 不能跑)
if ! nginx -t 2>&1; then
    echo "✗ nginx -t 失败,回滚"
    [ -f "/etc/nginx/sites-available/ffnmv.bak.$BAK" ] && \
        cp "/etc/nginx/sites-available/ffnmv.bak.$BAK" /etc/nginx/sites-available/ffnmv
    [ -f "/etc/nginx/conf.d/rate-limit.conf.bak.$BAK" ] && \
        cp "/etc/nginx/conf.d/rate-limit.conf.bak.$BAK" /etc/nginx/conf.d/rate-limit.conf
    nginx -s reload || true
    exit 1
fi
nginx -s reload
echo "  · nginx reload OK"
REMOTE

echo ""
echo "════════════════════════════════════════════"
echo " ✓ 部署完成  备份后缀: $BAK"
echo "════════════════════════════════════════════"
echo ""
echo "验证命令:"
echo "  curl -I http://118.89.118.126/"
echo "  bash diag-realtime.sh 118.89.118.126"
echo "  ANON_KEY=\$(ssh root@118.89.118.126 'grep ^ANON_KEY= /opt/supabase/docker/.env | cut -d= -f2-')"
echo "  for i in {1..12}; do curl -s -o /dev/null -w '%{http_code} ' -X POST http://118.89.118.126/auth/v1/token?grant_type=password -d '{\"email\":\"x@x.com\",\"password\":\"x\"}' -H 'Content-Type: application/json' -H \"apikey: \$ANON_KEY\"; done; echo"
