package pt.rui.soundbar

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * A interface está em HTML/JS (assets/www). Esta Activity:
 *  - faz os pedidos HTTP à API SmartThings (sem limitações de CORS),
 *  - guarda as definições (SharedPreferences),
 *  - abre o início de sessão Samsung (OAuth) e apanha o código de autorização,
 *  - passa as teclas de volume do telemóvel para a soundbar.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var prefs: SharedPreferences
    private val pool = Executors.newFixedThreadPool(4)
    private val main = Handler(Looper.getMainLooper())
    private var authDialog: Dialog? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = abrirPrefs()

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0B0F17"))
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.textZoom = 100
        web.addJavascriptInterface(Bridge(), "Native")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url.toString()
                if (u.startsWith("file:///android_asset/")) return false
                abrirExterno(u)
                return true
            }
        }
        setContentView(web)
        web.loadUrl("file:///android_asset/www/index.html")
    }

    /** Guarda token e definições cifrados. Migra os dados da versão antiga (texto simples) uma vez. */
    private fun abrirPrefs(): SharedPreferences {
        val antigas = getSharedPreferences("soundbar", Context.MODE_PRIVATE)
        val segura = try {
            val mk = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
            EncryptedSharedPreferences.create(
                this, "soundbar_secure", mk,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Se o Android Keystore falhar, usa as preferências normais em vez de deixar a app sem arrancar
            return antigas
        }
        if (segura.all.isEmpty() && antigas.all.isNotEmpty()) {
            val ed = segura.edit()
            for ((k, v) in antigas.all) if (v is String) ed.putString(k, v)
            ed.apply()
            antigas.edit().clear().apply()
        }
        return segura
    }

    private fun js(code: String) {
        main.post { web.evaluateJavascript(code, null) }
    }

    private fun abrirExterno(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            Toast.makeText(this, "Não consegui abrir: $url", Toast.LENGTH_LONG).show()
        }
    }

    override fun onResume() {
        super.onResume()
        js("window.onAppResume && window.onAppResume()")
    }

    override fun onPause() {
        super.onPause()
        js("window.onAppPause && window.onAppPause()")
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            val ativo = prefs.getString("hwkeys", "1") != "0"
            if (ativo && authDialog == null) {
                val dir = if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) 1 else -1
                js("window.onHwVolume && window.onHwVolume($dir)")
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    @Deprecated("Usado para compatibilidade com versões antigas do Android")
    override fun onBackPressed() {
        js("(window.onBack && window.onBack()) || Native.exit()")
    }

    override fun onDestroy() {
        pool.shutdownNow()
        super.onDestroy()
    }

    // ---------- Início de sessão Samsung (OAuth) ----------

    @SuppressLint("SetJavaScriptEnabled")
    private fun abrirLogin(url: String, redirectPrefix: String) {
        authDialog?.dismiss()
        val d = Dialog(this, android.R.style.Theme_DeviceDefault_NoActionBar)
        val w = WebView(this)
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(w, true)
        var terminado = false

        fun verificar(u: String): Boolean {
            if (!terminado && u.startsWith(redirectPrefix)) {
                terminado = true
                js("window.__oauthCb(" + JSONObject.quote(u) + ")")
                d.dismiss()
                return true
            }
            return terminado
        }

        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return verificar(request.url.toString())
            }

            override fun onPageStarted(view: WebView, u: String, favicon: Bitmap?) {
                if (verificar(u)) view.stopLoading()
            }
        }
        d.setContentView(
            w,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        d.setOnCancelListener {
            if (!terminado) {
                terminado = true
                js("window.__oauthCb('')")
            }
        }
        d.setOnDismissListener {
            authDialog = null
            w.destroy()
        }
        authDialog = d
        d.show()
        w.loadUrl(url)
    }

    // ---------- Ponte JS <-> Android ----------

    inner class Bridge {

        @JavascriptInterface
        fun getPref(k: String): String = prefs.getString(k, "") ?: ""

        @JavascriptInterface
        fun setPref(k: String, v: String) {
            prefs.edit().putString(k, v).apply()
        }

        @JavascriptInterface
        fun http(id: String, method: String, url: String, headers: String, body: String) {
            pool.execute {
                var status = 0
                var texto: String
                try {
                    val c = URL(url).openConnection() as HttpURLConnection
                    c.requestMethod = method
                    c.connectTimeout = 15000
                    c.readTimeout = 20000
                    c.useCaches = false
                    val h = JSONObject(if (headers.isEmpty()) "{}" else headers)
                    val chaves = h.keys()
                    while (chaves.hasNext()) {
                        val k = chaves.next()
                        c.setRequestProperty(k, h.getString(k))
                    }
                    if (body.isNotEmpty() && method != "GET") {
                        c.doOutput = true
                        c.outputStream.use { os -> os.write(body.toByteArray(Charsets.UTF_8)) }
                    }
                    status = c.responseCode
                    val stream = if (status in 200..399) c.inputStream else c.errorStream
                    texto = stream?.bufferedReader(Charsets.UTF_8)?.use { r -> r.readText() } ?: ""
                    c.disconnect()
                } catch (e: Exception) {
                    texto = "ERRO DE REDE: " + (e.message ?: e.toString())
                }
                js("window.__nativeCb(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(texto) + ")")
            }
        }

        @JavascriptInterface
        fun oauth(url: String, redirectPrefix: String) {
            main.post { abrirLogin(url, redirectPrefix) }
        }

        @JavascriptInterface
        fun openExternal(url: String) {
            main.post { abrirExterno(url) }
        }

        @JavascriptInterface
        fun copy(text: String) {
            main.post {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("Soundbar", text))
                Toast.makeText(this@MainActivity, "Copiado", Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun exit() {
            main.post { finish() }
        }
    }
}
