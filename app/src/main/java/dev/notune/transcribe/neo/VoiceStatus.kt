package dev.notune.transcribe.neo

/**
 * What the Rust voice engine's status texts (src/engine.rs, src/voice_session.rs) mean for the
 * "does the speech model work" question. Only a problem loading the model counts; a microphone
 * that failed to open, an empty recording or one failed transcription must not block dictation.
 */
object VoiceStatus {
    private val LOAD_FAILURES = listOf(
        "Error loading",           // imported model could not be read
        "Error: Model",            // "Model failed to load" / "Model error: ..."
        "Error: Asset error",
        "Error: Failed to resolve",
        "Error: model not loaded", // dictation asked for while no engine is loaded
        "Error: this device's CPU",
    )
    private val LOAD_OK = listOf("Ready", "Loading", "Checking", "Waiting")

    /** True when [status] says the model itself failed to load. */
    fun isLoadFailure(status: String): Boolean = LOAD_FAILURES.any { status.startsWith(it) }

    /** True when [status] says the model is loading or ready (it clears an earlier load failure). */
    fun clearsLoadFailure(status: String): Boolean = LOAD_OK.any { status.startsWith(it) }
}
