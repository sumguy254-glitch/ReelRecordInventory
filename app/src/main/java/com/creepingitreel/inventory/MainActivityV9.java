package com.creepingitreel.inventory;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivityV9 extends MainActivity {
    private WebView v9WebView;
    private AndroidBridge legacyBridge;
    private final Map<String, JSONObject> valuationCache = new ConcurrentHashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        legacyBridge = new AndroidBridge();
        v9WebView = findWebView();
        if (v9WebView == null) return;

        v9WebView.removeJavascriptInterface("AndroidBridge");
        v9WebView.addJavascriptInterface(new V9Bridge(), "AndroidBridge");
        v9WebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                invokeLegacyEnhancements();
                injectV9Enhancements();
            }
        });

        // Covers the unlikely case where the bundled page finishes before the
        // replacement WebViewClient is attached.
        v9WebView.postDelayed(this::injectV9Enhancements, 900);
    }

    private WebView findWebView() {
        try {
            Field field = MainActivity.class.getDeclaredField("webView");
            field.setAccessible(true);
            return (WebView) field.get(this);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void invokeLegacyEnhancements() {
        try {
            Method method = MainActivity.class.getDeclaredMethod("injectEnhancements");
            method.setAccessible(true);
            method.invoke(this);
        } catch (Exception ignored) {
        }
    }

    private void injectV9Enhancements() {
        if (v9WebView == null) return;
        try (InputStream in = getAssets().open("valuation.js")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            String js = out.toString(StandardCharsets.UTF_8.name());
            v9WebView.evaluateJavascript(js, null);
        } catch (Exception ignored) {
        }
    }

    private JSONObject invokePrivateLookup(String methodName, String barcode) {
        try {
            Method method = MainActivity.class.getDeclaredMethod(methodName, String.class);
            method.setAccessible(true);
            return (JSONObject) method.invoke(this, barcode);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String digitsOnly(String value) {
        return value == null ? "" : value.replaceAll("\\D", "");
    }

    private String httpGet(String urlText, int timeoutMs) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(timeoutMs);
        connection.setReadTimeout(timeoutMs);
        connection.setRequestProperty("User-Agent", "ReelRecordInventory/9.0 Android");
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

    private String normalizeMovieFormat(String value) {
        String s = value == null ? "" : value.toLowerCase(Locale.US);
        if (s.contains("hd dvd") || s.contains("hddvd")) return "HD DVD";
        if (s.contains("4k") || s.contains("uhd") || s.contains("ultra hd")) return "4K UHD";
        if (s.contains("blu")) return "Blu-ray";
        if (s.contains("dvd")) return "DVD";
        if (s.contains("vhs")) return "VHS";
        if (s.contains("laser")) return "LaserDisc";
        if (s.contains("vinyl") || s.matches(".*\\blp\\b.*")) return "Vinyl";
        if (s.matches(".*\\bcd\\b.*") || s.contains("compact disc")) return "CD";
        if (s.contains("cassette")) return "Cassette";
        return "";
    }

    private String classifyProductType(String text) {
        String s = text == null ? "" : text.toLowerCase(Locale.US);
        if (s.matches(".*(music|vinyl|album|compact disc|\\bcd\\b|record|cassette).*")) return "Music";
        if (s.matches(".*(season\\s*\\d+|complete season|complete series|television|tv series|tv season).*")) return "TV Season";
        return "Movie";
    }

    private double percentile(List<Double> sorted, double p) {
        if (sorted.isEmpty()) return 0;
        if (sorted.size() == 1) return sorted.get(0);
        double pos = p * (sorted.size() - 1);
        int lo = (int) Math.floor(pos);
        int hi = (int) Math.ceil(pos);
        if (lo == hi) return sorted.get(lo);
        double weight = pos - lo;
        return sorted.get(lo) * (1.0 - weight) + sorted.get(hi) * weight;
    }

    private double roundMoney(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private JSONObject calculateEstimate(JSONObject item) throws Exception {
        ArrayList<Double> used = new ArrayList<>();
        ArrayList<Double> all = new ArrayList<>();
        JSONArray offers = item.optJSONArray("offers");
        if (offers != null) {
            for (int i = 0; i < offers.length(); i++) {
                JSONObject offer = offers.optJSONObject(i);
                if (offer == null) continue;
                String currency = offer.optString("currency", "USD").trim();
                if (!currency.isEmpty() && !"USD".equalsIgnoreCase(currency)) continue;
                String availability = offer.optString("availability", "").toLowerCase(Locale.US);
                if (availability.contains("out of stock")) continue;
                double price = offer.optDouble("price", 0);
                if (!(price > 0) || Double.isInfinite(price) || Double.isNaN(price)) continue;
                all.add(price);
                String condition = offer.optString("condition", "").toLowerCase(Locale.US);
                if (condition.contains("used") || condition.contains("pre-owned") || condition.contains("preowned")) used.add(price);
            }
        }

        List<Double> chosen = !used.isEmpty() ? used : all;
        double estimate = 0;
        double low = 0;
        double high = 0;
        String source = "";
        String confidence = "low";
        int compCount = chosen.size();

        if (!chosen.isEmpty()) {
            Collections.sort(chosen);
            estimate = percentile(chosen, 0.50);
            if (chosen.size() >= 4) {
                low = percentile(chosen, 0.25);
                high = percentile(chosen, 0.75);
            } else {
                low = chosen.get(0);
                high = chosen.get(chosen.size() - 1);
            }
            if (!used.isEmpty()) {
                source = "UPCitemdb used-market offers";
                confidence = used.size() >= 3 ? "high" : "medium";
            } else {
                source = "UPCitemdb current market offers";
                confidence = all.size() >= 4 ? "medium" : "low";
            }
        } else {
            double historicalLow = item.optDouble("lowest_recorded_price", 0);
            double historicalHigh = item.optDouble("highest_recorded_price", 0);
            if (historicalLow > 0) {
                estimate = historicalLow;
                low = historicalLow;
                high = historicalHigh > 0 ? historicalHigh : historicalLow;
                if (historicalHigh > 0 && historicalHigh / historicalLow <= 3.0) {
                    estimate = (historicalLow + historicalHigh) / 2.0;
                }
                source = "UPCitemdb historical-price fallback";
                confidence = "low";
            }
        }

        JSONObject result = new JSONObject();
        result.put("estimatedValue", roundMoney(estimate));
        result.put("estimateLow", roundMoney(low));
        result.put("estimateHigh", roundMoney(high));
        result.put("estimateSource", source);
        result.put("estimateConfidence", confidence);
        result.put("estimateCompCount", compCount);
        result.put("estimateUpdatedAt", System.currentTimeMillis());
        return result;
    }

    private JSONObject lookupUpcItemDb(String barcode) throws Exception {
        String c = digitsOnly(barcode);
        if (c.isEmpty()) return null;
        String body = httpGet("https://api.upcitemdb.com/prod/trial/lookup?upc=" + URLEncoder.encode(c, "UTF-8"), 9000);
        JSONObject root = new JSONObject(body);
        JSONArray items = root.optJSONArray("items");
        if (items == null || items.length() == 0) return null;
        JSONObject item = items.optJSONObject(0);
        if (item == null) return null;

        String title = item.optString("title", "").trim();
        if (title.isEmpty()) return null;
        String brand = item.optString("brand", "").trim();
        String category = item.optString("category", "").trim();
        String description = item.optString("description", "").trim();
        String combined = title + " " + category + " " + description;
        String cover = "";
        JSONArray images = item.optJSONArray("images");
        if (images != null && images.length() > 0) cover = images.optString(0, "");

        JSONObject estimate = calculateEstimate(item);
        JSONObject result = new JSONObject();
        result.put("source", "UPCitemdb");
        result.put("type", classifyProductType(combined));
        result.put("title", title);
        result.put("creator", brand);
        result.put("year", "");
        result.put("genre", category);
        result.put("coverUrl", cover);
        result.put("format", normalizeMovieFormat(combined));
        result.put("detail", description.isEmpty() ? category : description);
        for (String key : new String[]{"estimatedValue", "estimateLow", "estimateHigh", "estimateSource", "estimateConfidence", "estimateCompCount", "estimateUpdatedAt"}) {
            result.put(key, estimate.opt(key));
        }

        valuationCache.put(c, new JSONObject(estimate.toString()));
        String upc = digitsOnly(item.optString("upc", ""));
        String ean = digitsOnly(item.optString("ean", ""));
        if (!upc.isEmpty()) valuationCache.put(upc, new JSONObject(estimate.toString()));
        if (!ean.isEmpty()) valuationCache.put(ean, new JSONObject(estimate.toString()));
        return result;
    }

    private JSONObject valuationFor(String barcode, boolean allowNetwork) throws Exception {
        String c = digitsOnly(barcode);
        if (c.isEmpty()) return null;
        JSONObject cached = valuationCache.get(c);
        if (cached != null) {
            JSONObject copy = new JSONObject(cached.toString());
            copy.put("cached", true);
            return copy;
        }
        if (!allowNetwork) return null;
        JSONObject product = lookupUpcItemDb(c);
        if (product == null) return null;
        JSONObject result = new JSONObject();
        for (String key : new String[]{"estimatedValue", "estimateLow", "estimateHigh", "estimateSource", "estimateConfidence", "estimateCompCount", "estimateUpdatedAt"}) {
            result.put(key, product.opt(key));
        }
        result.put("cached", false);
        return result;
    }

    private void sendEstimateResult(String requestId, JSONObject payload) {
        if (v9WebView == null) return;
        runOnUiThread(() -> {
            String id = JSONObject.quote(requestId == null ? "" : requestId);
            String data = JSONObject.quote(payload == null ? "{}" : payload.toString());
            v9WebView.evaluateJavascript(
                    "if(window.onRrEstimateResult){window.onRrEstimateResult(" + id + "," + data + ");}",
                    null
            );
        });
    }

    public class V9Bridge {
        @JavascriptInterface
        public String lookupExtraSources(String barcode) {
            JSONArray results = new JSONArray();
            try {
                JSONObject movie = invokePrivateLookup("lookupMovieCatalog", barcode);
                if (movie != null) results.put(movie);
            } catch (Exception ignored) {
            }
            try {
                JSONObject product = lookupUpcItemDb(barcode);
                if (product != null) results.put(product);
            } catch (Exception ignored) {
            }
            try {
                JSONObject product = invokePrivateLookup("lookupUpcDev", barcode);
                if (product != null) results.put(product);
            } catch (Exception ignored) {
            }
            return results.toString();
        }

        @JavascriptInterface
        public String getCachedEstimate(String barcode) {
            try {
                JSONObject result = valuationFor(barcode, false);
                return result == null ? "{}" : result.toString();
            } catch (Exception ignored) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void estimateValueAsync(String requestId, String barcode) {
            new Thread(() -> {
                JSONObject payload = new JSONObject();
                try {
                    JSONObject result = valuationFor(barcode, true);
                    if (result == null || result.optDouble("estimatedValue", 0) <= 0) {
                        payload.put("error", "No usable market pricing was found for this UPC.");
                    } else {
                        payload = result;
                    }
                } catch (Exception e) {
                    try {
                        payload.put("error", e.getMessage() == null ? "Value lookup failed." : e.getMessage());
                    } catch (Exception ignored) {
                    }
                }
                sendEstimateResult(requestId, payload);
            }, "value-estimate-" + digitsOnly(barcode)).start();
        }

        @JavascriptInterface
        public void openExternalUrl(String url) {
            if (url == null || !url.startsWith("https://")) return;
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void startVisualSearch() {
            legacyBridge.startVisualSearch();
        }

        @JavascriptInterface
        public void analyzeVisualImage(String dataUrl) {
            legacyBridge.analyzeVisualImage(dataUrl);
        }

        @JavascriptInterface
        public void saveTextFile(String filename, String text, String mimeType) {
            legacyBridge.saveTextFile(filename, text, mimeType);
        }
    }
}
