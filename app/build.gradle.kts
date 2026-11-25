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
    // A chave vem dos segredos do GitHub Actions (nunca fica no repositório).
    // Sem as variáveis, a compilação local usa a chave de debug do Android.
    signingConfigs {
        create("release") {
            val ks = System.getenv("SB_KEYSTORE_PATH")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("SB_STORE_PASS")
                keyAlias = System.getenv("SB_KEY_ALIAS")
                keyPassword = System.getenv("SB_KEY_PASS")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (System.getenv("SB_KEYSTORE_PATH") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
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
    implementation("androidx.security:security-crypto:1.0.0")
}
