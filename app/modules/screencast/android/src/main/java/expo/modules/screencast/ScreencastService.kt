package expo.modules.screencast

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

// A foreground service is mandatory before MediaProjection can start (Android 10+).
class ScreencastService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channelId = "sentivo_cast"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(
        NotificationChannel(channelId, "Screen cast", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, channelId)
      else @Suppress("DEPRECATION") Notification.Builder(this)
    val notif: Notification = builder
      .setContentTitle("Sentivo")
      .setContentText("Sharing your screen to the laptop")
      .setSmallIcon(android.R.drawable.ic_menu_share)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(1, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    } else {
      startForeground(1, notif)
    }
    return START_NOT_STICKY
  }
}
