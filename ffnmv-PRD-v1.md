# 轻笔记应用 LightNote \- Viber Coding 开发输入文件

## 一、项目基础配置

|**配置项**|**配置内容**|
|---|---|
|项目名称|LightNote 轻笔记|
|项目版本|v1\.2|
|核心定位|类Flomo轻量化、离线优先、多端实时同步笔记PWA应用|
|技术栈（固定）|前端：React/Vue \| 本地存储：IndexedDB\(Dexie\.js\) \| 云端：Supabase \| 架构：离线优先\+异步增量同步|
|核心价值|随时记录，永不丢失，多端一致|

## 二、全局核心规则（编码强制遵循）

- **离线优先原则**：所有用户操作优先写入本地IndexedDB，异步同步云端，无网络完全可用

- **增量同步原则**：仅同步变更数据，禁止全量同步（首次初始化/数据损坏除外）

- **最终一致性原则**：多设备操作后数据最终统一，支持冲突自动\+手动解决

- **幂等性原则**：所有同步、数据库操作支持重复执行，无副作用

- **软删除原则**：所有数据删除为软删除，保留30天可恢复

## 三、数据库结构化定义（Viber Coding 代码生成核心）

### 3\.1 本地 IndexedDB 定义（Dexie\.js 可直接生成代码）

```javascript
// Dexie.js 数据库初始化代码
import Dexie from 'dexie';

const db = new Dexie('LightNoteDB');
// 数据库版本1 表结构+索引定义
db.version(1).stores({
  notes: 'id, status, created_at, updated_at, sync_status, deleted_at',
  tags: 'id, name, sync_status',
  note_tags: '[note_id+tag_id], note_id, tag_id',
  sync_queue: '++id, type, entity_type, entity_id, created_at, priority',
  sync_metadata: 'key',
  conflicts: 'id, entity_type, entity_id, created_at',
  cache: 'key, expires_at'
});

export default db;
```

### 3\.2 本地数据表字段规范

#### 3\.2\.1 notes 笔记表

|字段名|类型|默认值|说明|
|---|---|---|---|
|id|UUID|客户端生成|全局唯一主键|
|content|String|空|最大10000字符，笔记正文|
|status|Enum|pending|pending\-未处理 / completed\-已处理|
|created\_at|Timestamp|当前时间|客户端生成创建时间|
|updated\_at|Timestamp|当前时间|客户端生成修改时间|
|deleted\_at|Timestamp|null|删除时间，null为未删除|
|version|Integer|1|数据版本号，每次修改自增|
|sync\_status|Enum|pending|synced\-已同步 / pending\-待同步 / failed\-同步失败|
|last\_synced\_at|Timestamp|null|最后云端同步时间|

#### 3\.2\.2 tags 标签表

|字段名|类型|默认值|说明|
|---|---|---|---|
|id|UUID|客户端生成|全局唯一主键|
|name|String|空|唯一标签名，最大50字符|
|color|String|随机十六进制色值|标签颜色|
|created\_at|Timestamp|当前时间|创建时间|
|updated\_at|Timestamp|当前时间|修改时间|
|deleted\_at|Timestamp|null|删除时间|
|version|Integer|1|版本自增|
|sync\_status|Enum|pending|同步状态|
|last\_synced\_at|Timestamp|null|最后同步时间|

#### 3\.2\.3 note\_tags 笔记标签关联表

联合主键：note\_id \+ tag\_id，实现笔记标签多对多关联

### 3\.3 云端 Supabase 建表SQL（可直接执行）

#### 3\.3\.1 notes 云端表

```SQL
create table notes (
  id uuid primary key,
  user_id uuid references auth.users(id) not null,
  content text not null,
  status text check (status in ('pending', 'completed')) not null default 'pending',
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  deleted_at timestamp with time zone,
  version integer not null default 1,
  last_sync_device text not null
);

-- 行级权限隔离
alter table notes enable row level security;
create policy "Users can access their own notes" on notes
  for all using (auth.uid() = user_id);

-- 实时订阅
alter publication supabase_realtime add table notes;

-- 索引优化
create index notes_user_id_updated_at_idx on notes(user_id, updated_at);
create index notes_user_id_status_idx on notes(user_id, status);
create index notes_user_id_deleted_at_idx on notes(user_id, deleted_at);
```

#### 3\.3\.2 tags 云端表

```SQL
create table tags (
  id uuid primary key,
  user_id uuid references auth.users(id) not null,
  name text not null,
  color text not null,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  deleted_at timestamp with time zone,
  version integer not null default 1,
  last_sync_device text not null,
  unique(user_id, name)
);

alter table tags enable row level security;
create policy "Users can access their own tags" on tags
  for all using (auth.uid() = user_id);

alter publication supabase_realtime add table tags;
create index tags_user_id_updated_at_idx on tags(user_id, updated_at);
```

#### 3\.3\.3 note\_tags 云端表

```SQL
create table note_tags (
  note_id uuid references notes(id) on delete cascade not null,
  tag_id uuid references tags(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  created_at timestamp with time zone not null,
  deleted_at timestamp with time zone,
  version integer not null default 1,
  last_sync_device text not null,
  primary key (note_id, tag_id)
);

alter table note_tags enable row level security;
create policy "Users can access their own note_tags" on note_tags
  for all using (auth.uid() = user_id);

alter publication supabase_realtime add table note_tags;
create index note_tags_user_id_updated_at_idx on note_tags(user_id, updated_at);
```

## 四、核心功能编码清单（必实现）

### 4\.1 笔记管理模块

- **创建笔记**：纯文本输入，停止输入300ms自动保存，本地瞬时生效

- **编辑笔记**：实时编辑，本地即时更新，版本号自增

- **删除笔记**：软删除，标记deleted\_at，30天内可恢复

- **笔记展示**：创建时间倒序，无限滚动加载

- **状态管理**：未处理/已处理双状态，支持一键切换、状态筛选

- **自动归档**：已处理笔记支持7天/30天/永不自动归档

### 4\.2 标签管理模块

- **基础操作**：创建（自定义名称\+颜色）、编辑、删除、标签合并

- **关联能力**：笔记多标签、标签多笔记，单条/批量增减标签

- **检索能力**：单标签筛选、多标签AND/OR组合筛选、标签搜索补全

- **数据展示**：标签展示关联笔记数量

### 4\.3 数据导入导出

- 本地数据全量导出JSON

- 支持JSON文件批量导入本地数据

- 每日自动备份本地数据

## 五、同步机制核心编码逻辑（核心模块）

### 5\.1 同步核心概念

- 设备ID：设备唯一标识，持久化localStorage

- 版本号version：每次数据修改自增，冲突判定核心依据

- 同步水印：记录各实体最后云端拉取时间戳，用于增量同步

- 同步队列：有序存储本地待同步操作，保障执行顺序

### 5\.2 五大同步流程编码逻辑

1. **初始化同步**：登录获取设备ID → 拉取云端增量数据 → 合并本地 → 更新同步水印 → 建立Realtime实时连接

2. **本地推云端**：操作写入本地（版本自增\+待同步标记）→ 加入同步队列 → 批量上传云端 → 更新同步状态 → 失败指数退避重试

3. **云端拉本地**：30s定时轮询 \+ 实时订阅 → 接收云端变更 → 版本比对 → 合并覆盖本地 → 更新UI

4. **离线恢复同步**：网络恢复触发全量增量同步 → 执行积压同步队列 → 拉取离线云端变更 → 解决冲突 → 重连实时通道

5. **多设备同步**：云端为唯一数据真相源，各设备独立同步，互不干扰，最多支持10台设备在线

### 5\.3 冲突解决编码规则

固定采用 **LWW最后写入胜出策略**，优先级依次递减：

1. 数据version版本号高者胜出

2. 版本一致时，updated\_at修改时间晚者胜出

3. 时间一致时，last\_sync\_device设备ID大者胜出

冲突处理流程：留存双版本数据 → 自动应用胜出版本 → 保存冲突记录 → UI弹窗提示用户手动合并/选择版本

### 5\.4 异常处理编码规则

- 网络异常：自动切换离线模式，操作不中断，联网自动续同步

- 同步失败：临时错误指数退避重试（最大10次、32s），永久错误终止重试并提示

- 数据损坏：每周自动校验完整性，异常自动从云端/本地备份恢复

## 六、UI界面编码规范

### 6\.1 主界面布局（固定三栏）

- 左侧：标签列表（展示标签\+笔记数量、支持拖拽排序）

- 中间：笔记列表（卡片式展示、时间倒序、无限滚动）

- 右侧：笔记编辑区

- 顶部：搜索框、状态筛选、全局同步状态指示器、手动同步按钮

- 底部：新建笔记悬浮按钮

### 6\.2 笔记卡片元素

固定展示：内容摘要、关联标签、创建时间、状态标记、同步状态图标、悬停操作栏（编辑/删除/状态切换）

### 6\.3 特殊界面

- 标签管理界面：增删改色、合并标签、统计笔记数

- 冲突解决界面：双版本数据对比、本地/云端版本选择、手动合并编辑

## 七、性能\&非功能编码约束

### 7\.1 硬性性能指标（编码必须达标）

- 本地读写耗时：加载\<100ms、保存\<50ms

- 检索响应：标签检索\<200ms、全文搜索\<300ms（1w条数据）

- 同步延迟：联机\<1s、离线恢复同步\<5s

- 应用启动\<300ms、页面切换\<150ms

### 7\.2 性能优化强制编码规则

- 本地操作：批量事务处理、防抖自动保存、按需索引、定时清理冗余数据

- 同步优化：动态调整批量同步数量、优先级同步（新建\>更新\>删除）、gzip传输压缩

- 渲染优化：虚拟列表、组件缓存、防抖节流、路由懒加载

- PWA优化：静态资源缓存、应用外壳架构、离线友好提示

### 7\.3 安全编码规范

- 云端传输全程HTTPS加密，数据云端加密存储

- 用户密码bcrypt加密，支持本地AES\-256加密存储

- Supabase严格开启RLS行级权限，数据用户隔离

- 支持账号注销、数据彻底删除、两步验证

### 7\.4 兼容性规范

兼容主流浏览器最新2个版本、桌面/移动端适配、支持PWA安装、键盘快捷键操作

## 八、核心工具类代码（可直接复用）

包含完整**同步管理器核心代码**，为Viber Coding核心生成模板，无需二次开发

```javascript
import { createClient } from '@supabase/supabase-js';
import db from './db';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// 设备ID持久化
let deviceId = localStorage.getItem('device_id');
if (!deviceId) {
  deviceId = uuidv4();
  localStorage.setItem('device_id', deviceId);
}

class SyncManager {
  constructor() {
    this.isSyncing = false;
    this.realtimeChannel = null;
    this.pollingInterval = null;
    this.retryDelay = 1000;
    this.maxRetryDelay = 32000;
    this.batchSize = 100;
    this.minBatchSize = 20;
  }

  // 初始化同步入口
  async init() {
    await this.fullSync();
    this.setupRealtime();
    this.startPolling();
    this.setupNetworkListener();
    this.setupVisibilityListener();
  }

  // 全量增量同步
  async fullSync() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      await this.syncEntity('notes');
      await this.syncEntity('tags');
      await this.syncEntity('note_tags');
      await db.sync_metadata.put({ key: 'last_full_sync_at', value: new Date().toISOString() });
    } catch (error) {
      this.scheduleRetry();
    } finally {
      this.isSyncing = false;
    }
  }

  // 单实体同步
  async syncEntity(entityType) {
    const lastSync = await db.sync_metadata.get(`last_${entityType}_sync_at`);
    const lastSyncAt = lastSync?.value || '1970-01-01T00:00:00.000Z';
    const { data, error } = await supabase
      .from(entityType)
      .select('*')
      .gt('updated_at', lastSyncAt)
      .order('updated_at', { ascending: true });
    if (error) throw error;

    // 合并云端数据到本地
    if (data.length > 0) {
      await db.transaction('rw', db[entityType], async () => {
        for (const item of data) {
          const { user_id, ...localItem } = item;
          const existing = await db[entityType].get(localItem.id);
          if (!existing) {
            await db[entityType].put({ ...localItem, sync_status: 'synced', last_synced_at: new Date().toISOString() });
          } else if (localItem.version > existing.version) {
            await db[entityType].put({ ...localItem, sync_status: 'synced', last_synced_at: new Date().toISOString() });
          } else if (localItem.version === existing.version && existing.sync_status === 'pending') {
            await this.handleConflict(entityType, existing, localItem);
          }
        }
      });
      await db.sync_metadata.put({ key: `last_${entityType}_sync_at`, value: data[data.length - 1].updated_at });
    }
    // 推送本地待同步数据
    await this.pushLocalChanges(entityType);
  }

  // 推送本地变更到云端
  async pushLocalChanges(entityType) {
    const pendingItems = await db[entityType]
      .where('sync_status')
      .anyOf(['pending', 'failed'])
      .limit(this.batchSize)
      .toArray();
    if (pendingItems.length === 0) return;

    const { data: userData } = await supabase.auth.getUser();
    const itemsToPush = pendingItems.map(item => ({
      ...item,
      user_id: userData.user.id,
      last_sync_device: deviceId
    }));

    const { error } = await supabase.from(entityType).upsert(itemsToPush, { onConflict: 'id' });
    if (error) throw error;

    await db[entityType].where('id').anyOf(pendingItems.map(i => i.id)).modify({
      sync_status: 'synced',
      last_synced_at: new Date().toISOString()
    });
  }

  // 冲突处理核心逻辑
  async handleConflict(entityType, localData, cloudData) {
    await db.conflicts.add({
      id: uuidv4(),
      entity_type: entityType,
      entity_id: localData.id,
      local_version: localData.version,
      cloud_version: cloudData.version,
      local_data: localData,
      cloud_data: cloudData,
      created_at: new Date().toISOString()
    });
    // LWW策略执行
    const localTime = new Date(localData.updated_at);
    const cloudTime = new Date(cloudData.updated_at);
    if (cloudTime > localTime) {
      await db[entityType].put({ ...cloudData, sync_status: 'synced', last_synced_at: new Date().toISOString() });
    }
  }

  // 实时订阅初始化
  setupRealtime() {
    this.realtimeChannel = supabase.channel('public:all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, (p) => this.handleRealtimeChange('notes', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tags' }, (p) => this.handleRealtimeChange('tags', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'note_tags' }, (p) => this.handleRealtimeChange('note_tags', p))
      .subscribe((status) => status === 'CHANNEL_ERROR' && this.scheduleRealtimeReconnect());
  }

  // 实时变更处理
  async handleRealtimeChange(entityType, payload) {
    if (payload.new?.last_sync_device === deviceId) return;
    const { new: newData, old: oldData, eventType } = payload;
    await db.transaction('rw', db[entityType], async () => {
      if (eventType === 'DELETE') await db[entityType].delete(oldData.id);
      else {
        const { user_id, ...localData } = newData;
        const existing = await db[entityType].get(localData.id);
        if (!existing || localData.version > existing.version) {
          await db[entityType].put({ ...localData, sync_status: 'synced', last_synced_at: new Date().toISOString() });
        } else if (existing.sync_status === 'pending') {
          await this.handleConflict(entityType, existing, localData);
        }
      }
    });
    window.dispatchEvent(new CustomEvent('data-updated', { detail: { entityType } }));
  }

  // 定时轮询、网络监听、重连、重试工具方法
  startPolling() {
    this.pollingInterval = setInterval(() => {
      if (!this.isSyncing && navigator.onLine && document.visibilityState === 'visible') this.fullSync();
    }, 30000);
  }

  setupNetworkListener() {
    window.addEventListener('online', () => {
      this.retryDelay = 1000;
      this.batchSize = 100;
      this.fullSync();
    });
    window.addEventListener('offline', () => this.batchSize = this.minBatchSize);
  }

  setupVisibilityListener() {
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.fullSync());
  }

  scheduleRetry() {
    setTimeout(() => this.fullSync(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay);
  }

  scheduleRealtimeReconnect() {
    setTimeout(() => this.setupRealtime(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay);
  }
}

export const syncManager = new SyncManager();
```

## 九、开发里程碑（Viber Coding迭代节奏）

1. M1：本地数据库搭建 \+ 笔记/标签基础CRUD

2. M2：Supabase云端对接 \+ 基础同步能力

3. M3：实时同步 \+ 离线同步能力完善

4. M4：冲突解决 \+ 全量异常处理

5. M5：UI适配 \+ 全维度性能优化

6. M6：全量功能测试 \+ Bug修复

7. Release：v1\.0正式版本上线

## 十、风险编码规避方案

- IndexedDB兼容：强制使用Dexie\.js封装，规避原生API兼容问题

- Supabase服务异常：离线优先兜底，不影响本地操作

- 同步数据冲突：强制留存冲突记录，支持手动兜底修复

- 浏览器存储配额不足：自动清理过期缓存/删除数据，支持用户手动清理

- 实时连接不稳定：自动重连\+降级轮询双兜底策略

> （注：文档部分内容可能由 AI 生成）
