// Prevents a console window from opening on Windows in release builds.
// DO NOT REMOVE — without this the app spawns a black terminal window on launch.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    interforge_lib::run()
}
