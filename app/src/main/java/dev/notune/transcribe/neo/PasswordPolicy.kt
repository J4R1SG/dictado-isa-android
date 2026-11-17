package dev.notune.transcribe.neo

import java.util.Locale

/**
 * New-password rules, checked on the phone because the PC never sees the new password
 * (it only gets the SCRAM keys). Mirrors politica_clave() in neo_records/cuentas.py.
 */
object PasswordPolicy {
    private val COMMON = setOf(
        "password", "password1", "password123", "passw0rd", "12345678", "123456789", "1234567890", "123456789a",
        "11111111", "00000000", "87654321", "12341234", "qwertyui", "qwerty123", "qwerty12", "asdfghjk", "abcd1234",
        "abc12345", "iloveyou", "sunshine", "princess", "football", "baseball", "superman", "trustno1", "welcome1",
        "admin123", "administrator", "letmein1", "contraseña", "contrasena", "contraseña1", "contrasena1",
        "micontraseña", "clave123", "clave1234", "12345678a", "a1234567", "veterinaria", "veterinario", "clinica1",
        "clinica123", "neorecords", "idexxneo", "doctor123", "doctora1",
        "perro123", "gato1234", "mascota1", "q1w2e3r4", "1q2w3e4r", "zaq12wsx", "changeme", "cambiame", "temporal",
    )

    /** Clinic-specific words of the PC's list, kept as SHA-256 so this public repo doesn't spell them out. */
    private val COMMON_SHA256 = setOf(
        "a1e5109600fbf93c1f8ac9a9c6629737eea67e2294dfd596f9fe43a96b986a09",
        "46e2439f98242057aa479c4410e406518339a21396165754b98765d63cd789a8",
        "6b9f6ffd19b3c60f1258a0d9b9251b182ae097033b8138f6b83705b80c4d9bb8",
    )

    private fun common(low: String): Boolean =
        low in COMMON || Scram.sha256(low.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) } in COMMON_SHA256

    /** Spanish message if the password can't be used, null if it is fine. */
    fun check(user: String?, password: String, old: String? = null): String? {
        val pw = try {
            Scram.normalize(password)
        } catch (e: NeoError) {
            return e.message
        }
        val n = pw.codePointCount(0, pw.length)
        if (n < 8) return "La contraseña debe tener al menos 8 letras o números."
        if (n > 128) return "La contraseña es demasiado larga (máximo 128)."
        val low = pw.lowercase(Locale.ROOT)
        if (low == (user ?: "").lowercase(Locale.ROOT)) return "La contraseña no puede ser igual al usuario."
        val distinct = low.codePoints().distinct().count()
        if (common(low) || distinct <= 2) return "Esa contraseña es muy fácil de adivinar. Usa otra."
        if (old != null && password == old) return "La contraseña nueva tiene que ser distinta a la de ahora."
        return null
    }
}
