package dev.notune.transcribe.neo

/**
 * The app only talks to the clinic PC on the local network: literal private IPv4
 * addresses (RFC 1918: 10/8, 172.16/12, 192.168/16). Names are never resolved, so
 * DNS can't point the app somewhere else.
 */
object HostFilter {
    const val PORT = 8768
    private val QUAD = Regex("(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})")

    /** The four octets of a strict dotted quad (no leading zeros), or null. */
    fun octets(host: String): IntArray? {
        val m = QUAD.matchEntire(host) ?: return null
        val o = IntArray(4) { m.groupValues[it + 1].toInt() }
        return if (o.all { it in 0..255 }) o else null
    }

    fun isPrivate(o: IntArray): Boolean =
        o[0] == 10 || (o[0] == 172 && o[1] in 16..31) || (o[0] == 192 && o[1] == 168)

    /** True for a private IPv4 that can be a host (not .0 or .255 at the end). */
    fun isAllowedHost(host: String): Boolean {
        val o = octets(host) ?: return false
        return isPrivate(o) && o[3] in 1..254
    }

    /**
     * What the doctor typed in "Dirección de la PC", cleaned: spaces, an https:// prefix,
     * a trailing slash and the app's own port are tolerated. Null if it is not a dotted quad.
     */
    fun clean(input: String?): String? {
        var h = (input ?: "").trim()
        if (h.length > 64) return null
        h = h.removePrefix("https://").removePrefix("http://").trimEnd('/')
        h = h.removeSuffix(":$PORT")
        return if (octets(h) != null) h else null
    }

    /** [clean], and only if it is an allowed private host. */
    fun normalize(input: String?): String? = clean(input)?.takeIf { isAllowedHost(it) }

    /** Directed broadcast address of ip/prefix (for UDP discovery), or null. */
    fun broadcast(ip: String, prefix: Int): String? {
        val o = octets(ip) ?: return null
        if (prefix < 8 || prefix > 30) return null
        val addr = (o[0] shl 24) or (o[1] shl 16) or (o[2] shl 8) or o[3]
        val mask = if (prefix == 0) 0 else (-1 shl (32 - prefix))
        val b = (addr and mask) or mask.inv()
        return "${(b ushr 24) and 255}.${(b ushr 16) and 255}.${(b ushr 8) and 255}.${b and 255}"
    }

    /** Hosts .1-.254 of the /24 that holds [ip] (the phone itself left out), for the fallback scan. */
    fun scanTargets(ip: String): List<String> {
        val o = octets(ip) ?: return emptyList()
        if (!isPrivate(o)) return emptyList()
        val base = "${o[0]}.${o[1]}.${o[2]}."
        return (1..254).filter { it != o[3] }.map { base + it }
    }
}
