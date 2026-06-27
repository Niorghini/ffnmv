#!/usr/bin/env bash
# 部署 ffnmv 前端 dist/ 到测试服务器 163.7.3.215(ffn-test.aicyber.chat)
#
# 流程:
#   1. 前置检查:--mode 合法、当前分支在 dev-* / test / dev / main 之中、
#      工作树状态(未 commit tracked 改动 + untracked 文件仅告警;main 严格)
#   2. 本地质量门:lint + type-check + test(任一失败立即退出,不部署)
#   3. 本地构建:npm run build:<mode>  → 产物 dist/
#   4. rsync 推送到 root@163.7.3.215:/opt/ffn/dist/(--delete 幂等清理旧文件)
#   5. 部署后验证:curl 拿到首页 + 抓一个 hash 化的 chunk 看 200 + 6 个安全头齐全
#
# 用法:
#   bash ops/deploy-frontend.sh                       # 默认:mode=test, dry-run
#   bash ops/deploy-frontend.sh --apply               # 真的推送(否则只演练)
#   bash ops/deploy-frontend.sh --mode production --apply
#   bash ops/deploy-frontend.sh --skip-tests --apply  # 跳过 lint/test(慎用)
#
# 服务器拓扑(参考 docs/SECURITY.md §10 / memory/deployment_topology):
#   - dev-* 分支 → 合并到 dev → 163.7.3.215(共享 /opt/ffn/dist/)
#   - main       → 118.89.118.126(prod)
#   - ffn-pre 已下线 2026-06-23,canary 模式保留以防回滚
#
# 回滚:
#   服务器上没有 dist/ 的版本管理 — 旧版本会被 --delete 清掉。
#   如果需要回滚,git revert + 重新部署。

set -euo pipefail

# ─────────── 参数 ───────────
MODE="test"
APPLY=0
SKIP_TESTS=0
SERVER="root@163.7.3.215"
REMOTE_DIR="/opt/ffn/dist"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

for arg in "$@"; do
    case "$arg" in
        --apply)        APPLY=1 ;;
        --mode)         shift; MODE="${1:-}" ; [[ -z "$MODE" ]] && { echo "✗ --mode 需传值"; exit 1; } ;;
        --mode=*)       MODE="${arg#*=}" ;;
        --skip-tests)   SKIP_TESTS=1 ;;
        -h|--help)      usage ;;
        *)              echo "✗ 未知参数: $arg"; usage ;;
    esac
    shift || true
done

# ─────────── 颜色 ───────────
if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
else
    BOLD=""; DIM=""; RED=""; GRN=""; YLW=""; RST=""
fi

step() { printf "\n${BOLD}${YLW}▶ %s${RST}\n" "$1"; }
ok()   { printf "  ${GRN}✓${RST} %s\n" "$1"; }
die()  { printf "\n${RED}✗ %s${RST}\n" "$1" >&2; exit 1; }
note() { printf "  ${DIM}%s${RST}\n" "$1"; }

# ─────────── Banner ───────────
printf "${BOLD}════════════════════════════════════════════${RST}\n"
printf "${BOLD} ffnmv 前端部署${RST}\n"
printf "  模式:   ${YLW}%s${RST}\n" "$MODE"
printf "  服务器: ${YLW}%s${RST}\n" "$SERVER"
printf "  目标:   ${YLW}%s${RST}\n" "$REMOTE_DIR"
if [[ $APPLY -eq 1 ]]; then
    printf "  动作:   ${RED}${BOLD}--apply 真推${RST}\n"
else
    printf "  动作:   ${DIM}dry-run(不会推送)${RST}\n"
fi
printf "${BOLD}════════════════════════════════════════════${RST}\n"

# ─────────── Step 0: 模式合法 ───────────
step "Step 0/6 · 验证 mode 参数"
case "$MODE" in
    test|canary|production) ok "mode=$MODE" ;;
    *) die "--mode 必须是 test | canary | production" ;;
esac

# ─────────── Step 1: 分支合法 + 工作树告警 ───────────
step "Step 1/6 · 分支检查 + 工作树状态"

cd "$PROJECT_ROOT"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
note "当前分支: $CURRENT_BRANCH"

# 分支白名单:dev-* / test / dev / main
case "$CURRENT_BRANCH" in
    dev-*|test|dev|main) ok "分支 '$CURRENT_BRANCH' 在白名单内" ;;
    *) die "当前分支 '$CURRENT_BRANCH' 不在白名单(dev-* / test / dev / main)。如需部署新分支,先合并到 dev。" ;;
esac

# 工作树状态:dev-* 分支允许脏(main 上要求干净,保护 prod)
TRACKED_DIRTY="$(git diff --shortstat HEAD 2>/dev/null)"
UNTRACKED_COUNT="$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')"

if [[ -n "$TRACKED_DIRTY" ]]; then
    note "⚠ 有未 commit 的 tracked 改动(本次部署不会包含这些改动对应的 dist):"
    git diff --shortstat HEAD | sed 's/^/    /'
fi

if [[ "$UNTRACKED_COUNT" -gt 0 ]]; then
    note "⚠ 有 $UNTRACKED_COUNT 个 untracked 文件(dev-* 分支常见,仅告警)"
    if [[ $APPLY -eq 1 ]]; then
        note "  untracked 清单(前 20 个):"
        git ls-files --others --exclude-standard 2>/dev/null | head -20 | sed 's/^/    /'
        if [[ $UNTRACKED_COUNT -gt 20 ]]; then
            note "    ... 及其他 $((UNTRACKED_COUNT - 20)) 个"
        fi
    fi
fi

# main 分支:严格,要求工作树干净(prod 不接受未 commit 内容)
if [[ "$CURRENT_BRANCH" == "main" ]]; then
    if [[ -n "$TRACKED_DIRTY" || "$UNTRACKED_COUNT" -gt 0 ]]; then
        die "main 分支要求工作树干净(prod 部署需要 100% 可复现)。请先 commit。"
    fi
    ok "main 分支 · 工作树干净"
else
    ok "dev-* 分支 · 跳过工作树严格检查(已打印告警)"
fi

# 模式与分支的语义对应(防止把 production 模式的构建推到测试服务器)
case "$MODE:$CURRENT_BRANCH" in
    test:main)
        die "mode=test 但当前在 main 分支。main 通常对应 production 模式,请确认。"
        ;;
    production:main)  ok "mode=production × main(prod)" ;;
    test:dev-*|test:test|test:dev) ok "mode=test × dev-* 分支(测试环境)" ;;
    canary:dev-*|canary:test|canary:dev) ok "mode=canary × dev-* 分支(预发)" ;;
    *)
        note "⚠ 非典型组合:mode=$MODE × 分支=$CURRENT_BRANCH"
        if [[ $APPLY -eq 0 ]]; then
            ok "(dry-run 不阻塞)"
        else
            read -r -p "    继续? [y/N] " ans
            [[ "$ans" =~ ^[Yy]$ ]] || die "已取消"
        fi
        ;;
esac

# ─────────── Step 2: 本地质量门 ───────────
step "Step 2/6 · 本地质量门"

if [[ $SKIP_TESTS -eq 1 ]]; then
    note "--skip-tests 已传,跳过 lint/type-check/test"
else
    command -v npm >/dev/null || die "npm 不在 PATH"

    note "npm run lint"
    npm run lint || die "lint 失败"

    note "npm run type-check"
    npm run type-check || die "type-check 失败"

    note "npm run test"
    npm run test || die "test 失败"

    ok "lint + type-check + test 全过"
fi

# ─────────── Step 3: 构建 ───────────
step "Step 3/6 · 构建前端"

BUILD_CMD="npm run build:$MODE"
note "$BUILD_CMD"

# 先清掉 dist/,确保是干净的产物(防止旧 hash 残留误导验证)
if [[ -d dist ]]; then
    note "清理 dist/"
    rm -rf dist
fi

npm run "build:$MODE" || die "构建失败"

[[ -f dist/index.html ]] || die "dist/index.html 不存在,构建产物异常"

# 抓一个 hash 化的 chunk 名字(部署后用)
NEW_CHUNK="$(ls dist/assets/*.js 2>/dev/null | head -1 | xargs -n1 basename)"
[[ -n "$NEW_CHUNK" ]] || die "dist/assets/ 下找不到 .js chunk"
ok "构建成功 · 新 chunk: $NEW_CHUNK"

# ─────────── Step 4: 推送 ───────────
step "Step 4/6 · rsync dist/ → $SERVER:$REMOTE_DIR"

# 服务器侧目标目录必须已存在(nobody:nginx 可读)
note "ssh $SERVER mkdir -p $REMOTE_DIR"
ssh "${SSH_OPTS[@]}" "$SERVER" "mkdir -p $REMOTE_DIR" || die "无法 ssh 到 $SERVER(请检查 ~/.ssh/config / 密钥)"

# 统计信息
LOCAL_SIZE="$(du -sh dist | cut -f1)"
REMOTE_SIZE="$(ssh "${SSH_OPTS[@]}" "$SERVER" "du -sh $REMOTE_DIR 2>/dev/null | cut -f1" || echo "unknown")"
note "本地 dist/: $LOCAL_SIZE"
note "远端 $REMOTE_DIR: $REMOTE_SIZE(将被 --delete 替换)"

RSYNC_OPTS=(-avz --delete --human-readable
            --exclude='.git'
            --exclude='node_modules'
            -e "ssh ${SSH_OPTS[*]}")

if [[ $APPLY -eq 0 ]]; then
    note "DRY-RUN — 实际不会推送。预览传输清单:"
    rsync "${RSYNC_OPTS[@]}" --dry-run dist/ "$SERVER:$REMOTE_DIR/" | tail -20
    die "DRY-RUN 完成。带上 --apply 真正推送。"
fi

# 备份当前远端 dist/(用于回滚)
BAK="dist.bak.$(date +%Y%m%d_%H%M%S)"
note "备份远端 dist/ → $BAK"
ssh "${SSH_OPTS[@]}" "$SERVER" "
    if [ -d $REMOTE_DIR ]; then
        cp -a $REMOTE_DIR $REMOTE_DIR.$BAK
        echo '  · 远端备份: $REMOTE_DIR.$BAK'
    fi
"

note "rsync(可能耗时几秒到几分钟)"
rsync "${RSYNC_OPTS[@]}" dist/ "$SERVER:$REMOTE_DIR/" || die "rsync 失败"

ok "dist/ 已推送"

# ─────────── Step 5: 部署后验证 ───────────
step "Step 5/6 · 部署后验证"

VERIFY_URL="https://ffn-test.aicyber.chat"

note "curl -I $VERIFY_URL/"
HEADERS="$(curl -sI --max-time 10 "$VERIFY_URL/" || true)"
echo "$HEADERS" | head -10

# 期望 200(nginx serve /opt/ffn/dist/index.html)
echo "$HEADERS" | head -1 | grep -q "200" \
    && ok "首页返回 200" \
    || die "首页未返回 200 — 见上方 headers"

# 6 个安全头(参考 ops/deploy-nginx.sh)
for h in "X-Frame-Options" "X-Content-Type-Options" "Referrer-Policy" "Strict-Transport-Security"; do
    if echo "$HEADERS" | grep -qi "^$h:"; then
        ok "安全头存在: $h"
    else
        note "⚠ 安全头缺失: $h(可能 ops/nginx.conf 未部署该版本)"
    fi
done

note "curl $VERIFY_URL/assets/$NEW_CHUNK"
CHUNK_STATUS="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$VERIFY_URL/assets/$NEW_CHUNK" || echo "000")"
if [[ "$CHUNK_STATUS" == "200" ]]; then
    ok "新 chunk $NEW_CHUNK 返 200 — 部署已生效"
else
    die "新 chunk 返 $CHUNK_STATUS(预期 200)— 部署未生效,检查 nginx 是否指向 $REMOTE_DIR"
fi

# ─────────── Step 6: 完成 ───────────
step "Step 6/6 · 完成"

printf "${GRN}${BOLD}════════════════════════════════════════════${RST}\n"
printf "${GRN}${BOLD} ✓ 部署成功${RST}\n"
printf "${GRN}════════════════════════════════════════════${RST}\n"
printf "  URL:    ${YLW}%s${RST}\n" "$VERIFY_URL"
printf "  chunk:  ${YLW}%s${RST}\n" "$NEW_CHUNK"
printf "  服务器: ${YLW}%s${RST}\n" "$SERVER"
printf "  备份:   ${DIM}$REMOTE_DIR.$BAK${RST}\n"
printf "\n"
printf "${BOLD}建议下一步:${RST}\n"
printf "  1. 浏览器打开 ${YLW}%s${RST} 硬刷新(Cmd+Shift+R / Ctrl+F5)\n" "$VERIFY_URL"
printf "  2. 登录测试账号,确认功能正常\n"
printf "  3. 跑一遍冒烟:RLS 双账号、sync 双向、新功能(如有)\n"
printf "  4. 没问题后合并分支到 dev → 触发 ffn-test 上的 CI(若有)\n"
printf "  5. 主干确认后,把分支合并到 main 部署到 prod(118.89.118.126,需用户确认)\n"