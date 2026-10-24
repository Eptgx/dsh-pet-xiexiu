# 动作标签（Action Tags）

AI 回复里可以带一个动作标签，宠物在**开口说话的那一刻**做对应动作。

```
[动作:跳]主人你好呀
```

## 解析

```js
const ACTION_WHITELIST = ['跳', '哭', '生气', '笑', '吃', '撒娇', '委屈'];
const ACTION_TAG_RE = /\[\s*动作\s*[:：]\s*([^\]\s]+)\s*\]/g;

function splitAction(text) {
  let action = null;
  const clean = String(text || '')
    .replace(ACTION_TAG_RE, (_, name) => {
      if (!action && ACTION_WHITELIST.includes(name)) action = name;
      return '';   // 不管合不合法，标签都删掉
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { clean, action };
}
```

要点：

- 全角/半角冒号都认，名字两侧允许空格；
- **不合法也删**，只是不播动作；
- 干净文本才进气泡、TTS、聊天历史——否则历史里残留标签，模型会以为这是格式要求。

## 映射

| 标签 | 动画 |
|---|---|
| 跳 | `anim-jump` |
| 哭 / 生气 | `anim-shake` |
| 笑 / 吃 | `anim-scale` |
| 撒娇 | `anim-sway` |
| 委屈 | `anim-pout` |

动画挂在 `#sprite` 上（不是 `#stage`）——`#stage` 已经有镜像和点击 Q 弹的 transform，
两个都写 transform 会互相覆盖。

## 触发时机

和气泡一样挂在 TTS 的 `onStart`：

```java
onStart() {
    callPet("__petTalkStart", null);
    if (action != null) callPet("__petApplyAction", action);
    showBubble(payload, 0);
}
```

语音关闭时，在弹气泡的同一刻执行。

## 准入规则

1. **拖拽 / 飞行中**不播（否则就是「人在飞还在蹦」）；
2. 当前动画是**宽动作**（刚好装满舞台）时，跳过「跳」和「放大」，否则会被裁；
3. **说话时**：小动作（笑/吃/撒娇/委屈）直接播，大动作（跳/生气/哭）等说完再补。

## 防僵尸

```js
sprite.addEventListener('animationend', clear);  // 正常结束
setTimeout(clear, 1400);                          // 兜底
// 拖拽开始时主动 clear
```

另外连续两次同一动作要 `remove → 强制重排 → add`，否则第二次不播。
监听必须在 `boot()` 里绑定——写在顶层时 `sprite` 还没赋值，会直接抛错让整页挂掉。

## 提示词

在 system prompt 里告诉模型标签格式，否则它不会主动输出：

> 如果这句话有明显的动作或情绪，就在开头加一个动作标签，格式如 `[动作:笑]`；
> 只能从 跳、哭、生气、笑、吃、撒娇、委屈 里选一个，不要解释这个标签。
