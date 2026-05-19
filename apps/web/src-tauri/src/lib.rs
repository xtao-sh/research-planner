use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Per-user writable data directory:
            //   ~/Library/Application Support/com.researchplanner.desktop/
            // The seeded SQLite database ships read-only inside the .app's
            // Resources directory. On first launch we copy it into the
            // per-user dir so the sidecar can write to it freely.
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("data.db");

            if !db_path.exists() {
                if let Ok(seed_db) = app
                    .path()
                    .resolve("data/data.db", tauri::path::BaseDirectory::Resource)
                {
                    if seed_db.exists() {
                        std::fs::copy(&seed_db, &db_path)?;
                    }
                }
            }

            let database_url = format!("file:{}", db_path.display());

            // Spawn the bundled Fastify+Prisma server. It binds to 127.0.0.1
            // on the agreed-upon port; the web shell (running inside the
            // Tauri webview) hits http://localhost:4317 directly.
            // Tauri's webview origin on macOS is `tauri://localhost`. The
            // Fastify CORS allow-list reads CORS_ORIGIN as a comma-separated
            // list when NODE_ENV=production, so we explicitly enumerate the
            // origins the desktop shell may use.
            let cors_origin = "tauri://localhost,https://tauri.localhost,http://tauri.localhost,http://localhost:4317";

            let sidecar = app
                .shell()
                .sidecar("research-planner-server")?
                .env("DATABASE_URL", &database_url)
                .env("PORT", "4317")
                .env("HOST", "127.0.0.1")
                .env("CORS_ORIGIN", cors_origin);

            let (mut rx, _child) = sidecar.spawn()?;
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            eprintln!("[server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[server-err] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[server] terminated: {:?}", payload);
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
