//! Voice for NeoActivity (the Neo Records app): same session code the old
//! RecognizeActivity popup used, exported under NeoActivity's JNI names.

use std::sync::Mutex;

use jni::objects::{JClass, JObject};
use jni::JNIEnv;
use once_cell::sync::Lazy;

use crate::voice_session::{self, VoiceSessionState};

static NEO_STATE: Lazy<Mutex<Option<VoiceSessionState>>> = Lazy::new(|| Mutex::new(None));

#[no_mangle]
pub unsafe extern "system" fn Java_dev_notune_transcribe_NeoActivity_initNative(
    env: JNIEnv,
    _class: JClass,
    activity: JObject,
) {
    let state = voice_session::init_session(env, activity);
    *NEO_STATE.lock().unwrap() = Some(state);
}

/// Only clears the session if it belongs to `activity`: a finishing popup
/// is often destroyed after the next one was already created, and must not
/// tear down the new popup's recording.
#[no_mangle]
pub unsafe extern "system" fn Java_dev_notune_transcribe_NeoActivity_cleanupNative(
    env: JNIEnv,
    _class: JClass,
    activity: JObject,
) {
    let mut guard = NEO_STATE.lock().unwrap();
    if guard
        .as_ref()
        .is_some_and(|s| env.is_same_object(&s.target_ref, &activity).unwrap_or(false))
    {
        *guard = None;
    }
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_notune_transcribe_NeoActivity_startRecording(
    env: JNIEnv,
    _class: JClass,
    auto_stop: jni::sys::jboolean,
) {
    let mut guard = NEO_STATE.lock().unwrap();
    if let Some(state) = guard.as_mut() {
        voice_session::start_recording(env, state, auto_stop != 0);
    }
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_notune_transcribe_NeoActivity_stopRecording(
    env: JNIEnv,
    _class: JClass,
) {
    let mut guard = NEO_STATE.lock().unwrap();
    if let Some(state) = guard.as_mut() {
        voice_session::stop_recording(env, state);
    }
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_notune_transcribe_NeoActivity_cancelRecording(
    env: JNIEnv,
    _class: JClass,
) {
    let mut guard = NEO_STATE.lock().unwrap();
    if let Some(state) = guard.as_mut() {
        crate::voice_session::cancel_recording(env, state);
    }
}
