## MAGI v2.3.0 — 从「本地播放器」到「本地库 + 聚合入口」

2.2.x 的 MAGI 只管本地：书架、曲库、视频，三样都得先有自己的文件。这一版加了第四个分区 **「发现」**，把外部内容接进来——动漫、书籍、音乐三类走同一条通道，搜一次，结果能直接试听、入库、或者跳去正版页。

### 源通道（`src/sources/`）

不是给每个内容类型写一套页面，而是**先把契约统一，再让 UI 只认一种结果**：

- `SourceProvider` 只有两个方法：`search(query)` → `SourceHit[]`，`detail(hit)` → 分集/章节 + 简介 + 属性。
- `SourceHit` 是一句话能描述的任何可消费内容：标题、封面、角标、`playUrl`（能听）、`downloadUrl`（能下）、`openUrl`（能看）。
- 内置源和用户自定义源实现同一个接口，所以**新增一个源不需要动 UI**。

| 内置源 | 类型 | 说明 |
|---|---|---|
| **AniList** | 动漫 | GraphQL 主源，免 Key。给分集列表与**正版观看入口**（B 站 / 爱奇艺 / 优酷 优先），不直连任何资源站 |
| **Jikan** | 动漫 | MAL 公共 API。`api.jikan.moe` 在国内多数网络不可达，**默认关闭** |
| **古登堡计划** | 书籍 | Gutendex，7 万+ 公版书，EPUB / TXT 可直接下载进书架 |
| **iTunes 试听** | 音乐 | Apple 官方 30 秒试听直链，命中即可进播放队列（复用现有传输条） |

### 网络层：多了一条 POST 通道

AniList 是 GraphQL，必须 POST。原来只有 `lookup-fetch`（纯 GET），所以主进程新增 `source-request`：

- 支持 `GET / POST / PUT / DELETE / HEAD`、自定义头、自定义超时（上限 30s），响应截断 2MB。
- 只放行 `http(s)`，超时用 `AbortController` 兜住，不会把主进程拖死。
- 渲染层统一走 `src/sources/http.ts`：优先 IPC，浏览器调试时退回 `fetch`；另有 `withRetry`（4xx 不重试，网络抖动自动再试一次）和 `mapLimit` 并发闸门。

### 聚合策略：一个源挂了不算全挂

- **并行 + 交错合并**：所有源同时打，结果按「轮」交替排列，避免某个源把前 24 条全占满。
- **失败隔离**：每源独立计时，失败只标红那一个并附原因；有「重试失败源」只重跑挂掉的，不整轮重来。
- **默认开关**：源可以声明 `defaultEnabled: false`（比如 Jikan），不常用的源关掉就不会每次搜索都拖一条红字。

### 操作逻辑

- `Ctrl / Cmd + K` 聚焦搜索框；`ESC` 逐层退出（先关详情抽屉，再清空结果）。
- 分区选择、最近 8 条搜索词都本地持久化，下次打开还是原来的位置。
- 搜索中走骨架屏（12 张卡），不闪白屏。
- 音乐命中卡上直接「试听」，书籍命中卡上直接「入库」，其余条目给「打开来源页」——不用先进详情。
- 详情抽屉右侧滑出：封面、属性表、简介、分集目录，分集点开直达正版播放页。

### 自定义源

「发现 → 源管理」粘一段 JSON 就能加源，URL 支持 `{query}` `{page}` `{limit}`，字段映射走点路径：

```json
{
  "id": "my-anime", "name": "我的源", "kinds": ["anime"],
  "search": {
    "url": "https://api.example.com/search?q={query}&page={page}",
    "list": "data.items",
    "fields": { "id": "id", "title": "name", "cover": "pic", "openUrl": "url" }
  }
}
```

**刻意不支持任意 JS**：允许自定义脚本的源系统，等于把整个应用交给第三方代码。声明式映射覆盖绝大多数 JSON API，安全性换来的那点灵活性不值得。

### 顺带

- 左侧分区栏从三个变四个，「发现」与本地库并列——MAGI 的定位从「纯本地」扩成「本地库 + 聚合入口」。
- 分区按钮补了 `:active` 缩放与 `:focus-visible` 描边，键盘操作可见焦点。
- 搜索页的「源」不是概念，是可见的：每个源一条状态胶囊，写着条数和耗时。

### 验证

- `tsc --noEmit` → 0 error
- `vite build` → 通过（626 modules）
- 实测网络：`graphql.anilist.co`（POST）通、`gutendex.com` 通、`itunes.apple.com` 通；`api.jikan.moe` / `api.bgm.tv` / `archive.org` 在本机网络下超时——这也是 Jikan 默认关闭、以及失败隔离必须存在的原因。
