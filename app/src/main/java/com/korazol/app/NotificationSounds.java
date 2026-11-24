package com.korazol.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Local, original event sounds. Android 8+ binds sound to notification channels:
 * changing the sound later requires a new channel ID (v2), never resetting a
 * user's notification preferences or silently deleting existing channels.
 */
final class NotificationSounds {
    private static final String PREFIX = "korazol_event_";
    private static final String VERSION = "_sound_v2";
    private static final String[] TYPES = {
        "goal", "kickoff", "secondhalf", "halftime",
        "fulltime", "yellow", "red", "general"
    };
    private static final String[] TITLES = {
        "⚽ الأهداف · هتاف الجمهور", "⏱ البداية · صافرة حكم", "▶ الشوط الثاني · صافرة حكم",
        "⏸ نهاية الشوط · صافرتان", "🏁 نهاية المباراة · ثلاث صافرات",
        "🟨 الكرت الأصفر · صافرة", "🟥 الكرت الأحمر · صافرة وجمهور",
        "🔔 تنبيهات كورة زول"
    };
    private static MediaPlayer currentPreview;

    private NotificationSounds() { }

    static String kind(String eventType) {
        String key = eventType == null ? "" : eventType.toLowerCase(Locale.ROOT);
        if (key.equals("goal") || key.equals("goal-home") || key.equals("goal-away")) return "goal";
        for (String item : TYPES) if (item.equals(key)) return item;
        return "general";
    }

    static boolean isPreviewable(String key) {
        if (key == null) return false;
        for (String item : TYPES) if (item.equals(key)) return true;
        return false;
    }

    static String channelId(String eventType) {
        return PREFIX + kind(eventType) + VERSION;
    }

    private static String rawName(String eventType) {
        return "korazol_" + kind(eventType);
    }

    static Uri soundUri(Context context, String eventType) {
        // The resource *name* stays stable when Android resource IDs change.
        return Uri.parse("android.resource://" + context.getPackageName() + "/raw/" + rawName(eventType));
    }

    static int resource(String eventType) {
        switch (kind(eventType)) {
            case "goal": return R.raw.korazol_goal;
            case "kickoff": return R.raw.korazol_kickoff;
            case "secondhalf": return R.raw.korazol_secondhalf;
            case "halftime": return R.raw.korazol_halftime;
            case "fulltime": return R.raw.korazol_fulltime;
            case "yellow": return R.raw.korazol_yellow;
            case "red": return R.raw.korazol_red;
            default: return R.raw.korazol_general;
        }
    }

    static AudioAttributes attributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    static void installChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        // Keep the legacy channel for already-sent, system-rendered FCM messages.
        manager.createNotificationChannel(new NotificationChannel(
            NativePush.CHANNEL, "إشعارات المباريات القديمة", NotificationManager.IMPORTANCE_HIGH));
        ArrayList<NotificationChannel> channels = new ArrayList<>();
        AudioAttributes attrs = attributes();
        for (int i = 0; i < TYPES.length; i++) {
            NotificationChannel channel = new NotificationChannel(
                channelId(TYPES[i]), TITLES[i], NotificationManager.IMPORTANCE_HIGH);
            channel.setSound(soundUri(context, TYPES[i]), attrs);
            channel.enableVibration(true);
            channel.setDescription("كورة زول: " + TITLES[i] + " — صوت خاص يمكن تغييره أو إيقافه من إعدادات أندرويد");
            channels.add(channel);
        }
        // Re-creating a channel preserves the user's notification sound/quiet settings.
        manager.createNotificationChannels(channels);
    }

    static boolean preview(Context context, String type) {
        if (!isPreviewable(type)) return false;
        if (currentPreview != null) {
            try { currentPreview.stop(); } catch (IllegalStateException ignored) { }
            currentPreview.release();
            currentPreview = null;
        }
        MediaPlayer player = new MediaPlayer();
        try {
            player.setAudioAttributes(attributes());
            player.setDataSource(context, soundUri(context, type));
            player.setOnCompletionListener(p -> {
                if (currentPreview == p) currentPreview = null;
                p.release();
            });
            player.setOnErrorListener((p, what, extra) -> {
                if (currentPreview == p) currentPreview = null;
                p.release();
                return true;
            });
            player.prepare();
            currentPreview = player;
            player.start();
            return true;
        } catch (Exception e) {
            player.release();
            currentPreview = null;
            return false;
        }
    }
}
