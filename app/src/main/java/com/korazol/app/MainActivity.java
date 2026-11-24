package com.korazol.app;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.JavaScriptReplyProxy;
import org.json.JSONObject;
import java.util.Collections;

public class MainActivity extends Activity {
    private static final String HOME = "https://fwadh486-lab.github.io/kora-.zool/";
    private static final int BACKGROUND = Color.rgb(16,24,39);
    private static final int ACCENT = Color.rgb(32,227,154);
    private WebView webView;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private boolean pageFailed;
    private Runnable permissionGranted;
    private Runnable permissionDenied;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        NativePush.createChannel(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
                return insets;
            });
        }
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12),0,dp(8),0);
        ImageView logo = new ImageView(this);
        logo.setImageResource(com.korazol.app.R.drawable.korazol_icon);
        logo.setContentDescription("كورة زول");
        toolbar.addView(logo,new LinearLayout.LayoutParams(dp(34),dp(34)));
        TextView title = new TextView(this);
        title.setText("كورة زول"); title.setTextColor(Color.WHITE); title.setTextSize(18);
        title.setPadding(dp(8),0,dp(8),0);
        toolbar.addView(title,new LinearLayout.LayoutParams(0,dp(48),1));
        title.setGravity(Gravity.CENTER_VERTICAL);
        Button alerts = new Button(this,null,android.R.attr.borderlessButtonStyle);
        alerts.setText("🔔 الإشعارات"); alerts.setTextColor(ACCENT); alerts.setTextSize(12);
        alerts.setOnClickListener(v -> webView.loadUrl(HOME+"?settings=1"));
        toolbar.addView(alerts,new LinearLayout.LayoutParams(-2,dp(48)));
        root.addView(toolbar,new LinearLayout.LayoutParams(-1,dp(48)));
        progress = new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));

        FrameLayout content = new FrameLayout(this);
        root.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setUserAgentString(settings.getUserAgentString()+" KoraZolAndroid/0.7.0");
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            WebViewCompat.addWebMessageListener(webView,"KoraNative",Collections.singleton("https://fwadh486-lab.github.io"),(view,message,sourceOrigin,isMainFrame,reply)->{
                if(isMainFrame&&isAppUrl(Uri.parse(view.getUrl()==null?HOME:view.getUrl())))handleNativeMessage(message.getData(),reply);
            });
        }
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (isAppUrl(uri)) return false;
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) openExternal(uri);
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageFailed=false;errorPanel.setVisibility(View.GONE);progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view,String url) {
                progress.setVisibility(View.GONE);
                if (!pageFailed) errorPanel.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view,int value) {progress.setProgress(value);}
        });
        content.addView(webView,new FrameLayout.LayoutParams(-1,-1));
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL); errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(24),dp(24),dp(24),dp(24)); errorPanel.setBackgroundColor(BACKGROUND);
        TextView error = new TextView(this);error.setText("تعذر الاتصال بكورة زول\nتأكد من الإنترنت وحاول مرة أخرى.");error.setTextColor(Color.WHITE);error.setTextSize(17);error.setGravity(Gravity.CENTER);
        errorPanel.addView(error,new LinearLayout.LayoutParams(-1,-2));
        Button retry = new Button(this);retry.setText("إعادة المحاولة");retry.setOnClickListener(v -> {errorPanel.setVisibility(View.GONE);webView.loadUrl(HOME);});
        errorPanel.addView(retry,new LinearLayout.LayoutParams(-2,dp(52)));
        errorPanel.setVisibility(View.GONE);content.addView(errorPanel,new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);
        if (savedInstanceState==null || webView.restoreState(savedInstanceState)==null) openLaunchUrl(getIntent());
    }

    private int dp(float value) {return Math.round(value*getResources().getDisplayMetrics().density);}
    private boolean isAppUrl(Uri uri) {
        String path=uri.getPath();
        return "https".equals(uri.getScheme()) && "fwadh486-lab.github.io".equals(uri.getHost()) && path!=null && path.startsWith("/kora-.zool/");
    }
    private void showError(){pageFailed=true;progress.setVisibility(View.GONE);errorPanel.setVisibility(View.VISIBLE);}
    private void openExternal(Uri uri) {
        try {startActivity(new Intent(Intent.ACTION_VIEW,uri));} catch (Exception ignored) {
            Toast.makeText(this,"لا يوجد تطبيق لفتح الرابط",Toast.LENGTH_SHORT).show();
        }
    }
    private void openLaunchUrl(Intent intent){String url=intent==null?null:intent.getStringExtra("url");webView.loadUrl(url!=null&&isAppUrl(Uri.parse(url))?url:HOME);}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(intent.getStringExtra("url")!=null)openLaunchUrl(intent);}
    private void respond(JavaScriptReplyProxy reply,String id,JSONObject result){runOnUiThread(()->{try{if(!isFinishing()&&webView!=null)reply.postMessage(result.put("id",id).toString());}catch(Exception ignored){}});}
    private void handleNativeMessage(String raw,JavaScriptReplyProxy reply){
        if(raw==null||raw.length()>65536)return;
        try {
            JSONObject request=new JSONObject(raw);String id=request.getString("id"),command=request.getString("command");
            if(id.length()>80)return;
            if ("preview-sound".equals(command)) {
                JSONObject options=request.optJSONObject("preferences");
                String kind=options==null?"":options.optString("sound","");
                runOnUiThread(()->{
                    if(!NotificationSounds.isPreviewable(kind)) {
                        respond(reply,id,NativePush.error("invalid_sound"));
                        return;
                    }
                    boolean played=NotificationSounds.preview(this,kind);
                    JSONObject result=new JSONObject();
                    try { result.put("ok",played); } catch(Exception ignored) { }
                    if(!played)result=NativePush.error("sound_unavailable");
                    respond(reply,id,result);
                });
                return;
            }
            Runnable work=()->NativePush.command(this,command,request.optJSONObject("preferences"),result->respond(reply,id,result));
            if(command.equals("enable")&&Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
                if(permissionGranted!=null){respond(reply,id,NativePush.error("busy"));return;}
                permissionGranted=work;permissionDenied=()->respond(reply,id,NativePush.error("not_allowed"));requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},71);
            }else work.run();
        }catch(Exception ignored){}
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){super.onRequestPermissionsResult(code,permissions,results);if(code==71){Runnable next=results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED?permissionGranted:permissionDenied;permissionGranted=null;permissionDenied=null;if(next!=null)next.run();}}
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
    @Override protected void onSaveInstanceState(Bundle outState){if(webView!=null)webView.saveState(outState);super.onSaveInstanceState(outState);}
    @Override protected void onDestroy(){if(webView!=null){webView.destroy();webView=null;}super.onDestroy();}
}
