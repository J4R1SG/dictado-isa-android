package dev.notune.transcribe.neo

import java.security.MessageDigest
import java.security.SecureRandom
import java.text.Normalizer
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Error with a plain Spanish message the UI shows as is. `status` is the HTTP code, 0 if none. */
class NeoError(message: String, val status: Int = 0) : Exception(message)

/**
 * SCRAM-SHA-256(-PLUS) client pieces (RFC 5802 / RFC 7677), with channel binding
 * `tls-server-end-point` (RFC 5929: cbdata = SHA-256 of the server certificate DER).
 * Pure JVM code: no android.* so the JVM unit tests can run it.
 *
 * Text forms, exactly as the PC (neo_records/cuentas.py) builds them:
 *   client-first-bare      n=<user>,r=<cnonce>
 *   server-first           r=<nonce>,s=<salt>,i=<iter>
 *   client-final-no-proof  c=<b64("p=tls-server-end-point,," + cbdata)>,r=<nonce>   (c=biws without binding)
 *   AuthMessage            the three joined with ","
 */
object Scram {
    /** Iterations the phone uses for new passwords, and the minimum it accepts from the network. */
    const val ITER = 600_000
    const val MAX_ITER = 10_000_000
    private val GS2_PLUS = "p=tls-server-end-point,,".toByteArray(Charsets.US_ASCII)
    private const val GS2_NONE_B64 = "biws" // b64("n,,")

    private val NONCE_RE = Regex("[\\x21-\\x2b\\x2d-\\x7e]{16,128}")
    private val RAW_USER_RE = Regex("[A-Za-z0-9._-]{1,64}")
    private val rnd = SecureRandom()

    fun b64(raw: ByteArray): String = Base64.getEncoder().encodeToString(raw)

    /** Strict standard base64 (with padding); null if it is not. */
    fun unb64(text: String?): ByteArray? {
        if (text == null || text.length > 4096) return null
        return try {
            Base64.getDecoder().decode(text)
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

    fun hmac(key: ByteArray, msg: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(msg)
    }

    fun randomBytes(n: Int): ByteArray = ByteArray(n).also { rnd.nextBytes(it) }

    /** Client nonce: b64 of 18 random bytes (24 printable chars, no comma). */
    fun newCnonce(): String = b64(randomBytes(18))

    /** Constant-time comparison. */
    fun same(a: ByteArray?, b: ByteArray?): Boolean =
        a != null && b != null && MessageDigest.isEqual(a, b)

    /**
     * SASLprep-lite, same as the PC: NFKC, then reject control, format, surrogate,
     * private-use and unassigned code points.
     */
    fun normalize(password: String): String {
        val pw = Normalizer.normalize(password, Normalizer.Form.NFKC)
        var i = 0
        while (i < pw.length) {
            val cp = pw.codePointAt(i)
            when (Character.getType(cp)) {
                Character.CONTROL.toInt(), Character.FORMAT.toInt(), Character.SURROGATE.toInt(),
                Character.PRIVATE_USE.toInt(), Character.UNASSIGNED.toInt() ->
                    throw NeoError("La contraseña tiene caracteres que no se pueden usar.")
            }
            i += Character.charCount(cp)
        }
        return pw
    }

    /**
     * PBKDF2-HMAC-SHA256 with a 32-byte output (one block), over the UTF-8 bytes.
     * Written out instead of SecretKeyFactory because Android's PBKDF2 providers
     * have differed in how they turn a char[] password into bytes.
     */
    fun pbkdf2(password: ByteArray, salt: ByteArray, iterations: Int): ByteArray {
        require(iterations >= 1) { "iterations" }
        // SecretKeySpec refuses an empty key; an empty password is never valid anyway.
        if (password.isEmpty()) throw NeoError("Escribe la contraseña.")
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(password, "HmacSHA256"))
        mac.update(salt)
        mac.update(byteArrayOf(0, 0, 0, 1))
        var u = mac.doFinal()
        val out = u.copyOf()
        for (i in 1 until iterations) {
            u = mac.doFinal(u)
            for (j in out.indices) out[j] = (out[j].toInt() xor u[j].toInt()).toByte()
        }
        return out
    }

    fun saltedPassword(password: String, salt: ByteArray, iterations: Int): ByteArray =
        pbkdf2(normalize(password).toByteArray(Charsets.UTF_8), salt, iterations)

    class Keys(val clientKey: ByteArray, val storedKey: ByteArray, val serverKey: ByteArray)

    fun keys(salted: ByteArray): Keys {
        val clientKey = hmac(salted, "Client Key".toByteArray(Charsets.US_ASCII))
        return Keys(clientKey, sha256(clientKey), hmac(salted, "Server Key".toByteArray(Charsets.US_ASCII)))
    }

    fun clientFirstBare(user: String, cnonce: String) = "n=$user,r=$cnonce"

    fun serverFirst(nonce: String, saltB64: String, iterations: Int) = "r=$nonce,s=$saltB64,i=$iterations"

    /** c= value: GS2 header plus cbdata for SCRAM-PLUS, or "biws" (n,,) without channel binding. */
    fun channelBinding(cbdata: ByteArray?): String = if (cbdata == null) GS2_NONE_B64 else b64(GS2_PLUS + cbdata)

    fun clientFinalWithoutProof(nonce: String, cbdata: ByteArray?) = "c=${channelBinding(cbdata)},r=$nonce"

    fun authMessage(user: String, cnonce: String, nonce: String, saltB64: String, iterations: Int,
                    cbdata: ByteArray?): String =
        clientFirstBare(user, cnonce) + "," + serverFirst(nonce, saltB64, iterations) + "," +
            clientFinalWithoutProof(nonce, cbdata)

    /** ClientProof = ClientKey XOR HMAC(StoredKey, AuthMessage). */
    fun clientProof(keys: Keys, authMessage: String): ByteArray {
        val sig = hmac(keys.storedKey, authMessage.toByteArray(Charsets.UTF_8))
        return ByteArray(sig.size) { (keys.clientKey[it].toInt() xor sig[it].toInt()).toByte() }
    }

    fun serverSignature(serverKey: ByteArray, authMessage: String): ByteArray =
        hmac(serverKey, authMessage.toByteArray(Charsets.UTF_8))

    /** The user name as sent in n=: trimmed, lower case; null if it has characters SCRAM can't carry. */
    fun cleanUser(user: String?): String? {
        val u = (user ?: "").trim().lowercase(java.util.Locale.ROOT)
        return if (RAW_USER_RE.matches(u)) u else null
    }

    /** Answer to the first step, checked before any password work is done. */
    class ServerFirst(val sid: String, val saltB64: String, val salt: ByteArray, val iterations: Int, val nonce: String)

    /**
     * Checks the PC's first answer. A man in the middle chooses salt and iterations, so on the
     * network the iteration count must be at least [ITER] (a low count would make a captured proof
     * cheap to crack); the server nonce must extend our own.
     */
    fun checkServerFirst(cnonce: String, sid: Any?, saltB64: Any?, iterations: Any?, nonce: Any?,
                         minIter: Int = ITER): ServerFirst {
        val bad = NeoError("No es la computadora de la clínica.")
        if (sid !is String || sid.isEmpty() || sid.length > 128) throw bad
        if (saltB64 !is String) throw bad
        val salt = unb64(saltB64) ?: throw bad
        if (salt.size < 8 || salt.size > 64) throw bad
        if (iterations !is Int || iterations < minIter || iterations > MAX_ITER) throw bad
        if (nonce !is String || !NONCE_RE.matches(nonce) || !nonce.startsWith(cnonce) ||
            nonce.length <= cnonce.length) throw bad
        return ServerFirst(sid, saltB64, salt, iterations, nonce)
    }

    /** New-password keys computed on the phone (the new password never travels). */
    class NewKeys(val salt: ByteArray, val iterations: Int, val storedKey: ByteArray, val serverKey: ByteArray)

    fun newKeys(password: String, salt: ByteArray = randomBytes(16), iterations: Int = ITER): NewKeys {
        val k = keys(saltedPassword(password, salt, iterations))
        return NewKeys(salt, iterations, k.storedKey, k.serverKey)
    }
}
