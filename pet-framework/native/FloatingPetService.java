package com.demo2apk.floatingpet;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 悬浮桌宠：前台服务 + 两个独立的透明悬浮窗。
 *
 *   宠物窗：只有宠物那么大，位置由用户拖拽决定。
 *   菜单窗：按需创建，装三级级联菜单，可以单独拖动——因为它是另一个窗口，
 *           拖菜单不会带着宠物一起走，也不需要把宠物窗撑大。
 *
 * 两个窗口都必须 FLAG_NOT_FOCUSABLE，否则会抢输入法焦点。
 * 窗口内的 WebView 用 MATCH_PARENT：窗口尺寸由 JS 上报后 updateViewLayout 改变，
 * 子 View 写死像素会导致页面按旧视口排版。
 *
 * 拖动由网页上报屏幕坐标增量（screenX/screenY × dpr），这里只做 updateViewLayout；
 * 用 clientX 会形成「窗口跟着手指动 → 相对坐标不变 → 增量为 0」的反馈死锁。
 */
public class FloatingPetService extends Service {

    public static final String ACTION_START = "com.demo2apk.floatingpet.action.START";
    public static final String ACTION_STOP = "com.demo2apk.floatingpet.action.STOP";
    public static final String ACTION_UNLOCK = "com.demo2apk.floatingpet.action.UNLOCK";
    public static final String ACTION_LOCK = "com.demo2apk.floatingpet.action.LOCK";
    public static final String ACTION_CENTER = "com.demo2apk.floatingpet.action.CENTER";
    public static final String ACTION_RESIZE = "com.demo2apk.floatingpet.action.RESIZE";
    public static final String ACTION_RELOAD = "com.demo2apk.floatingpet.action.RELOAD";
    public static final String ACTION_SHOW = "com.demo2apk.floatingpet.action.SHOW";
    public static final String ACTION_HIDE = "com.demo2apk.floatingpet.action.HIDE";
    public static final String ACTION_TALK_START = "com.demo2apk.floatingpet.action.TALK_START";
    public static final String ACTION_TALK_STOP = "com.demo2apk.floatingpet.action.TALK_STOP";

    /** AI 回复里的动作标签：[动作:跳]，也兼容全角冒号与空格 */
    private static final java.util.regex.Pattern ACTION_TAG =
            java.util.regex.Pattern.compile("\\[\\s*动作\\s*[:：]\\s*([^\\]\\s]+)\\s*\\]");

    /** 锁定 = 窗口 FLAG_NOT_TOUCHABLE：宠物纯观赏，触摸全部穿透到下层桌面 */
    public static final String PREFS = "dsh_pet_overlay";

    /** 供 TtsSpeaker 等外部类读同一份偏好 */
    public static SharedPreferences prefsOf(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
    public static final String KEY_LOCKED = "locked";
    /** 桌宠大小（dp 宽）：小 140 / 中 180 / 大 220 */
    public static final String KEY_SIZE = "sizeDp";
    /** 固定不动：不自己走、不自己转身 */
    public static final String KEY_FIXED = "fixed";
    /** 宠物身体离屏幕边缘的最小距离（dp） */
    public static final int EDGE_MARGIN_DP = 12;

    /** 和 App 对话页共用的人设 */
    private static final String PERSONA =
            "你是主人手机上的桌面宠物「鲸鱼娘」：蓝发小女仆，语气自然、俏皮、亲近。回答简短，20~60 字，不要说自己是 AI，不要长篇大论。"
                    + "如果这句话有明显的动作或情绪，就在开头加一个动作标签，格式如[动作:笑]；"
                    + "只能从 跳、哭、生气、笑、吃、撒娇、委屈 里选一个，不要解释这个标签。";
    /** 服务是否活着：Activity 侧据此决定要不要发解锁 Intent（否则会顺手拉起一只宠物） */
    public static boolean running = false;

    private static final String CHANNEL_ID = "dsh_pet_overlay";
    private static final int NOTIFICATION_ID = 40961;
    private static final String PET_URL = "file:///android_asset/www/overlay.html";
    private static final String MENU_URL = "file:///android_asset/www/menu.html";

    private WindowManager windowManager;
    private FrameLayout container;
    private WebView webView;
    private WindowManager.LayoutParams params;

    private FrameLayout menuContainer;
    private WebView menuWebView;
    private WindowManager.LayoutParams menuParams;
    private TextView bubbleView;
    private int bubbleSeq = 0;
    /** App 在前台时把宠物藏起来，回到桌面/别的应用再出现 */
    private boolean petHidden = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_UNLOCK.equals(intent.getAction())) {
            setLockedPref(false);
            applyTouchable();
            return START_STICKY;
        }
        if (intent != null && ACTION_LOCK.equals(intent.getAction())) {
            setLockedPref(true);
            applyTouchable();
            return START_STICKY;
        }
        if (intent != null && ACTION_CENTER.equals(intent.getAction())) {
            callPet("__petCenter", null);
            return START_STICKY;
        }
        if (intent != null && ACTION_RESIZE.equals(intent.getAction())) {
            applySizeFromPrefs();
            return START_STICKY;
        }
        if (intent != null && ACTION_RELOAD.equals(intent.getAction())) {
            callPet("__petSettingsChanged", null);
            return START_STICKY;
        }
        if (intent != null && ACTION_HIDE.equals(intent.getAction())) {
            setPetHidden(true);
            return START_STICKY;
        }
        if (intent != null && ACTION_SHOW.equals(intent.getAction())) {
            setPetHidden(false);
            return START_STICKY;
        }
        if (intent != null && ACTION_TALK_START.equals(intent.getAction())) {
            callPet("__petTalkStart", null);
            String action = intent.getStringExtra("action");
            if (action != null && isActionAllowed(action)) {
                callPet("__petApplyAction", action);
            }
            return START_STICKY;
        }
        if (intent != null && ACTION_TALK_STOP.equals(intent.getAction())) {
            callPet("__petTalkStop", null);
            return START_STICKY;
        }
        ensureForeground();
        if (webView == null) {
            showOverlay();
        }
        return START_STICKY;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
    }

    @Override
    public void onDestroy() {
        running = false;
        closeMenuWindow();
        removeOverlay();
        super.onDestroy();
    }

    // ---------------- 宠物窗 ----------------

    private void showOverlay() {
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) {
            stopSelf();
            return;
        }

        // 窗口 = 舞台裁切框：素材 640×360，只保留 x120..520 / y20..340（400×320），
        // 让角色填满窗口而不是缩在中间 37.5% 里。宽高比 = 400:320 = 1.25。
        final int width = dp(sizeDp());
        final int height = Math.round(width * 320f / 400f);

        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;

        params = new WindowManager.LayoutParams(width, height, overlayType(), flags, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        int[] screen = screenSize();
        params.x = dp(16);
        params.y = Math.round(screen[1] * 0.28f);

        container = new FrameLayout(this);
        container.setBackgroundColor(Color.TRANSPARENT);

        webView = buildWebView(new NativeBridge(), PET_URL);
        container.addView(
                webView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));

        try {
            windowManager.addView(container, params);
            applyTouchable();
        } catch (Exception error) {
            webView = null;
            container = null;
            stopSelf();
        }
    }

    private void removeOverlay() {
        if (windowManager != null && container != null) {
            try {
                windowManager.removeView(container);
            } catch (Exception ignored) {
                // 已经被系统移除
            }
        }
        if (webView != null) {
            try {
                webView.destroy();
            } catch (Exception ignored) {
                // ignore
            }
        }
        webView = null;
        container = null;
    }

    // ---------------- 菜单窗 ----------------

    private void openMenuWindow() {
        if (menuWebView != null || windowManager == null || params == null) {
            return;
        }

        int width = dp(240);
        int height = dp(320);
        int[] screen = screenSize();

        int x = params.x + params.width + dp(8);
        if (x + width > screen[0] - dp(4)) {
            x = params.x - width - dp(8);
        }
        if (x < dp(4)) {
            x = dp(4);
        }
        int y = params.y + (params.height - height) / 2;
        y = Math.max(dp(4), Math.min(screen[1] - height - dp(4), y));

        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;

        menuParams = new WindowManager.LayoutParams(
                width, height, overlayType(), flags, PixelFormat.TRANSLUCENT);
        menuParams.gravity = Gravity.TOP | Gravity.START;
        menuParams.x = x;
        menuParams.y = y;

        menuContainer = new FrameLayout(this);
        menuContainer.setBackgroundColor(Color.TRANSPARENT);

        menuWebView = buildWebView(new MenuBridge(), MENU_URL);
        menuContainer.addView(
                menuWebView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));

        try {
            windowManager.addView(menuContainer, menuParams);
        } catch (Exception error) {
            closeMenuWindow();
        }
    }

    private void closeMenuWindow() {
        if (windowManager != null && menuContainer != null) {
            try {
                windowManager.removeView(menuContainer);
            } catch (Exception ignored) {
                // 已经被系统移除
            }
        }
        if (menuWebView != null) {
            try {
                menuWebView.destroy();
            } catch (Exception ignored) {
                // ignore
            }
        }
        menuContainer = null;
        menuWebView = null;
        menuParams = null;
    }

    /** 让宠物页面执行一个动作（菜单选中后调用）。 */
    private void callPet(final String function, final String argument) {
        final WebView view = webView;
        if (view == null) {
            return;
        }
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    String script = "window." + function + "(" + (argument == null ? "" : quote(argument)) + ");";
                    view.evaluateJavascript(script, null);
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
            if (c == '"' || c == '\\') {
                out.append('\\').append(c);
            } else if (c == '\n') {
                out.append("\\n");
            } else {
                out.append(c);
            }
        }
        return out.append('"').toString();
    }

    // ---------------- 通用 ----------------

    private WebView buildWebView(Object bridge, String url) {
        WebView view = new WebView(this);
        view.setBackgroundColor(Color.TRANSPARENT);
        view.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        view.setVerticalScrollBarEnabled(false);
        view.setHorizontalScrollBarEnabled(false);
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        if (bridge instanceof NativeBridge) {
            view.addJavascriptInterface((NativeBridge) bridge, "PetNative");
        } else if (bridge instanceof MenuBridge) {
            view.addJavascriptInterface((MenuBridge) bridge, "PetMenu");
        }
        view.setWebViewClient(new WebViewClient());
        view.loadUrl(url);
        return view;
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private int sizeDp() {
        int value = getSharedPreferences(PREFS, MODE_PRIVATE).getInt(KEY_SIZE, 180);
        return Math.max(120, Math.min(300, value));
    }

    /** 按设置里的宽度重建窗口，并把位置夹回「离边缘 EDGE_MARGIN_DP」以内。 */
    private void applySizeFromPrefs() {
        if (params == null || container == null || windowManager == null) {
            return;
        }
        int width = dp(sizeDp());
        int height = Math.round(width * 320f / 400f);
        int[] screen = screenSize();
        int margin = dp(EDGE_MARGIN_DP);
        params.width = width;
        params.height = height;
        params.x = Math.max(margin, Math.min(screen[0] - width - margin, params.x));
        params.y = Math.max(margin, Math.min(screen[1] - height - margin, params.y));
        try {
            windowManager.updateViewLayout(container, params);
        } catch (Exception ignored) {
            // 窗口已移除
        }
        callPet("__petSettingsChanged", null);
    }

    private boolean isLockedPref() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_LOCKED, false);
    }

    private void setLockedPref(boolean locked) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_LOCKED, locked).apply();
    }

    private void setPetHidden(boolean hidden) {
        petHidden = hidden;
        if (container != null) {
            container.setVisibility(hidden ? View.INVISIBLE : View.VISIBLE);
        }
        applyTouchable();
    }

    /** 锁定 = 宠物窗 FLAG_NOT_TOUCHABLE，触摸全部穿到下层；解锁 = 恢复可拖可点。 */
    private void applyTouchable() {
        if (params == null || container == null || windowManager == null) {
            return;
        }
        int notTouchable = WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        if (isLockedPref() || petHidden) {
            params.flags |= notTouchable;
        } else {
            params.flags &= ~notTouchable;
        }
        try {
            windowManager.updateViewLayout(container, params);
        } catch (Exception ignored) {
            // 窗口已移除
        }
    }

    /** 全屏物理像素尺寸（含状态栏/导航栏）。Service 拿不到 Activity 的窗口几何，
     *  WindowMetrics 在服务上下文里语义不稳，所以统一用 getRealMetrics。 */
    private int[] screenSize() {
        if (windowManager == null) {
            windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        }
        DisplayMetrics metrics = new DisplayMetrics();
        if (windowManager != null) {
            windowManager.getDefaultDisplay().getRealMetrics(metrics);
        } else {
            metrics = getResources().getDisplayMetrics();
        }
        return new int[] { metrics.widthPixels, metrics.heightPixels };
    }

    // ---------------- 宠物页桥 ----------------

    public class NativeBridge {

        @JavascriptInterface
        public void moveBy(final int dx, final int dy) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (params == null || container == null || windowManager == null) {
                        return;
                    }
                    params.x += dx;
                    params.y += dy;
                    try {
                        windowManager.updateViewLayout(container, params);
                    } catch (Exception ignored) {
                        // 窗口已销毁
                    }
                }
            });
        }

        @JavascriptInterface
        public void moveTo(final int x, final int y) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (params == null || container == null || windowManager == null) {
                        return;
                    }
                    params.x = x;
                    params.y = y;
                    try {
                        windowManager.updateViewLayout(container, params);
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            });
        }

        @JavascriptInterface
        public void close() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    stopSelf();
                }
            });
        }

        @JavascriptInterface
        public String getScreenInfo() {
            int[] size = screenSize();
            float density = getResources().getDisplayMetrics().density;
            return "{\"width\":" + size[0] + ",\"height\":" + size[1] + ",\"density\":" + density + "}";
        }

        @JavascriptInterface
        public String getWindowRect() {
            if (params == null) return "{}";
            return "{\"x\":" + params.x + ",\"y\":" + params.y
                    + ",\"w\":" + params.width + ",\"h\":" + params.height + "}";
        }

        @JavascriptInterface
        public void setRect(final int x, final int y, final int width, final int height) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (params == null || container == null || windowManager == null) {
                        return;
                    }
                    params.x = x;
                    params.y = y;
                    params.width = width;
                    params.height = height;
                    try {
                        windowManager.updateViewLayout(container, params);
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            });
        }

        @JavascriptInterface
        public void setLocked(final boolean locked) {
            setLockedPref(locked);
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    applyTouchable();
                }
            });
        }

        @JavascriptInterface
        public void openMenu() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    openMenuWindow();
                }
            });
        }

        @JavascriptInterface
        public void closeMenu() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    closeMenuWindow();
                }
            });
        }

        @JavascriptInterface
        public boolean isMenuOpen() {
            return menuWebView != null;
        }

        @JavascriptInterface
        public String getPetSettings() {
            boolean fixed = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_FIXED, false);
            return "{\"sizeDp\":" + sizeDp() + ",\"fixed\":" + fixed
                    + ",\"marginDp\":" + EDGE_MARGIN_DP + "}";
        }
    }

    // ---------------- 菜单页桥 ----------------

    public class MenuBridge {

        @JavascriptInterface
        public String getScreenInfo() {
            int[] size = screenSize();
            float density = getResources().getDisplayMetrics().density;
            return "{\"width\":" + size[0] + ",\"height\":" + size[1] + ",\"density\":" + density + "}";
        }

        @JavascriptInterface
        public String getPetRect() {
            if (params == null) return "{}";
            return "{\"x\":" + params.x + ",\"y\":" + params.y
                    + ",\"w\":" + params.width + ",\"h\":" + params.height + "}";
        }

        @JavascriptInterface
        public String getMenuRect() {
            if (menuParams == null) return "{}";
            return "{\"x\":" + menuParams.x + ",\"y\":" + menuParams.y
                    + ",\"w\":" + menuParams.width + ",\"h\":" + menuParams.height + "}";
        }

        /** 菜单页算好自己的内容尺寸后上报（CSS px），这里换算成物理像素并夹到屏幕内。 */
        @JavascriptInterface
        public void resize(final int widthCss, final int heightCss) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (menuParams == null || menuContainer == null || windowManager == null) {
                        return;
                    }
                    int[] screen = screenSize();
                    float density = getResources().getDisplayMetrics().density;
                    int width = Math.max(dp(60), Math.min(screen[0], Math.round(widthCss * density)));
                    int height = Math.max(dp(40), Math.min(screen[1], Math.round(heightCss * density)));
                    menuParams.width = width;
                    menuParams.height = height;
                    try {
                        windowManager.updateViewLayout(menuContainer, menuParams);
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            });
        }

        @JavascriptInterface
        public void moveBy(final int dx, final int dy) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (menuParams == null || menuContainer == null || windowManager == null) {
                        return;
                    }
                    menuParams.x += dx;
                    menuParams.y += dy;
                    try {
                        windowManager.updateViewLayout(menuContainer, menuParams);
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            });
        }

        @JavascriptInterface
        public void moveTo(final int x, final int y) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (menuParams == null || menuContainer == null || windowManager == null) {
                        return;
                    }
                    menuParams.x = x;
                    menuParams.y = y;
                    try {
                        windowManager.updateViewLayout(menuContainer, menuParams);
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            });
        }

        @JavascriptInterface
        public void pick(final String name) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    closeMenuWindow();
                    callPet("__petPlay", name);
                }
            });
        }

        @JavascriptInterface
        public void centerPet() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    closeMenuWindow();
                    callPet("__petCenter", null);
                }
            });
        }

        @JavascriptInterface
        public void lock() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    setLockedPref(true);
                    applyTouchable();
                    closeMenuWindow();
                }
            });
        }

        @JavascriptInterface
        public void close() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    closeMenuWindow();
                }
            });
        }

        @JavascriptInterface
        public void closePet() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    closeMenuWindow();
                    stopSelf();
                }
            });
        }

        /** 对话输入需要键盘：临时把菜单窗变成可聚焦窗口，并主动弹起输入法。 */
        @JavascriptInterface
        public void setFocusable(final boolean focusable) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (menuParams == null || menuContainer == null || windowManager == null) {
                        return;
                    }
                    if (focusable) {
                        menuParams.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
                        // 允许窗口外的触摸落到下层（宠物窗）：点宠物 = 取消输入
                        menuParams.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
                        menuParams.softInputMode =
                                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                                        | WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE;
                    } else {
                        menuParams.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
                    }
                    try {
                        windowManager.updateViewLayout(menuContainer, menuParams);
                    } catch (Exception ignored) {
                        // ignore
                    }
                    if (focusable && menuWebView != null) {
                        menuWebView.requestFocus();
                        try {
                            InputMethodManager imm =
                                    (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                            if (imm != null) {
                                imm.showSoftInput(menuWebView, InputMethodManager.SHOW_IMPLICIT);
                            }
                        } catch (Exception ignored) {
                            // 部分 ROM 不给悬浮窗输入法
                        }
                    }
                }
            });
        }

        /** 余额气泡：金额 + 当前是否高峰期（00:30–08:30 为低谷）。 */
        @JavascriptInterface
        public void showBalance() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    closeMenuWindow();
                }
            });
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String payload;
                    try {
                        JSONObject root = new JSONObject(AiClient.balance(FloatingPetService.this));
                        JSONObject data = root.optJSONObject("data");
                        JSONArray infos = data == null ? null : data.optJSONArray("balance_infos");
                        JSONObject info =
                                infos != null && infos.length() > 0 ? infos.optJSONObject(0) : null;

                        Calendar now = Calendar.getInstance();
                        int minutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
                        boolean offPeak = minutes >= 30 && minutes < 8 * 60 + 30;

                        JSONObject out = new JSONObject();
                        out.put("kind", "balance");
                        out.put("amount", info == null ? "—" : info.optString("total_balance", "—"));
                        out.put("currency", info == null ? "CNY" : info.optString("currency", "CNY"));
                        out.put("peak", !offPeak);
                        payload = out.toString();
                    } catch (AiClient.ApiError error) {
                        payload = bubbleError(error.getMessage());
                    } catch (Exception error) {
                        payload = bubbleError("余额查询失败");
                    }
                    showBubble(payload);
                }
            }).start();
        }

        /** 对话：菜单收起 → 请求模型 → 宠物头顶气泡回复；历史与 App 对话页共用。 */
        @JavascriptInterface
        public void chatSend(final String text) {
            final String message = text == null ? "" : text.trim();
            if (message.isEmpty()) {
                return;
            }
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    closeMenuWindow();
                }
            });
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String payload;
                    String replyForSpeech = null;
                    String actionForSpeech = null;
                    try {
                        JSONArray history = new JSONArray(AiClient.chatHistory(FloatingPetService.this));
                        JSONArray messages = new JSONArray();
                        JSONObject system = new JSONObject();
                        system.put("role", "system");
                        system.put("content", PERSONA);
                        messages.put(system);
                        for (int i = Math.max(0, history.length() - 16); i < history.length(); i += 1) {
                            messages.put(history.getJSONObject(i));
                        }
                        JSONObject user = new JSONObject();
                        user.put("role", "user");
                        user.put("content", message);
                        messages.put(user);

                        JSONObject result = new JSONObject(
                                AiClient.chat(FloatingPetService.this, messages.toString()));
                        String reply = result.optString("content", "");
                        // 先把 [动作:x] 剥掉：气泡、TTS、历史都只用干净文本
                        String[] split = splitAction(reply);
                        reply = split[0];
                        actionForSpeech = split[1];
                        history.put(user);
                        JSONObject assistant = new JSONObject();
                        assistant.put("role", "assistant");
                        assistant.put("content", reply);
                        history.put(assistant);
                        AiClient.saveChatHistory(FloatingPetService.this, history.toString());

                        JSONObject out = new JSONObject();
                        out.put("kind", "chat");
                        out.put("text", reply);
                        payload = out.toString();
                        replyForSpeech = reply;
                    } catch (AiClient.ApiError error) {
                        payload = bubbleError(error.getMessage());
                    } catch (Exception error) {
                        payload = bubbleError("对话失败");
                    }

                    // 气泡与口型都挂在 TTS 的 onStart 上：声音真正出来的那一刻才显示，
                    // 引擎没回调时由 TtsSpeaker 的 1.5s 兜底触发。
                    final String payloadFinal = payload;
                    final String replyFinal = replyForSpeech;
                    final String actionFinal = actionForSpeech;
                    if (replyFinal != null && TtsSpeaker.isEnabled(FloatingPetService.this)) {
                        TtsSpeaker.speak(FloatingPetService.this, replyFinal, new TtsSpeaker.Callback() {
                            @Override
                            public void onStart() {
                                callPet("__petTalkStart", null);
                                if (actionFinal != null) callPet("__petApplyAction", actionFinal);
                                showBubble(payloadFinal, 0);
                            }

                            @Override
                            public void onDone() {
                                callPet("__petTalkStop", null);
                                hideBubbleAfter(1000);
                            }
                        });
                    } else {
                        showBubble(payloadFinal, 8000);
                        if (actionFinal != null) callPet("__petApplyAction", actionFinal);
                    }
                }
            }).start();
        }
    }

    // ---------------- 前台通知 ----------------

    /** 剥掉所有 [动作:x] 标签；返回 {干净文本, 第一个白名单动作或 null}。 */
    private static String[] splitAction(String text) {
        if (text == null) return new String[]{"", null};
        java.util.regex.Matcher matcher = ACTION_TAG.matcher(text);
        StringBuilder clean = new StringBuilder();
        String action = null;
        int last = 0;
        while (matcher.find()) {
            clean.append(text, last, matcher.start());
            String name = matcher.group(1);
            if (action == null && isActionAllowed(name)) action = name;
            last = matcher.end();
        }
        clean.append(text, last, text.length());
        return new String[]{clean.toString().replaceAll("\\s{2,}", " ").trim(), action};
    }

    private static boolean isActionAllowed(String name) {
        return "跳".equals(name) || "哭".equals(name) || "生气".equals(name) || "笑".equals(name)
                || "吃".equals(name) || "撒娇".equals(name) || "委屈".equals(name);
    }

    private static String bubbleError(String message) {        try {
            JSONObject out = new JSONObject();
            out.put("kind", "error");
            out.put("text", message == null ? "出错了" : message);
            return out.toString();
        } catch (Exception error) {
            return "{\"kind\":\"error\",\"text\":\"出错了\"}";
        }
    }

    /**
     * 宠物头顶的气泡：独立的小悬浮窗（不可点、不抢焦点）。
     * 不塞进宠物窗——宠物窗只有宠物那么大，气泡画超出边界会被裁掉。
     */
    private void showBubble(final String payload) {
        showBubble(payload, 8000);
    }

    /** autoHideMs = 0 表示不自动收（由 TTS 的 onDone 决定何时消失）。 */
    private void showBubble(final String payload, final int autoHideMs) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject data = new JSONObject(payload);
                    String kind = data.optString("kind", "chat");
                    String text;
                    int accent = 0;

                    if ("balance".equals(kind)) {
                        String amount = data.optString("amount", "—");
                        String currency = data.optString("currency", "CNY");
                        boolean peak = data.optBoolean("peak", true);
                        String unit = "CNY".equals(currency) ? "¥" : currency + " ";
                        text = "余额（" + (peak ? "峰" : "谷") + "）" + unit + amount;
                        accent = peak ? 0xFFE53935 : 0xFF2E9E4F;
                    } else {
                        text = data.optString("text", "");
                        if ("error".equals(kind)) accent = 0xFFD94F3D;
                    }
                    if (text.isEmpty()) return;

                    removeBubble();

                    TextView view = new TextView(FloatingPetService.this);
                    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
                    view.setTextColor(0xFF2B2B2B);
                    view.setPadding(dp(14), dp(9), dp(14), dp(9));
                    GradientDrawable background = new GradientDrawable();
                    background.setColor(0xFFFFFFFF);
                    background.setCornerRadius(dp(12));
                    view.setBackground(background);
                    view.setElevation(dp(4));

                    if (accent != 0) {
                        SpannableString span = new SpannableString(text);
                        int start = text.indexOf('（');
                        int end = text.indexOf('）');
                        if (start >= 0 && end > start) {
                            span.setSpan(new ForegroundColorSpan(accent), start + 1, end,
                                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        } else if ("error".equals(kind)) {
                            span.setSpan(new ForegroundColorSpan(accent), 0, text.length(),
                                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        }
                        view.setText(span);
                    } else {
                        view.setText(text);
                    }

                    int maxWidth = dp(240);
                    view.measure(
                            View.MeasureSpec.makeMeasureSpec(maxWidth, View.MeasureSpec.AT_MOST),
                            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
                    int width = Math.max(dp(60), view.getMeasuredWidth());
                    int height = view.getMeasuredHeight();

                    int[] screen = screenSize();
                    int x = params == null ? dp(4) : params.x + (params.width - width) / 2;
                    int y = params == null ? dp(4) : params.y - height - dp(10);
                    x = Math.max(dp(4), Math.min(screen[0] - width - dp(4), x));
                    y = Math.max(dp(4), y);

                    WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                            width, height, overlayType(),
                            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                            PixelFormat.TRANSLUCENT);
                    lp.gravity = Gravity.TOP | Gravity.START;
                    lp.x = x;
                    lp.y = y;

                    windowManager.addView(view, lp);
                    bubbleView = view;

                    final int seq = ++bubbleSeq;
                    if (autoHideMs > 0) {
                        mainHandler.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                if (seq == bubbleSeq) removeBubble();
                            }
                        }, autoHideMs);
                    }
                } catch (Exception ignored) {
                    // 气泡失败不影响宠物
                }
            }
        });
    }

    private void removeBubble() {
        if (bubbleView != null && windowManager != null) {
            try {
                windowManager.removeView(bubbleView);
            } catch (Exception ignored) {
                // ignore
            }
        }
        bubbleView = null;
    }

    /** 念完之后延迟收气泡（期间如果又冒了新气泡，就不动它）。 */
    private void hideBubbleAfter(final int delayMs) {
        final int seq = bubbleSeq;
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (seq == bubbleSeq) removeBubble();
            }
        }, delayMs);
    }

    private void ensureForeground() {
        try {
            startForeground(NOTIFICATION_ID, buildNotification());
        } catch (Exception ignored) {
            // 缺少前台服务类型声明 / 系统限制时不让整个服务崩掉，悬浮窗仍然尝试创建
        }
    }

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null && manager.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID, "悬浮桌宠", NotificationManager.IMPORTANCE_LOW);
                channel.setShowBadge(false);
                manager.createNotificationChannel(channel);
            }
        }

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        builder.setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle("悬浮桌宠正在运行")
                .setContentText("点按回到应用")
                .setOngoing(true);

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, pendingFlags));
        }

        return builder.build();
    }
}


