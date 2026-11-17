package dev.notune.transcribe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Names of imported models come from the file provider and must stay inside files/models. */
class ModelNameTest {
    @Test
    fun keepsOnlyAPlainGgufName() {
        assertEquals("model.gguf", ModelStore.safeModelName("model.gguf"))
        assertEquals("model.gguf", ModelStore.safeModelName("primary:Download/model.gguf"))
        assertEquals("x.gguf", ModelStore.safeModelName("../x.gguf"))
        assertEquals("x.gguf", ModelStore.safeModelName("a\b\x.gguf"))
        assertNull(ModelStore.safeModelName(null))
        assertNull(ModelStore.safeModelName("model.txt"))
        assertNull(ModelStore.safeModelName(".hidden.gguf"))
        assertNull(ModelStore.safeModelName("a..b.gguf"))
        assertNull(ModelStore.safeModelName("dir/"))
    }
}
