# The Rust code (src/*.rs) calls these methods back by name over JNI, which
# R8 can't see: they must be neither removed, renamed nor changed in
# signature. (Native methods and their classes are kept by the default rules.)
-keepclassmembers class dev.notune.transcribe.NeoActivity {
    public void onStatusUpdate(java.lang.String);
    public void onAudioLevel(float);
    public void onAutoStop();
    public void onTextTranscribed(java.lang.String);
}
-keepclassmembers class dev.notune.transcribe.ModelsActivity {
    public void onStatusUpdate(java.lang.String);
}

# Shrink and optimize, but keep class and method names, so stack traces in
# bug reports stay readable. Exact line numbers need the build's mapping.txt.
-dontobfuscate
