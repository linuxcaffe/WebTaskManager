"""
Configuration settings for the TaskWarrior Web UI
"""

# Developer mode settings
DEVELOPER_MODE = False  # Set to False to disable developer mode
DEBUG_FILE = 'command.debug'

# Kanban board columns — optional, overrides the built-in default.
# Must match the values used in the 'state' UDA on your tasks.
# Tasks with no state value appear in a grey "Unassigned" column.
# Also add to your taskrc:
#   uda.state.type=string
#   uda.state.label=State
#
# KANBAN_COLUMNS = ['backlog', 'todo', 'doing', 'review', 'done']
