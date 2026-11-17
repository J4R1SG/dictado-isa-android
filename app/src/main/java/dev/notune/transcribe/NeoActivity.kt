package dev.notune.transcribe

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import dev.notune.transcribe.neo.Bridge
import dev.notune.transcribe.neo.Discovery
import dev.notune.transcribe.neo.NeoClient
import dev.notune.transcribe.neo.NeoError
import dev.notune.transcribe.neo.SecureStore
import dev.notune.transcribe.neo.VoiceStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Neo Records on the phone. One full-screen WebView showing only the bundled page
 * (https://appassets.androidplatform.net/assets/ui/index.html, served from the APK by
 * WebViewAssetLoader). The page never touches the network: it asks this activity through
 * the "NeoBridge" message channel (see neo/Bridge.kt), and the activity talks to the clinic
 * PC (neo/NeoClient.kt) and runs the offline voice engine (src/neo_voice.rs).
 */
class NeoActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var client: NeoClient
    private lateinit var discovery: Discovery
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var reply: JavaScriptReplyProxy? = null

    // Voice
    private var nativeReady = false
    private var recording = false
    private var autoStop = false
    @Volatile private var lastStatus = ""
    // Set only when the speech MODEL failed to load; mic or transcription errors never set it.
    @Volatile private var modelFailed = false
    private var webDestroyed = false
    private var pendingMic: Bridge.Request? = null
    private var pendingMicAt = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // No screenshots, screen recording or previews in the app switcher: the screens show patients.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        writeModelLanguageOnce()

        val store = SecureStore(this)
        client = NeoClient(store, deviceName = { deviceName() })
        discovery = Discovery(client)

        WebView.setWebContentsDebuggingEnabled(false)
        web = WebView(this)
        val root = FrameLayout(this)
        val dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        root.setBackgroundColor(if (dark) Color.rgb(0x16, 0x1a, 0x1c) else Color.rgb(0xf6, 0xf3, 0xec))
        web.setBackgroundColor(Color.TRANSPARENT)
        // The login password must never be offered to a password manager / autofill service.
        web.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        // targetSdk 36 draws edge to edge: keep the page clear of the bars, the notch and the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            )
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsetsCompat.CONSUMED
        }

        setupWebView()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    private fun setupWebView() {
        val loader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            setGeolocationEnabled(false)
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                // Only the bundled page; everything else (any network URL) gets an empty 404.
                if (isAppUrl(request.url)) loader.shouldInterceptRequest(request.url)?.let { return it }
                return notFound()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !isAppUrl(request.url)

            // Android killed the page's renderer (low memory, crash). Without this the whole app dies.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                micCancelQuiet()
                reply = null
                (view.parent as? ViewGroup)?.removeView(view)
                if (!webDestroyed) {
                    webDestroyed = true
                    view.destroy()
                }
                main.post { if (!isFinishing && !isDestroyed) recreate() }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) =
                callback.invoke(origin, false, false)
            override fun onShowFileChooser(w: WebView?, cb: ValueCallback<Array<Uri>>?, p: WebChromeClient.FileChooserParams?) = false
            // The page may print patient data; nothing goes to the system log.
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?) = true
        }

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            web.loadDataWithBaseURL(null, OLD_WEBVIEW_PAGE, "text/html", "utf-8", null)
            return
        }
        WebViewCompat.addWebMessageListener(web, "NeoBridge", setOf(ORIGIN)) { _, message, sourceOrigin, isMainFrame, proxy ->
            if (!isMainFrame || sourceOrigin.scheme != "https" || sourceOrigin.host != ASSET_HOST) return@addWebMessageListener
            reply = proxy
            onBridgeMessage(message.data)
        }
        web.loadUrl(START_URL)
    }

    private fun isAppUrl(url: Uri): Boolean =
        url.scheme == "https" && url.host == ASSET_HOST && url.port == -1 &&
            (url.path ?: "").startsWith("/assets/ui/") && !(url.path ?: "").contains("..")

    private fun notFound() =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    // ------------------------------------------------------------------ bridge

    private fun post(msg: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) reply?.postMessage(msg)
        else main.post { reply?.postMessage(msg) }
    }

    private fun event(name: String, data: Any?) = post(Bridge.event(name, data))

    private fun onBridgeMessage(data: String?) {
        val req = Bridge.parse(data)
        if (req == null) {
            Bridge.unknownOp(data)?.let { post(it) }
            return
        }
        val a = req.args
        when (req.op) {
            "discover" -> work(req) { JSONObject().put("pcs", discovery.find()).put("last", client.last() ?: JSONObject.NULL) }
            "connect" -> work(req) { client.connect(a.opt("host") as? String, a.opt("port") as? Int) }
            "forget" -> {
                micCancelQuiet()
                work(req) { client.forget(); JSONObject() }
            }
            "login" -> work(req) { JSONObject().put("user", client.login(a.opt("user") as? String, a.opt("pass") as? String)) }
            "logout" -> {
                micCancelQuiet()
                work(req) { client.logout(); JSONObject() }
            }
            "me" -> work(req) { client.me() ?: JSONObject.NULL }
            "changePassword" -> work(req) {
                client.changePassword(a.opt("old") as? String, a.opt("new") as? String)
                JSONObject()
            }
            "api" -> work(req) { client.api(a.opt("method"), a.opt("path"), a.opt("body")) }
            "micStart" -> micStart(req)
            "micStop" -> {
                if (recording) {
                    recording = false
                    stopRecording()
                }
                post(Bridge.ok(req.id, JSONObject()))
            }
            "micCancel" -> {
                micCancelQuiet()
                post(Bridge.ok(req.id, JSONObject()))
            }
            "modelStatus" -> post(Bridge.ok(req.id, modelStatus()))
            "importModel" -> {
                micCancelQuiet()
                startActivity(Intent(this, ModelsActivity::class.java))
                post(Bridge.ok(req.id, JSONObject()))
            }
            "deviceName" -> post(Bridge.ok(req.id, JSONObject().put("name", deviceName())))
        }
    }

    /** Runs a blocking op off the main thread and answers the page. Errors never carry internals. */
    private fun work(req: Bridge.Request, block: () -> Any?) {
        scope.launch {
            val msg = try {
                Bridge.ok(req.id, withContext(Dispatchers.IO) { block() })
            } catch (e: NeoError) {
                Bridge.error(req.id, e.message ?: NeoClient.MSG_FALLA, e.status)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "op ${req.op} failed: ${e.javaClass.simpleName}")
                Bridge.error(req.id, NeoClient.MSG_FALLA)
            }
            post(msg)
        }
    }

    private fun deviceName(): String {
        val n = try {
            Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME)
        } catch (e: Exception) {
            null
        }
        return Bridge.cleanName(if (n.isNullOrBlank()) "${Build.MANUFACTURER} ${Build.MODEL}" else n, "Teléfono")
    }

    // ------------------------------------------------------------------ voice

    private fun ensureNative(): Boolean {
        if (!libsLoaded) return false
        if (!nativeReady) {
            initNative(this) // also starts loading the model in the background
            nativeReady = true
        }
        return true
    }

    private fun micStart(req: Bridge.Request) {
        if (!ModelStore.hasAnyModel(this)) {
            post(Bridge.error(req.id, "Falta el modelo de voz. Ve a Ajustes e importa el modelo."))
            return
        }
        if (!libsLoaded) {
            post(Bridge.error(req.id, "El dictado no funciona en este teléfono. Puedes escribir tu respuesta."))
            return
        }
        autoStop = req.args.optBoolean("autoStop", false)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startMic(req)
            return
        }
        pendingMic?.let { post(Bridge.error(it.id, getString(R.string.mic_denied))) }
        pendingMic = req
        pendingMicAt = SystemClock.elapsedRealtime()
        MaterialAlertDialogBuilder(this)
            .setTitle("Micrófono")
            .setMessage(R.string.mic_rationale)
            .setCancelable(false)
            .setPositiveButton("Continuar") { _, _ -> requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC) }
            .setNegativeButton("Ahora no") { _, _ -> failPendingMic(getString(R.string.mic_denied)) }
            .show()
    }

    private fun failPendingMic(message: String) {
        pendingMic?.let { post(Bridge.error(it.id, message)) }
        pendingMic = null
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_MIC) return
        val req = pendingMic ?: return
        pendingMic = null
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        when {
            !granted -> post(Bridge.error(req.id, getString(R.string.mic_denied)))
            // The page stops waiting after 15 s; don't start a recording it no longer expects.
            SystemClock.elapsedRealtime() - pendingMicAt > 13_000 ->
                post(Bridge.error(req.id, "Listo, ya hay permiso. Toca el micrófono otra vez para dictar."))
            else -> startMic(req)
        }
    }

    private fun startMic(req: Bridge.Request) {
        if (!ensureNative()) {
            post(Bridge.error(req.id, "El dictado no funciona en este teléfono. Puedes escribir tu respuesta."))
            return
        }
        if (recording) cancelRecording()
        lastStatus = "" // an old mic error must not describe this recording
        startRecording(autoStop)
        recording = true
        post(Bridge.ok(req.id, JSONObject()))
    }

    private fun micCancelQuiet() {
        if (recording) {
            recording = false
            cancelRecording()
        }
    }

    private fun modelStatus(): JSONObject {
        val has = ModelStore.hasAnyModel(this)
        val active = if (has) ModelStore.ensureValidSelection(this) else ""
        val s = lastStatus
        val failed = has && modelFailed
        val status = when {
            !has -> "Falta el modelo de voz. Toca «Importar modelo» y elige el archivo .gguf."
            failed -> "El modelo de voz no cargó. Toca «Importar modelo» y elige el archivo otra vez."
            s.startsWith("Loading") || s.startsWith("Waiting") || s.startsWith("Checking") -> "Cargando el modelo de voz…"
            else -> "Listo para dictar."
        }
        // Warm the engine up while the doctor is on the note screen, so the first dictation is quick.
        if (has && !failed && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            ensureNative()
        }
        return JSONObject()
            .put("ready", has && !failed)
            .put("name", if (!has) "" else active.ifEmpty { getString(R.string.models_builtin) })
            .put("status", status)
    }

    /** Spanish hint for models that take a language (harmless for Parakeet, which detects it). */
    private fun writeModelLanguageOnce() {
        try {
            val f = File(filesDir, "model_language")
            if (!f.exists()) f.writeText("es-ES")
        } catch (e: Exception) {
            Log.w(TAG, "could not write model_language")
        }
    }

    // Called by the Rust voice session (src/voice_session.rs) from its own threads.

    fun onStatusUpdate(status: String) {
        lastStatus = status
        if (VoiceStatus.isLoadFailure(status)) modelFailed = true
        else if (VoiceStatus.clearsLoadFailure(status)) modelFailed = false
        event("mic_status", JSONObject().put("status", status))
    }

    fun onAudioLevel(level: Float) {
        if (level.isNaN()) return
        event("mic_level", level.toDouble())
    }

    fun onTextTranscribed(text: String) {
        event("mic_text", JSONObject().put("text", text))
    }

    fun onAutoStop() {
        main.post {
            if (recording && autoStop) {
                recording = false
                stopRecording()
            }
        }
    }

    // ------------------------------------------------------------------ lifecycle

    override fun onResume() {
        super.onResume()
        // Back from the model screen: its reload reported there, so forget a stale status here.
        if (lastStatus.startsWith("Error")) lastStatus = ""
        modelFailed = false
    }

    override fun onStop() {
        super.onStop()
        // Never keep the microphone on in the background.
        micCancelQuiet()
    }

    override fun onDestroy() {
        micCancelQuiet()
        if (nativeReady) {
            try {
                cleanupNative(this)
            } catch (t: Throwable) {
                // ignore
            }
        }
        scope.cancel()
        reply = null
        if (!webDestroyed) {
            webDestroyed = true
            web.destroy()
        }
        super.onDestroy()
    }

    private external fun initNative(activity: NeoActivity)
    private external fun cleanupNative(activity: NeoActivity)
    private external fun startRecording(autoStop: Boolean)
    private external fun stopRecording()
    private external fun cancelRecording()

    companion object {
        private const val TAG = "NeoRecords"
        private const val REQ_MIC = 401
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$ASSET_HOST"
        const val START_URL = "$ORIGIN/assets/ui/index.html"
        private const val OLD_WEBVIEW_PAGE = "<!doctype html><meta charset=utf-8>" +
            "<meta name=viewport content='width=device-width,initial-scale=1'>" +
            "<body style='font:20px sans-serif;padding:24px'>Neo Records necesita una versión más nueva de " +
            "«Android System WebView». Actualízala en Play Store y vuelve a abrir la app.</body>"

        private val libsLoaded: Boolean = try {
            try {
                System.loadLibrary("c++_shared")
            } catch (e: UnsatisfiedLinkError) {
                // linked statically on some builds
            }
            System.loadLibrary("android_transcribe_app")
            true
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "native voice library missing", e)
            false
        }
    }
}
