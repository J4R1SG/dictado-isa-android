package dev.notune.transcribe.neo

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket

/**
 * A tiny HTTPS "clinic PC" for the JVM tests: speaks the server side of APP_SPEC §1.2 (SCRAM-SHA-256
 * with tls-server-end-point) on 127.0.0.1. The certificate it presents can be switched between two
 * throwaway test certificates (server_a.p12 / server_b.p12) to play a man in the middle.
 */
class FakePc(private val iterations: Int = Scram.ITER) : AutoCloseable {
    class Seen(val method: String, val path: String, val headers: Map<String, String>, val body: String, val cert: String)

    private val contexts = mapOf("a" to context("server_a.p12"), "b" to context("server_b.p12"))
    val certs: Map<String, ByteArray> = mapOf("a" to leaf("server_a.p12"), "b" to leaf("server_b.p12"))
    private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = socket.localPort
    private val running = AtomicBoolean(true)

    @Volatile var cert = "a"
    @Volatile var badSignature = false
    @Volatile var switchCertAfterInicio: String? = null
    val seen: MutableList<Seen> = Collections.synchronizedList(mutableListOf())
    var handshakesWithoutRequest = 0

    private class User(var salt: ByteArray, var iter: Int, var stored: ByteArray, var server: ByteArray, var mustChange: Boolean)
    private val users = mutableMapOf<String, User>()
    private class Pending(val user: String, val cnonce: String, val nonce: String, val salt: String, val iter: Int,
                          val purpose: String, val session: String?)
    private val pending = mutableMapOf<String, Pending>()
    private val sessions = mutableMapOf<String, Pair<String, String>>() // token -> (user, device)

    init {
        addUser("doc", "Prueba-123", mustChange = true)
        Thread { loop() }.apply { isDaemon = true }.start()
    }

    fun addUser(user: String, password: String, mustChange: Boolean = false) {
        val salt = Scram.randomBytes(16)
        val k = Scram.keys(Scram.saltedPassword(password, salt, iterations))
        users[user] = User(salt, iterations, k.storedKey, k.serverKey, mustChange)
    }

    private fun context(res: String): SSLContext {
        val ks = KeyStore.getInstance("PKCS12")
        javaClass.classLoader!!.getResourceAsStream(res).use { ks.load(it, "prueba".toCharArray()) }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, "prueba".toCharArray())
        return SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }
    }

    private fun leaf(res: String): ByteArray {
        val ks = KeyStore.getInstance("PKCS12")
        javaClass.classLoader!!.getResourceAsStream(res).use { ks.load(it, "prueba".toCharArray()) }
        return (ks.getCertificate(ks.aliases().nextElement()) as X509Certificate).encoded
    }

    private fun loop() {
        while (running.get()) {
            val raw = try {
                socket.accept()
            } catch (e: Exception) {
                return
            }
            val name = cert
            Thread { serve(raw, name) }.apply { isDaemon = true }.start()
        }
    }

    private fun serve(raw: Socket, certName: String) {
        try {
            raw.soTimeout = 10000
            val s = contexts.getValue(certName).socketFactory.createSocket(raw, "127.0.0.1", raw.port, true) as SSLSocket
            s.useClientMode = false
            s.use { ssl ->
                ssl.startHandshake()
                val input = BufferedInputStream(ssl.inputStream)
                val requestLine = readLine(input)
                if (requestLine.isEmpty()) {
                    synchronized(this) { handshakesWithoutRequest++ }
                    return
                }
                val headers = mutableMapOf<String, String>()
                while (true) {
                    val l = readLine(input)
                    if (l.isEmpty()) break
                    val i = l.indexOf(':')
                    if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
                }
                val len = headers["content-length"]?.toInt() ?: 0
                val body = ByteArray(len)
                var off = 0
                while (off < len) {
                    val n = input.read(body, off, len - off)
                    if (n < 0) break
                    off += n
                }
                val (method, path) = requestLine.split(" ").let { it[0] to it[1] }
                val text = String(body, Charsets.UTF_8)
                seen += Seen(method, path, headers, text, certName)
                val (code, obj) = handle(method, path, headers, text, certName)
                val out = obj.toString().toByteArray(Charsets.UTF_8)
                val head = "HTTP/1.1 $code X\r\nContent-Type: application/json; charset=utf-8\r\n" +
                    "Content-Length: ${out.size}\r\nConnection: close\r\n\r\n"
                ssl.outputStream.write(head.toByteArray(Charsets.US_ASCII) + out)
                ssl.outputStream.flush()
            }
        } catch (e: Exception) {
            synchronized(this) { handshakesWithoutRequest++ }
        }
    }

    private fun readLine(input: InputStream): String {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = input.read()
            if (c < 0 || c == '\n'.code) break
            if (c != '\r'.code) b.write(c)
        }
        return b.toString("UTF-8")
    }

    private fun err(code: Int, msg: String) = code to JSONObject().put("ok", false).put("error", msg)

    private fun session(headers: Map<String, String>): String? {
        val tok = headers["authorization"]?.removePrefix("Bearer ") ?: return null
        val s = synchronized(this) { sessions[tok] } ?: return null
        if (headers["x-neo-device"] != s.second) return null
        return s.first
    }

    @Synchronized
    private fun handle(method: String, path: String, h: Map<String, String>, body: String, certName: String): Pair<Int, JSONObject> {
        val cbdata = Pin.of(certs.getValue(certName))
        val b = if (body.isEmpty()) JSONObject() else JSONObject(body)
        when ("$method ${path.substringBefore('?')}") {
            "GET /api/v1/hola" -> return 200 to JSONObject().put("svc", "neo-records").put("v", 1).put("name", "PC-PRUEBA")
            "POST /api/v1/login/inicio", "POST /api/v1/cuenta/clave/inicio" -> {
                if (h["x-neo-records"] != "1") return err(403, "Petición no válida.")
                val clave = path.contains("clave")
                val user: String
                val sessionTok: String?
                if (clave) {
                    user = session(h) ?: return err(401, "Tu sesión terminó. Vuelve a entrar.")
                    sessionTok = h["authorization"]
                } else {
                    user = b.getString("user")
                    sessionTok = null
                }
                val u = users[user] ?: return err(401, "Usuario o contraseña incorrectos.")
                val cnonce = b.getString("cnonce")
                val nonce = cnonce + Scram.b64(Scram.randomBytes(18))
                val sid = "sid" + Scram.randomBytes(6).joinToString("") { "%02x".format(it) }
                pending[sid] = Pending(user, cnonce, nonce, Scram.b64(u.salt), u.iter, if (clave) "clave" else "login", sessionTok)
                switchCertAfterInicio?.let { cert = it }
                return 200 to JSONObject().put("sid", sid).put("salt", Scram.b64(u.salt)).put("iter", u.iter).put("nonce", nonce)
            }
            "POST /api/v1/login/fin", "POST /api/v1/cuenta/clave/fin" -> {
                if (h["x-neo-records"] != "1") return err(403, "Petición no válida.")
                val clave = path.contains("clave")
                val p = pending.remove(b.optString("sid")) ?: return err(401, "Usuario o contraseña incorrectos.")
                if (p.purpose != (if (clave) "clave" else "login")) return err(401, "Usuario o contraseña incorrectos.")
                if (clave && h["authorization"] != p.session) return err(401, "Usuario o contraseña incorrectos.")
                val u = users.getValue(p.user)
                val am = Scram.authMessage(p.user, p.cnonce, p.nonce, p.salt, p.iter, cbdata)
                val proof = Scram.unb64(b.optString("proof")) ?: ByteArray(32)
                val sig = Scram.hmac(u.stored, am.toByteArray(Charsets.UTF_8))
                val clientKey = ByteArray(32) { (proof.getOrElse(it) { 0 }.toInt() xor sig[it].toInt()).toByte() }
                if (!Scram.same(Scram.sha256(clientKey), u.stored)) return err(401, "Usuario o contraseña incorrectos.")
                val serverSig = if (badSignature) Scram.randomBytes(32) else Scram.serverSignature(u.server, am)
                if (clave) {
                    u.salt = Scram.unb64(b.getString("new_salt"))!!
                    u.iter = b.getInt("new_iter")
                    u.stored = Scram.unb64(b.getString("new_stored_key"))!!
                    u.server = Scram.unb64(b.getString("new_server_key"))!!
                    u.mustChange = false
                    return 200 to JSONObject().put("ok", true).put("server_sig", Scram.b64(serverSig))
                }
                val token = Scram.b64(Scram.randomBytes(32))
                sessions[token] = p.user to b.getString("device")
                return 200 to JSONObject().put("ok", true).put("server_sig", Scram.b64(serverSig)).put("token", token)
                    .put("user", yo(p.user))
            }
            "GET /api/v1/yo" -> {
                val user = session(h) ?: return err(401, "Tu sesión terminó. Vuelve a entrar.")
                return 200 to yo(user).put("ok", true)
            }
            "POST /api/v1/salir" -> {
                h["authorization"]?.removePrefix("Bearer ")?.let { sessions.remove(it) }
                return 200 to JSONObject().put("ok", true)
            }
            "GET /api/v1/consultas" -> {
                session(h) ?: return err(401, "Tu sesión terminó. Vuelve a entrar.")
                return 200 to JSONObject().put("ok", true).put("rows", org.json.JSONArray().put(JSONObject().put("id", 7)))
            }
            "POST /api/v1/crear-soap" -> {
                session(h) ?: return err(401, "Tu sesión terminó. Vuelve a entrar.")
                return err(409, "La nota ya tiene texto.")
            }
        }
        return err(404, "No existe.")
    }

    private fun yo(user: String): JSONObject {
        val u = users.getValue(user)
        return JSONObject().put("user", user).put("name", "Doctora").put("role", "admin").put("doctor", "")
            .put("must_change", u.mustChange)
    }

    fun dropAllSessions() = synchronized(this) { sessions.clear() }

    override fun close() {
        running.set(false)
        socket.close()
    }
}
