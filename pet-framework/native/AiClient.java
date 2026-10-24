package com.demo2apk.floatingpet;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * DeepSeek 接口的最小客户端。App 的桥和宠物菜单窗共用这一份。
 *
 * BASE_URL 锁死，不对外暴露可编辑入口；Key / 模型 / 对话历史都存在 SharedPreferences。
 * 所有方法都在后台线程被调用（调用方负责），这里只做同步 HTTP + JSON。
 */
public final class AiClient {

    public static final String PREFS = "dsh_pet_app";
    public static final String KEY_API = "api_key";
    public static final String KEY_MODEL = "model";
    public static final String KEY_CHAT = "chat_history";
    public static final String BASE_URL = "https://api.deepseek.com";
    public static final String DEFAULT_MODEL = "deepseek-chat";

    private AiClient() {}

    public static class ApiError extends Exception {
        public final int code;
        public final String body;

        ApiError(int code, String body) {
            super(messageFor(code));
            this.code = code;
            this.body = body;
        }

        private static String messageFor(int code) {
            switch (code) {
                case 401:
                    return "API Key 无效或已失效";
                case 402:
                    return "账户余额不足";
                case 429:
                    return "请求太频繁，稍后再试";
                case 500:
                case 502:
                case 503:
                    return "服务端暂时不可用";
                default:
                    return "请求失败（HTTP " + code + "）";
            }
        }
    }

    public static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String apiKey(Context context) {
        String key = prefs(context).getString(KEY_API, "");
        return key == null ? "" : key;
    }

    public static String model(Context context) {
        String value = prefs(context).getString(KEY_MODEL, DEFAULT_MODEL);
        return value == null || value.trim().isEmpty() ? DEFAULT_MODEL : value;
    }

    public static String listModels(Context context) throws Exception {
        JSONArray models = new JSONArray();
        JSONObject root = new JSONObject(http(context, "GET", "/models", null));
        JSONArray data = root.optJSONArray("data");
        if (data != null) {
            for (int i = 0; i < data.length(); i += 1) {
                JSONObject item = data.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id");
                if (id != null && !id.isEmpty()) models.put(id);
            }
        }
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("models", models);
        return out.toString();
    }

    public static String test(Context context) throws Exception {
        long started = System.currentTimeMillis();
        JSONObject body = new JSONObject();
        body.put("model", model(context));
        body.put("stream", false);
        body.put("max_tokens", 1);
        JSONArray messages = new JSONArray();
        JSONObject message = new JSONObject();
        message.put("role", "user");
        message.put("content", "ping");
        messages.put(message);
        body.put("messages", messages);
        http(context, "POST", "/chat/completions", body.toString());
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("latencyMs", System.currentTimeMillis() - started);
        out.put("model", model(context));
        return out.toString();
    }

    public static String balance(Context context) throws Exception {
        JSONObject root = new JSONObject(http(context, "GET", "/user/balance", null));
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("data", root);
        return out.toString();
    }

    public static String chat(Context context, String messagesJson) throws Exception {
        JSONObject body = new JSONObject();
        body.put("model", model(context));
        body.put("stream", false);
        body.put("messages", new JSONArray(messagesJson));
        JSONObject root = new JSONObject(http(context, "POST", "/chat/completions", body.toString()));
        JSONArray choices = root.optJSONArray("choices");
        String content = "";
        if (choices != null && choices.length() > 0) {
            JSONObject message = choices.getJSONObject(0).optJSONObject("message");
            if (message != null) content = message.optString("content", "");
        }
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("content", content);
        return out.toString();
    }

    /** 对话历史（两条桥共用一份，存在原生 prefs）。 */
    public static String chatHistory(Context context) {
        return prefs(context).getString(KEY_CHAT, "[]");
    }

    public static void saveChatHistory(Context context, String json) {
        if (json == null) return;
        prefs(context).edit().putString(KEY_CHAT, json).apply();
    }

    private static String http(Context context, String method, String path, String body) throws Exception {
        String key = apiKey(context);
        if (key.isEmpty()) throw new ApiError(401, null);

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(BASE_URL + path).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("Authorization", "Bearer " + key);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            if (body != null) {
                connection.setDoOutput(true);
                OutputStream out = connection.getOutputStream();
                out.write(body.getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.close();
            }
            int code = connection.getResponseCode();
            InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = readAll(stream);
            if (code >= 400) throw new ApiError(code, text);
            return text;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder builder = new StringBuilder();
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        String line;
        while ((line = reader.readLine()) != null) builder.append(line);
        reader.close();
        return builder.toString();
    }

    public static String errorJson(String message, int code, String body) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", message == null ? "请求失败" : message);
            out.put("code", code);
            if (body != null && !body.isEmpty()) {
                out.put("detail", body.length() > 300 ? body.substring(0, 300) : body);
            }
            return out.toString();
        } catch (Exception error) {
            return "{\"ok\":false,\"error\":\"请求失败\",\"code\":" + code + "}";
        }
    }
}
