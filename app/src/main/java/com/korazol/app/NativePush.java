package com.korazol.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.android.gms.tasks.Tasks;
import org.json.JSONObject;
import java.net.URL;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

final class NativePush {
    static final String CHANNEL = "korazol_matches";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    interface Result { void finish(JSONObject response); }
    static SharedPreferences prefs(Context context) { return context.getSharedPreferences("native_push",Context.MODE_PRIVATE); }
    static boolean allowed(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED)
            && context.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }
    static void createChannel(Context context) { NotificationSounds.installChannels(context); }
    private static String secret(SharedPreferences p) {
        String secret=p.getString("secret",null);
        if(secret==null){secret=UUID.randomUUID().toString()+UUID.randomUUID();p.edit().putString("secret",secret).commit();}
        return secret;
    }
    private static JSONObject request(String path,JSONObject body) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL("https://korazol-push.fwadh486.workers.dev/"+path).openConnection();
        try {
            connection.setConnectTimeout(12000);connection.setReadTimeout(15000);connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");connection.setRequestProperty("Origin","https://fwadh486-lab.github.io");connection.setRequestProperty("Content-Type","application/json");connection.setDoOutput(true);
            try(java.io.OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}
            int code=connection.getResponseCode();
            java.io.InputStream stream=code>=200&&code<300?connection.getInputStream():connection.getErrorStream();
            java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
            if(stream!=null)try(java.io.InputStream in=stream){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1){bytes.write(buffer,0,n);if(bytes.size()>65536)throw new Exception("server_error");}}
            JSONObject result=new JSONObject(bytes.toString("UTF-8"));
            if(code<200||code>=300)throw new Exception(result.optString("error","server_error"));
            return result;
        } finally {connection.disconnect();}
    }
    private static JSONObject body(SharedPreferences p,String token) throws Exception {return new JSONObject().put("token",secret(p)).put("nativeToken",token).put("richNotifications",true);}
    static JSONObject error(String code) {JSONObject r=new JSONObject();try{r.put("ok",false).put("error",code);}catch(Exception ignored){}return r;}
    static void command(Context context,String action,JSONObject preferences,Result callback) {
        Context app=context.getApplicationContext();
        IO.execute(()->{
            try {
                SharedPreferences p=prefs(app);boolean enabled=p.getBoolean("enabled",false);
                JSONObject r;
                switch(action){
                    case "state": r=new JSONObject().put("enabled",enabled).put("permission",allowed(app));break;
                    case "enable": case "sync":
                        if(!allowed(app))throw new Exception("not_allowed");
                        if(action.equals("sync")&&!enabled)throw new Exception("not_subscribed");
                        if(preferences==null)throw new Exception("invalid_preferences");
                        FirebaseMessaging.getInstance().setAutoInitEnabled(true);
                        String token=Tasks.await(FirebaseMessaging.getInstance().getToken(),20,TimeUnit.SECONDS);
                        r=request("subscribe",body(p,token).put("preferences",preferences));
                        if(r.optBoolean("subscribed"))p.edit().putBoolean("enabled",true).putString("token",token).putString("preferences",preferences.toString()).commit();
                        break;
                    case "disable":
                        String old=p.getString("token","");
                        if(enabled&&!old.isEmpty())request("unsubscribe",body(p,old));
                        p.edit().putBoolean("enabled",false).remove("token").remove("preferences").commit();
                        FirebaseMessaging.getInstance().setAutoInitEnabled(false);
                        FirebaseMessaging.getInstance().deleteToken();
                        r=new JSONObject().put("subscribed",false);break;
                    case "test": case "test-status":
                        if(!enabled)throw new Exception("not_subscribed");
                        if(!allowed(app))throw new Exception("not_allowed");
                        r=request(action,body(p,p.getString("token","")));break;
                    default: throw new Exception("invalid_command");
                }
                callback.finish(r.put("ok",true));
            }catch(Exception e){String message=e.getMessage();callback.finish(error(message!=null&&message.matches("[a-z_]{2,60}")?message:"native_error"));}
        });
    }
    static void refresh(Context context,String token) {
        Context app=context.getApplicationContext();
        IO.execute(()->{try{SharedPreferences p=prefs(app);if(!p.getBoolean("enabled",false))return;
            JSONObject r=request("subscribe",body(p,token).put("preferences",new JSONObject(p.getString("preferences","{}"))));
            if(r.optBoolean("subscribed"))p.edit().putString("token",token).commit();
        }catch(Exception ignored){/* Next app sync retries registration. */}});
    }
}
