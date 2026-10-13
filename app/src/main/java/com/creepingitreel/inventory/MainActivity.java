package com.creepingitreel.inventory;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final int CAMERA_REQUEST = 1001;
    private static final int FILE_CHOOSER_REQUEST = 1002;
    private static final int VISUAL_SEARCH_REQUEST = 1003;
    private static final String MOVIE_CATALOG_URL = "https://docs.google.com/spreadsheets/d/1po70GCN9JUwrWgycMueNfxpEvBjLd7DQkiMRUQFFsL8/export?format=csv&gid=0";
    private static final long MOVIE_CATALOG_TTL_MS = 12L * 60L * 60L * 1000L;
    private static final Pattern UPC12 = Pattern.compile("(?<!\\d)(\\d{12})(?!\\d)");
    private static final Pattern UPC_GROUP = Pattern.compile("\\[([^;\\]]+);([^\\]]+)\\]");

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private Uri pendingVisualUri;
    private final Object movieCatalogLock = new Object();
    private Map<String, MovieMatch> movieCatalog = new HashMap<>();
    private long movieCatalogLoadedAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectEnhancements();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        request.deny();
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams fileChooserParams) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/csv", "text/comma-separated-values", "text/plain"});
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                return true;
            }
        });

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
        }

        loadBundledApp();

        new Thread(() -> {
            try {
                ensureMovieCatalog();
            } catch (Exception ignored) {
            }
        }, "movie-catalog-preload").start();
    }

    private String readAsset(String filename) throws Exception {
        try (InputStream in = getAssets().open(filename)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void loadBundledApp() {
        try {
            String html = readAsset("index.html");
            webView.loadDataWithBaseURL("https://app.local/", html, "text/html", "UTF-8", null);
        } catch (Exception e) {
            Toast.makeText(this, "Unable to load app: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void injectEnhancements() {
        try {
            String js = readAsset("enhance.js") + "\n" + readAsset("visual_search.js");
            webView.evaluateJavascript(js, null);
        } catch (Exception ignored) {
        }
    }

    private void launchVisualSearch() {
        try {
            Intent gallery = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            gallery.addCategory(Intent.CATEGORY_OPENABLE);
            gallery.setType("image/*");

            ArrayList<Intent> initial = new ArrayList<>();
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (camera.resolveActivity(getPackageManager()) != null) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, "reel-record-visual-" + System.currentTimeMillis() + ".jpg");
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ReelRecordInventory");
                pendingVisualUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (pendingVisualUri != null) {
                    camera.putExtra(MediaStore.EXTRA_OUTPUT, pendingVisualUri);
                    camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    initial.add(camera);
                }
            }

            Intent chooser = Intent.createChooser(gallery, "Visual Search");
            if (!initial.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, initial.toArray(new Intent[0]));
            startActivityForResult(chooser, VISUAL_SEARCH_REQUEST);
        } catch (Exception e) {
            Toast.makeText(this, "Unable to start visual search: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void processVisualSearchImage(Uri uri) {
        if (uri == null) {
            sendVisualSearchError("No image was selected.");
            return;
        }
        try {
            InputImage image = InputImage.fromFilePath(this, uri);
            BarcodeScanner barcodeScanner = BarcodeScanning.getClient();
            TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            JSONArray foundBarcodes = new JSONArray();

            barcodeScanner.process(image)
                    .addOnSuccessListener(barcodes -> {
                        for (Barcode barcode : barcodes) {
                            String raw = barcode.getRawValue();
                            if (raw == null) continue;
                            String digits = digitsOnly(raw);
                            if (digits.length() >= 8 && digits.length() <= 14) foundBarcodes.put(digits);
                        }
                    })
                    .addOnCompleteListener(barcodeTask -> {
                        barcodeScanner.close();
                        recognizer.process(image)
                                .addOnSuccessListener(text -> {
                                    try {
                                        JSONObject result = new JSONObject();
                                        result.put("barcodes", foundBarcodes);
                                        result.put("text", text.getText() == null ? "" : text.getText());
                                        sendVisualSearchResult(result);
                                    } catch (Exception e) {
                                        sendVisualSearchError("Could not read visual search result.");
                                    }
                                })
                                .addOnFailureListener(err -> sendVisualSearchError("Text recognition failed: " + err.getMessage()))
                                .addOnCompleteListener(textTask -> recognizer.close());
                    });
        } catch (Exception e) {
            sendVisualSearchError("Could not open image: " + e.getMessage());
        }
    }

    private void sendVisualSearchResult(JSONObject result) {
        runOnUiThread(() -> {
            String payload = JSONObject.quote(result.toString());
            webView.evaluateJavascript(
                    "if(window.onVisualSearchNativeResult){window.onVisualSearchNativeResult(" + payload + ");}",
                    null
            );
        });
    }

    private void sendVisualSearchError(String message) {
        try {
            JSONObject result = new JSONObject();
            result.put("error", message == null ? "Visual search failed." : message);
            result.put("barcodes", new JSONArray());
            result.put("text", "");
            sendVisualSearchResult(result);
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == VISUAL_SEARCH_REQUEST) {
            Uri selected = null;
            if (resultCode == RESULT_OK) {
                if (data != null && data.getData() != null) selected = data.getData();
                else selected = pendingVisualUri;
            }
            if (selected != null) {
                processVisualSearchImage(selected);
            } else {
                if (pendingVisualUri != null) {
                    try { getContentResolver().delete(pendingVisualUri, null, null); } catch (Exception ignored) {}
                }
                sendVisualSearchError("Visual search was cancelled.");
            }
            pendingVisualUri = null;
            return;
        }

        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    private String digitsOnly(String value) {
        return value == null ? "" : value.replaceAll("\\D", "");
    }

    private List<String> lookupCandidates(String barcode) {
        ArrayList<String> values = new ArrayList<>();
        String c = digitsOnly(barcode);
        if (!c.isEmpty()) values.add(c);
        if (c.length() == 13 && c.startsWith("0")) values.add(c.substring(1));
        if (c.length() == 12) values.add("0" + c);
        return values;
    }

    private String normalizeMovieFormat(String value) {
        String s = value == null ? "" : value.toLowerCase();
        if (s.contains("hd dvd") || s.contains("hddvd")) return "HD DVD";
        if (s.contains("4k") || s.contains("uhd")) return "4K UHD";
        if (s.contains("blu") || s.matches(".*\\bbr\\b.*")) return "Blu-ray";
        if (s.contains("dvd")) return "DVD";
        if (s.contains("vhs")) return "VHS";
        if (s.contains("laser")) return "LaserDisc";
        return "";
    }

    private int headerIndex(List<String> headers, String wanted) {
        for (int i = 0; i < headers.size(); i++) {
            String h = headers.get(i).replace("\uFEFF", "").trim();
            if (h.equalsIgnoreCase(wanted)) return i;
        }
        return -1;
    }

    private String cell(List<String> row, int index) {
        return index >= 0 && index < row.size() ? row.get(index).trim() : "";
    }

    private List<List<String>> parseCsv(String text) {
        ArrayList<List<String>> rows = new ArrayList<>();
        ArrayList<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            char next = i + 1 < text.length() ? text.charAt(i + 1) : '\0';
            if (ch == '"') {
                if (quoted && next == '"') {
                    cell.append('"');
                    i++;
                } else {
                    quoted = !quoted;
                }
            } else if (ch == ',' && !quoted) {
                row.add(cell.toString());
                cell.setLength(0);
            } else if ((ch == '\n' || ch == '\r') && !quoted) {
                if (ch == '\r' && next == '\n') i++;
                row.add(cell.toString());
                cell.setLength(0);
                boolean any = false;
                for (String v : row) if (!v.isEmpty()) { any = true; break; }
                if (any) rows.add(new ArrayList<>(row));
                row.clear();
            } else {
                cell.append(ch);
            }
        }
        row.add(cell.toString());
        boolean any = false;
        for (String v : row) if (!v.isEmpty()) { any = true; break; }
        if (any) rows.add(row);
        return rows;
    }

    private String httpGet(String urlText, int timeoutMs) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(timeoutMs);
        connection.setReadTimeout(timeoutMs);
        connection.setRequestProperty("User-Agent", "ReelRecordInventory/5.0 Android");
        connection.setRequestProperty("Accept", "application/json,text/csv,text/plain,*/*");
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

    private void addMovieCodes(Map<String, MovieMatch> target, String text, MovieMatch base, String format) {
        Matcher upcs = UPC12.matcher(text == null ? "" : text);
        while (upcs.find()) {
            String code = upcs.group(1);
            MovieMatch m = new MovieMatch(base.title, base.year, base.quality, format);
            if (!target.containsKey(code)) target.put(code, m);
        }
    }

    private void ensureMovieCatalog() throws Exception {
        synchronized (movieCatalogLock) {
            long now = System.currentTimeMillis();
            if (!movieCatalog.isEmpty() && now - movieCatalogLoadedAt < MOVIE_CATALOG_TTL_MS) return;

            String csv = httpGet(MOVIE_CATALOG_URL, 15000);
            List<List<String>> rows = parseCsv(csv);
            if (rows.size() < 2) throw new Exception("Movie catalog was empty");

            List<String> headers = rows.get(0);
            int titleIndex = headerIndex(headers, "TITLE");
            int upcIndex = headerIndex(headers, "UPC");
            int qualityIndex = headerIndex(headers, "QUALITY");
            int yearIndex = headerIndex(headers, "YEAR");
            if (titleIndex < 0 || upcIndex < 0) throw new Exception("Movie catalog columns changed");

            HashMap<String, MovieMatch> fresh = new HashMap<>();
            for (int i = 1; i < rows.size(); i++) {
                List<String> row = rows.get(i);
                String title = cell(row, titleIndex);
                String upcField = cell(row, upcIndex);
                if (title.isEmpty() || upcField.isEmpty()) continue;
                MovieMatch base = new MovieMatch(title, cell(row, yearIndex), cell(row, qualityIndex), "");

                Matcher groups = UPC_GROUP.matcher(upcField);
                boolean foundGroup = false;
                while (groups.find()) {
                    foundGroup = true;
                    String format = normalizeMovieFormat(groups.group(1));
                    addMovieCodes(fresh, groups.group(2), base, format);
                }
                if (!foundGroup) addMovieCodes(fresh, upcField, base, "");
            }

            if (fresh.isEmpty()) throw new Exception("No UPCs were parsed from the movie catalog");
            movieCatalog = fresh;
            movieCatalogLoadedAt = now;
        }
    }

    private JSONObject lookupMovieCatalog(String barcode) throws Exception {
        ensureMovieCatalog();
        for (String candidate : lookupCandidates(barcode)) {
            MovieMatch match = movieCatalog.get(candidate);
            if (match != null) return match.toJson(candidate);
        }
        return null;
    }

    private JSONObject lookupUpcDev(String barcode) throws Exception {
        String c = digitsOnly(barcode);
        if (c.isEmpty()) return null;
        String body = httpGet("https://upc.dev/v1/product/" + URLEncoder.encode(c, "UTF-8"), 6000);
        JSONObject root = new JSONObject(body);
        if (!root.optBoolean("ok", false)) return null;
        JSONObject data = root.optJSONObject("data");
        if (data == null) return null;
        String name = data.optString("name", "").trim();
        if (name.isEmpty()) return null;
        String brand = data.optString("brand", "").trim();
        String category = data.optString("category", "").trim();
        String combined = name + " " + category;
        String lower = combined.toLowerCase();
        String type = lower.matches(".*(music|vinyl|album|compact disc|\\bcd\\b|record).*") ? "Music" : "Movie";
        JSONObject result = new JSONObject();
        result.put("source", "upc.dev");
        result.put("type", type);
        result.put("title", name);
        result.put("creator", brand);
        result.put("year", "");
        result.put("genre", category);
        result.put("coverUrl", data.optString("image", data.optString("image_url", "")));
        result.put("format", normalizeMovieFormat(combined));
        result.put("detail", category);
        return result;
    }

    private static class MovieMatch {
        final String title;
        final String year;
        final String quality;
        final String format;

        MovieMatch(String title, String year, String quality, String format) {
            this.title = title == null ? "" : title;
            this.year = year == null ? "" : year;
            this.quality = quality == null ? "" : quality;
            this.format = format == null ? "" : format;
        }

        JSONObject toJson(String matchedUpc) throws Exception {
            JSONObject result = new JSONObject();
            result.put("source", "My-UPC / DigitalUPC");
            result.put("type", "Movie");
            result.put("title", title);
            result.put("creator", "");
            result.put("year", year);
            result.put("genre", "");
            result.put("coverUrl", "");
            result.put("format", format);
            result.put("detail", (quality.isEmpty() ? "Physical movie catalog" : quality) + " • UPC " + matchedUpc);
            return result;
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public String lookupExtraSources(String barcode) {
            JSONArray results = new JSONArray();
            try {
                JSONObject movie = lookupMovieCatalog(barcode);
                if (movie != null) results.put(movie);
            } catch (Exception ignored) {
            }
            try {
                JSONObject product = lookupUpcDev(barcode);
                if (product != null) results.put(product);
            } catch (Exception ignored) {
            }
            return results.toString();
        }

        @JavascriptInterface
        public void startVisualSearch() {
            runOnUiThread(MainActivity.this::launchVisualSearch);
        }

        @JavascriptInterface
        public void saveTextFile(String filename, String text, String mimeType) {
            runOnUiThread(() -> {
                try {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType == null ? "text/plain" : mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ReelRecordInventory");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new Exception("Could not create download");
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os == null) throw new Exception("Could not open download");
                        os.write(text.getBytes(StandardCharsets.UTF_8));
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, values, null, null);
                    Toast.makeText(MainActivity.this, "Saved to Downloads/ReelRecordInventory", Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Save failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }
    }
}
