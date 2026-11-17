package dev.notune.transcribe.neo

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class SmokeTest {
    @Test
    fun realJsonOnTheJvm() {
        assertEquals("x", JSONObject("{\"a\":\"x\"}").getString("a"))
    }
}
