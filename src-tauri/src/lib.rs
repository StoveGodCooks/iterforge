use std::sync::{Arc, Mutex};
use tauri_plugin_shell::{ShellExt, process::CommandChild};

// ── App state ────────────────────────────────────────────────
pub struct BackendProcess(pub Arc<Mutex<Option<CommandChild>>>);

// ── Entry point ──────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_arc: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));

    // Clone for the window-event closure
    let backend_arc_event = Arc::clone(&backend_arc);

    // Clone to move into the setup async task
    let backend_arc_task = Arc::clone(&backend_arc);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendProcess(backend_arc))
        .setup(move |app| {
            let shell_backend = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                launch_backend(shell_backend, backend_arc_task).await;
            });

            Ok(())
        })
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut guard) = backend_arc_event.lock() {
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                        println!("[InterForge] Backend stopped.");
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running InterForge");
}

// ── Port check ────────────────────────────────────────────────
fn is_port_in_use(port: u16) -> bool {
    std::net::TcpListener::bind(std::net::SocketAddr::from(([127, 0, 0, 1], port))).is_err()
}

// ── Backend path resolution ───────────────────────────────────
fn resolve_backend_dir() -> std::path::PathBuf {
    // 1. Explicit env var override (release packaging)
    if let Ok(p) = std::env::var("INTERFORGE_BACKEND_DIR") {
        let path = std::path::PathBuf::from(&p);
        if path.is_dir() { return path; }
    }
    // 2. Dev: one level up from src-tauri (CWD when running `tauri dev`)
    let dev_path = std::path::PathBuf::from("../interforge-backend");
    if dev_path.is_dir() { return dev_path; }
    // 3. Release: bundled alongside the exe
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let candidate = exe_dir.join("interforge-backend");
            if candidate.is_dir() { return candidate; }
            // Also try parent of exe dir (e.g. resources/interforge-backend)
            let candidate2 = exe_dir.join("..").join("interforge-backend");
            if candidate2.is_dir() { return candidate2; }
        }
    }
    // 4. Fallback
    std::path::PathBuf::from("../interforge-backend")
}

// ── FastAPI backend launcher ──────────────────────────────────
async fn launch_backend(
    app: tauri::AppHandle,
    process_arc: Arc<Mutex<Option<CommandChild>>>,
) {
    // Skip if already running (e.g. started externally via Launch-InterForge-Dev.bat)
    if is_port_in_use(7842) {
        println!("[InterForge] Backend already running on :7842 — skipping spawn.");
        return;
    }

    let backend_dir = resolve_backend_dir();

    let (python_cmd, python_args_prefix): (&str, &[&str]) = if cfg!(target_os = "windows") {
        ("py", &["-3.11"])
    } else {
        ("python3.11", &[])
    };

    let mut args: Vec<&str> = python_args_prefix.to_vec();
    args.extend(["-m", "uvicorn", "main:app",
                 "--host", "127.0.0.1", "--port", "7842",
                 "--log-level", "warning"]);

    match app.shell().command(python_cmd).args(args).current_dir(&backend_dir).spawn() {
        Ok((_rx, child)) => {
            println!("[InterForge] Backend running → http://127.0.0.1:7842");
            if let Ok(mut guard) = process_arc.lock() {
                *guard = Some(child);
            }
        }
        Err(e) => {
            eprintln!("[InterForge] Backend failed to start: {e}");
        }
    }
}
