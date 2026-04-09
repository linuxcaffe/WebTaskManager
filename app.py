#!/usr/bin/env python3
"""
TaskWarrior Web UI - Backend Server
A lightweight Flask server to interface with TaskWarrior commands
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import subprocess
import json
import os
import re
from datetime import datetime
from config import DEVELOPER_MODE, DEBUG_FILE
try:
    from config import KANBAN_COLUMNS
except ImportError:
    KANBAN_COLUMNS = ['backlog', 'todo', 'doing', 'review', 'done']

# Accepts a UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) or a plain integer task ID
_TASK_ID_RE = re.compile(
    r'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$',
    re.IGNORECASE
)

def _valid_task_id(task_id):
    return bool(_TASK_ID_RE.match(str(task_id)))

def log_command(args):
    """Log the command to the debug file with a timestamp"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    with open(DEBUG_FILE, 'a') as f:
        f.write(f"[{timestamp}] {' '.join(args)}\n")

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

def run_task_command(args):
    """Execute a TaskWarrior command and return the result.
    args must be a list, e.g. ['task', 'status:pending', 'export'].
    shell=True is intentionally not used.
    """
    try:
        if args[0] != 'task':
            args = ['task'] + args

        log_command(args)

        if DEVELOPER_MODE:
            return {
                'success': True,
                'stdout': f'[DEV MODE] Command logged to {DEBUG_FILE}: {" ".join(args)}',
                'stderr': '',
                'returncode': 0
            }

        result = subprocess.run(args, capture_output=True, text=True)
        return {
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'returncode': result.returncode
        }
    except Exception as e:
        return {
            'success': False,
            'stdout': '',
            'stderr': str(e),
            'returncode': -1
        }

@app.route('/')
def index():
    """Serve the main HTML page"""
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    """Serve static files (CSS, JS, etc.)"""
    return send_from_directory('.', filename)

@app.route('/api/tasks/planned')
def get_planned_tasks():
    """Get all planned tasks (with scheduled date) in JSON format"""
    result = run_task_command(['task', 'scheduled.not:', 'export'])

    if result['success']:
        try:
            tasks = json.loads(result['stdout'])
            return jsonify({'success': True, 'data': tasks})
        except json.JSONDecodeError as e:
            return jsonify({
                'success': False,
                'error': f'JSON decode error: {str(e)}',
                'stdout': result['stdout'],
                'stderr': result['stderr']
            }), 500
    else:
        return jsonify({
            'success': False,
            'error': 'Failed to retrieve planned tasks',
            'stderr': result['stderr']
        }), 500

@app.route('/api/tasks')
def get_tasks():
    """Get all pending tasks in JSON format"""
    result = run_task_command(['task', 'status:pending', 'export'])

    if result['success']:
        try:
            tasks = json.loads(result['stdout'])
            tasks.sort(key=lambda x: x.get('urgency', 0), reverse=True)
            return jsonify({'success': True, 'tasks': tasks})
        except json.JSONDecodeError as e:
            return jsonify({
                'success': False,
                'error': f'JSON decode error: {str(e)}',
                'stdout': result['stdout'],
                'stderr': result['stderr']
            }), 500
    else:
        return jsonify({
            'success': False,
            'error': 'Failed to retrieve tasks',
            'stderr': result['stderr']
        }), 500

@app.route('/api/projects')
def get_projects():
    """Get all unique projects from TaskWarrior, including completed tasks"""
    result = run_task_command(['task', '_projects'])

    if result['success']:
        try:
            projects = [p.strip() for p in result['stdout'].split('\n') if p.strip()]
            return jsonify({'success': True, 'projects': projects})
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Failed to parse projects: {str(e)}'
            }), 500
    else:
        return jsonify({'success': False, 'error': result['stderr']}), 500

@app.route('/api/contexts')
def get_contexts():
    """Get all defined contexts and the currently active context"""
    show_result = run_task_command(['task', '_show'])
    contexts = []
    if show_result['success']:
        for line in show_result['stdout'].splitlines():
            m = re.match(r'^context\.(\w+)\.read=', line)
            if m:
                contexts.append(m.group(1))

    active_result = run_task_command(['task', '_get', 'rc.context'])
    active = active_result['stdout'].strip() if active_result['success'] else ''

    return jsonify({'success': True, 'contexts': contexts, 'active': active})

@app.route('/api/task/<task_id>/start', methods=['POST'])
def start_task(task_id):
    """Start a task"""
    if not _valid_task_id(task_id):
        return jsonify({'success': False, 'message': 'Invalid task ID'}), 400
    result = run_task_command(['task', task_id, 'start'])
    return jsonify({
        'success': result['success'],
        'message': result['stdout'] if result['success'] else result['stderr']
    })

@app.route('/api/task/<task_id>/stop', methods=['POST'])
def stop_task(task_id):
    """Stop a task"""
    if not _valid_task_id(task_id):
        return jsonify({'success': False, 'message': 'Invalid task ID'}), 400
    result = run_task_command(['task', task_id, 'stop'])
    return jsonify({
        'success': result['success'],
        'message': result['stdout'] if result['success'] else result['stderr']
    })

@app.route('/api/task/<task_id>/done', methods=['POST'])
def complete_task(task_id):
    """Mark a task as done"""
    if not _valid_task_id(task_id):
        return jsonify({'success': False, 'message': 'Invalid task ID'}), 400
    result = run_task_command(['task', task_id, 'done'])
    return jsonify({
        'success': result['success'],
        'message': result['stdout'] if result['success'] else result['stderr']
    })

@app.route('/api/task/<task_id>/delete', methods=['DELETE'])
def delete_task(task_id):
    """Delete a task"""
    if not _valid_task_id(task_id):
        return jsonify({'success': False, 'message': 'Invalid task ID'}), 400
    result = run_task_command(['task', 'rc.confirmation=off', task_id, 'delete'])
    return jsonify({
        'success': result['success'],
        'message': result['stdout'] if result['success'] else result['stderr']
    })

@app.route('/api/task/<task_id>/modify', methods=['PUT'])
def modify_task(task_id):
    """Modify a task"""
    if not _valid_task_id(task_id):
        return jsonify({'success': False, 'message': 'Invalid task ID'}), 400

    data = request.get_json()
    modifications = []

    if 'description' in data and data['description']:
        modifications.append(f'description:{data["description"]}')

    if 'tags' in data:
        clear_result = run_task_command(['task', 'rc.confirmation=off', task_id, 'modify', '-TAGS'])
        if clear_result['success'] and isinstance(data['tags'], list) and data['tags']:
            for tag in data['tags']:
                if tag and tag.strip():
                    modifications.append(f'+{tag.strip()}')

    if 'due' in data:
        modifications.append(f'due:{data["due"]}' if data['due'] else 'due:')

    if 'scheduled' in data:
        modifications.append(f'scheduled:{data["scheduled"]}' if data['scheduled'] else 'scheduled:')

    if 'priority' in data:
        modifications.append(f'priority:{data["priority"]}' if data['priority'] else 'priority:')

    if 'project' in data:
        modifications.append(f'project:{data["project"]}' if data['project'] else 'project:')

    if 'estTime' in data and data['estTime']:
        modifications.append(f'estTime:{data["estTime"]}')

    if 'state' in data:
        modifications.append(f'state:{data["state"]}' if data['state'] else 'state:')

    if modifications:
        result = run_task_command(
            ['task', 'rc.confirmation=off', task_id, 'modify'] + modifications
        )

        if result['success']:
            export_result = run_task_command(['task', task_id, 'export'])
            if export_result['success'] and export_result['stdout'].strip():
                try:
                    task = json.loads(export_result['stdout'])
                    if task:
                        return jsonify({
                            'success': True,
                            'message': result['stdout'],
                            'task': task[0]
                        })
                except (json.JSONDecodeError, IndexError) as e:
                    print(f"Error parsing task data: {e}")
                    return jsonify({'success': True, 'message': result['stdout'], 'task': None})

        return jsonify({
            'success': result['success'],
            'message': result['stdout'] if result['success'] else result['stderr'],
            'task': None
        })
    else:
        return jsonify({'success': True, 'message': 'No changes to apply', 'task': None})

@app.route('/api/kanban/columns')
def get_kanban_columns():
    """Return configured kanban column names"""
    return jsonify({'success': True, 'columns': KANBAN_COLUMNS})

@app.route('/api/task/add', methods=['POST'])
def add_task():
    """Add a new task"""
    data = request.get_json()

    if not data.get('description'):
        return jsonify({'success': False, 'error': 'Description is required'}), 400

    args = ['task', 'add', data['description']]

    if data.get('tags'):
        if isinstance(data['tags'], list):
            for tag in data['tags']:
                args.append(f'+{tag}')

    if data.get('due'):
        args.append(f'due:{data["due"]}')

    if data.get('scheduled'):
        args.append(f'scheduled:{data["scheduled"]}')

    if data.get('priority'):
        args.append(f'priority:{data["priority"]}')

    if data.get('project'):
        args.append(f'project:{data["project"]}')

    if data.get('estTime'):
        args.append(f'estTime:{data["estTime"]}')

    create_result = run_task_command(args)

    if create_result['success']:
        export_result = run_task_command(['task', '+LATEST', 'export'])
        if export_result['success'] and export_result['stdout'].strip():
            try:
                task = json.loads(export_result['stdout'])
                if task:
                    return jsonify({
                        'success': True,
                        'message': 'Task created successfully',
                        'task': task[0]
                    })
            except (json.JSONDecodeError, IndexError) as e:
                print(f"Error parsing task data: {e}")

    return jsonify({
        'success': create_result.get('success', False),
        'error': create_result.get('stderr', 'Failed to create task'),
        'task': None
    })

if __name__ == '__main__':
    check_result = run_task_command(['task', 'version'])
    if not check_result['success']:
        print("Warning: TaskWarrior doesn't seem to be installed or accessible")
        print("Please install TaskWarrior: sudo apt-get install taskwarrior")
    else:
        print("TaskWarrior found:", check_result['stdout'].split('\n')[0])

    print("Starting TaskWarrior Web UI...")
    print("Access the interface at: http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
