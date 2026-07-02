package expo.modules.screencast

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.core.os.bundleOf
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import kotlin.math.max

private const val REQ = 6112

class ScreencastModule : Module() {
  private var projection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var pending: Promise? = null
  private var fps = 12
  private var quality = 55
  private var lastEmit = 0L
  private val handler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("Screencast")
    Events("frame")

    AsyncFunction("start") { f: Int, q: Int, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) { promise.reject("NO_ACTIVITY", "no current activity", null); return@AsyncFunction }
      fps = if (f < 1) 12 else f
      quality = q.coerceIn(20, 90)
      pending = promise
      val mpm = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      activity.startActivityForResult(mpm.createScreenCaptureIntent(), REQ)
    }

    Function("stop") { stopCapture() }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQ) return@OnActivityResult
      val p = pending; pending = null
      val data = payload.data
      if (payload.resultCode == Activity.RESULT_OK && data != null) {
        startCapture(payload.resultCode, data) // starts the fg service, then sets up capture async
        p?.resolve(true)
      } else {
        p?.resolve(false)
      }
    }

    OnDestroy { stopCapture() }
  }

  private fun startCapture(resultCode: Int, data: Intent) {
    val ctx: Context = appContext.reactContext ?: return
    // Android 14: the foreground service (type mediaProjection) must already be running before
    // getMediaProjection, so start it and set up capture a beat later.
    ctx.startForegroundService(Intent(ctx, ScreencastService::class.java))
    handler.postDelayed({ try { setupProjection(ctx, resultCode, data) } catch (_: Exception) { stopCapture() } }, 900)
  }

  private fun setupProjection(ctx: Context, resultCode: Int, data: Intent) {
    val mpm = ctx.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val proj = mpm.getMediaProjection(resultCode, data) ?: return
    projection = proj
    proj.registerCallback(object : MediaProjection.Callback() {
      override fun onStop() { stopCapture() }
    }, handler)

    val metrics = ctx.resources.displayMetrics
    val fullW = metrics.widthPixels
    val fullH = metrics.heightPixels
    val scale = if (max(fullW, fullH) > 1280) 1280f / max(fullW, fullH) else 1f
    val w = (fullW * scale).toInt() and 0x7FFFFFFE // even
    val h = (fullH * scale).toInt() and 0x7FFFFFFE

    val reader = ImageReader.newInstance(w, h, android.graphics.PixelFormat.RGBA_8888, 2)
    imageReader = reader
    virtualDisplay = proj.createVirtualDisplay(
      "sentivo-cast", w, h, metrics.densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.surface, null, handler
    )

    reader.setOnImageAvailableListener({ r ->
      val image = r.acquireLatestImage() ?: return@setOnImageAvailableListener
      val now = System.currentTimeMillis()
      if (now - lastEmit < 1000L / fps) { image.close(); return@setOnImageAvailableListener }
      lastEmit = now
      try {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPad = rowStride - pixelStride * w
        val bmp = Bitmap.createBitmap(w + rowPad / pixelStride, h, Bitmap.Config.ARGB_8888)
        bmp.copyPixelsFromBuffer(buffer)
        val out = ByteArrayOutputStream()
        val cropped = if (rowPad == 0) bmp else Bitmap.createBitmap(bmp, 0, 0, w, h)
        cropped.compress(Bitmap.CompressFormat.JPEG, quality, out)
        val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        sendEvent("frame", bundleOf("data" to b64))
        if (cropped != bmp) cropped.recycle()
        bmp.recycle()
      } catch (_: Exception) {}
      image.close()
    }, handler)
  }

  private fun stopCapture() {
    try { virtualDisplay?.release() } catch (_: Exception) {}
    try { imageReader?.close() } catch (_: Exception) {}
    try { projection?.stop() } catch (_: Exception) {}
    virtualDisplay = null; imageReader = null; projection = null
    val ctx = appContext.reactContext
    if (ctx != null) try { ctx.stopService(Intent(ctx, ScreencastService::class.java)) } catch (_: Exception) {}
  }
}
