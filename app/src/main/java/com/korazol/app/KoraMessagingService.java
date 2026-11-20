package com.korazol.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class KoraMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token){NativePush.refresh(this,token);}
    @SuppressLint("MissingPermission")
    @Override public void onMessageReceived(RemoteMessage message){
        if(!NativePush.allowed(this)||!NativePush.prefs(this).getBoolean("enabled",false))return;
        RemoteMessage.Notification payload=message.getNotification();
        if(payload==null)return;
        NativePush.createChannel(this);
        String tag=message.getData().get("tag");if(tag==null)tag="korazol";
        Intent launch=new Intent(this,MainActivity.class).putExtra("url",message.getData().get("url")).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending=PendingIntent.getActivity(this,tag.hashCode(),launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,NativePush.CHANNEL):new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_notification).setContentTitle(payload.getTitle()).setContentText(payload.getBody()).setStyle(new Notification.BigTextStyle().bigText(payload.getBody())).setContentIntent(pending).setAutoCancel(true);
        if(Build.VERSION.SDK_INT<26)builder.setDefaults(Notification.DEFAULT_ALL).setPriority(Notification.PRIORITY_HIGH);
        getSystemService(NotificationManager.class).notify(tag,1,builder.build());
    }
}
