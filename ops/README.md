# ops/ — 部署与运维

服务器侧配置 + 一键部署脚本。**不属于前端 bundle**，跟 `src/` / `supabase/migrations/` 同级。

## 文件清单

| 文件 | 用途 | 部署目标 |
|---|---|---|
| `nginx.conf` | ffnmv 站点配置(server 块) | `/etc/nginx/sites-available/ffnmv` |
| `rate-limit.conf` | 登录限速(limit_req_zone) | `/etc/nginx/conf.d/rate-limit.conf` |
| `snippets/auth-rate-limit.yml` | auth 服务 environment 4 行 rate limit | 插入到 `/opt/supabase/docker/docker-compose.yml` |
| `snippets/auth-password-min-length.yml` | auth 服务 1 行 GOTRUE_PASSWORD_MIN_LENGTH | 插入到 `/opt/supabase/docker/docker-compose.yml` |
| `deploy-nginx.sh` | 部署 nginx 配置 | — |
| `deploy-rate-limit.sh` | 部署 Supabase 登录限速 env + compose patch | — |
| `deploy-password.sh` | 部署密码最小长度(对齐前端 8 位) | — |
| `deploy-disable-email.sh` | 关闭 prod 邮箱确认(SMTP 没配时的降级方案) | — |
| **`deploy-frontend.sh`** | **部署前端 dist/ 到测试服务器(163.7.3.215)** | **/opt/ffn/dist/** |

## 服务器拓扑(2026-06-27)

| 域名 | 服务器 | 用途 | 部署路径 |
|---|---|---|---|
| ffn.aicyber.chat | 118.89.118.126 | **prod** | main 分支 / `npm run build:prod` |
| ffn-test.aicyber.chat | 163.7.3.215 | 测试 | dev-* 分支 / `npm run build:test` |
| ffn-pre.aicyber.chat | — | **已下线** | (2026-06-23) |

## deploy-frontend.sh 用法

**默认 dry-run** — 不带 `--apply` 只演练，不推送。强制开发者审一遍。

```bash
# 1. 先演练(看会推哪些文件)
bash ops/deploy-frontend.sh

# 2. 真推
bash ops/deploy-frontend.sh --apply

# 3. 其他模式(理论上 canary/production 也走同一脚本,但生产需要用户显式确认)
bash ops/deploy-frontend.sh --mode production --apply

# 4. 跳过质量门(应急用,慎用)
bash ops/deploy-frontend.sh --skip-tests --apply
```

### 流程(6 步)

1. **Step 0** — 验证 `--mode` 是 test/canary/production
2. **Step 1** — 工作树必须干净；分支必须在白名单(`dev-*` / `test` / `dev` / `main`)
3. **Step 2** — 本地 `lint` + `type-check` + `test`(可 `--skip-tests` 跳过)
4. **Step 3** — `npm run build:<mode>` → 产物 `dist/`
5. **Step 4** — rsync `dist/` → `root@163.7.3.215:/opt/ffn/dist/`(`--delete` 幂等)
6. **Step 5** — curl 验证首页 200 + 6 个安全头 + 新 chunk 200

### 内置安全护栏

- **拒绝脏工作树部署** — 必须先 commit 所有改动
- **拒绝未在白名单的分支** — 防止误推
- **拒绝 mode 与分支不匹配的组合** — 比如 `mode=test` 在 `main` 分支会立即 die
- **质量门失败立即退出** — lint/type-check/test 任一失败都不会推送
- **推送前自动备份** — 远端 `dist/` 备份为 `dist.bak.<时间戳>`
- **dry-run 默认开启** — 必须显式 `--apply` 才真推

### 服务器前置条件

163.7.3.215 上的目录结构必须已存在:

```
/opt/ffn/dist/       ← 本脚本 rsync 目标(nobody:nginx 可读)
/opt/ffn/dist.bak.*  ← 自动备份
```

SSH 访问:`root@163.7.3.215`,密钥在 `~/.ssh/id_rsa` 或 `~/.ssh/id_ecdsa`。

### 回滚

服务器侧没有版本管理,旧版本被 `--delete` 清掉了。回滚步骤:

```bash
# 1. 在本地 revert 那个 commit
git revert <bad-commit-sha>

# 2. 重新跑部署
bash ops/deploy-frontend.sh --apply
```

如果远端 `dist.bak.<时间戳>` 还在,应急可以:

```bash
ssh root@163.7.3.215 "cp -a /opt/ffn/dist.bak.<时间戳>/* /opt/ffn/dist/"
```

### 与 CI 的关系

`.github/workflows/android-ci.yml` **不**触发部署,只做 CI 验证。所以本脚本是**手动部署**的入口,不是替代品。

## 当前覆盖的安全评估项

- **item 3** (nginx 加安全头) — 6 个头 + gzip 调优
- **item 6** (登录限速) — nginx limit_req 10r/m + Supabase GOTRUE_RATE_LIMIT_*

## 部署命令

需要 SSH 到 `root@118.89.118.126` 的免密/密钥访问。

```bash
# 1. nginx 站点 + 限速
bash ops/deploy-nginx.sh

# 2. Supabase 登录限速 env(~3s 不可用)
bash ops/deploy-rate-limit.sh
```

两个脚本都是**幂等的**:重跑会跳过已存在的配置,但会创建新的 `.bak.<时间戳>` 备份。

## Cache 策略(2026-06-20 加)

部署后用户浏览器不会拉错 hash 的旧 chunk:
- `/` → `Cache-Control: no-cache, no-store, must-revalidate`(永远拉最新 index.html)
- `/assets/*.js` → `Cache-Control: public, max-age=31536000, immutable`(永久缓存,hash 文件名永不变)
- 其他路径 → SPA fallback(原行为)

**为什么需要**:之前每次部署(换 hash)后,用户浏览器还缓存旧 index.html,旧 index.html 引用
旧 hash 的 chunk,旧 chunk 已被新部署删了 → nginx SPA fallback 返 text/html → 浏览器报
"Expected a JavaScript module script but the server responded with a MIME type of text/html"

## 验证

部署后跑这套命令,全过才算完事:

```bash
# V1: 6+ 安全头
curl -I http://118.89.118.126/

# V2: nginx 限速(第 7 次起 429,burst=5)
ANON_KEY=$(ssh root@118.89.118.126 'grep ^ANON_KEY= /opt/supabase/docker/.env | cut -d= -f2-')
for i in {1..12}; do
  curl -s -o /dev/null -w "%{http_code} " \
    -X POST http://118.89.118.126/auth/v1/token?grant_type=password \
    -H "Content-Type: application/json" \
    -H "apikey: $ANON_KEY" \
    -d '{"email":"x@x.com","password":"x"}'
done; echo

# V2b: GoTrue 层(容器内 env)
ssh root@118.89.118.126 'docker exec supabase-auth env | grep GOTRUE_RATE_LIMIT'

# V3: WebSocket 101 Switching Protocols
curl -s -i --max-time 5 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Protocol: realtime.v1" \
  "http://118.89.118.126/realtime/v1/websocket?apikey=$ANON_KEY" | head -1

# V4: 静态资源 200 + 同样 6 头
curl -I http://118.89.118.126/assets/index-7jCGTUc_.js
```

## 回滚

```bash
# nginx 回滚(取最新备份)
ssh root@118.89.118.126 'ls -t /etc/nginx/sites-available/ffnmv.bak.* | head -1 | xargs -I{} cp {} /etc/nginx/sites-available/ffnmv && nginx -s reload'
ssh root@118.89.118.126 'ls -t /etc/nginx/conf.d/rate-limit.conf.bak.* | head -1 | xargs -I{} cp {} /etc/nginx/conf.d/rate-limit.conf && nginx -s reload'

# 限速 env + compose 回滚
ssh root@118.89.118.126 'ls -t /opt/supabase/docker/.env.bak.* | head -1 | xargs -I{} cp {} /opt/supabase/docker/.env'
ssh root@118.89.118.126 'ls -t /opt/supabase/docker/docker-compose.yml.bak.* | head -1 | xargs -I{} cp {} /opt/supabase/docker/docker-compose.yml'
ssh root@118.89.118.126 'cd /opt/supabase/docker && docker compose up -d --force-recreate --no-deps auth'
```

## 重要踩坑

部署 `deploy-rate-limit.sh` 时容易踩的坑(已写在脚本里):

1. **`environment:` 块 vs `env_file:`**:supabase 官方 compose 的 auth 服务用的是显式 `environment:` 块,`.env` 里加新变量**不会自动进容器**。必须在 compose 的 auth 服务 environment 块也加上对应行(`snippets/auth-rate-limit.yml` 就是干这个的)。
2. **`docker compose restart` 不重读 compose 文件**:要 `docker compose up -d --force-recreate --no-deps <service>` 才会重读 env。
3. **幂等性**:`deploy-rate-limit.sh` 用 `grep -q` 检测 4 个变量 + 4 行 compose,重跑不会重复追加,会创建新 `.bak.<时间戳>` 备份。

## 不在 ops/ 范围

- **HTTPS** (item 2):ZeroSSL / certbot 申请 + 443 listen 改造,独立 PR
- **dist 构建**:`npm run build` 产物走 `rsync` 到 `/var/www/ffnmv/dist`,见 `README.md` 部署章节
- **数据库迁移**:`supabase db push` 走 `supabase/migrations/`

## 改了 ops/ 之后的流程

```bash
git add ops/
git commit -m "feat(ops): <描述>"
git push origin dev-loginadv
# 实际部署: bash ops/deploy-<xxx>.sh
```

---

## v1.3.0 release notes (2026-06-20)

11 个新 commit 推到 main:`b625ed4..14e58ae`

### 🔐 安全 (覆盖安全评估 11 项里的 item 2/3/5/6/7/8)

| commit | 改动 | 文件 |
|---|---|---|
| `63cc3e7` | nginx 加 6 个安全头 + gzip 调优 + 登录限速 4 条 location | `ops/nginx.conf` `ops/rate-limit.conf` |
| `6593827` | 本地 dev `[auth.rate_limit]` 跟 prod 一致(supabase/config.toml 数值) | `supabase/config.toml` |
| `d5be90f` | **SEC-003** 密码最小长度后端对齐 8 位 | `supabase/config.toml` + `ops/deploy-password.sh` + `ops/snippets/auth-password-min-length.yml` |
| (跟随 `63cc3e7`) | **SEC-002** 配置 + 部署脚本:登录限速双层(nginx limit_req 10r/m + Supabase GOTRUE_RATE_LIMIT_*) | `ops/deploy-rate-limit.sh` + `ops/snippets/auth-rate-limit.yml` |

### 🚀 效率 (4 项 EFF-001/002/003 + EFF 性能)

| commit | 改动 | 文件 |
|---|---|---|
| `61d701c` | **EFF-003** 路由 lazy load:MainApp/Settings/Trash 独立 chunk,首屏 index.js 79KB → 30KB | `src/App.jsx` |
| `ffa72d4` | **EFF-001** Dexie schema v4→5 加 `archived_at` 索引,`getAll()` filter 改链式 | `src/lib/db.js` `src/repositories/notesRepo.js` |
| `df050e1` | **EFF-002** `data-updated` 事件带 `rows`/`removed` 增量,3 store 改 Map 索引增量更新 | `src/lib/tags.js` `src/lib/syncManager.js` `src/repositories/{notesRepo,tagsRepo}.js` `src/stores/{useNotesStore,useTagsStore,useTrashStore}.js` `src/components/ConflictDialog.jsx` + 5 新 store tests |

### 🛠 工具 (ops/)

| commit | 改动 | 文件 |
|---|---|---|
| `63cc3e7` | 新增 `ops/` 目录:deploy-nginx.sh / deploy-rate-limit.sh + snippets/ + README | `ops/*` |
| `e951026` | vite.config.js 加 `VITE_BASE` 支持(ffn-pre/ canary build 用)+ `.env.ffn-pre` 进 .gitignore | `vite.config.js` `.gitignore` |

### 📦 Release

| commit | 改动 | 文件 |
|---|---|---|
| `2323220` | `package.json` 1.2.1 → 1.3.0 | `package.json` |
| `ed40730` | 浏览器 tab title v1.3.0 同步 + `.env.production` 进 .gitignore(防 prod ANON_KEY 误推) | `src/main.jsx` `.gitignore` |
| `14e58ae` | `src/index.html` 静态 `<title>` 同步 v1.3.0(release 后补) | `index.html` |

### 部署状态

| 目标 | 状态 |
|---|---|
| 118.89.118.126 (prod) | ✅ 已部署 v1.3.0,旧 `index-BmI4P9xV.js` 删,新 `index-LGNUZcRE.js` + 3 lazy chunk |
| 163.7.3.215 /ffn-pre/ (canary) | ✅ 已部署,white-page 修了两件事:1) supabase-auth 容器因 `.env` 里 `GOTRUE_RATE_LIMIT_*_REFRESH=150/1h` 格式错反复 crash(改成裸数字 30);2) nginx CSP 缺单引号 `script-src self` 应为 `script-src 'self'`(已 sed 修复) |
| GitHub `main` | ✅ 11 个新 commit `b625ed4..14e58ae` |
| GitHub `dev-loginadv` | ✅ 新分支保留 feature 提交 |

### 用户首次进站会发生的事

- **EFF-001 schema v4→5**:IndexedDB 自动升级,加 `archived_at` 索引 + 规范化历史 `undefined` 为 `null`。无 UI 变化,首次访问几百毫秒无感
- **SEC-003 密码 8 位**:老账号 6 位密码仍可 signin(GoTrue signin 不检查 min_length),改密时会被前后端双双拦住
- **EFF-002 增量更新**:devtools Performance 录一段同步,主线程占用应明显降(单条 Realtime 变更从 ~50ms reload → ~1ms Map 替换)
- **EFF-003 lazy load**:Network 面板可见 `MainApp-*.js` 立即加载,`Settings/Trash` 按需加载

---

## v1.3.0.1 patch (2026-06-20) — 关掉 prod 邮箱确认

### 问题

prod 118.89.118.126 的 `.env` 配的是 `SMTP_HOST=supabase-mail`(期望 inbucket 容器),但 `docker-compose.yml` 里**根本没有声明 supabase-mail service**。结果:
- `ENABLE_EMAIL_AUTOCONFIRM=false` 要求邮箱确认
- 但 `supabase-mail` DNS 解析失败 (`lookup supabase-mail on 127.0.0.11:53: server misbehaving`)
- → 注册时 GoTrue 在事务里建 user + 发邮件,邮件失败 → 整个事务回滚 → **用户从未落库**
- → 用户看到 500 "Error sending confirmation email",永远注册不了

用户 `yatyeung@163.com` 试了 4 次都失败。audit log 里有 `user_confirmation_requested` 事件但 `auth.users` 里 0 行(回滚导致)。

### 临时修复

`bash ops/deploy-disable-email.sh` 做了:
- 备份 `.env` → `.env.bak.disableemail.<时间戳>`
- `ENABLE_EMAIL_AUTOCONFIRM=true`(让 GoTrue 自动确认,跳过邮件流程)
- `docker compose up -d --force-recreate --no-deps auth`(让新 env 生效)

**效果**:注册立即 200 + 返回 access_token + `email_confirmed_at` 自动设,无需邮件。

### ⚠️ 安全 trade-off

这是**降级方案**:
- ✅ 注册流程能用了
- ❌ **任何人都能用任意邮箱注册**(SEC-002 防抢注完全暴露)
- ❌ 之前评估 item 4 "Supabase 邮件验证" 失效

### 何时恢复(接真 SMTP 后)

1. 注册 SMTP provider(Resend 免费 3K/月、SendGrid 免费 100/天)
2. 改 `.env` 5-6 个变量:
   - `SMTP_HOST=<provider host>`
   - `SMTP_PORT=587` / `SMTP_SECURE=true` 等
   - `SMTP_USER` / `SMTP_PASS` / `SMTP_ADMIN_EMAIL`
3. 改回 `ENABLE_EMAIL_AUTOCONFIRM=false` + `docker compose up -d --force-recreate --no-deps auth`
4. (可选) `supabase/config.toml` 改 `enable_confirmations = true` 让本地 dev 也一致
5. 在 `docker-compose.yml` auth service 加 `GOTRUE_MAILER_EXTERNAL_HOSTS: 118.89.118.126`(消除 log 里的 "external host not added" 警告)

