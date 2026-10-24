# 语音与音画同步（TTS & Sync）

## 用哪个引擎

走 **Android 标准 `TextToSpeech`**，绑定系统当前的首选引擎
（可以是 Google TTS、厂商引擎，也可以是 MultiTTS 这类聚合器）。

好处：

- 不依赖任何第三方 App 的私有 HTTP 接口（端口、协议都不稳定）；
- 用户装好的离线音色、语速、音调直接在系统设置里生效；
- 引擎替换不影响我们的代码。

```java
tts = new TextToSpeech(context, status -> {
    if (status == TextToSpeech.SUCCESS) {
        tts.setLanguage(Locale.CHINA);
        tts.setOnUtteranceProgressListener(listener);
    }
});
```

## 为什么不能在调 speak 的瞬间弹气泡

`speak()` 只是提交任务，引擎还要：绑定引擎（首句几百毫秒）→ 合成 → 出声。
气泡立刻画出来，声音晚一拍，就是「音画不同步」。

正确做法是把气泡、口型、动作都挂在 **`UtteranceProgressListener`** 上：

```java
onStart(utteranceId) → 弹气泡 + 开始口型 + 执行动作
onDone(utteranceId)  → 停口型 + 延迟 1s 收气泡
onError / onStop     → 同上（兜底）
```

## 引擎不回调怎么办

不是所有引擎都会准时回调。加一个 **1.5 秒兜底**：请求朗读后 1.5s 还没收到 `onStart`，
就当它已经开始，照常弹气泡——避免「只出声、不显示」。

## 口型

素材是一段「说话时循环播放」的动画（dsh-pet 里是 `events.whisper` 的碎碎念）。
`onStart` 切进去、`onDone` 切回待机，期间：

- 不算随机动作、不走路；
- 新的一句先 `QUEUE_FLUSH`，避免排队。

这不是真正的口型同步（视频没有 viseme），只是「说话时嘴在动」。

## 音频焦点

`AudioAttributes` 用 `USAGE_ASSISTANT + CONTENT_TYPE_SPEECH`，念一句就结束，
不会把用户的音乐停掉（最多短暂压低）。

## 一个坑

页面全局 `user-select: none`（防止拖菜单时选中文字）会**连输入框一起禁掉**：
能打字，但点文字移动光标不工作。必须给输入框开例外：

```css
input, textarea {
  -webkit-user-select: text;
  user-select: text;
  touch-action: manipulation;
}
```
