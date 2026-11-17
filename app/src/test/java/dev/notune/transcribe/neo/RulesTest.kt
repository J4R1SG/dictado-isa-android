package dev.notune.transcribe.neo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

/** RFC 1918 host filter, certificate pin checks and the new-password policy. */
class RulesTest {

    @Test
    fun onlyPrivateIpv4Literals() {
        for (ok in listOf("10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.50.20", "192.168.60.7")) {
            assertTrue(ok, HostFilter.isAllowedHost(ok))
        }
        for (bad in listOf(
            "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "127.0.0.1", "169.254.1.1", "100.64.0.1",
            "0.0.0.0", "255.255.255.255", "192.168.1.0", "192.168.1.255", "192.168.001.5", "192.168.1.256",
            "192.168.1", "192.168.1.5.6", "localhost", "pc.local", "::1", "fe80::1", "192.168.1.5 ", "",
        )) {
            assertFalse(bad, HostFilter.isAllowedHost(bad))
        }
    }

    @Test
    fun typedAddressesAreCleaned() {
        assertEquals("192.168.50.20", HostFilter.normalize(" 192.168.50.20 "))
        assertEquals("192.168.50.20", HostFilter.normalize("https://192.168.50.20:8768/"))
        assertNull(HostFilter.normalize("192.168.50.20:9999"))
        assertNull(HostFilter.normalize("http://example.com"))
        assertNull(HostFilter.normalize("8.8.8.8"))
        assertNull(HostFilter.normalize(null))
        assertNull(HostFilter.normalize("1".repeat(100)))
    }

    @Test
    fun broadcastAndScanTargets() {
        assertEquals("192.168.50.255", HostFilter.broadcast("192.168.50.20", 24))
        assertEquals("10.1.255.255", HostFilter.broadcast("10.1.0.4", 16))
        assertEquals("172.16.0.7", HostFilter.broadcast("172.16.0.5", 30))
        assertNull(HostFilter.broadcast("192.168.50.20", 31))
        assertNull(HostFilter.broadcast("nope", 24))
        val t = HostFilter.scanTargets("192.168.50.20")
        assertEquals(253, t.size)
        assertFalse(t.contains("192.168.50.20"))
        assertTrue(t.contains("192.168.50.1") && t.contains("192.168.50.254"))
        assertTrue(HostFilter.scanTargets("8.8.8.8").isEmpty())
    }

    private fun cert(name: String): X509Certificate =
        javaClass.classLoader!!.getResourceAsStream(name).use {
            CertificateFactory.getInstance("X.509").generateCertificate(it) as X509Certificate
        }

    @Test
    fun pinnedTrustAcceptsOnlyThePinnedCertificate() {
        val a = cert("cert_a.pem")
        val b = cert("cert_b.pem")
        val pin = Pin.of(a.encoded)
        assertTrue(Pin.matches(pin, a.encoded))
        assertFalse(Pin.matches(pin, b.encoded))
        assertFalse(Pin.matches(null, a.encoded))
        assertFalse(Pin.matches(ByteArray(31), a.encoded))
        val t = PinnedTrust(pin)
        t.checkServerTrusted(arrayOf(a), "ECDHE_ECDSA")
        try {
            t.checkServerTrusted(arrayOf(b), "ECDHE_ECDSA")
            fail("b is not pinned")
        } catch (e: PinMismatch) {
            // expected
        }
        for (chain in listOf(emptyArray<X509Certificate>(), null)) {
            try {
                t.checkServerTrusted(chain, "ECDHE_ECDSA")
                fail("empty chain")
            } catch (e: CertificateException) {
                // expected
            }
        }
        try {
            t.checkClientTrusted(arrayOf(a), "x")
            fail("never trusts clients")
        } catch (e: CertificateException) {
            // expected
        }
        assertEquals(0, t.acceptedIssuers.size)
    }

    @Test
    fun captureTrustOnlyNeedsALeaf() {
        CaptureTrust().checkServerTrusted(arrayOf(cert("cert_b.pem")), "x")
        try {
            CaptureTrust().checkServerTrusted(emptyArray(), "x")
            fail("empty chain")
        } catch (e: CertificateException) {
            // expected
        }
    }

    @Test
    fun passwordPolicyMirrorsThePc() {
        assertNull(PasswordPolicy.check("ana", "Gatito-Feliz-42"))
        assertEquals("La contraseña debe tener al menos 8 letras o números.", PasswordPolicy.check("ana", "corta1"))
        assertEquals("La contraseña es demasiado larga (máximo 128).", PasswordPolicy.check("ana", "x1".repeat(65)))
        assertEquals("La contraseña no puede ser igual al usuario.", PasswordPolicy.check("doctora.ana", "Doctora.Ana"))
        assertEquals("Esa contraseña es muy fácil de adivinar. Usa otra.", PasswordPolicy.check("ana", "Password123"))
        assertEquals("Esa contraseña es muy fácil de adivinar. Usa otra.", PasswordPolicy.check("ana", "abababab"))
        assertEquals("Esa contraseña es muy fácil de adivinar. Usa otra.", PasswordPolicy.check("ana", "Contraseña1"))
        assertEquals("La contraseña tiene caracteres que no se pueden usar.", PasswordPolicy.check("ana", "abc\u0007defghij"))
        assertEquals("La contraseña nueva tiene que ser distinta a la de ahora.", PasswordPolicy.check("ana", "Gatito-Feliz-42", "Gatito-Feliz-42"))
        // Length counts letters, not UTF-16 units: 8 emoji are 8 characters.
        assertNull(PasswordPolicy.check("ana", "🐶🐱🐭🐹🐰🦊🐻🐼"))
    }

    @Test
    fun addressWithPort() {
        assertEquals("192.168.50.20" to 8770, HostFilter.parseAddress(" https://192.168.50.20:8770/ "))
        assertEquals("192.168.50.20" to null, HostFilter.parseAddress("192.168.50.20"))
        for (bad in listOf("192.168.50.20:", "192.168.50.20:80", "192.168.50.20:99999", "192.168.50.20:8a", "x:8768")) {
            assertNull(bad, HostFilter.parseAddress(bad))
        }
    }

    @Test
    fun onlyWifiInterfacesAreUsed() {
        assertTrue(HostFilter.isWifiInterface("wlan0"))
        assertFalse(HostFilter.isWifiInterface("rmnet_data1"))
        assertFalse(HostFilter.isWifiInterface("eth0"))
    }

    @Test
    fun onlyLoadErrorsMeanTheModelFailed() {
        for (m in listOf("Error: no audio recorded. Check microphone permissions.",
            "Error: failed to open microphone: busy", "Error: no microphone available. Check permissions.",
            "Error: transcription failed", "Listening...", "Ready")) {
            assertFalse(m, VoiceStatus.isLoadFailure(m))
        }
        for (m in listOf("Error loading x.gguf: bad", "Error: Model failed to load", "Error: Model error: x",
            "Error: model not loaded", "Error: Asset error: x")) {
            assertTrue(m, VoiceStatus.isLoadFailure(m))
        }
        assertTrue(VoiceStatus.clearsLoadFailure("Ready"))
        assertTrue(VoiceStatus.clearsLoadFailure("Loading model x..."))
        assertFalse(VoiceStatus.clearsLoadFailure("Listening..."))
    }
}
