plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "pt.rui.soundbar"
    compileSdk = 35

    defaultConfig {
        applicationId = "pt.rui.soundbar"
        minSdk = 26
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    // Chave fixa: cada nova versão instala por cima da anterior sem perder a ligação à conta
    signingConfigs {
        create("soundbar") {
            storeFile = file("soundbar.jks")
            storePassword = "soundbar123"
            keyAlias = "soundbar"
            keyPassword = "soundbar123"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("soundbar")
        }
        debug {
            signingConfig = signingConfigs.getByName("soundbar")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
}
