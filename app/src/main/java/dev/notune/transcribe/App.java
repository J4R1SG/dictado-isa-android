package dev.notune.transcribe;

import android.app.Application;

import com.google.android.material.color.DynamicColors;

/** Material You en Android 12+ para la pantalla de modelos de voz. */
public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        DynamicColors.applyToActivitiesIfAvailable(this);
    }
}
