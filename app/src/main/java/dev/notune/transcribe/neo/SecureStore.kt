package dev.notune.transcribe.neo

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The app's secrets (session token, certificate pin, device id, PC address) in one JSON blob,
 * encrypted with AES-256-GCM under a key that lives in the Android Keystore and never leaves it.
 * The blob sits in a private prefs file; backups are off (allowBackup=false, extraction rules).
 * If the key is gone or the blob is damaged, the store starts empty (the doctor logs in again).
 */
class SecureStore(context: Context) : KeyValue {
    private val prefs = context.getSharedPreferences("neo_seguro", Context.MODE_PRIVATE)
    private val lock = Any()
    private var cache: JSONObject? = null

    override fun get(key: String): String? = synchronized(lock) {
        load().optString(key, "").ifEmpty { null }
    }

    override fun put(values: Map<String, String?>) = synchronized(lock) {
        val o = load()
        for ((k, v) in values) if (v == null) o.remove(k) else o.put(k, v)
        try {
            prefs.edit().putString(BLOB, encrypt(o.toString().toByteArray(Charsets.UTF_8))).commit()
        } catch (e: Exception) {
            Log.e(TAG, "could not save the secure store", e)
        }
        cache = o
    }

    private fun load(): JSONObject {
        cache?.let { return it }
        val blob = prefs.getString(BLOB, null)
        val o = if (blob == null) JSONObject() else try {
            JSONObject(String(decrypt(blob), Charsets.UTF_8))
        } catch (e: Exception) {
            Log.w(TAG, "secure store unreadable; starting empty")
            JSONObject()
        }
        cache = o
        return o
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: ByteArray): String {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, key())
        val ct = c.doFinal(plain)
        return Scram.b64(c.iv) + ":" + Scram.b64(ct)
    }

    private fun decrypt(blob: String): ByteArray {
        val parts = blob.split(':')
        require(parts.size == 2) { "blob" }
        val iv = Scram.unb64(parts[0]) ?: throw IllegalArgumentException("iv")
        val ct = Scram.unb64(parts[1]) ?: throw IllegalArgumentException("ct")
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        return c.doFinal(ct)
    }

    private companion object {
        const val TAG = "NeoRecords"
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "neo_records_store_v1"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val BLOB = "blob"
    }
}
