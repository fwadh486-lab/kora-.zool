package com.korazol.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

public class KoraMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token){NativePush.refresh(this,token);}
    @SuppressLint("MissingPermission")
    @Override public void onMessageReceived(RemoteMessage message){
        if(!NativePush.allowed(this)||!NativePush.prefs(this).getBoolean("enabled",false))return;
        RemoteMessage.Notification payload=message.getNotification();
        Map<String,String> data=message.getData();
        String title=payload==null?data.get("title"):payload.getTitle();
        String body=payload==null?data.get("body"):payload.getBody();
        if(title==null||body==null)return;
        NativePush.createChannel(this);
        String tag=message.getData().get("tag");if(tag==null)tag="korazol";
        Intent launch=new Intent(this,MainActivity.class).putExtra("url",message.getData().get("url")).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending=PendingIntent.getActivity(this,tag.hashCode(),launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,NativePush.CHANNEL):new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setContentIntent(pending).setAutoCancel(true).setCategory(Notification.CATEGORY_EVENT).setColor(0xff14c78b);
        Bitmap image=fetchIcon(data.get("image"));
        if(image!=null)builder.setLargeIcon(image);
        if(Build.VERSION.SDK_INT<26)builder.setDefaults(Notification.DEFAULT_ALL).setPriority(Notification.PRIORITY_HIGH);
        getSystemService(NotificationManager.class).notify(tag,1,builder.build());
    }
    // A missing or slow portrait must never stop an alert from appearing.
    private Bitmap fetchIcon(String value){
        if(value==null||value.length()>400||!value.matches("(?i)https://img\\.thesports\\.com/football/(player|team)/[a-z0-9._/%-]+"))return null;
        HttpURLConnection connection=null;
        try{
            connection=(HttpURLConnection)new URL(value).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(1200);connection.setReadTimeout(1200);
            if(connection.getResponseCode()!=200||connection.getContentLength()>262144)return null;
            ByteArrayOutputStream output=new ByteArrayOutputStream();
            long deadline=android.os.SystemClock.elapsedRealtime()+1200;
            try(InputStream input=connection.getInputStream()){
                byte[] buffer=new byte[4096];int n;
                while((n=input.read(buffer))!=-1){if(output.size()+n>262144||android.os.SystemClock.elapsedRealtime()>deadline)return null;output.write(buffer,0,n);}
            }
            byte[] bytes=output.toByteArray();
            BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
            BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
            if(options.outWidth<=0||options.outHeight<=0||options.outWidth>4096||options.outHeight>4096)return null;
            options.inJustDecodeBounds=false;options.inSampleSize=1;
            while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>192)options.inSampleSize*=2;
            return BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
        }catch(Exception ignored){return null;}finally{if(connection!=null)connection.disconnect();}
    }
}
