package dev.notune.transcribe.neo

import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Finds the Neo Records PC on the local network:
 *  1. UDP broadcast "NEO-RECORDS?v1" to port 8769 (255.255.255.255 and the Wi-Fi broadcast
 *     address); answers are collected for 1.5 s.
 *  2. If nobody answered: HTTPS GET /api/v1/hola on every host of the phone's /24, 64 at a time
 *     with 400 ms timeouts. Any certificate is accepted for this hello only; nothing is sent.
 */
class Discovery(private val client: NeoClient) {
    companion object {
        const val UDP_PORT = 8769
        const val PROBE = "NEO-RECORDS?v1"
        const val UDP_WAIT_MS = 1500L
        const val SCAN_PARALLEL = 64
        const val SCAN_TIMEOUT_MS = 400
    }

    /** Private IPv4 addresses of this phone with their prefix length (Wi-Fi first). */
    fun localAddresses(): List<Pair<String, Int>> {
        val out = mutableListOf<Pair<String, Int>>()
        try {
            val ifaces = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
                .filter { it.isUp && !it.isLoopback && !it.isVirtual }
                .sortedBy { if (it.name.startsWith("wlan")) 0 else 1 }
            for (ni in ifaces) {
                for (ia in ni.interfaceAddresses) {
                    val a = ia.address as? Inet4Address ?: continue
                    val ip = a.hostAddress ?: continue
                    if (HostFilter.isAllowedHost(ip)) out += ip to ia.networkPrefixLength.toInt()
                }
            }
        } catch (e: Exception) {
            // no interfaces readable: discovery finds nothing, the manual address still works
        }
        return out.distinctBy { it.first }
    }

    fun find(): JSONArray {
        val locals = localAddresses()
        val found = LinkedHashMap<String, JSONObject>()
        for (pc in udp(locals)) found.putIfAbsent(pc.getString("host"), pc)
        if (found.isEmpty()) for (pc in scan(locals)) found.putIfAbsent(pc.getString("host"), pc)
        return JSONArray(found.values.toList())
    }

    private fun udp(locals: List<Pair<String, Int>>): List<JSONObject> {
        val out = mutableListOf<JSONObject>()
        val targets = (listOf("255.255.255.255") +
            locals.mapNotNull { (ip, prefix) -> HostFilter.broadcast(ip, prefix) }).distinct()
        try {
            DatagramSocket().use { s ->
                s.broadcast = true
                s.soTimeout = 150
                val msg = PROBE.toByteArray(Charsets.US_ASCII)
                fun sendAll() {
                    for (t in targets) {
                        try {
                            s.send(DatagramPacket(msg, msg.size, InetAddress.getByName(t), UDP_PORT))
                        } catch (e: Exception) {
                            // that broadcast address is not reachable from here
                        }
                    }
                }
                sendAll()
                var resent = false
                val start = System.nanoTime()
                val buf = ByteArray(512)
                while (System.nanoTime() - start < UDP_WAIT_MS * 1_000_000) {
                    if (!resent && System.nanoTime() - start > 600_000_000L) {
                        sendAll() // UDP can drop a datagram; one more try
                        resent = true
                    }
                    val p = DatagramPacket(buf, buf.size)
                    try {
                        s.receive(p)
                    } catch (e: SocketTimeoutException) {
                        continue
                    }
                    val from = (p.address as? Inet4Address)?.hostAddress ?: continue
                    val text = String(p.data, p.offset, p.length, Charsets.UTF_8)
                    Bridge.parseDiscovery(from, text)?.let { out += it }
                }
            }
        } catch (e: Exception) {
            // no socket (no network): fall through to the scan, which will also find nothing
        }
        return out
    }

    private fun scan(locals: List<Pair<String, Int>>): List<JSONObject> {
        val hosts = locals.take(2).flatMap { HostFilter.scanTargets(it.first) }.distinct()
        if (hosts.isEmpty()) return emptyList()
        val pool = Executors.newFixedThreadPool(SCAN_PARALLEL)
        try {
            val tasks = hosts.map { h ->
                Callable { client.hello(h, SCAN_TIMEOUT_MS)?.let { JSONObject().put("host", h).put("name", it.ifEmpty { h }) } }
            }
            return pool.invokeAll(tasks, 15, TimeUnit.SECONDS).mapNotNull {
                try {
                    if (it.isCancelled) null else it.get()
                } catch (e: Exception) {
                    null
                }
            }
        } finally {
            pool.shutdownNow()
        }
    }
}
