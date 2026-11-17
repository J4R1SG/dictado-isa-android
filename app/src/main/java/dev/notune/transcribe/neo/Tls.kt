package dev.notune.transcribe.neo

import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager

/**
 * Trust in the clinic PC. Its certificate is self-signed, so system CAs don't apply.
 *  - [Pinned]: normal calls. Only the certificate whose SHA-256 (of the DER) was pinned after
 *    the last verified login is accepted.
 *  - [Capture]: only for the login exchange and the hello probe. Any certificate is accepted
 *    for the handshake, but login then REQUIRES the SCRAM server signature computed with the
 *    channel binding of THAT certificate (tls-server-end-point), so a man in the middle fails.
 *    The hello probe sends no credentials.
 * Hostnames are not checked: the PC is reached by IP and the certificate itself is what counts.
 */
object Pin {
    /** cbdata for tls-server-end-point with a SHA-256 certificate signature = SHA-256(DER). */
    fun of(certDer: ByteArray): ByteArray = Scram.sha256(certDer)

    fun matches(pin: ByteArray?, certDer: ByteArray?): Boolean =
        pin != null && pin.size == 32 && certDer != null && Scram.same(pin, of(certDer))
}

class PinMismatch : CertificateException("certificate is not the pinned one")

open class BaseTrust : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("no client certificates")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        if (chain.isNullOrEmpty()) throw CertificateException("empty chain")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/** Accepts only the pinned leaf certificate. */
class PinnedTrust(private val pin: ByteArray) : BaseTrust() {
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        super.checkServerTrusted(chain, authType)
        if (!Pin.matches(pin, chain!![0].encoded)) throw PinMismatch()
    }
}

/** Accepts any leaf (see the class comment): login proves the PC with SCRAM afterwards. */
class CaptureTrust : BaseTrust()

object Tls {
    /** Used only on our own connections (set per connection, never as the default). */
    val ANY_HOST = HostnameVerifier { _, _ -> true }

    fun factory(trust: X509TrustManager): SSLSocketFactory {
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf(trust), SecureRandom())
        return ctx.socketFactory
    }
}
