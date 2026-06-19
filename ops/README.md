# ops/ — 部署与运维

服务器侧配置 + 一键部署脚本。**不属于前端 bundle**，跟 `src/` / `supabase/migrations/` 同级。

## 文件清单

| 文件 | 用途 | 部署目标 |
|---|---|---|
| `nginx.conf` | ffnmv 站点配置(server 块) | `/etc/nginx/sites-available/ffnmv` |
| `rate-limit.conf` | 登录限速(limit_req_zone) | `/etc/nginx/conf.d/rate-limit.conf` |
| `snippets/auth-rate-limit.yml` | auth 服务 environment 4 行新增 | 插入到 `/opt/supabase/docker/docker-compose.yml` |
| `deploy-nginx.sh` | 部署 nginx 配置 | — |
| `deploy-rate-limit.sh` | 部署 Supabase 登录限速 env + compose patch | — |

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
