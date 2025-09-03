// TaskWarrior Web UI - Frontend JavaScript

class TaskWarriorUI {
    constructor() {
        this.tasks = [];
        this.currentEditingTask = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadTasks();
    }

    bindEvents() {
        // Refresh button
        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.loadTasks();
        });

        // Add task form
        document.getElementById('add-task-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addTask();
        });

        // Edit task form
        document.getElementById('edit-task-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveTaskEdit();
        });

        // Modal close events
        document.querySelector('.close').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('cancel-edit').addEventListener('click', () => {
            this.closeModal();
        });

        // Close modal when clicking outside
        document.getElementById('edit-modal').addEventListener('click', (e) => {
            if (e.target.id === 'edit-modal') {
                this.closeModal();
            }
        });
    }

    async loadTasks() {
        try {
            this.showLoading(true);
            this.hideError();

            const response = await fetch('/api/tasks');
            const data = await response.json();

            if (data.success) {
                this.tasks = data.tasks;
                this.renderTasks();
            } else {
                this.showError(data.error || 'Failed to load tasks');
            }
        } catch (error) {
            this.showError('Network error: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async addTask() {
        const description = document.getElementById('task-description').value.trim();
        const tags = document.getElementById('task-tags').value.trim();
        const project = document.getElementById('task-project').value.trim();
        const priority = document.getElementById('task-priority').value;
        const due = document.getElementById('task-due').value;
        const scheduled = document.getElementById('task-scheduled').value;
        const duration = document.getElementById('task-duration').value.trim();

        if (!description) {
            this.showNotification('Description is required', 'error');
            return;
        }

        const taskData = {
            description: description,
            tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
            project: project || null,
            priority: priority || null,
            due: due ? this.formatDateForTask(due) : null,
            scheduled: scheduled ? this.formatDateForTask(scheduled) : null,
            duration: duration || null
        };

        try {
            const response = await fetch('/api/task/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(taskData)
            });

            const data = await response.json();

            if (data.success) {
                this.showNotification('Task added successfully', 'success');
                this.clearAddForm();
                this.loadTasks();
            } else {
                this.showNotification(data.error || 'Failed to add task', 'error');
            }
        } catch (error) {
            this.showNotification('Network error: ' + error.message, 'error');
        }
    }

    async performTaskAction(taskId, action) {
        const actionMap = {
            'start': 'POST',
            'stop': 'POST',
            'done': 'POST',
            'delete': 'DELETE'
        };

        const method = actionMap[action];
        const endpoint = action === 'delete' ? `/api/task/${taskId}/delete` : `/api/task/${taskId}/${action}`;

        try {
            const response = await fetch(endpoint, { method });
            const data = await response.json();

            if (data.success) {
                this.showNotification(`Task ${action} successful`, 'success');
                this.loadTasks();
            } else {
                this.showNotification(data.message || `Failed to ${action} task`, 'error');
            }
        } catch (error) {
            this.showNotification('Network error: ' + error.message, 'error');
        }
    }

    openEditModal(task) {
        this.currentEditingTask = task;
        
        document.getElementById('edit-description').value = task.description || '';
        document.getElementById('edit-tags').value = task.tags ? task.tags.join(', ') : '';
        document.getElementById('edit-priority').value = task.priority || '';
        
        // Format dates for datetime-local input
        if (task.due) {
            document.getElementById('edit-due').value = this.formatDateForInput(task.due);
        } else {
            document.getElementById('edit-due').value = '';
        }
        
        if (task.scheduled) {
            document.getElementById('edit-scheduled').value = this.formatDateForInput(task.scheduled);
        } else {
            document.getElementById('edit-scheduled').value = '';
        }

        document.getElementById('edit-modal').style.display = 'block';
    }

    closeModal() {
        document.getElementById('edit-modal').style.display = 'none';
        this.currentEditingTask = null;
    }

    async saveTaskEdit() {
        if (!this.currentEditingTask) return;

        const description = document.getElementById('edit-description').value.trim();
        const tags = document.getElementById('edit-tags').value.trim();
        const priority = document.getElementById('edit-priority').value;
        const due = document.getElementById('edit-due').value;
        const scheduled = document.getElementById('edit-scheduled').value;

        const taskData = {
            description: description,
            tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
            priority: priority || null,
            due: due ? this.formatDateForTask(due) : null,
            scheduled: scheduled ? this.formatDateForTask(scheduled) : null
        };

        try {
            const response = await fetch(`/api/task/${this.currentEditingTask.id}/modify`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(taskData)
            });

            const data = await response.json();

            if (data.success) {
                this.showNotification('Task updated successfully', 'success');
                this.closeModal();
                this.loadTasks();
            } else {
                this.showNotification(data.error || 'Failed to update task', 'error');
            }
        } catch (error) {
            this.showNotification('Network error: ' + error.message, 'error');
        }
    }

    renderTasks() {
        const container = document.getElementById('tasks-container');
        
        if (this.tasks.length === 0) {
            container.innerHTML = '<div class="loading">No pending tasks found</div>';
            return;
        }

        container.innerHTML = this.tasks.map(task => this.renderTask(task)).join('');
    }

    renderTask(task) {
        const priorityClass = task.priority ? `priority-${task.priority}` : '';
        const statusClass = task.start ? 'status-active' : 'status-pending';
        const statusText = task.start ? 'Active' : 'Pending';
        
        const tags = task.tags ? task.tags.map(tag => 
            `<span class="tag">${this.escapeHtml(tag)}</span>`
        ).join('') : '';

        const dueDate = task.due ? this.formatDisplayDate(task.due) : '';
        const scheduledDate = task.scheduled ? this.formatDisplayDate(task.scheduled) : '';
        const urgency = task.urgency !== undefined ? parseFloat(task.urgency).toFixed(2) : '';
        const estTime = task.estTime ? this.formatDuration(task.estTime) : '';

        return `
            <div class="task-card ${priorityClass}">
                <div class="task-header">
                    <div class="task-info">
                        <div class="task-description">${this.escapeHtml(task.description)}</div>
                        <div class="task-meta">
                            <span class="task-id">ID: ${task.id}</span>
                            <span class="task-status ${statusClass}">${statusText}</span>
                            ${task.priority ? `<span>Priority: ${task.priority}</span>` : ''}
                            ${urgency ? `<span>Urgency: ${urgency}</span>` : ''}
                            ${task.project ? `<span>Project: ${this.escapeHtml(task.project)}</span>` : ''}
                        </div>
                        ${tags ? `<div class="task-tags">${tags}</div>` : ''}
                        <div class="task-dates">
                            ${dueDate ? `<div>Due: ${dueDate}</div>` : ''}
                            ${scheduledDate ? `<div>Scheduled: ${scheduledDate}</div>` : ''}
                            ${estTime ? `<div>Est. Time: ${estTime}</div>` : ''}
                        </div>
                    </div>
                </div>
                <div class="task-actions">
                    ${task.start ? 
                        `<button class="btn btn-warning btn-small" onclick="app.performTaskAction(${task.id}, 'stop')">
                            <span class="icon">⏸️</span> Stop
                        </button>` :
                        `<button class="btn btn-success btn-small" onclick="app.performTaskAction(${task.id}, 'start')">
                            <span class="icon">▶️</span> Start
                        </button>`
                    }
                    <button class="btn btn-primary btn-small" onclick="app.openEditModal(${JSON.stringify(task).replace(/"/g, '&quot;')})">
                        <span class="icon">✏️</span> Edit
                    </button>
                    <button class="btn btn-success btn-small" onclick="app.performTaskAction(${task.id}, 'done')">
                        <span class="icon">✅</span> Done
                    </button>
                    <button class="btn btn-danger btn-small" onclick="app.confirmDelete(${task.id})">
                        <span class="icon">🗑️</span> Delete
                    </button>
                </div>
            </div>
        `;
    }

    confirmDelete(taskId) {
        if (confirm('Are you sure you want to delete this task?')) {
            this.performTaskAction(taskId, 'delete');
        }
    }

    clearAddForm() {
        document.getElementById('add-task-form').reset();
        document.getElementById('task-project').value = '';
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        loading.style.display = show ? 'block' : 'none';
    }

    showError(message) {
        const errorDiv = document.getElementById('error-message');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    hideError() {
        document.getElementById('error-message').style.display = 'none';
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    formatDateForTask(dateString) {
        // Convert HTML datetime-local input to local date string without timezone
        // Input format: 'YYYY-MM-DDTHH:MM' (local time)
        // Output format: 'YYYY-MM-DDTHH:MM:00' (local time, no timezone)
        if (!dateString) return '';
        
        // Return the input string with seconds added if needed
        return dateString.length === 16 ? `${dateString}:00` : dateString;
    }

    formatDateForInput(dateString) {
        // Convert TaskWarrior date format to HTML datetime-local format
        if (!dateString) return '';
        
        // Handle TaskWarrior format: 20250131T055530Z
        if (/^\d{8}T\d{6}Z$/.test(dateString)) {
            const year = dateString.substring(0, 4);
            const month = dateString.substring(4, 6);
            const day = dateString.substring(6, 8);
            const hour = dateString.substring(9, 11);
            const minute = dateString.substring(11, 13);
            const second = dateString.substring(13, 15);
            
            // Create ISO format string: YYYY-MM-DDTHH:MM:SSZ
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
            const date = new Date(isoString);
            return date.toISOString().slice(0, 16);
        }
        
        // Fallback for other date formats
        const date = new Date(dateString);
        return date.toISOString().slice(0, 16);
    }

    formatDisplayDate(dateString) {
        // Format TaskWarrior date format (YYYYMMDDTHHMMSSZ) for display
        if (!dateString) return '';
        
        // Handle TaskWarrior format: 20250131T055530Z
        if (/^\d{8}T\d{6}Z$/.test(dateString)) {
            const year = dateString.substring(0, 4);
            const month = dateString.substring(4, 6);
            const day = dateString.substring(6, 8);
            const hour = dateString.substring(9, 11);
            const minute = dateString.substring(11, 13);
            const second = dateString.substring(13, 15);
            
            // Create ISO format string: YYYY-MM-DDTHH:MM:SSZ
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
            const date = new Date(isoString);
            return date.toLocaleString();
        }
        
        // Fallback for other date formats
        const date = new Date(dateString);
        return date.toLocaleString();
    }

    formatDuration(durationString) {
        // Format TaskWarrior duration (e.g., "PT2H30M" or "2h30min") for display
        if (!durationString) return '';
        
        // Handle ISO 8601 duration format (PT2H30M)
        if (durationString.startsWith('PT')) {
            const match = durationString.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (match) {
                const hours = parseInt(match[1] || 0);
                const minutes = parseInt(match[2] || 0);
                const seconds = parseInt(match[3] || 0);
                
                let result = '';
                if (hours > 0) result += `${hours}h `;
                if (minutes > 0) result += `${minutes}m `;
                if (seconds > 0) result += `${seconds}s`;
                
                return result.trim() || '0s';
            }
        }
        
        // Handle simple format (2h30min, 1.5h, etc.)
        return durationString;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app when the page loads
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new TaskWarriorUI();
});
