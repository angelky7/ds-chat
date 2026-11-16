package com.angelky.dschat;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 单页外壳：直接用系统 WebView 打开线上站点，因此与浏览器同源，
 * 跨域、localStorage、IndexedDB 的行为和网页版完全一致。
 */
public class MainActivity extends Activity {

    private static final String HOME_URL = "https://angelky7.github.io/ds-chat/";
    private static final String HOME_HOST = "angelky7.github.io";
    private static final int REQUEST_FILE = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupStatusBar();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        webView.setLayoutParams(
                new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // 上传头像、附件需要文件选择器；其余保持默认，避免放宽不必要的权限
        settings.setAllowFileAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        // 朗读功能在无手势时也要能播放
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " DsChatApp/1.0");

        webView.addJavascriptInterface(new Bridge(), "DsChatApp");
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new Chrome());

        setContentView(webView);
        webView.loadUrl(HOME_URL);
    }

    /** 白色状态栏 + 深色图标，与站点的浅色头部衔接 */
    private void setupStatusBar() {
        Window window = getWindow();
        window.setStatusBarColor(Color.WHITE);
        window.setNavigationBarColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
            // 没有可处理该链接的应用时静默忽略，不影响站内使用
        }
    }

    private boolean isInternal(Uri uri) {
        String host = uri.getHost();
        return host != null && (host.equals(HOME_HOST) || host.endsWith("." + HOME_HOST));
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if (scheme != null && (scheme.equals("http") || scheme.equals("https"))) {
                if (isInternal(uri)) {
                    return false;
                }
                openExternal(uri.toString());
                return true;
            }
            // mailto、tg 之类的协议交给系统
            openExternal(uri.toString());
            return true;
        }

        @Override
        public void onReceivedError(
                WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) {
                return;
            }
            view.loadDataWithBaseURL(HOME_URL, errorPage(), "text/html", "utf-8", null);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(
                WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(null);
            }
            fileCallback = callback;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            String[] accept = params.getAcceptTypes();
            if (accept != null && accept.length > 0 && accept[0] != null && !accept[0].isEmpty()) {
                // accept 里可能带 ".png,.jpg" 这类扩展名，MIME 通配更稳
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/*", "application/pdf",
                        "text/plain", "application/msword", "application/vnd.ms-powerpoint",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "application/vnd.openxmlformats-officedocument.presentationml.presentation"});
            }
            try {
                startActivityForResult(Intent.createChooser(intent, getString(R.string.pick_file)), REQUEST_FILE);
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    /** 错误页的「重试」按钮通过这个桥接回原生 */
    private final class Bridge {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> webView.loadUrl(HOME_URL));
        }
    }

    private String errorPage() {
        return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>body{margin:0;height:100vh;display:flex;flex-direction:column;"
                + "align-items:center;justify-content:center;gap:16px;background:#fff;"
                + "color:#1f2329;font:16px/1.6 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;"
                + "text-align:center;padding:24px;box-sizing:border-box}"
                + "p{margin:0;color:#6b7280;font-size:14px}"
                + "button{margin-top:8px;padding:10px 24px;border:none;border-radius:100px;"
                + "background:#4d6bfe;color:#fff;font-size:15px}</style></head><body>"
                + "<h2>无法连接</h2>"
                + "<p>请检查网络后再试。若所在网络无法访问该站点，可切换网络或使用代理。</p>"
                + "<button onclick=\"DsChatApp.retry()\">重试</button>"
                + "</body></html>";
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(collectUris(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private Uri[] collectUris(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null) {
            return null;
        }
        ClipData clip = data.getClipData();
        if (clip != null) {
            Uri[] uris = new Uri[clip.getItemCount()];
            for (int i = 0; i < clip.getItemCount(); i++) {
                uris[i] = clip.getItemAt(i).getUri();
            }
            return uris;
        }
        Uri single = data.getData();
        return single == null ? null : new Uri[] {single};
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
