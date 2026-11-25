package pt.rui.soundbar

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

object Store {
    /** Guarda token e definições cifrados. Migra os dados da versão antiga (texto simples) uma vez. */
    fun open(ctx: Context): SharedPreferences {
        val antigas = ctx.getSharedPreferences("soundbar", Context.MODE_PRIVATE)
        val segura = try {
            val alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
            EncryptedSharedPreferences.create(
                "soundbar_secure", alias, ctx,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Se o Android Keystore falhar, usa as preferências normais em vez de deixar a app sem arrancar
            return antigas
        }
        if (segura.all.isEmpty() && antigas.all.isNotEmpty()) {
            val ed = segura.edit()
            for ((k, v) in antigas.all) if (v is String) ed.putString(k, v)
            ed.apply()
            antigas.edit().clear().apply()
        }
        return segura
    }
}
