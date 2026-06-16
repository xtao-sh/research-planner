use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the spawned Fastify/Prisma sidecar so we can terminate it when the
/// app exits. Without this the child handle was dropped immediately after
/// spawn — and dropping a `CommandChild` does NOT kill the process, so a
/// zombie server kept holding port 4317. The next launch then failed to
/// bind and the webview loaded a blank page. Every launch leaked a process.
struct SidecarProcess(Mutex<Option<CommandChild>>);

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
                match app
                    .path()
                    .resolve("data/data.db", tauri::path::BaseDirectory::Resource)
                {
                    Ok(seed_db) if seed_db.exists() => {
                        // Propagate copy errors instead of swallowing them — a
                        // failed copy leaves an empty/absent DB and the server
                        // then fails every query with no diagnostic.
                        if let Err(e) = std::fs::copy(&seed_db, &db_path) {
                            eprintln!(
                                "[setup] FATAL: failed to copy seed DB {} -> {}: {}",
                                seed_db.display(),
                                db_path.display(),
                                e
                            );
                            return Err(Box::new(e));
                        }
                    }
                    Ok(seed_db) => {
                        eprintln!(
                            "[setup] WARNING: bundled seed DB not found at {} — starting with no database. \
                             The server will fail until a database exists.",
                            seed_db.display()
                        );
                    }
                    Err(e) => {
                        eprintln!(
                            "[setup] WARNING: could not resolve bundled seed DB resource: {}. \
                             Starting with no database.",
                            e
                        );
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

            let (mut rx, child) = sidecar.spawn()?;
            // Keep the child handle alive in app state so we can kill it on
            // exit (see the RunEvent::ExitRequested handler below).
            app.manage(SidecarProcess(Mutex::new(Some(child))));
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Terminate the sidecar when the app is quitting so it doesn't
            // outlive the window and hold the port for the next launch.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<SidecarProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            if let Err(e) = child.kill() {
                                eprintln!("[shutdown] failed to kill sidecar: {}", e);
                            }
                        }
                    }
                }
            }
        });
}
