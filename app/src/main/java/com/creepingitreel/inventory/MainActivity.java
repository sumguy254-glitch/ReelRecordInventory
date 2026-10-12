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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int CAMERA_REQUEST = 1001;
    private static final int FILE_CHOOSER_REQUEST = 1002;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

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
        webView.setWebViewClient(new WebViewClient());
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
    }

    private void loadBundledApp() {
        try (InputStream in = getAssets().open("index.html")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            String html = out.toString(StandardCharsets.UTF_8.name());
            webView.loadDataWithBaseURL("https://app.local/", html, "text/html", "UTF-8", null);
        } catch (Exception e) {
            Toast.makeText(this, "Unable to load app: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
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

    public class AndroidBridge {
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
