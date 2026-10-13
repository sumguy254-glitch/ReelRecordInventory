package com.creepingitreel.inventory;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivityV11 extends MainActivityV9 {
    private WebView bookWebView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bookWebView = findBookWebView();
        if (bookWebView == null) return;
        bookWebView.addJavascriptInterface(new BookBridge(), "BookBridge");
        bookWebView.postDelayed(this::injectBookEnhancements, 1400);
        bookWebView.postDelayed(this::injectBookEnhancements, 2800);
    }

    private WebView findBookWebView() {
        try {
            Field field = MainActivity.class.getDeclaredField("webView");
            field.setAccessible(true);
            return (WebView) field.get(this);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void injectBookEnhancements() {
        if (bookWebView == null) return;
        try (InputStream in = getAssets().open("books.js")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            bookWebView.evaluateJavascript(out.toString(StandardCharsets.UTF_8.name()), null);
        } catch (Exception ignored) {
        }
    }

    private String cleanIsbn(String value) {
        if (value == null) return "";
        return value.toUpperCase(Locale.US).replaceAll("[^0-9X]", "");
    }

    private boolean looksLikeIsbn(String code) {
        String c = cleanIsbn(code);
        return c.length() == 10 || (c.length() == 13 && (c.startsWith("978") || c.startsWith("979")));
    }

    private String httpGetBook(String urlText, int timeoutMs) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(timeoutMs);
        connection.setReadTimeout(timeoutMs);
        connection.setRequestProperty("User-Agent", "MediaDex-ReelRecordInventory/11.0 Android");
        connection.setRequestProperty("Accept", "application/json");
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        if (stream == null) throw new Exception("HTTP " + status);
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            String body = out.toString(StandardCharsets.UTF_8.name());
            if (status < 200 || status >= 300) throw new Exception("HTTP " + status);
            return body;
        } finally {
            connection.disconnect();
        }
    }

    private String names(JSONArray values) {
        if (values == null) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < values.length(); i++) {
            JSONObject item = values.optJSONObject(i);
            String value = item != null ? item.optString("name", "").trim() : values.optString(i, "").trim();
            if (value.isEmpty()) continue;
            if (out.length() > 0) out.append(", ");
            out.append(value);
            if (out.length() > 180) break;
        }
        return out.toString();
    }

    private String subjects(JSONArray values) {
        if (values == null) return "";
        StringBuilder out = new StringBuilder();
        int count = 0;
        for (int i = 0; i < values.length() && count < 5; i++) {
            JSONObject item = values.optJSONObject(i);
            String value = item != null ? item.optString("name", "").trim() : values.optString(i, "").trim();
            if (value.isEmpty()) continue;
            if (out.length() > 0) out.append(", ");
            out.append(value);
            count++;
        }
        return out.toString();
    }

    private String yearFrom(String value) {
        Matcher matcher = Pattern.compile("(1[5-9]\\d{2}|20\\d{2}|2100)").matcher(value == null ? "" : value);
        return matcher.find() ? matcher.group(1) : "";
    }

    private String normalizeBookFormat(String value) {
        String s = value == null ? "" : value.toLowerCase(Locale.US);
        if (s.contains("mass market")) return "Mass Market Paperback";
        if (s.contains("trade paperback")) return "Trade Paperback";
        if (s.contains("hardcover") || s.contains("hardback")) return "Hardcover";
        if (s.contains("paperback") || s.contains("softcover")) return "Paperback";
        if (s.contains("board book")) return "Board Book";
        if (s.contains("audio")) return "Audiobook";
        if (s.contains("ebook") || s.contains("electronic")) return "eBook";
        return "";
    }

    private JSONObject lookupOpenLibrary(String isbn) throws Exception {
        String code = cleanIsbn(isbn);
        if (!looksLikeIsbn(code)) return null;
        String key = "ISBN:" + code;
        String url = "https://openlibrary.org/api/books?bibkeys=" + URLEncoder.encode(key, "UTF-8") + "&jscmd=data&format=json&details=true";
        JSONObject root = new JSONObject(httpGetBook(url, 9000));
        JSONObject book = root.optJSONObject(key);
        if (book == null) return null;

        String title = book.optString("title", "").trim();
        if (title.isEmpty()) return null;
        String authors = names(book.optJSONArray("authors"));
        String publishers = names(book.optJSONArray("publishers"));
        String publishDate = book.optString("publish_date", "").trim();
        String genre = subjects(book.optJSONArray("subjects"));
        JSONObject cover = book.optJSONObject("cover");
        String coverUrl = cover == null ? "" : cover.optString("large", cover.optString("medium", cover.optString("small", "")));

        JSONObject details = book.optJSONObject("details");
        String physical = "";
        int pages = book.optInt("number_of_pages", 0);
        if (details != null) {
            physical = details.optString("physical_format", "");
            if (pages <= 0) pages = details.optInt("number_of_pages", 0);
            if (publishers.isEmpty()) {
                JSONArray p = details.optJSONArray("publishers");
                if (p != null) publishers = names(p);
            }
        }

        JSONObject result = new JSONObject();
        result.put("source", "Open Library");
        result.put("type", "Book");
        result.put("title", title);
        result.put("creator", authors);
        result.put("year", yearFrom(publishDate));
        result.put("genre", genre);
        result.put("coverUrl", coverUrl);
        result.put("format", normalizeBookFormat(physical));
        StringBuilder detail = new StringBuilder();
        if (!publishers.isEmpty()) detail.append(publishers);
        if (!publishDate.isEmpty()) {
            if (detail.length() > 0) detail.append(" • ");
            detail.append(publishDate);
        }
        if (pages > 0) {
            if (detail.length() > 0) detail.append(" • ");
            detail.append(pages).append(" pages");
        }
        result.put("detail", detail.toString());
        result.put("isbn", code);
        return result;
    }

    private void sendBookResult(String requestId, JSONObject payload) {
        if (bookWebView == null) return;
        runOnUiThread(() -> {
            String id = JSONObject.quote(requestId == null ? "" : requestId);
            String data = JSONObject.quote(payload == null ? "{}" : payload.toString());
            bookWebView.evaluateJavascript(
                    "if(window.onMediaDexBookResult){window.onMediaDexBookResult(" + id + "," + data + ");}",
                    null
            );
        });
    }

    public class BookBridge {
        @JavascriptInterface
        public void lookupBookAsync(String requestId, String isbn) {
            new Thread(() -> {
                JSONObject payload = new JSONObject();
                try {
                    JSONObject result = lookupOpenLibrary(isbn);
                    if (result == null) payload.put("error", "No Open Library match was found for this ISBN.");
                    else payload = result;
                } catch (Exception e) {
                    try {
                        payload.put("error", e.getMessage() == null ? "Book lookup failed." : e.getMessage());
                    } catch (Exception ignored) {
                    }
                }
                sendBookResult(requestId, payload);
            }, "book-isbn-lookup").start();
        }
    }
}
