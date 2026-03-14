## IterForge client — polls iterforge.json and drives auto-import.
## Attach to the dock scene root.
@tool
extends Control

const POLL_INTERVAL_SEC := 2.0
const LOCK_FILE_SUFFIX  := ".lock"
const TMP_FILE_SUFFIX   := ".tmp"
const MAX_RECENT        := 5

var _editor_interface: EditorInterface
var _config_path: String        # absolute path to iterforge.json
var _lock_path: String
var _poll_timer: Timer
var _last_mtime: int = 0

# UI node references — set by the dock scene
@export var status_dot:      ColorRect
@export var status_label:    Label
@export var cloud_label:     Label
@export var recent_list:     VBoxContainer
@export var open_gui_btn:    Button
@export var sync_btn:        Button
@export var open_docs_btn:   Button

# ── lifecycle ─────────────────────────────────────────────────────────────────

func _ready() -> void:
	_poll_timer = Timer.new()
	_poll_timer.wait_time = POLL_INTERVAL_SEC
	_poll_timer.autostart = true
	_poll_timer.timeout.connect(_on_poll)
	add_child(_poll_timer)

	if open_gui_btn:
		open_gui_btn.pressed.connect(_on_open_gui)
	if sync_btn:
		sync_btn.pressed.connect(_on_sync_now)
	if open_docs_btn:
		open_docs_btn.pressed.connect(_on_open_docs)

	_locate_config()
	_on_poll()

func set_editor_interface(ei: EditorInterface) -> void:
	_editor_interface = ei

# ── config location ───────────────────────────────────────────────────────────

func _locate_config() -> void:
	# Walk upward from res:// looking for iterforge.json
	var res_dir := ProjectSettings.globalize_path("res://")
	var candidate := res_dir.path_join("iterforge.json")
	if FileAccess.file_exists(candidate):
		_config_path = candidate
		_lock_path   = candidate + LOCK_FILE_SUFFIX
		return
	# Check one level up (project inside a larger repo)
	var parent := res_dir.get_base_dir()
	candidate = parent.path_join("iterforge.json")
	if FileAccess.file_exists(candidate):
		_config_path = candidate
		_lock_path   = candidate + LOCK_FILE_SUFFIX

# ── polling ───────────────────────────────────────────────────────────────────

func _on_poll() -> void:
	if _config_path.is_empty() or not FileAccess.file_exists(_config_path):
		_set_status(false)
		return

	_set_status(true)

	# Skip if locked by Node.js side
	if FileAccess.file_exists(_lock_path):
		return

	# Skip if file hasn't changed
	var mtime := FileAccess.get_modified_time(_config_path)
	if mtime == _last_mtime:
		return
	_last_mtime = mtime

	var config := _read_config()
	if config.is_empty():
		return

	_update_recent(config)
	_update_cloud_label(config)
	_process_pending_assets(config)

# ── pending asset import ──────────────────────────────────────────────────────

func _process_pending_assets(config: Dictionary) -> void:
	var pending: Array = config.get("godot_sync", {}).get("pending_assets", [])
	if pending.is_empty():
		return

	# Acquire lock
	var lock := FileAccess.open(_lock_path, FileAccess.WRITE)
	if not lock:
		return  # couldn't acquire — skip this cycle
	lock.close()

	# Trigger Godot filesystem rescan
	if _editor_interface:
		_editor_interface.get_resource_filesystem().scan()

	# Clear pending_assets — atomic write via .tmp
	config["godot_sync"]["pending_assets"] = []
	config["godot_sync"]["last_import"] = Time.get_datetime_string_from_system()
	_write_config(config)

	# Release lock
	DirAccess.remove_absolute(_lock_path)

	# Refresh recent list
	_update_recent(config)

# ── UI helpers ────────────────────────────────────────────────────────────────

func _set_status(connected: bool) -> void:
	if status_dot:
		status_dot.color = Color.GREEN if connected else Color(0.5, 0.5, 0.5)
	if status_label:
		status_label.text = "IterForge Connected" if connected else "IterForge Not Found"

func _update_recent(config: Dictionary) -> void:
	if not recent_list:
		return
	for child in recent_list.get_children():
		child.queue_free()

	var history: Array = config.get("history", [])
	var shown := mini(history.size(), MAX_RECENT)
	for i in shown:
		var entry: Dictionary = history[i]
		var lbl := Label.new()
		var img_path: String = entry.get("image_path", "")
		var filename := img_path.get_file() if not img_path.is_empty() else "(unknown)"
		var ts: String = entry.get("timestamp", "")
		lbl.text = "%s  %s" % [filename, ts.left(10)]
		lbl.add_theme_font_size_override("font_size", 11)
		recent_list.add_child(lbl)

func _update_cloud_label(config: Dictionary) -> void:
	if not cloud_label:
		return
	# Placeholder — RunPod tracking is V2
	cloud_label.text = ""

# ── button actions ────────────────────────────────────────────────────────────

func _on_open_gui() -> void:
	OS.create_process("iterforge", ["gui"])

func _on_sync_now() -> void:
	_last_mtime = 0   # force re-read next poll
	_on_poll()

func _on_open_docs() -> void:
	OS.shell_open("https://iterforge.itch.io")

# ── JSON read / write ─────────────────────────────────────────────────────────

func _read_config() -> Dictionary:
	var f := FileAccess.open(_config_path, FileAccess.READ)
	if not f:
		return {}
	var text := f.get_as_text()
	f.close()
	var parsed := JSON.parse_string(text)
	if parsed is Dictionary:
		return parsed
	return {}

func _write_config(config: Dictionary) -> void:
	# Atomic write: write .tmp then rename
	var tmp_path := _config_path + TMP_FILE_SUFFIX
	var f := FileAccess.open(tmp_path, FileAccess.WRITE)
	if not f:
		return
	f.store_string(JSON.stringify(config, "\t"))
	f.close()
	DirAccess.rename_absolute(tmp_path, _config_path)
	_last_mtime = FileAccess.get_modified_time(_config_path)
