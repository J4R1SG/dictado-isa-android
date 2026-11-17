package dev.notune.transcribe.neo

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class ScramTest {

    /** RFC 7677 §3 example: SCRAM-SHA-256 without channel binding (c=biws). */
    @Test
    fun rfc7677Vector() {
        val cnonce = "rOprNGfwEbeRWgbNEkqO"
        val sf = Scram.checkServerFirst(cnonce, "sid", "W22ZaJ0SNY7soEsUEjb6gQ==", 4096,
            "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF\$k0", minIter = 4096)
        val keys = Scram.keys(Scram.saltedPassword("pencil", sf.salt, sf.iterations))
        val am = Scram.authMessage("user", cnonce, sf.nonce, sf.saltB64, sf.iterations, null)
        assertEquals(
            "n=user,r=rOprNGfwEbeRWgbNEkqO," +
                "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF\$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096," +
                "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF\$k0",
            am,
        )
        assertEquals("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", Scram.b64(Scram.clientProof(keys, am)))
        assertEquals("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=", Scram.b64(Scram.serverSignature(keys.serverKey, am)))
    }

    /** The cross-language vector the PC side (Python) generated, with tls-server-end-point binding. */
    @Test
    fun channelBindingVectorFromThePc() {
        val v = JSONObject(javaClass.classLoader!!.getResource("scram_vector.json")!!.readText())
        val cbdata = Scram.unb64(v.getString("cbdata"))!!
        val salt = Scram.unb64(v.getString("salt"))!!
        val iter = v.getInt("iter")
        val user = v.getString("user")
        val cnonce = v.getString("cnonce")
        val nonce = v.getString("nonce")
        assertEquals(cnonce + v.getString("snonce"), nonce)

        assertEquals(v.getString("client_first_bare"), Scram.clientFirstBare(user, cnonce))
        assertEquals(v.getString("server_first"), Scram.serverFirst(nonce, v.getString("salt"), iter))
        assertEquals(v.getString("client_final_without_proof"), Scram.clientFinalWithoutProof(nonce, cbdata))
        val am = Scram.authMessage(user, cnonce, nonce, v.getString("salt"), iter, cbdata)
        assertEquals(v.getString("auth_message"), am)

        val keys = Scram.keys(Scram.saltedPassword(v.getString("password"), salt, iter))
        assertEquals(v.getString("stored_key"), Scram.b64(keys.storedKey))
        assertEquals(v.getString("server_key"), Scram.b64(keys.serverKey))
        assertEquals(v.getString("client_proof"), Scram.b64(Scram.clientProof(keys, am)))
        assertEquals(v.getString("server_signature"), Scram.b64(Scram.serverSignature(keys.serverKey, am)))

        // The keys of the new-password flow match what the PC would derive itself.
        val nk = Scram.newKeys(v.getString("password"), salt, iter)
        assertArrayEquals(keys.storedKey, nk.storedKey)
        assertArrayEquals(keys.serverKey, nk.serverKey)
    }

    @Test
    fun pbkdf2MatchesTheJdkForAscii() {
        val salt = Scram.randomBytes(16)
        val jdk = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(PBEKeySpec("Clave-de-prueba-77".toCharArray(), salt, 1000, 256)).encoded
        assertArrayEquals(jdk, Scram.pbkdf2("Clave-de-prueba-77".toByteArray(), salt, 1000))
    }

    @Test
    fun passwordsAreNfkcNormalizedLikeThePc() {
        val salt = Scram.randomBytes(16)
        // Full-width letters are the same password after NFKC.
        assertArrayEquals(
            Scram.saltedPassword("ｐａｓｓｗｏｒｄ９", salt, 10),
            Scram.saltedPassword("password9", salt, 10),
        )
        for (bad in listOf("abc\u0000defgh", "abc​defgh", "abcdefgh")) {
            try {
                Scram.normalize(bad)
                fail("should refuse $bad")
            } catch (e: NeoError) {
                assertEquals("La contraseña tiene caracteres que no se pueden usar.", e.message)
            }
        }
    }

    private fun refused(block: () -> Unit) {
        try {
            block()
            fail("expected refusal")
        } catch (e: NeoError) {
            assertEquals("No es la computadora de la clínica.", e.message)
        }
    }

    @Test
    fun serverFirstIsCheckedBeforeAnyPasswordWork() {
        val c = Scram.newCnonce()
        val good = c + Scram.b64(Scram.randomBytes(18))
        val salt = Scram.b64(Scram.randomBytes(16))
        Scram.checkServerFirst(c, "sid", salt, Scram.ITER, good)
        refused { Scram.checkServerFirst(c, "sid", salt, 4096, good) }               // cheap to crack
        refused { Scram.checkServerFirst(c, "sid", salt, Scram.MAX_ITER + 1, good) } // phone hang
        refused { Scram.checkServerFirst(c, "sid", salt, "600000", good) }
        refused { Scram.checkServerFirst(c, "sid", salt, Scram.ITER, "x" + good) }   // not our nonce
        refused { Scram.checkServerFirst(c, "sid", salt, Scram.ITER, c) }            // no server part
        refused { Scram.checkServerFirst(c, "sid", salt, Scram.ITER, "$good,x") }    // comma
        refused { Scram.checkServerFirst(c, "sid", "not base64!", Scram.ITER, good) }
        refused { Scram.checkServerFirst(c, "sid", Scram.b64(ByteArray(4)), Scram.ITER, good) }
        refused { Scram.checkServerFirst(c, null, salt, Scram.ITER, good) }
        refused { Scram.checkServerFirst(c, "", salt, Scram.ITER, good) }
    }

    @Test
    fun cnonceIsPrintableAndRandom() {
        val a = Scram.newCnonce()
        val b = Scram.newCnonce()
        assertEquals(24, a.length)
        assertFalse(a == b)
        assertFalse(a.contains(","))
    }

    @Test
    fun newKeysVerifyOnTheServerSide() {
        val nk = Scram.newKeys("Otra-Clave-55", iterations = 1000)
        assertEquals(16, nk.salt.size)
        // What the PC does at the next login with these keys:
        val keys = Scram.keys(Scram.saltedPassword("Otra-Clave-55", nk.salt, nk.iterations))
        val am = Scram.authMessage("ana", "c".repeat(24), "c".repeat(24) + "s".repeat(24), Scram.b64(nk.salt), 1000, ByteArray(32))
        val proof = Scram.clientProof(keys, am)
        val sig = Scram.hmac(nk.storedKey, am.toByteArray())
        val clientKey = ByteArray(32) { (proof[it].toInt() xor sig[it].toInt()).toByte() }
        assertArrayEquals(nk.storedKey, Scram.sha256(clientKey))
        assertArrayEquals(Scram.serverSignature(nk.serverKey, am), Scram.serverSignature(keys.serverKey, am))
    }

    @Test
    fun userNamesAreCleaned() {
        assertEquals("doc", Scram.cleanUser("  Doc "))
        assertEquals("dra.ana_2", Scram.cleanUser("Dra.Ana_2"))
        for (bad in listOf("", "a,b", "a=b", "año", "x".repeat(65), null)) assertEquals(null, Scram.cleanUser(bad))
    }

    @Test
    fun constantTimeCompareAndBase64() {
        assertTrue(Scram.same(byteArrayOf(1, 2), byteArrayOf(1, 2)))
        assertFalse(Scram.same(byteArrayOf(1, 2), byteArrayOf(1, 3)))
        assertFalse(Scram.same(null, byteArrayOf(1)))
        assertEquals(null, Scram.unb64("%%%"))
        assertEquals(null, Scram.unb64(null))
    }
}
