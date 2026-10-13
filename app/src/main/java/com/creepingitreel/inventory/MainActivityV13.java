package com.creepingitreel.inventory;

import android.os.Bundle;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;

public class MainActivityV13 extends MainActivityV11 {
    private WebView brandingWebView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        brandingWebView = findBrandingWebView();
        if (brandingWebView == null) return;
        brandingWebView.postDelayed(this::injectBranding, 1700);
        brandingWebView.postDelayed(this::injectBranding, 3200);
    }

    private WebView findBrandingWebView() {
        try {
            Field field = MainActivity.class.getDeclaredField("webView");
            field.setAccessible(true);
            return (WebView) field.get(this);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void injectBranding() {
        if (brandingWebView == null) return;
        try (InputStream in = getAssets().open("branding.js")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            brandingWebView.evaluateJavascript(out.toString(StandardCharsets.UTF_8.name()), null);
        } catch (Exception ignored) {
        }
    }
}
