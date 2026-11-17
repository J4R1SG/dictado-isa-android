package dev.notune.transcribe.neo

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class MemStore : KeyValue {
    val map = mutableMapOf<String, String>()
    override fun get(key: String): String? = map[key]
    override fun put(values: Map<String, String?>) {
        for ((k, v) in values) if (v == null) map.remove(k) else map[k] = v
    }
}

/** Login, pinning, man-in-the-middle and session handling against [FakePc] over real TLS. */
class NeoClientTest {
    private lateinit var pc: FakePc
    private lateinit var store: MemStore
    private lateinit var client: NeoClient

    @Before
    fun setUp() {
        pc = FakePc()
        store = MemStore()
        client = NeoClient(store, { "Galaxy de prueba" }, { it == "127.0.0.1" }, pc.port)
    }

    @After
    fun tearDown() = pc.close()

    private fun expectError(block: () -> Unit): NeoError {
        try {
            block()
        } catch (e: NeoError) {
            return e
        }
        fail("expected NeoError")
        throw AssertionError()
    }

    private fun closedPort(): Int = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1")).use { it.localPort }

    private fun connectAndLogin(): JSONObject {
        assertEquals("PC-PRUEBA", client.connect("127.0.0.1").getString("name"))
        return client.login("Doc", "Prueba-123")
    }

    @Test
    fun connectRemembersThePc() {
        client.connect(" https://127.0.0.1/ ")
        assertEquals("127.0.0.1", client.host())
        assertEquals("PC-PRUEBA", client.last()!!.getString("name"))
        // The hello probe carries no credentials.
        assertNull(pc.seen.last().headers["authorization"])
    }

    @Test
    fun connectRefusesPublicOrOddAddresses() {
        val real = NeoClient(MemStore(), { "x" })
        for (bad in listOf("8.8.8.8", "neo.example.com", "", "192.168.1.0", "127.0.0.1")) {
            expectError { real.connect(bad) }
        }
    }

    @Test
    fun loginPinsTheCertificateAndKeepsTheToken() {
        val u = connectAndLogin()
        assertEquals("doc", u.getString("user"))
        assertTrue(u.getBoolean("must_change"))
        assertEquals(Scram.b64(Pin.of(pc.certs.getValue("a"))), store.map[NeoClient.K_PIN])
        assertNotNull(store.map[NeoClient.K_TOKEN])
        val inicio = pc.seen.first { it.path == "/api/v1/login/inicio" }
        assertEquals("1", inicio.headers["x-neo-records"])
        val fin = pc.seen.first { it.path == "/api/v1/login/fin" }
        val body = JSONObject(fin.body)
        assertEquals(client.deviceId(), body.getString("device"))
        assertEquals("Galaxy de prueba", body.getString("device_name"))
        assertFalse(fin.body.contains("Prueba-123"))
        assertEquals("doc", client.me()!!.getString("user"))
    }

    @Test
    fun wrongPasswordStoresNothing() {
        client.connect("127.0.0.1")
        val e = expectError { client.login("doc", "otra-cosa-9") }
        assertEquals("Usuario o contraseña incorrectos.", e.message)
        assertEquals(401, e.status)
        assertNull(store.map[NeoClient.K_TOKEN])
        assertNull(store.map[NeoClient.K_PIN])
    }

    @Test
    fun badServerSignatureMeansNotTheClinicPc() {
        client.connect("127.0.0.1")
        pc.badSignature = true
        val e = expectError { client.login("doc", "Prueba-123") }
        assertEquals(NeoClient.MSG_NO_ES, e.message)
        assertNull(store.map[NeoClient.K_TOKEN])
        assertNull(store.map[NeoClient.K_PIN])
    }

    @Test
    fun lowIterationCountIsRefusedBeforeSendingAProof() {
        pc.close()
        pc = FakePc(iterations = 4096)
        client = NeoClient(store, { "x" }, { it == "127.0.0.1" }, pc.port)
        client.connect("127.0.0.1")
        val e = expectError { client.login("doc", "Prueba-123") }
        assertEquals("No es la computadora de la clínica.", e.message)
        assertTrue(pc.seen.none { it.path == "/api/v1/login/fin" })
    }

    @Test
    fun certificateChangedBetweenTheTwoStepsAbortsBeforeTheProof() {
        client.connect("127.0.0.1")
        pc.switchCertAfterInicio = "b"
        val e = expectError { client.login("doc", "Prueba-123") }
        assertEquals(NeoClient.MSG_NO_ES, e.message)
        assertTrue(pc.seen.none { it.path == "/api/v1/login/fin" })
        assertNull(store.map[NeoClient.K_TOKEN])
    }

    @Test
    fun afterLoginADifferentCertificateNeverGetsTheToken() {
        connectAndLogin()
        pc.cert = "b"
        val e = expectError { client.api("GET", "/api/v1/consultas?date=11-16-2026", null) }
        assertEquals(495, e.status)
        assertEquals(NeoClient.MSG_OTRA_PC, e.message)
        assertTrue(pc.seen.none { it.cert == "b" && it.headers["authorization"] != null })
        // me() asks for a new login instead of failing; the token is not handed out.
        assertNull(client.me())
        assertTrue(pc.seen.none { it.cert == "b" })
        // A new login against the different certificate is refused before any proof is sent.
        val before = pc.seen.size
        val e2 = expectError { client.login("doc", "Prueba-123") }
        assertEquals(NeoClient.MSG_OTRA_PC, e2.message)
        assertEquals(495, e2.status)
        assertTrue(pc.seen.drop(before).none { it.path == "/api/v1/login/fin" })
        assertEquals(Scram.b64(Pin.of(pc.certs.getValue("a"))), store.map[NeoClient.K_PIN])
        // Same after a logout (the pin outlives the session).
        client.logout()
        assertTrue(expectError { client.login("doc", "Prueba-123") }.status == 495)
        // Connecting again is refused too, until the doctor forgets the PC.
        assertEquals(495, expectError { client.connect("127.0.0.1") }.status)
        client.forget()
        assertNull(client.host())
        assertNull(store.map[NeoClient.K_PIN])
        assertNull(store.map[NeoClient.K_TOKEN])
        client.connect("127.0.0.1")
        client.login("doc", "Prueba-123")
        assertEquals(Scram.b64(Pin.of(pc.certs.getValue("b"))), store.map[NeoClient.K_PIN])
        assertNotNull(client.api("GET", "/api/v1/consultas?date=11-16-2026", null))
    }

    @Test
    fun manualAddressWithPortIsRememberedAndUsed() {
        val c = NeoClient(store, { "x" }, { it == "127.0.0.1" }, 8768)
        assertEquals("PC-PRUEBA", c.connect("127.0.0.1:${pc.port}").getString("name"))
        assertEquals(pc.port.toString(), store.map[NeoClient.K_PORT])
        assertEquals(pc.port, c.last()!!.getInt("port"))
        assertEquals("doc", c.login("doc", "Prueba-123").getString("user"))
        assertEquals("doc", c.me()!!.getString("user"))
    }

    @Test
    fun reconnectWithoutPortKeepsStoredPort() {
        val c = NeoClient(store, { "x" }, { it == "127.0.0.1" }, 8768)
        c.connect("127.0.0.1:${pc.port}")
        // The page reconnects to the stored PC without a port.
        assertEquals("PC-PRUEBA", c.connect("127.0.0.1").getString("name"))
        assertEquals(pc.port.toString(), store.map[NeoClient.K_PORT])
        assertEquals(pc.port, c.connect("127.0.0.1", null).let { c.last()!!.getInt("port") })
    }

    @Test
    fun portFromPageIsUsed() {
        val c = NeoClient(store, { "x" }, { it == "127.0.0.1" }, 8768)
        c.connect("127.0.0.1", pc.port)
        assertEquals(pc.port.toString(), store.map[NeoClient.K_PORT])
    }

    @Test
    fun staleStoredPortFallsBackToTheDefaultPort() {
        // The PC was on another port before and went back to the default one.
        store.map[NeoClient.K_HOST] = "127.0.0.1"
        store.map[NeoClient.K_PORT] = closedPort().toString()
        assertEquals("PC-PRUEBA", client.connect("127.0.0.1").getString("name"))
        assertNull(store.map[NeoClient.K_PORT]) // the default is not stored
        assertEquals(pc.port, client.last()!!.getInt("port"))
        assertEquals("doc", client.login("doc", "Prueba-123").getString("user"))
    }

    @Test
    fun defaultPortFallbackStillNeedsThePinnedCertificate() {
        connectAndLogin()
        store.map[NeoClient.K_PORT] = closedPort().toString()
        pc.cert = "b"
        assertEquals(495, expectError { client.connect("127.0.0.1") }.status)
        assertTrue(pc.seen.none { it.cert == "b" })
    }

    @Test
    fun typedPortIsNotSwappedForTheDefault() {
        // A port typed by the doctor is the only one tried.
        val e = expectError { client.connect("127.0.0.1:${closedPort()}") }
        assertEquals(NeoClient.MSG_RED, e.message)
        assertNull(store.map[NeoClient.K_HOST])
    }

    @Test
    fun otherPcMessageUsesPlainWords() {
        assertTrue(NeoClient.MSG_OTRA_PC.contains("«Olvidar esta computadora»"))
        assertFalse(NeoClient.MSG_OTRA_PC.contains("certificado"))
        assertFalse(NeoClient.MSG_OTRA_PC.contains("PC"))
    }

    @Test
    fun discoveredPortIsUsedByConnect() {
        val c = NeoClient(store, { "x" }, { it == "127.0.0.1" }, 8768)
        c.noteDiscovered("127.0.0.1", pc.port)
        c.connect("127.0.0.1")
        assertEquals(pc.port, c.last()!!.getInt("port"))
    }

    @Test
    fun apiSendsTokenInHeaderAndParsesJson() {
        connectAndLogin()
        val r = client.api("GET", "/api/v1/consultas?date=11-16-2026&refresh=0", null) as JSONObject
        assertEquals(7, (r.getJSONArray("rows").get(0) as JSONObject).getInt("id"))
        val req = pc.seen.last()
        assertEquals("Bearer " + store.map[NeoClient.K_TOKEN], req.headers["authorization"])
        assertEquals(client.deviceId(), req.headers["x-neo-device"])
        assertFalse(req.path.contains(store.map[NeoClient.K_TOKEN]!!))
        assertNull(req.headers["content-type"])
    }

    @Test
    fun apiErrorsCarryTheSpanishTextAndStatus() {
        connectAndLogin()
        val e = expectError { client.api("POST", "/api/v1/crear-soap", JSONObject().put("date", "11-16-2026").put("id", 7)) }
        assertEquals("La nota ya tiene texto.", e.message)
        assertEquals(409, e.status)
        assertEquals("application/json; charset=utf-8", pc.seen.last().headers["content-type"])
    }

    @Test
    fun apiRefusesPathsOutsideApiV1() {
        connectAndLogin()
        val before = pc.seen.size
        for (p in listOf("/admin", "/api/v1/../x", "https://evil/api/v1/yo", "/api/v1//yo", "/api/v2/yo")) {
            expectError { client.api("GET", p, null) }
        }
        expectError { client.api("DELETE", "/api/v1/yo", null) }
        assertEquals(before, pc.seen.size)
    }

    @Test
    fun sessionEndedOnThePcDropsTheToken() {
        connectAndLogin()
        pc.dropAllSessions()
        val e = expectError { client.api("GET", "/api/v1/consultas", null) }
        assertEquals(401, e.status)
        assertNull(store.map[NeoClient.K_TOKEN])
        assertNull(client.me())
    }

    @Test
    fun meIsNullWithoutSessionAndThrowsWhenThePcIsUnreachable() {
        assertNull(client.me())
        connectAndLogin()
        pc.close()
        val e = expectError { client.me() }
        assertEquals(NeoClient.MSG_RED, e.message)
        assertNotNull(store.map[NeoClient.K_TOKEN]) // a network blip must not log the doctor out
    }

    @Test
    fun logoutForgetsTheTokenAndTellsThePc() {
        connectAndLogin()
        client.logout()
        assertNull(store.map[NeoClient.K_TOKEN])
        assertEquals("/api/v1/salir", pc.seen.last().path)
        assertNull(client.me())
    }

    @Test
    fun changePasswordSendsOnlyKeysAndTheNewPasswordWorks() {
        connectAndLogin()
        client.changePassword("Prueba-123", "Gatito-Feliz-42")
        val fin = pc.seen.first { it.path == "/api/v1/cuenta/clave/fin" }
        assertFalse(fin.body.contains("Gatito-Feliz-42"))
        assertFalse(fin.body.contains("Prueba-123"))
        val b = JSONObject(fin.body)
        assertEquals(Scram.ITER, b.getInt("new_iter"))
        assertEquals(16, Scram.unb64(b.getString("new_salt"))!!.size)
        assertFalse(client.me()!!.getBoolean("must_change"))
        client.logout()
        client.login("doc", "Gatito-Feliz-42")
        expectError { client.login("doc", "Prueba-123") }
    }

    @Test
    fun changePasswordChecksThePolicyBeforeTheNetwork() {
        connectAndLogin()
        val before = pc.seen.size
        assertEquals("La contraseña debe tener al menos 8 letras o números.", expectError { client.changePassword("Prueba-123", "corta") }.message)
        assertEquals("La contraseña nueva tiene que ser distinta a la de ahora.", expectError { client.changePassword("Prueba-123", "Prueba-123") }.message)
        assertEquals("Esa contraseña es muy fácil de adivinar. Usa otra.", expectError { client.changePassword("Prueba-123", "password123") }.message)
        // only the /yo lookups reached the PC
        assertTrue(pc.seen.drop(before).all { it.path == "/api/v1/yo" })
    }

    @Test
    fun changePasswordWithWrongOldPasswordKeepsTheSession() {
        connectAndLogin()
        val e = expectError { client.changePassword("No-Es-Esta-1", "Gatito-Feliz-42") }
        assertEquals("La contraseña de ahora no es correcta.", e.message)
        assertNotNull(client.me())
    }

    @Test
    fun deviceIdIsStableAndWellFormed() {
        val d = client.deviceId()
        assertTrue(Regex("[0-9a-f]{32}").matches(d))
        assertEquals(d, client.deviceId())
        assertEquals(d, store.map[NeoClient.K_DEVICE])
    }

    @Test
    fun arraysFromThePcComeBackAsArrays() {
        assertTrue(Bridge.parseResponse("[{\"id\":1}]") is JSONArray)
    }
}
