package dev.notune.transcribe

import android.os.Bundle
import android.util.Log
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity

/** Neo Records: scaffold (replaced in the next commit). */
class NeoActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(WebView(this))
    }

    fun onStatusUpdate(status: String) { Log.i(TAG, status) }
    fun onAudioLevel(level: Float) {}
    fun onTextTranscribed(text: String) {}
    fun onAutoStop() {}

    private external fun initNative(activity: NeoActivity)
    private external fun cleanupNative(activity: NeoActivity)
    private external fun startRecording(autoStop: Boolean)
    private external fun stopRecording()
    private external fun cancelRecording()

    companion object {
        private const val TAG = "NeoRecords"
    }
}
