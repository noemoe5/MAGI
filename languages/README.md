# 界面语言包 / Language packs

MAGI 的界面语言是**外挂**的：往语言目录里丢一个 `.json`，它就会出现在「设置 → 语言」里。删掉文件即消失，不用改代码、不用重新打包。

思路借鉴 [AutoSD](https://github.com/noemoe5/AutoSD) 的 `language` 文件夹做法。

## 放哪里

| 位置 | 用途 | 需要重启吗 |
| --- | --- | --- |
| `%APPDATA%\MAGI\languages\` | 你自己装的语言包（优先级最高，可覆盖内置文案） | 重启应用 |
| `<安装目录>\resources\languages\` | 随安装包分发的语言包 | 重启应用 |
| `<仓库根>/languages/` | 开发期直接用 | 重启应用 |

设置面板里点「打开语言包目录」会直接打开第一个目录（不存在会自动创建）。

## 文件格式

文件名随意（`ja.json`、`russian.json` 都行），内容：

```json
{
  "code": "ja",
  "name": "日本語",
  "strings": {
    "library": "本棚",
    "settings": "設定",
    "sectionMusic": "音楽"
  }
}
```

- `code`：语言码，2–16 位字母 / 数字 / `-` / `_`。省略时取文件名（`ja.json` → `ja`）。
- `name`：设置面板里显示的名字。省略时显示 `code`。
- `strings`：键值对，**只写你要覆盖的词条就行**，没写的自动回落到英文（`en`）文案，再没有就显示键名。

`_template.json` 里是一份常用键的清单，复制一份改掉 `code` / `name` / 文本即可。完整的键表见 `src/i18n/index.ts` 里的 `zh` / `en` 两个对象。

## 注意

- 内置的「简体中文」「English」永远在，外部包可以用同样的 `code`（`zh` / `en`）覆盖个别词条，用于改称呼、改术语。
- 一个 `code` 只会加载一次：`userData` 里的同名包会盖掉随包分发的那个。
- json 写坏了不会影响启动 —— 该文件被跳过，应用照常用内置语言。
