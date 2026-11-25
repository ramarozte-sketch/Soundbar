package pt.rui.soundbar

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.widget.RemoteViews
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Widget do ecrã inicial: volume −/+ e ligar/desligar. Usa o mesmo token e a mesma soundbar da app. */
class SoundbarWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) draw(context, mgr, id)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val act = intent.action ?: return
        if (act != ACTION_VOL_UP && act != ACTION_VOL_DOWN && act != ACTION_POWER) return
        val pending = goAsync()
        Thread {
            try {
                handle(context, act)
            } catch (e: Exception) {
                // falhas de rede ficam silenciosas no widget; a app mostra o erro
            } finally {
                refreshAll(context)
                pending.finish()
            }
        }.start()
    }

    private fun handle(ctx: Context, act: String) {
        val prefs = Store.open(ctx)
        val dev = prefs.getString("deviceId", "") ?: ""
        if (dev.isEmpty()) return
        val token = token(prefs) ?: return
        when (act) {
            ACTION_VOL_UP, ACTION_VOL_DOWN -> {
                val max = prefs.getString("maxVol", "100")?.toIntOrNull() ?: 100
                val cur = prefs.getString("lastVolume", "0")?.toIntOrNull() ?: 0
                val nv = (if (act == ACTION_VOL_UP) cur + 1 else cur - 1).coerceIn(0, max)
                if (post(token, dev, "audioVolume", "setVolume", "[$nv]"))
                    prefs.edit().putString("lastVolume", nv.toString()).apply()
            }
            ACTION_POWER -> {
                val want = prefs.getString("lastPower", "0") != "1"
                if (post(token, dev, "switch", if (want) "on" else "off", null))
                    prefs.edit().putString("lastPower", if (want) "1" else "0").apply()
            }
        }
    }

    /** Devolve um token válido; renova o OAuth se estiver perto de expirar. */
    private fun token(prefs: SharedPreferences): String? {
        return when (prefs.getString("authMode", "")) {
            "pat" -> prefs.getString("pat", null)
            "oauth" -> {
                val exp = prefs.getString("expiresAt", "0")?.toLongOrNull() ?: 0L
                if (System.currentTimeMillis() > exp - 5 * 60 * 1000) refresh(prefs)
                prefs.getString("accessToken", null)
            }
            else -> null
        }
    }

    private fun refresh(prefs: SharedPreferences): Boolean {
        val cid = prefs.getString("clientId", "") ?: ""
        val sec = prefs.getString("clientSecret", "") ?: ""
        val rt = prefs.getString("refreshToken", "") ?: ""
        val c = URL("https://api.smartthings.com/oauth/token").openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.connectTimeout = 10000; c.readTimeout = 15000
        val basic = android.util.Base64.encodeToString("$cid:$sec".toByteArray(), android.util.Base64.NO_WRAP)
        c.setRequestProperty("Authorization", "Basic $basic")
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        c.doOutput = true
        val form = "grant_type=refresh_token&client_id=" + URLEncoder.encode(cid, "UTF-8") +
            "&refresh_token=" + URLEncoder.encode(rt, "UTF-8")
        c.outputStream.use { it.write(form.toByteArray()) }
        if (c.responseCode !in 200..299) { c.disconnect(); return false }
        val j = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
        c.disconnect()
        prefs.edit()
            .putString("accessToken", j.getString("access_token"))
            .putString("refreshToken", j.optString("refresh_token", rt))
            .putString("expiresAt", (System.currentTimeMillis() + j.optLong("expires_in", 86399L) * 1000).toString())
            .apply()
        return true
    }

    private fun post(token: String, dev: String, cap: String, cmd: String, args: String?): Boolean {
        val arg = if (args != null) ",\"arguments\":$args" else ""
        val body = "{\"commands\":[{\"component\":\"main\",\"capability\":\"$cap\",\"command\":\"$cmd\"$arg}]}"
        val c = URL("https://api.smartthings.com/v1/devices/$dev/commands").openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.connectTimeout = 10000; c.readTimeout = 15000
        c.setRequestProperty("Authorization", "Bearer $token")
        c.setRequestProperty("Content-Type", "application/json")
        c.doOutput = true
        c.outputStream.use { it.write(body.toByteArray()) }
        val ok = c.responseCode in 200..299
        c.disconnect()
        return ok
    }

    private fun draw(ctx: Context, mgr: AppWidgetManager, id: Int) {
        val prefs = Store.open(ctx)
        val v = RemoteViews(ctx.packageName, R.layout.widget_soundbar)
        val on = prefs.getString("lastPower", "0") == "1"
        v.setTextViewText(R.id.wTitle, prefs.getString("deviceLabel", "Soundbar Q990B") ?: "Soundbar")
        v.setTextViewText(R.id.wVol, prefs.getString("lastVolume", "–") ?: "–")
        v.setTextViewText(R.id.wPower, if (on) "⏻ Desligar" else "⏻ Ligar")
        v.setOnClickPendingIntent(R.id.wUp, action(ctx, ACTION_VOL_UP, 1))
        v.setOnClickPendingIntent(R.id.wDown, action(ctx, ACTION_VOL_DOWN, 2))
        v.setOnClickPendingIntent(R.id.wPower, action(ctx, ACTION_POWER, 3))
        val open = PendingIntent.getActivity(
            ctx, 4, Intent(ctx, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        v.setOnClickPendingIntent(R.id.wTitle, open)
        mgr.updateAppWidget(id, v)
    }

    private fun action(ctx: Context, act: String, req: Int): PendingIntent {
        val i = Intent(ctx, SoundbarWidget::class.java).setAction(act)
        return PendingIntent.getBroadcast(
            ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    companion object {
        const val ACTION_VOL_UP = "pt.rui.soundbar.VOL_UP"
        const val ACTION_VOL_DOWN = "pt.rui.soundbar.VOL_DOWN"
        const val ACTION_POWER = "pt.rui.soundbar.POWER"

        fun refreshAll(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, SoundbarWidget::class.java))
            for (id in ids) SoundbarWidget().draw(ctx, mgr, id)
        }
    }
}
