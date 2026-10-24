package com.demo2apk.floatingpet;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.Locale;

/**
 * 用系统 TTS 引擎朗读宠物回复（Android 标准 TextToSpeech，不依赖任何第三方私有接口）。
 *
 * 关键：说话的开始/结束以引擎的 UtteranceProgressListener 为准，而不是"调完 speak 就算开始"。
 * 引擎首句要绑定 + 合成，有几百毫秒延迟；把气泡和口型挂在 onStart 上，音画才能对齐。
 * 引擎不回调时用 1.5s 兜底，避免"只出声不显示"。
 */
public final class TtsSpeaker {

    /** 和悬浮窗共用同一份 prefs */
    public static final String KEY_ENABLED = "ttsEnabled";
    private static final int MAX_CHARS = 120;
    private static final long FALLBACK_START_MS = 1500;

    /** 一句话的生命周期回调（都在主线程触发） */
    public interface Callback {
        void onStart();

        void onDone();
    }

    private static TextToSpeech engine;
    private static boolean ready = false;
    private static boolean initializing = false;
    private static String pending = null;

    private static Callback current;
    private static boolean started = false;
    private static Runnable fallback = null;

    private static final Handler main = new Handler(Looper.getMainLooper());

    private TtsSpeaker() {}

    private static SharedPreferences prefs(Context context) {
        return FloatingPetService.prefsOf(context);
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, true);
    }

    public static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
        if (!enabled) stop();
    }

    public static void warmUp(final Context context) {
        if (context == null) return;
        main.post(new Runnable() {
            @Override
            public void run() {
                ensureInit(context.getApplicationContext());
            }
        });
    }

    public static void speak(Context context, String text) {
        speak(context, text, null);
    }

    public static void speak(final Context context, final String text, final Callback callback) {
        if (context == null || text == null) return;
        final String clipped = text.length() > MAX_CHARS ? text.substring(0, MAX_CHARS) : text;
        if (clipped.trim().isEmpty()) return;
        if (!isEnabled(context)) return;

        main.post(new Runnable() {
            @Override
            public void run() {
                finishCurrent();
                current = callback;
                started = false;
                pending = clipped;
                ensureInit(context.getApplicationContext());
                if (ready) flush();
                if (current != null) {
                    fallback = new Runnable() {
                        @Override
                        public void run() {
                            if (current != null && !started) {
                                started = true;
                                current.onStart();
                            }
                        }
                    };
                    main.postDelayed(fallback, FALLBACK_START_MS);
                }
            }
        });
    }

    public static void stop() {
        main.post(new Runnable() {
            @Override
            public void run() {
                finishCurrent();
                pending = null;
                if (engine != null) {
                    try {
                        engine.stop();
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            }
        });
    }

    public static String describe(Context context) {
        try {
            if (engine != null) {
                String name = engine.getDefaultEngine();
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) {
            // ignore
        }
        return "系统默认语音引擎";
    }

    // ---------------- 内部 ----------------

    /** 结束上一句：取消兜底、补一次 onDone，避免气泡/口型卡在"说话中"。 */
    private static void finishCurrent() {
        if (fallback != null) {
            main.removeCallbacks(fallback);
            fallback = null;
        }
        if (current != null && started) {
            current.onDone();
        }
        current = null;
        started = false;
    }

    private static void ensureInit(final Context context) {
        if (engine != null || initializing) return;
        initializing = true;
        try {
            engine = new TextToSpeech(context, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    initializing = false;
                    ready = status == TextToSpeech.SUCCESS;
                    if (!ready) return;
                    try {
                        engine.setLanguage(Locale.CHINA);
                    } catch (Exception ignored) {
                        // 引擎不支持中文就用默认语言
                    }
                    try {
                        android.media.AudioAttributes attributes = new android.media.AudioAttributes.Builder()
                                .setUsage(android.media.AudioAttributes.USAGE_ASSISTANT)
                                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build();
                        engine.setAudioAttributes(attributes);
                    } catch (Exception ignored) {
                        // 老引擎不支持就跳过
                    }
                    try {
                        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override
                            public void onStart(String utteranceId) {
                                main.post(new Runnable() {
                                    @Override
                                    public void run() {
                                        if (current != null && !started) {
                                            started = true;
                                            if (fallback != null) {
                                                main.removeCallbacks(fallback);
                                                fallback = null;
                                            }
                                            current.onStart();
                                        }
                                    }
                                });
                            }

                            @Override
                            public void onDone(String utteranceId) {
                                main.post(new Runnable() {
                                    @Override
                                    public void run() {
                                        finishCurrent();
                                    }
                                });
                            }

                            @Override
                            public void onError(String utteranceId) {
                                main.post(new Runnable() {
                                    @Override
                                    public void run() {
                                        finishCurrent();
                                    }
                                });
                            }

                            @Override
                            public void onStop(String utteranceId, boolean interrupted) {
                                main.post(new Runnable() {
                                    @Override
                                    public void run() {
                                        finishCurrent();
                                    }
                                });
                            }
                        });
                    } catch (Exception ignored) {
                        // 引擎不支持进度回调：靠 1.5s 兜底
                    }
                    flush();
                }
            });
        } catch (Exception error) {
            initializing = false;
            engine = null;
        }
    }

    private static void flush() {
        if (!ready || engine == null || pending == null) return;
        final String text = pending;
        pending = null;
        try {
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "pet-" + System.currentTimeMillis());
        } catch (Exception ignored) {
            // 念不出来就算了，聊天不受影响
        }
    }
}
