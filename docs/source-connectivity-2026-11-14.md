# 源通道连通性测试 · 2026-11-14

测试机：DESKTOP-HS4VIK0（Windows 11 26200），网络 = BNUZ-Student 校园网（本机 10.8.201.247）。
方法：Node 22 原生 `fetch`，UA 伪装 `MAGI/1.0`，单请求超时 12–25s，对可疑失败项二次重试并记录 `cause.code`。
脚本：`scripts/test-sources.mjs`（自定义源端到端自检）、`scripts/probe-sources.mjs`（端点扫盲，`node scripts/probe-sources.mjs` 出总表，加 `--json` 出机器可读结果）。

## 一、内置源

| 源 | 类型 | 结果 | 耗时 | 备注 |
| --- | --- | --- | --- | --- |
| AniList (GraphQL POST) | 动漫 | ✅ 200 | 2.0s / 首测 9.2s | 首包慢，稳定可用；「进击的巨人」命中 |
| Gutendex | 书籍 | ✅ 200 | 4.2s / 7.3s | count=299，公版书正常；偶发一次 12s 超时，属正常抖动 |
| iTunes Search | 音乐 | ✅ 200 | 0.4s | 30s 试听直链正常 |
| Jikan v4 | 动漫 | ❌ 连接超时 | 10.6s | `UND_ERR_CONNECT_TIMEOUT`，保持默认关闭是正确决定 |

## 二、落雪（LX Music）系接口

| 端点 | 结果 | 耗时 | 细节 |
| --- | --- | --- | --- |
| GDStudio search（netease） | ✅ 200 | 1.5–6.6s | 根数组，`id/name/artist[]/album`，`source=netease` 有效 |
| GDStudio url（netease, br=320） | ✅ 200 | 2.6s | 返回 `m801.music.126.net/...mp3`，实测 206 + `audio/mpeg` + `ID3` 头 = 可播 |
| GDStudio 其它平台 | ❌ | — | kuwo/kugou/tencent/ytmusic/spotify/qobuz/tidal 一律 `Value of \`source\` is not supported`；joox 能搜但 `url=null` |
| 野草 vkeys search | ✅ 200 | 1.1–2.8s | `data[]` 带 `song/singer/album/cover`，封面可直接用 |
| 野草 vkeys 取流 | ⚠️ 200 但 `url=null` | 1.0s | 无 `level/quality/type` 参数组合能拿到直链 → 只能当检索源 |
| 网易云 Web API（`/api/search/get/web`） | ✅ 200 | 3.5s | 无需登录可取搜索结果，未测取流 |
| QQ 音乐 `client_search_cp` | ⚠️ 不稳定 | 1.9–5.2s | 同一端点两次采样结果不同：一次 500 空响应，一次 200（`list=3`，命中「发如雪」）。可用但需重试兜底 |
| 酷狗 `mobilecdn` | ❌ TLS | 0.1s | `ERR_TLS_CERT_ALTNAME_INVALID` → 证书被劫持/指向错误主机 |
| 咪咕 | ❌ | 6.6s | 返回 HTML 落地页，非 JSON |
| B 站 `search/type` | ❌ 412 | 6.5s | 风控（`-412`），需 cookie/wbi 签名 |

## 三、基础设施（决定源怎么分发）

| 端点 | 结果 | 说明 |
| --- | --- | --- |
| `cdn.jsdelivr.net` | ✅ 200 | 可直取 `gh/user/repo@main/src/...ts`，**源分发走这里** |
| `registry.npmmirror.com` | ✅ 200 | 0.4s |
| `raw.githubusercontent.com` | ❌ | `UNABLE_TO_VERIFY_LEAF_SIGNATURE`（校园网 SSL 中间人，证书链不完整） |
| `api.github.com` | ❌ | 同上 |
| `github.com` 网页 | ❌ | 同上 —— 浏览器能开是因为浏览器内置根证书/代理，Node 的 CA 库认不出 |

**结论**：MAGI 主进程若要直接拉 GitHub 资源，会遇到同样的证书错误。两种处理：
1. 源清单/音源统一走 jsDelivr（已验证可用，零改造）；
2. 需要直连 GitHub 时，在 `main.cjs` 注册 `app.on('certificate-error')` 或在设置里给「信任不安全证书」开关（仅对用户显式开启的域名生效）。

## 四、落雪音源能不能直接加载？

**不能原样加载。** 洛雪的「自定义音源」是 **JS 插件**，依赖宿主注入的 `lx.request`、`lx.utils.crypto`（RSA/AES 签名）、`lx.send` 等私有 API，本质是沙箱脚本而不是数据。

但它的**底层 HTTP 接口是普通的**。所以有两条路：

| 路线 | 工作量 | 能覆盖 |
| --- | --- | --- |
| A. 把音源底层的公开 API 写成声明式源（**已实现**） | 每个源 20 行 JSON | 网易云（GDStudio）、野草检索；覆盖日常找歌 + 试听 |
| B. 加 JS 沙箱适配层，兼容 `lx.*` API | 中（需 Worker/BrowserWindow 隔离 + 网络白名单） | 完整落雪音源生态，含 QQ/酷狗/咪咕 |

本次落地的是 A 路线 + 一个新能力（见下）。

## 五、本次代码改动

1. **惰性取流** `SourceProvider.resolveStream`：搜索结果只有 id 时，点「试听」才向上游换直链。落雪系 API 全是这个形状，之前契约只支持「搜索结果自带 playUrl」，所以这条路是断的。
2. `CustomSourceSpec.stream`：声明式写取流模板 `{ id }` + 响应点路径 `pick`。
3. `DiscoverPage`：`canPlay()` 判定改为「有 playUrl 或有 resolveStream」，卡片与详情抽屉都生效；取流失败给 toast，不再静默。
4. **修掉一个既有 bug**：`fields` 省略 `cover` 时，`pick(row, undefined)` 返回整行对象，`absolutize` 对其调 `.startsWith` 直接抛 `url.startsWith is not a function` —— 任何不带封面的自定义源都会挂。已在 `custom.ts` 加 `f.cover ?` 守卫，`absolutize` 也改成接受 unknown 并强转。
5. 新增 `examples/sources/luoxue-music.json`（GDStudio 网易云 / GDStudio JOOX / 野草）与 `scripts/test-sources.mjs`。

实测（`node scripts/test-sources.mjs 周杰伦`）：

```
[GDStudio · 网易云] 搜索 24 条 / 6594ms
   取流 2630ms → https://m801.music.126.net/...
   直链: HTTP 206 audio/mpeg 32768B magic=73,68,51 ✓ 可播
[GDStudio · JOOX] 搜索 30 条 / 1988ms  (无 stream 模板)
[野草 API · 网易云] 搜索 20 条 / 2815ms  [cover]
结果: 全部通过
```

`tsc --noEmit` 0 error。

## 六、"把网站变成源"的设计（下一阶段）

三层，按投入从小到大：

**L1 声明式 API（已有）** — JSON 映射。适合有公开 JSON 接口的站。

**L2 HTML 抓取型** — 新增 `search.html` 模式：`row` 选择器 + 字段选择器 + 翻页模板，主进程用 linkedom/cheerio 解析。适合服务端渲染的站（RSS、播客、公版书站、独立博客）。**不引入任意脚本**，风险可控。

**L3 站点嗅探器（推荐的下一步）** — 「网站变源」真正的入口：输入一个 URL → 隐藏 `BrowserWindow` 打开 → 用 `webRequest.onBeforeRequest` 记录 XHR/fetch → 自动识别返回 JSON 的接口 → 让用户点选「标题/封面/直链」字段 → **生成 L1 的 spec**，直接存进源列表。

可行性评估：L3 是纯增量，不碰运行时安全模型（产物仍然是声明式 JSON），能把"陌生站点"到"可用源"的人力从写代码降到点几下。工程量约 300–500 行（隐藏窗口 + 请求记录 + 字段映射 UI）。风险点是登录态站点需要 cookie 透传，以及 JS 加密接口（B 站 wbi、网易 weapi）无法靠嗅探绕开——这两类只能落到 L4 沙箱脚本。

**L4 沙箱脚本（最后再做）** — 兼容落雪 `lx.*` 的 Worker 隔离运行时。只有当 L2/L3 覆盖不了 QQ/酷狗/咪咕这类加密接口时才值得写。

## 七、遗留

- 野草 API 的取流需要平台会员或另一套参数，暂当检索源用。
- QQ 音乐 / 酷狗 / B 站 在本网络下不可用，和 MAGI 无关，是网络侧问题。
- 校园网 SSL 中间人会持续影响 `electron-updater` 之类直连 GitHub 的功能，发版前需要处理证书信任。
