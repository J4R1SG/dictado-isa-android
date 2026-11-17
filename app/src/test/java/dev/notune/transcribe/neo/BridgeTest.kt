package dev.notune.transcribe.neo

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Messages between the page and the app, and the /api/v1 path whitelist. */
class BridgeTest {

    @Test
    fun parsesWellFormedRequests() {
        val r = Bridge.parse("""{"id":7,"op":"api","args":{"method":"GET","path":"/api/v1/yo"}}""")!!
        assertEquals(7, r.id)
        assertEquals("api", r.op)
        assertEquals("/api/v1/yo", r.args.getString("path"))
        val s = Bridge.parse("""{"id":"a1","op":"discover"}""")!!
        assertEquals("a1", s.id)
        assertEquals(0, s.args.length())
        assertEquals(0, Bridge.parse("""{"id":1,"op":"me","args":null}""")!!.args.length())
        for (op in Bridge.OPS) assertEquals(op, Bridge.parse("""{"id":1,"op":"$op","args":{}}""")!!.op)
    }

    @Test
    fun ignoresMalformedRequests() {
        for (bad in listOf(
            null, "", "nope", "[]", "42", """{"op":"me"}""", """{"id":1}""", """{"id":1,"op":"reauth"}""",
            """{"id":1,"op":"me","args":[1]}""", """{"id":1,"op":"me","args":"x"}""", """{"id":true,"op":"me"}""",
            """{"id":{},"op":"me"}""", """{"id":"${"x".repeat(65)}","op":"me"}""",
            """{"id":1,"op":"me","pad":"${"x".repeat(Bridge.MAX_MESSAGE)}"}""",
        )) {
            assertNull(bad?.take(40), Bridge.parse(bad))
        }
    }

    @Test
    fun unknownOpsGetAnAnswerSoThePageDoesNotHang() {
        val r = JSONObject(Bridge.unknownOp("""{"id":3,"op":"reauth","args":{}}""")!!)
        assertEquals(3, r.getInt("id"))
        assertFalse(r.getBoolean("ok"))
        assertTrue(r.getString("error").isNotEmpty())
        assertNull(Bridge.unknownOp("""{"op":"x"}"""))
        assertNull(Bridge.unknownOp("garbage"))
    }

    @Test
    fun replyAndEventShapes() {
        val ok = JSONObject(Bridge.ok(5, JSONObject().put("name", "PC")))
        assertEquals(5, ok.getInt("id"))
        assertTrue(ok.getBoolean("ok"))
        assertEquals("PC", ok.getJSONObject("data").getString("name"))
        assertTrue(JSONObject(Bridge.ok(6, null)).isNull("data"))
        assertTrue(JSONObject(Bridge.ok(6, JSONArray().put(1))).get("data") is JSONArray)

        val err = JSONObject(Bridge.error("x", "Algo falló.", 409))
        assertEquals("x", err.getString("id"))
        assertFalse(err.getBoolean("ok"))
        assertEquals("Algo falló.", err.getString("error"))
        assertEquals(409, err.getInt("status"))
        assertFalse(JSONObject(Bridge.error(1, "x")).has("status"))

        val ev = JSONObject(Bridge.event("mic_level", 0.5))
        assertEquals("mic_level", ev.getString("event"))
        assertEquals(0.5, ev.getDouble("data"), 1e-9)
        assertFalse(ev.has("id"))
        assertEquals("Listening...", JSONObject(Bridge.event("mic_status", JSONObject().put("status", "Listening...")))
            .getJSONObject("data").getString("status"))
        try {
            Bridge.event("other", null)
            fail("unknown event")
        } catch (e: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun pathWhitelist() {
        for (ok in listOf(
            "/api/v1/yo", "/api/v1/consultas?date=11-16-2026&refresh=1", "/api/v1/consulta?date=11-16-2026&id=123",
            "/api/v1/trabajo?job=Ab_9-x", "/api/v1/cuenta/clave/inicio", "/api/v1/cola?date=11-16-2026",
            "/api/v1/borrador?date=11-16-2026&id=5%20",
        )) assertTrue(ok, Bridge.allowedPath(ok))
        for (bad in listOf(
            null, 5, "", "/", "/api/v1/", "/api/v1", "/api/v2/yo", "api/v1/yo", "/API/v1/yo", "/api/v1/../d/x",
            "/api/v1/./yo", "/api/v1//yo", "/api/v1/yo/", "/api/v1/yo#x", "/api/v1/yo?a=<b>", "/api/v1/yo?a=b c",
            "https://evil/api/v1/yo", "//evil/api/v1/yo", "/api/v1/yo\n", "/api/v1/y\\o", "/d/abc", "/api/v1/" + "a".repeat(80),
            "/api/v1/yo@evil", "/api/v1/yo?x=" + "a".repeat(600),
        )) assertFalse(bad.toString(), Bridge.allowedPath(bad))
    }

    @Test
    fun methodsAndBodies() {
        assertEquals("GET", Bridge.allowedMethod("GET"))
        assertEquals("POST", Bridge.allowedMethod("post"))
        for (bad in listOf("PUT", "DELETE", "", null, 1)) assertNull(Bridge.allowedMethod(bad))
        assertNull(Bridge.body("GET", JSONObject().put("a", 1)))
        assertEquals("{\"a\":1}", Bridge.body("POST", JSONObject().put("a", 1)))
        assertNull(Bridge.body("POST", null))
        assertNull(Bridge.body("POST", JSONObject.NULL))
        for (bad in listOf<Any>(JSONArray(), "x", 1)) {
            try {
                Bridge.body("POST", bad)
                fail("body must be an object")
            } catch (e: NeoError) {
                // expected
            }
        }
    }

    @Test
    fun pcResponsesAndErrors() {
        assertTrue(Bridge.parseResponse("{\"ok\":true}") is JSONObject)
        assertTrue(Bridge.parseResponse("[1,2]") is JSONArray)
        assertNull(Bridge.parseResponse("<html>"))
        assertNull(Bridge.parseResponse("\"text\""))
        assertNull(Bridge.parseResponse(""))
        assertEquals("No existe.", Bridge.errorText(JSONObject().put("ok", false).put("error", "No existe."), "x"))
        assertEquals("fallback", Bridge.errorText(JSONObject(), "fallback"))
        assertEquals("fallback", Bridge.errorText(null, "fallback"))
        assertEquals("fallback", Bridge.errorText(JSONObject().put("error", "e".repeat(400)), "fallback"))
        val u = Bridge.user(JSONObject().put("ok", true).put("user", "ana").put("name", "Ana").put("role", "doctor")
            .put("doctor", "Dra. Ana").put("must_change", true).put("extra", 1))
        assertFalse(u.has("ok") || u.has("extra"))
        assertEquals("ana", u.getString("user"))
        assertTrue(u.getBoolean("must_change"))
    }

    @Test
    fun discoveryAnswers() {
        val good = """{"svc":"neo-records","v":1,"port":8768,"name":"PC-RECEPCION"}"""
        val pc = Bridge.parseDiscovery("192.168.50.20", good)!!
        assertEquals("192.168.50.20", pc.getString("host"))
        assertEquals("PC-RECEPCION", pc.getString("name"))
        assertNull(Bridge.parseDiscovery("8.8.8.8", good))
        assertNull(Bridge.parseDiscovery("192.168.50.20", """{"svc":"other","v":1,"port":8768}"""))
        assertNull(Bridge.parseDiscovery("192.168.50.20", """{"svc":"neo-records","v":2,"port":8768}"""))
        assertNull(Bridge.parseDiscovery("192.168.50.20", """{"svc":"neo-records","v":1,"port":443}"""))
        assertNull(Bridge.parseDiscovery("192.168.50.20", """{"svc":"neo-records","v":1}"""))
        // The PC's configurable port (movil_puerto) is passed on.
        val other = Bridge.parseDiscovery("192.168.50.20", """{"svc":"neo-records","v":1,"port":8770,"name":"X"}""")!!
        assertEquals(8770, other.getInt("port"))
        assertEquals(8768, pc.getInt("port"))
        assertNull(Bridge.parseDiscovery("192.168.50.20", "NEO-RECORDS?v1"))
        assertNull(Bridge.parseDiscovery("192.168.50.20", "x".repeat(600)))
        val odd = Bridge.parseDiscovery("10.0.0.2", """{"svc":"neo-records","v":1,"port":8768,"name":"<img src=x>\u0007PC"}""")!!
        assertEquals("img srcxPC", odd.getString("name"))
        assertEquals("10.0.0.2", Bridge.parseDiscovery("10.0.0.2", """{"svc":"neo-records","v":1,"port":8768}""")!!.getString("name"))
    }

    @Test
    fun helloAnswers() {
        assertEquals("PC", Bridge.parseHello("""{"svc":"neo-records","v":1,"name":"PC"}"""))
        assertEquals("", Bridge.parseHello("""{"svc":"neo-records","v":1}"""))
        assertNull(Bridge.parseHello("""{"svc":"x","v":1}"""))
        assertNull(Bridge.parseHello("<html>"))
    }
}
