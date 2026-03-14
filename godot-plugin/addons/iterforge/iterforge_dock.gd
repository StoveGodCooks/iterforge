@tool
extends EditorPlugin

const DOCK_SCENE = preload("res://addons/iterforge/iterforge_dock.tscn")

var _dock: Control

func _enter_tree() -> void:
	_dock = DOCK_SCENE.instantiate()
	add_control_to_dock(DOCK_SLOT_RIGHT_UL, _dock)
	_dock.set_editor_interface(get_editor_interface())

func _exit_tree() -> void:
	if _dock:
		remove_control_from_docks(_dock)
		_dock.queue_free()
		_dock = null
