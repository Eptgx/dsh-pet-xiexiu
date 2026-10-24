package com.demo2apk.floatingpet;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

/**
 * 主界面里的 window.FloatingPet。
 *
 *   1. 悬浮窗：权限、启停、锁定、解锁、居中；
 *   2. 桌宠设置：大小 / 固定不动；
 *   3. 配置：API Key / 模型（原生 prefs，宠物菜单窗共用）；
 *   4. 网络：拉模型 / 测连接 / 余额 / 对话，全部在原生做（页面 file:// 会被 CORS 拦）。
 *
 * 网络异步：JS 传 callbackId，原生后台请求，完成后 evaluateJavascript 调
 * window.__aiCallback(id, json)。不能阻塞 WebView 的 JS 线程。
 */
public class FloatingPetBridge {

    private final Activity activity;
    private final WebView webView;
    private final Handler main = new Handler(Looper.getMainLooper());

    public FloatingPetBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        // 提前绑定 TTS 引擎（MultiTTS），避免第一句回复延迟
        TtsSpeaker.warmUp(activity);
    }

    // ---------------- 悬浮窗 ----------------

    @JavascriptInterface
    public boolean canDrawOverlays() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return Settings.canDrawOverlays(activity);
    }

    @JavascriptInterface
    public void requestOverlayPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        if (Settings.canDrawOverlays(activity)) return;
        try {
            activity.startActivity(new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + activity.getPackageName())));
        } catch (Exception ignored) {
            // 部分 ROM 没有这个设置页
        }
    }

    @JavascriptInterface
    public void start() {
        if (!canDrawOverlays()) {
            requestOverlayPermission();
            return;
        }
        Intent intent = new Intent(activity, FloatingPetService.class);
        intent.setAction(FloatingPetService.ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                activity.startForegroundService(intent);
            } else {
                activity.startService(intent);
            }
        } catch (Exception ignored) {
            // 后台启动受限
        }
    }

    @JavascriptInterface
    public void stop() {
        try {
            activity.stopService(new Intent(activity, FloatingPetService.class));
        } catch (Exception ignored) {
            // ignore
        }
    }

    @JavascriptInterface
    public boolean isRunning() {
        return FloatingPetService.running;
    }

    @JavascriptInterface
    public boolean isLocked() {
        return petPrefs().getBoolean(FloatingPetService.KEY_LOCKED, false);
    }

    @JavascriptInterface
    public void setLocked(boolean locked) {
        petPrefs().edit().putBoolean(FloatingPetService.KEY_LOCKED, locked).apply();
        sendAction(locked ? FloatingPetService.ACTION_LOCK : FloatingPetService.ACTION_UNLOCK);
    }

    @JavascriptInterface
    public void centerPet() {
        sendAction(FloatingPetService.ACTION_CENTER);
    }

    /** App 前台时隐藏宠物（false=隐藏，true=显示）。 */
    @JavascriptInterface
    public void setPetVisible(boolean visible) {
        sendAction(visible ? FloatingPetService.ACTION_SHOW : FloatingPetService.ACTION_HIDE);
    }

    // ---------------- 桌宠设置 ----------------

    private SharedPreferences petPrefs() {
        return activity.getSharedPreferences(FloatingPetService.PREFS, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public String getPetSettings() {
        int size = petPrefs().getInt(FloatingPetService.KEY_SIZE, 180);
        boolean fixed = petPrefs().getBoolean(FloatingPetService.KEY_FIXED, false);
        return "{\"sizeDp\":" + size + ",\"fixed\":" + fixed
                + ",\"marginDp\":" + FloatingPetService.EDGE_MARGIN_DP + "}";
    }

    /** 小 180 / 中 220 / 大 260（dp 宽）。服务在跑就立刻按新尺寸重建窗口。 */
    @JavascriptInterface
    public void setPetSize(int sizeDp) {
        int value = Math.max(120, Math.min(300, sizeDp));
        petPrefs().edit().putInt(FloatingPetService.KEY_SIZE, value).apply();
        sendAction(FloatingPetService.ACTION_RESIZE);
    }

    @JavascriptInterface
    public void setPetFixed(boolean fixed) {
        petPrefs().edit().putBoolean(FloatingPetService.KEY_FIXED, fixed).apply();
        sendAction(FloatingPetService.ACTION_RELOAD);
    }

    private void sendAction(String action) {
        sendAction(action, null);
    }

    private void sendAction(String action, String extraAction) {
        if (!FloatingPetService.running) return;
        Intent intent = new Intent(activity, FloatingPetService.class);
        intent.setAction(action);
        if (extraAction != null) intent.putExtra("action", extraAction);
        try {
            activity.startService(intent);
        } catch (Exception ignored) {
            // 后台启动受限
        }
    }

    // ---------------- 通知 / 后台 ----------------

    @JavascriptInterface
    public boolean canNotify() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return activity.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void requestNotification() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || canNotify()) return;
        try {
            activity.requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 4711);
        } catch (Exception ignored) {
            // ignore
        }
    }

    @JavascriptInterface
    public boolean isIgnoringBattery() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager power = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
        return power != null && power.isIgnoringBatteryOptimizations(activity.getPackageName());
    }

    @JavascriptInterface
    public void openBatterySettings() {
        try {
            activity.startActivity(new Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + activity.getPackageName())));
        } catch (Exception ignored) {
            openAppSettings();
        }
    }

    @JavascriptInterface
    public void openAppSettings() {
        try {
            activity.startActivity(new Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + activity.getPackageName())));
        } catch (Exception ignored) {
            // ignore
        }
    }

    // ---------------- 配置 ----------------

    @JavascriptInterface
    public String getConfig() {
        try {
            JSONObject out = new JSONObject();
            String key = AiClient.apiKey(activity);
            out.put("hasKey", key != null && !key.isEmpty());
            out.put("model", AiClient.model(activity));
            out.put("baseUrl", AiClient.BASE_URL);
            return out.toString();
        } catch (Exception error) {
            return "{\"hasKey\":false,\"model\":\"" + AiClient.DEFAULT_MODEL
                    + "\",\"baseUrl\":\"" + AiClient.BASE_URL + "\"}";
        }
    }

    @JavascriptInterface
    public void setApiKey(String key) {
        AiClient.prefs(activity).edit().putString(AiClient.KEY_API, key == null ? "" : key.trim()).apply();
    }

    @JavascriptInterface
    public void setModel(String model) {
        AiClient.prefs(activity).edit().putString(
                AiClient.KEY_MODEL,
                model == null || model.trim().isEmpty() ? AiClient.DEFAULT_MODEL : model.trim()).apply();
    }

    // ---------------- 对话历史（与宠物菜单共用） ----------------

    @JavascriptInterface
    public String getChatHistory() {
        return AiClient.chatHistory(activity);
    }

    @JavascriptInterface
    public void saveChatHistory(String json) {
        AiClient.saveChatHistory(activity, json);
    }

    // ---------------- 语音（系统 TTS / MultiTTS） ----------------

    @JavascriptInterface
    public void speak(String text) {
        speakWithAction(text, null);
    }

    /** 带动作标签朗读：语音真正开始时，顺带让宠物做这个动作。 */
    @JavascriptInterface
    public void speakWithAction(String text, final String action) {
        TtsSpeaker.speak(activity, text, new TtsSpeaker.Callback() {
            @Override
            public void onStart() {
                sendAction(FloatingPetService.ACTION_TALK_START, action);
            }

            @Override
            public void onDone() {
                sendAction(FloatingPetService.ACTION_TALK_STOP);
            }
        });
    }

    @JavascriptInterface
    public void stopSpeak() {
        TtsSpeaker.stop();
    }

    @JavascriptInterface
    public boolean isTtsEnabled() {
        return TtsSpeaker.isEnabled(activity);
    }

    @JavascriptInterface
    public void setTtsEnabled(boolean enabled) {
        TtsSpeaker.setEnabled(activity, enabled);
    }

    @JavascriptInterface
    public String getTtsStatus() {
        try {
            JSONObject out = new JSONObject();
            out.put("enabled", TtsSpeaker.isEnabled(activity));
            out.put("engine", TtsSpeaker.describe(activity));
            return out.toString();
        } catch (Exception error) {
            return "{\"enabled\":true,\"engine\":\"系统默认语音引擎\"}";
        }
    }

    // ---------------- 网络 ----------------

    @JavascriptInterface
    public void listModels(final String callbackId) {
        run(callbackId, new Task() {
            @Override
            public String call() throws Exception {
                return AiClient.listModels(activity);
            }
        });
    }

    @JavascriptInterface
    public void testConnection(final String callbackId) {
        run(callbackId, new Task() {
            @Override
            public String call() throws Exception {
                return AiClient.test(activity);
            }
        });
    }

    @JavascriptInterface
    public void getBalance(final String callbackId) {
        run(callbackId, new Task() {
            @Override
            public String call() throws Exception {
                return AiClient.balance(activity);
            }
        });
    }

    @JavascriptInterface
    public void chat(final String callbackId, final String messagesJson) {
        run(callbackId, new Task() {
            @Override
            public String call() throws Exception {
                return AiClient.chat(activity, messagesJson);
            }
        });
    }

    private interface Task {
        String call() throws Exception;
    }

    private void run(final String callbackId, final Task task) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String payload;
                try {
                    payload = task.call();
                } catch (AiClient.ApiError error) {
                    payload = AiClient.errorJson(error.getMessage(), error.code, error.body);
                } catch (Exception error) {
                    payload = AiClient.errorJson(String.valueOf(error.getMessage()), 0, null);
                }
                deliver(callbackId, payload);
            }
        }).start();
    }

    private void deliver(final String callbackId, final String json) {
        main.post(new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                try {
                    webView.evaluateJavascript(
                            "window.__aiCallback(" + quote(callbackId) + "," + json + ");", null);
                } catch (Exception ignored) {
                    // WebView 已销毁
                }
            }
        });
    }

    private static String quote(String text) {
        if (text == null) return "null";
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < text.length(); i += 1) {
            char c = text.charAt(i);
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c == '\n') out.append("\\n");
            else out.append(c);
        }
        return out.append('"').toString();
    }
}
