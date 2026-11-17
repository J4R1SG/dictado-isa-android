package dev.notune.transcribe.neo

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Message format between the page (assets/ui) and the app. The page sends
 * NeoBridge.postMessage(JSON.stringify({id, op, args})); the app answers
 * {id, ok:true, data} or {id, ok:false, error:"<Spanish>", status?} and pushes events
 * {event:"mic_level"|"mic_status"|"mic_text", data}.
 */
object Bridge {
    const val MAX_MESSAGE = 256 * 1024
    val OPS = setOf(
        "discover", "connect", "login", "logout", "me", "changePassword", "api",
        "micStart", "micStop", "micCancel", "modelStatus", "importModel", "deviceName",
    )
    val EVENTS = setOf("mic_level", "mic_status", "mic_text")

    class Request(val id: Any, val op: String, val args: JSONObject)

    /** Parsed request, or null if the message is not a well-formed request (it is then ignored). */
    fun parse(message: String?): Request? {
        if (message == null || message.length > MAX_MESSAGE) return null
        val o = try {
            JSONTokener(message).nextValue() as? JSONObject ?: return null
        } catch (e: JSONException) {
            return null
        }
        val id = o.opt("id")
        val okId = (id is Int || id is Long) || (id is String && id.length in 1..64)
        if (!okId) return null
        val op = o.opt("op") as? String ?: return null
        if (op !in OPS) return null
        val args = when (val a = o.opt("args")) {
            null, JSONObject.NULL -> JSONObject()
            is JSONObject -> a
            else -> return null
        }
        return Request(id, op, args)
    }

    /** Reply for an op name the app does not know (so the page doesn't wait for its timeout). */
    fun unknownOp(message: String?): String? {
        if (message == null || message.length > MAX_MESSAGE) return null
        val o = try {
            JSONTokener(message).nextValue() as? JSONObject ?: return null
        } catch (e: JSONException) {
            return null
        }
        val id = o.opt("id")
        if (!(id is Int || id is Long || (id is String && id.length in 1..64))) return null
        return error(id, "La app no conoce esa acción. Actualiza la app.")
    }

    fun ok(id: Any, data: Any?): String =
        JSONObject().put("id", id).put("ok", true).put("data", data ?: JSONObject.NULL).toString()

    fun error(id: Any, message: String, status: Int = 0): String {
        val o = JSONObject().put("id", id).put("ok", false).put("error", message)
        if (status > 0) o.put("status", status)
        return o.toString()
    }

    fun event(name: String, data: Any?): String {
        require(name in EVENTS) { "unknown event" }
        return JSONObject().put("event", name).put("data", data ?: JSONObject.NULL).toString()
    }

    // ---- api op

    private val PATH_RE = Regex("/api/v1/[A-Za-z0-9_\\-/]{1,64}(\\?[A-Za-z0-9_\\-.=&%+]{0,512})?")

    /** True if the page may call this PC route: /api/v1/..., plain characters, no "..", "//" or fragments. */
    fun allowedPath(path: Any?): Boolean {
        if (path !is String || path.length > 600) return false
        if (!PATH_RE.matches(path)) return false
        val p = path.substringBefore('?')
        return !p.contains("//") && !p.contains("..") && !p.endsWith("/")
    }

    fun allowedMethod(method: Any?): String? = when (method) {
        "GET", "get" -> "GET"
        "POST", "post" -> "POST"
        else -> null
    }

    /** JSON body for POST: an object (or nothing). Arrays and scalars are refused. */
    fun body(method: String, body: Any?): String? {
        if (method == "GET") return null
        return when (body) {
            null, JSONObject.NULL -> null
            is JSONObject -> body.toString()
            else -> throw NeoError("Datos no válidos.")
        }
    }

    /** Any JSON value from the PC (objects or arrays like /cola); null if it is not JSON. */
    fun parseResponse(text: String): Any? = try {
        val v = JSONTokener(text).nextValue()
        if (v is JSONObject || v is JSONArray) v else null
    } catch (e: JSONException) {
        null
    }

    /** The Spanish "error" text from a PC error body, or the fallback. */
    fun errorText(parsed: Any?, fallback: String): String {
        val e = (parsed as? JSONObject)?.opt("error") as? String
        return if (e.isNullOrBlank() || e.length > 300) fallback else e
    }

    /** /yo answer without the "ok" field (the page gets the plain user). */
    fun user(o: JSONObject): JSONObject {
        val u = JSONObject()
        for (k in listOf("user", "name", "role", "doctor")) u.put(k, o.optString(k, ""))
        u.put("must_change", o.optBoolean("must_change", false))
        return u
    }

    // ---- discovery

    private val SAFE_NAME = Regex("[^\\p{L}\\p{N} ._-]")

    /** A short printable PC name for the screen. */
    fun cleanName(name: Any?, fallback: String): String {
        val n = (name as? String ?: "").replace(SAFE_NAME, "").trim().take(40)
        return n.ifEmpty { fallback }
    }

    /** UDP discovery answer {"svc":"neo-records","v":1,"port":8768,"name":...} from a private host. */
    fun parseDiscovery(fromHost: String, payload: String): JSONObject? {
        if (!HostFilter.isAllowedHost(fromHost) || payload.length > 512) return null
        val o = try {
            JSONTokener(payload).nextValue() as? JSONObject ?: return null
        } catch (e: JSONException) {
            return null
        }
        if (o.opt("svc") != "neo-records" || o.opt("v") != 1 || o.opt("port") != HostFilter.PORT) return null
        return JSONObject().put("host", fromHost).put("name", cleanName(o.opt("name"), fromHost))
    }

    /** GET /api/v1/hola answer: the PC name, or null if it is not Neo Records. */
    fun parseHello(payload: String): String? {
        val o = parseResponse(payload) as? JSONObject ?: return null
        if (o.opt("svc") != "neo-records" || o.opt("v") != 1) return null
        return cleanName(o.opt("name"), "")
    }
}
