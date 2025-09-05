// TaskWarrior Web UI - Frontend JavaScript

class TaskWarriorUI {
    constructor() {
        this.tasks = [];
        this.currentEditingTask = null;
        this.currentContext = ''; // 'pro', 'perso', or '' for all
        this.currentFilters = {
            project: null,
            tags: []
        };
        this.projects = new Set(); // Pour stocker la liste des projets uniques
        this.initializeEventListeners();
        this.loadTasks();
        
        // Mettre à jour les suggestions de projets
        this.updateProjectSuggestions();
    }

    initializeEventListeners() {
        document.getElementById('add-task-form').addEventListener('submit', (e) => this.handleAddTask(e));
        document.getElementById('edit-task-form').addEventListener('submit', (e) => this.handleEditTask(e));
        document.getElementById('cancel-edit').addEventListener('click', () => this.closeModal());
        document.querySelector('.close').addEventListener('click', () => this.closeModal());
        document.getElementById('refresh-btn').addEventListener('click', () => this.loadTasks());
        
        // Add context selection event listeners
        document.querySelectorAll('.context-option').forEach(button => {
            button.addEventListener('click', (e) => this.setContext(e.target.getAttribute('data-context')));
        });

        // Add advanced filters event listeners
        document.getElementById('apply-filters').addEventListener('click', () => this.applyFilters());
        document.getElementById('clear-filters').addEventListener('click', () => this.clearFilters());
        
        // Apply filters on Enter key in filter inputs
        const projectInput = document.getElementById('filter-project');
        const tagsInput = document.getElementById('filter-tags');
        
        // Update project suggestions as user types
        projectInput.addEventListener('input', (e) => {
            this.updateProjectSuggestions(e.target.value);
        });
        
        // Apply filters on Enter
        [projectInput, tagsInput].forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.applyFilters();
                }
            });
        });
    }

    handleAddTask(e) {
        e.preventDefault();
        this.addTask();
    }

    handleEditTask(e) {
        e.preventDefault();
        this.saveTaskEdit();
    }

    async loadTasks() {
        try {
            this.showLoading(true);
            this.hideError();

            // Load tasks and projects in parallel
            const [tasksResponse, projectsResponse] = await Promise.all([
                fetch('/api/tasks'),
                fetch('/api/projects')
            ]);

            const tasksData = await tasksResponse.json();
            const projectsData = await projectsResponse.json();

            if (tasksData.success) {
                this.tasks = tasksData.tasks;
                this.renderTasks();
            } else {
                this.showError(tasksData.error || 'Failed to load tasks');
            }

            if (projectsData.success) {
                this.updateProjectDatalist(projectsData.projects);
            }
        } catch (error) {
            this.showError('Network error: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }
    
    // Update the project datalist with all available projects
    updateProjectDatalist(projects) {
        const datalist = document.getElementById('project-options');
        if (!datalist) return;
        
        // Clear existing options
        datalist.innerHTML = '';
        
        // Add projects to datalist
        projects.forEach(project => {
            if (project) {  // Only add non-empty projects
                const option = document.createElement('option');
                option.value = project;
                datalist.appendChild(option);
            }
        });
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
        document.getElementById('edit-project').value = task.project || '';
        
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
        
        document.getElementById('edit-duration').value = task.estTime  || '';
        

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
        const project = document.getElementById('edit-project').value.trim();
        const priority = document.getElementById('edit-priority').value;
        const due = document.getElementById('edit-due').value;
        const scheduled = document.getElementById('edit-scheduled').value;
        const duration = document.getElementById('edit-duration').value.trim();

        const taskData = {
            description: description,
            tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
            project: project || null,
            priority: priority || null,
            due: due ? this.formatDateForTask(due) : null,
            scheduled: scheduled ? this.formatDateForTask(scheduled) : null,
            est: duration || null
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

    // Filter tasks based on current context and advanced filters
    getFilteredTasks() {
        return this.tasks.filter(task => {
            // Filter by context (pro/perso)
            if (this.currentContext) {
                if (!task.tags || !task.tags.includes(this.currentContext)) {
                    return false;
                }
            }
            
            // Filter by project
            if (this.currentFilters.project && task.project !== this.currentFilters.project) {
                return false;
            }
            
            // Filter by tags
            if (this.currentFilters.tags && this.currentFilters.tags.length > 0) {
                if (!task.tags || !this.currentFilters.tags.every(tag => task.tags.includes(tag))) {
                    return false;
                }
            }
            
            return true;
        });
    }
    
    // Apply advanced filters
    applyFilters() {
        const project = document.getElementById('filter-project').value.trim();
        const tags = document.getElementById('filter-tags').value
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
            
        this.currentFilters = {
            project: project || null,
            tags: tags
        };
        
        this.renderTasks();
    }
    
    // Clear all filters
    clearFilters() {
        document.getElementById('filter-project').value = '';
        document.getElementById('filter-tags').value = '';
        
        this.currentFilters = {
            project: null,
            tags: []
        };
        
        this.renderTasks();
    }

    // Set the current context and update the UI
    setContext(context) {
        this.currentContext = context;
        
        // Update active state of context buttons
        document.querySelectorAll('.context-option').forEach(button => {
            if (button.getAttribute('data-context') === context) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
        
        // Re-render tasks with the new filter
        this.updateProjectsList();
        this.renderTasks();
    }

    updateProjectsList() {
        this.projects.clear();
        this.tasks.forEach(task => {
            if (task.project) {
                this.projects.add(task.project);
            }
        });
        this.updateProjectSuggestions();
    }
    
    updateProjectSuggestions(filter = '') {
        const datalist = document.getElementById('project-suggestions');
        if (!datalist) return;
        
        // Clear existing options
        datalist.innerHTML = '';
        
        // Filter and sort projects
        const filteredProjects = Array.from(this.projects)
            .filter(project => 
                project.toLowerCase().includes(filter.toLowerCase())
            )
            .sort();
        
        // Add filtered projects to datalist
        filteredProjects.forEach(project => {
            const option = document.createElement('option');
            option.value = project;
            datalist.appendChild(option);
        });
    }

    renderTasks() {
        const container = document.getElementById('tasks-container');
        if (!container) return;
        
        // Update projects list whenever tasks are rendered
        this.updateProjectsList();
        
        const filteredTasks = this.getFilteredTasks();
        
        if (filteredTasks.length === 0) {
            container.innerHTML = '<div class="no-tasks">No tasks found' + 
                (this.currentContext ? ` in context "${this.currentContext}"` : '') + 
                (this.currentFilters.project ? ` for project "${this.currentFilters.project}"` : '') + 
                (this.currentFilters.tags.length > 0 ? ` with tags: ${this.currentFilters.tags.join(', ')}` : '') + 
                '</div>';
            return;
        }
        
        container.innerHTML = filteredTasks.map(task => this.renderTask(task)).join('');
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
