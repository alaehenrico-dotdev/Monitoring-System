// Encrypts the offline cache/outbox (see client/src/tauri/offlineStore.ts) at
// rest using Windows DPAPI, scoped to the current Windows user account - the
// OS handles key management entirely, so there's no password to prompt for
// or risk losing. This only protects the SQLite file's contents if it's
// copied off this machine or read by a different Windows account; anyone
// already logged into this same account can decrypt it, same trust boundary
// as the rest of that Windows login already provides.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use windows_dpapi::{decrypt_data, encrypt_data, Scope};

#[tauri::command]
pub fn encrypt_dpapi(plaintext: String) -> Result<String, String> {
    let encrypted = encrypt_data(plaintext.as_bytes(), Scope::User, None).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(encrypted))
}

#[tauri::command]
pub fn decrypt_dpapi(ciphertext: String) -> Result<String, String> {
    let bytes = STANDARD.decode(&ciphertext).map_err(|e| e.to_string())?;
    let decrypted = decrypt_data(&bytes, Scope::User, None).map_err(|e| e.to_string())?;
    String::from_utf8(decrypted).map_err(|e| e.to_string())
}
