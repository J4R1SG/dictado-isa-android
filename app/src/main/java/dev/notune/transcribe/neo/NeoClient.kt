package dev.notune.transcribe.neo

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException
import javax.net.ssl.X509TrustManager

/** Small persistent key/value store (the Keystore-encrypted one on the phone, a map in tests). */
interface KeyValue {
    fun get(key: String): String?
    fun put(values: Map<String, String?>)
}

/**
 * Talks to the clinic PC over HTTPS (port 8768 unless the PC announces another): login with SCRAM-SHA-256-PLUS, change of
 * password, and the /api/v1 calls. Blocking; call it from a background thread.
 *
 * Stored: host and name of the PC, the certificate pin, the session token, the device id.
 * The token is only ever sent over a connection whose certificate matches the pin, and once a
 * pin exists EVERY later connection (including a new login) must match it. Only a first-ever
 * connection (no pin) or [forget] may trust a certificate it has not seen.
 */
class NeoClient(
    private val store: KeyValue,
    private val deviceName: () -> String,
    // Only the JVM tests change these (to reach a fake PC on 127.0.0.1).
    private val allowHost: (String) -> Boolean = HostFilter::isAllowedHost,
    private val port: Int = HostFilter.PORT, // default port when the PC announced none
) {

    companion object {
        const val K_HOST = "host"
        const val K_NAME = "name"
        const val K_PORT = "port"
        const val K_PIN = "pin"
        const val K_TOKEN = "token"
        const val K_DEVICE = "device"

        const val MSG_RED = "No se pudo conectar con la computadora de la clínica. Revisa que el teléfono " +
            "esté en el wifi de la clínica y que Neo Records esté abierto en la computadora."
        const val MSG_NO_ES = "No es la computadora de la clínica. No escribas tu contraseña aquí."
        const val MSG_OTRA_PC = "La computadora de la clínica cambió. Si cambiaron la computadora o reinstalaron " +
            "Neo Records, toca «Olvidar esta computadora»."
        const val MSG_SESION = "Tu sesión se cerró. Entra otra vez."
        const val MSG_FALLA = "Algo falló. Intenta otra vez."
        const val MSG_SIN_PC = "Primero hay que encontrar la computadora de la clínica."
        const val MSG_FAIL = "Usuario o contraseña incorrectos."

        private const val MAX_RESPONSE = 4 * 1024 * 1024
        private val TOKEN_RE = Regex("[A-Za-z0-9+/]{43}=")
        private val DEVICE_RE = Regex("[A-Za-z0-9_-]{16,64}")
    }

    class Resp(val code: Int, val text: String, val certDer: ByteArray)

    // ---- stored state

    fun host(): String? = store.get(K_HOST)?.takeIf { allowHost(it) }

    fun last(): JSONObject? {
        val h = host() ?: return null
        return JSONObject().put("host", h).put("name", store.get(K_NAME) ?: h).put("port", currentPort())
    }

    /** Port used when the PC announced none (8768 on a phone). */
    val defaultPort: Int get() = port

    /** Port of the stored PC (movil_puerto on the PC), or the default. */
    private fun currentPort(): Int = HostFilter.validPort(store.get(K_PORT)?.toIntOrNull()) ?: port

    // Ports announced by the PC's UDP answer, for the PC the doctor is about to pick.
    private val discovered = ConcurrentHashMap<String, Int>()

    fun noteDiscovered(host: String, announcedPort: Int) {
        HostFilter.validPort(announcedPort)?.let { discovered[host] = it }
    }

    /** Forget the PC (host, name, port, certificate pin and session) so another one can be set up. */
    fun forget() {
        store.put(mapOf(K_HOST to null, K_NAME to null, K_PORT to null, K_PIN to null, K_TOKEN to null))
    }

    private fun pin(): ByteArray? = Scram.unb64(store.get(K_PIN))?.takeIf { it.size == 32 }

    private fun token(): String? = store.get(K_TOKEN)?.takeIf { TOKEN_RE.matches(it) }

    fun hasSession(): Boolean = token() != null && pin() != null && host() != null

    /** Random install id sent at login and with every call (the PC binds the session to it). */
    fun deviceId(): String {
        val d = store.get(K_DEVICE)
        if (d != null && DEVICE_RE.matches(d)) return d
        val n = Scram.randomBytes(16).joinToString("") { "%02x".format(it) }
        store.put(mapOf(K_DEVICE to n))
        return n
    }

    private fun dropSession() = store.put(mapOf(K_TOKEN to null))

    // ---- HTTP

    /**
     * One HTTPS request to [host]. [beforeBody] sees the server certificate after the handshake and
     * before anything is sent; it can throw to abort. Redirects are off, sizes capped.
     */
    fun request(host: String, method: String, path: String, body: String?, trust: X509TrustManager,
                headers: Map<String, String> = emptyMap(), connectMs: Int = 5000, readMs: Int = 30000,
                port: Int = currentPort(), beforeBody: ((ByteArray) -> Unit)? = null): Resp {
        if (!allowHost(host)) throw NeoError(MSG_SIN_PC)
        val c = URL("https", host, port, path).openConnection() as HttpsURLConnection
        try {
            c.sslSocketFactory = Tls.factory(trust)
            c.hostnameVerifier = Tls.ANY_HOST
            c.instanceFollowRedirects = false
            c.useCaches = false
            c.allowUserInteraction = false
            c.connectTimeout = connectMs
            c.readTimeout = readMs
            c.requestMethod = method
            c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("Connection", "close")
            c.setRequestProperty("X-Neo-Records", "1")
            for ((k, v) in headers) c.setRequestProperty(k, v)
            val bytes = body?.toByteArray(Charsets.UTF_8)
            if (bytes != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.setFixedLengthStreamingMode(bytes.size)
            }
            c.connect()
            val leaf = c.serverCertificates.firstOrNull() as? X509Certificate
                ?: throw NeoError(MSG_NO_ES)
            val der = leaf.encoded
            if (trust is PinnedTrust && !Pin.matches(pin(), der)) throw PinMismatch()
            beforeBody?.invoke(der)
            if (bytes != null) c.outputStream.use { it.write(bytes) }
            val code = c.responseCode
            val stream: InputStream? = if (code >= 400) c.errorStream else c.inputStream
            val text = stream?.use { readCapped(it) } ?: ""
            return Resp(code, text, der)
        } catch (e: NeoError) {
            throw e
        } catch (e: PinMismatch) {
            throw NeoError(MSG_OTRA_PC, 495)
        } catch (e: SSLException) {
            if (generateSequence<Throwable>(e) { it.cause }.any { it is PinMismatch }) throw NeoError(MSG_OTRA_PC, 495)
            throw NeoError(MSG_RED)
        } catch (e: SocketTimeoutException) {
            throw NeoError(MSG_RED)
        } catch (e: ConnectException) {
            throw NeoError(MSG_RED)
        } catch (e: NoRouteToHostException) {
            throw NeoError(MSG_RED)
        } catch (e: IOException) {
            throw NeoError(MSG_RED)
        } finally {
            c.disconnect()
        }
    }

    private fun readCapped(input: InputStream): String {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            if (out.size() > MAX_RESPONSE) throw NeoError(MSG_FALLA)
        }
        return out.toString("UTF-8")
    }

    private fun authHeaders(token: String): Map<String, String> =
        mapOf("Authorization" to "Bearer $token", "X-Neo-Device" to deviceId())

    private fun jsonOrFail(r: Resp, fallback: String = MSG_FALLA): JSONObject {
        val parsed = Bridge.parseResponse(r.text)
        if (r.code !in 200..299) throw NeoError(Bridge.errorText(parsed, fallback), r.code)
        return parsed as? JSONObject ?: throw NeoError(MSG_FALLA)
    }

    // ---- hello / connect

    /** GET /api/v1/hola with any certificate and no credentials. PC name, or null if it isn't one. */
    fun hello(host: String, timeoutMs: Int, helloPort: Int = port): String? = try {
        val r = request(host, "GET", "/api/v1/hola", null, CaptureTrust(), connectMs = timeoutMs, readMs = timeoutMs,
            port = helloPort)
        if (r.code == 200) Bridge.parseHello(r.text) else null
    } catch (e: NeoError) {
        null
    }

    /**
     * Checks that [input] ("192.168.x.x" or "192.168.x.x:port") is a Neo Records PC and remembers
     * it as the PC to use. With a pin already stored the PC must present that certificate.
     */
    fun connect(input: String?, portArg: Int? = null): JSONObject {
        val (host, typedPort) = HostFilter.parseAddress(input)?.takeIf { allowHost(it.first) }
            ?: throw NeoError("Esa dirección no es de la red de la clínica. Debe ser como 192.168.x.x.")
        val explicit = typedPort ?: HostFilter.validPort(portArg) ?: discovered[host]
        // Same PC as the stored one and no port given: try the port saved for it first. If the PC
        // went back to the default port, the saved one fails and the default one is tried next.
        val keptPort = if (explicit == null && store.get(K_HOST) == host)
            HostFilter.validPort(store.get(K_PORT)?.toIntOrNull()) else null
        val tries = if (explicit != null) listOf(explicit) else listOfNotNull(keptPort, port).distinct()
        val pin = pin()
        val trust = if (pin != null) PinnedTrust(pin) else CaptureTrust()
        for ((i, p) in tries.withIndex()) {
            val name = try {
                val r = request(host, "GET", "/api/v1/hola", null, trust, connectMs = 4000, readMs = 4000, port = p)
                (if (r.code == 200) Bridge.parseHello(r.text) else null) ?: throw NeoError(MSG_RED)
            } catch (e: NeoError) {
                if (e.status == 495) throw e
                if (i == tries.lastIndex) throw NeoError(MSG_RED)
                continue
            }
            // The default port is not stored, so a later default keeps working.
            val keep = if (explicit == null && p == port) null else p.toString()
            store.put(mapOf(K_HOST to host, K_NAME to name.ifEmpty { host }, K_PORT to keep))
            return JSONObject().put("name", name.ifEmpty { host })
        }
        throw NeoError(MSG_RED)
    }

    // ---- login

    /** SCRAM-SHA-256-PLUS login. Returns the user. The pin and token are stored only after the
     *  PC's signature checked out. */
    fun login(userIn: String?, password: String?): JSONObject {
        val host = host() ?: throw NeoError(MSG_SIN_PC)
        val user = Scram.cleanUser(userIn) ?: throw NeoError(MSG_FAIL, 401)
        if (password.isNullOrEmpty()) throw NeoError("Escribe la contraseña.")
        if (password.length > 1024) throw NeoError(MSG_FAIL, 401)
        Scram.normalize(password)
        val cnonce = Scram.newCnonce()
        // After the first verified login the pinned certificate is required here too: a different
        // certificate stops the login before any proof is computed or sent.
        val pin = pin()
        val capture: X509TrustManager = if (pin != null) PinnedTrust(pin) else CaptureTrust()

        val r1 = request(host, "POST", "/api/v1/login/inicio",
            JSONObject().put("user", user).put("cnonce", cnonce).toString(), capture)
        val first = jsonOrFail(r1, MSG_FAIL)
        val cbdata = Pin.of(r1.certDer)
        val sf = Scram.checkServerFirst(cnonce, first.opt("sid"), first.opt("salt"), first.opt("iter"), first.opt("nonce"))

        val keys = Scram.keys(Scram.saltedPassword(password, sf.salt, sf.iterations))
        val am = Scram.authMessage(user, cnonce, sf.nonce, sf.saltB64, sf.iterations, cbdata)
        val proof = Scram.clientProof(keys, am)
        val expected = Scram.serverSignature(keys.serverKey, am)

        val body = JSONObject().put("sid", sf.sid).put("proof", Scram.b64(proof))
            .put("device", deviceId()).put("device_name", deviceName().take(60))
        val r2 = request(host, "POST", "/api/v1/login/fin", body.toString(), capture) { der ->
            // The second step must reach the same certificate the first one saw.
            if (!Scram.same(Pin.of(der), cbdata)) throw NeoError(MSG_NO_ES)
        }
        val fin = jsonOrFail(r2, MSG_FAIL)
        val sig = Scram.unb64(fin.opt("server_sig") as? String)
        if (!Scram.same(sig, expected)) throw NeoError(MSG_NO_ES)
        val token = fin.opt("token") as? String
        val u = fin.optJSONObject("user")
        if (token == null || !TOKEN_RE.matches(token) || u == null) throw NeoError(MSG_FALLA)
        store.put(mapOf(K_PIN to Scram.b64(cbdata), K_TOKEN to token))
        return Bridge.user(u)
    }

    // ---- session calls

    /** The logged-in user, or null when there is no session or the PC says it ended (401) or the
     *  PC's certificate changed. Network failures throw (they must not log the doctor out). */
    fun me(): JSONObject? {
        val token = token() ?: return null
        val host = host() ?: return null
        val pin = pin() ?: return null
        val r = try {
            request(host, "GET", "/api/v1/yo", null, PinnedTrust(pin), authHeaders(token), readMs = 10000)
        } catch (e: NeoError) {
            if (e.status == 495) return null
            throw e
        }
        if (r.code == 401) {
            dropSession()
            return null
        }
        return Bridge.user(jsonOrFail(r))
    }

    fun logout() {
        val token = token()
        val host = host()
        val pin = pin()
        dropSession()
        if (token != null && host != null && pin != null) {
            try {
                request(host, "POST", "/api/v1/salir", null, PinnedTrust(pin), authHeaders(token),
                    connectMs = 3000, readMs = 5000)
            } catch (e: NeoError) {
                // The token is already forgotten here; the PC expires it on its own.
            }
        }
    }

    /** api op: GET/POST to an /api/v1 route with the session. Returns the parsed JSON. */
    fun api(method: Any?, path: Any?, body: Any?): Any {
        val m = Bridge.allowedMethod(method) ?: throw NeoError("Datos no válidos.")
        if (!Bridge.allowedPath(path)) throw NeoError("Datos no válidos.")
        val token = token() ?: throw NeoError(MSG_SESION, 401)
        val host = host() ?: throw NeoError(MSG_SIN_PC)
        val pin = pin() ?: throw NeoError(MSG_SESION, 401)
        val r = request(host, m, path as String, Bridge.body(m, body), PinnedTrust(pin), authHeaders(token))
        val parsed = Bridge.parseResponse(r.text)
        if (r.code == 401) {
            dropSession()
            throw NeoError(Bridge.errorText(parsed, MSG_SESION), 401)
        }
        if (r.code !in 200..299) throw NeoError(Bridge.errorText(parsed, MSG_FALLA), r.code)
        return parsed ?: throw NeoError(MSG_FALLA)
    }

    /**
     * Change of password: SCRAM proof of the OLD password (same channel binding) and the NEW keys
     * computed here, so the new password never leaves the phone.
     */
    fun changePassword(old: String?, new: String?) {
        if (old.isNullOrEmpty()) throw NeoError("Escribe tu contraseña de ahora.")
        if (new.isNullOrEmpty()) throw NeoError("Escribe la contraseña nueva.")
        val me = me() ?: throw NeoError(MSG_SESION, 401)
        val user = me.getString("user")
        PasswordPolicy.check(user, new, old)?.let { throw NeoError(it) }
        Scram.normalize(old)
        val token = token() ?: throw NeoError(MSG_SESION, 401)
        val host = host() ?: throw NeoError(MSG_SIN_PC)
        val pin = pin() ?: throw NeoError(MSG_SESION, 401)
        val trust = PinnedTrust(pin)
        val headers = authHeaders(token)

        val cnonce = Scram.newCnonce()
        val r1 = request(host, "POST", "/api/v1/cuenta/clave/inicio",
            JSONObject().put("cnonce", cnonce).toString(), trust, headers)
        if (r1.code == 401) {
            dropSession()
            throw NeoError(Bridge.errorText(Bridge.parseResponse(r1.text), MSG_SESION), 401)
        }
        val first = jsonOrFail(r1)
        val cbdata = Pin.of(r1.certDer)
        val sf = Scram.checkServerFirst(cnonce, first.opt("sid"), first.opt("salt"), first.opt("iter"), first.opt("nonce"))
        // The PC hands out the salt for the new password, so a changed password looks the same from
        // outside as an untouched one. Older PCs do not send it: then a random salt is used.
        val given = Scram.unb64(first.optString("new_salt", ""))
        val nk = if (given != null && given.size == 16) Scram.newKeys(new, given) else Scram.newKeys(new)
        val keys = Scram.keys(Scram.saltedPassword(old, sf.salt, sf.iterations))
        val am = Scram.authMessage(user, cnonce, sf.nonce, sf.saltB64, sf.iterations, cbdata)
        val expected = Scram.serverSignature(keys.serverKey, am)
        val body = JSONObject()
            .put("sid", sf.sid)
            .put("proof", Scram.b64(Scram.clientProof(keys, am)))
            .put("new_salt", Scram.b64(nk.salt))
            .put("new_iter", nk.iterations)
            .put("new_stored_key", Scram.b64(nk.storedKey))
            .put("new_server_key", Scram.b64(nk.serverKey))
        val r2 = request(host, "POST", "/api/v1/cuenta/clave/fin", body.toString(), trust, headers) { der ->
            if (!Scram.same(Pin.of(der), cbdata)) throw NeoError(MSG_NO_ES)
        }
        if (r2.code == 401) {
            val msg = Bridge.errorText(Bridge.parseResponse(r2.text), MSG_FAIL)
            // A wrong old password is a 401 with the generic text; the session itself is still fine.
            if (msg == MSG_FAIL) throw NeoError("La contraseña de ahora no es correcta.", 400)
            dropSession()
            throw NeoError(msg, 401)
        }
        val fin = jsonOrFail(r2)
        if (!Scram.same(Scram.unb64(fin.opt("server_sig") as? String), expected)) throw NeoError(MSG_NO_ES)
    }
}
