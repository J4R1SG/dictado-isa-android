package dev.notune.transcribe.neo

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket

/** The parts of [Discovery] that do not need a real Wi-Fi: asking a known host directly. */
class DiscoveryTest {
    private lateinit var pc: FakePc
    private lateinit var store: MemStore

    @Before
    fun setUp() {
        pc = FakePc()
        store = MemStore()
    }

    @After
    fun tearDown() = pc.close()

    private fun closedPort(): Int = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }

    private fun client(defaultPort: Int) = NeoClient(store, { "x" }, { it == "127.0.0.1" }, defaultPort)

    @Test
    fun storedPcIsAskedOnItsStoredPort() {
        val c = client(closedPort())
        store.map[NeoClient.K_HOST] = "127.0.0.1"
        store.map[NeoClient.K_PORT] = pc.port.toString()
        val found = Discovery(c).probeStored()!!
        assertEquals("127.0.0.1", found.getString("host"))
        assertEquals("PC-PRUEBA", found.getString("name"))
        assertEquals(pc.port, found.getInt("port"))
    }

    @Test
    fun storedPcBackOnTheDefaultPortIsFoundAndConnects() {
        val c = client(pc.port)
        store.map[NeoClient.K_HOST] = "127.0.0.1"
        store.map[NeoClient.K_PORT] = closedPort().toString()
        val found = Discovery(c).probeStored()!!
        assertEquals(pc.port, found.getInt("port"))
        // The page connects with the host only; the port that answered is used.
        assertEquals("PC-PRUEBA", c.connect("127.0.0.1").getString("name"))
        assertEquals(pc.port, c.last()!!.getInt("port"))
    }

    @Test
    fun nothingStoredMeansNothingProbed() {
        assertNull(Discovery(client(pc.port)).probeStored())
        assertEquals(0, pc.seen.size)
    }

    @Test
    fun scanAnswerCarriesThePortAndConnectUsesIt() {
        // Stored port is stale; the scan finds the PC on the client's default port.
        store.map[NeoClient.K_HOST] = "127.0.0.1"
        store.map[NeoClient.K_PORT] = closedPort().toString()
        val c = client(pc.port)
        val found = Discovery(c).helloAt("127.0.0.1", 2000)!!
        assertEquals(pc.port, found.getInt("port"))
        assertEquals("PC-PRUEBA", found.getString("name"))
        c.connect("127.0.0.1")
        assertEquals(pc.port.toString(), store.map[NeoClient.K_PORT])
    }

    @Test
    fun scanOfAHostWithoutAPcFindsNothing() {
        assertNull(Discovery(client(closedPort())).helloAt("127.0.0.1", 500))
    }
}
