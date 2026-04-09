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
        
        // Initialiser le composant TaskEditor
        this.taskEditor = new TaskEditor({
            showAllFields: true,
            priorityFormat: 'letters',
            language: 'en',
            modalId: 'unified-task-editor',
            onSave: (taskData, isEdit) => this.handleTaskSave(taskData, isEdit),
            onCancel: () => this.handleTaskCancel()
        });
        
        // Initialiser le composant TaskEditor en mode inline
        this.taskCreator = new TaskEditor({
            showAllFields: true,
            priorityFormat: 'letters',
            language: 'en',
            containerId: 'task-creator-container',
            inline: true,
            onSaveSuccess: (task, isEdit) => {
                if (!isEdit) {
                    this.tasks.unshift(task);
                    this.renderTasks();
                    this.showNotification('Task added successfully', 'success');
                }
            },
            onSaveError: (error) => {
                this.showNotification(error || 'Failed to add task', 'error');
            }
        });
        
        // Wait for components to initialise before loading data
        setTimeout(() => {
            this.initializeEventListeners();
            this.loadContexts();
            this.loadTasks();
            this.updateProjectSuggestions();
        }, 100);
    }

    initializeEventListeners() {
        document.getElementById('refresh-btn').addEventListener('click', () => this.loadTasks());
        
        // Context buttons are added dynamically — delegate to the container
        document.getElementById('context-options').addEventListener('click', (e) => {
            const btn = e.target.closest('.context-option');
            if (btn) this.setContext(btn.getAttribute('data-context'));
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
                // Mettre à jour aussi les suggestions du TaskCreator
                if (this.taskCreator) {
                    this.taskCreator.updateProjectSuggestions(projectsData.projects);
                }
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


    // Gestionnaire unifié pour la sauvegarde des tâches (ajout et modification)
    handleTaskSaveSuccess(task, isEdit) {
        if (isEdit) {
            // Mettre à jour la tâche dans le tableau local
            const taskIndex = this.tasks.findIndex(t => t.uuid === task.uuid);
            if (taskIndex !== -1) {
                this.tasks[taskIndex] = task;
            }
        } else {
            // Ajouter la nouvelle tâche au début de la liste
            this.tasks.unshift(task);
        }
        this.renderTasks();
        this.showNotification(isEdit ? 'Task updated successfully' : 'Task added successfully', 'success');
    }
    
    // Gestionnaire pour l'annulation
    handleTaskCancel() {
        this.currentEditingTask = null;
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

    async loadContexts() {
        try {
            const r = await fetch('/api/contexts');
            const d = await r.json();
            if (!d.success) return;

            const container = document.getElementById('context-options');
            container.innerHTML = '';

            // "All" button always first
            const allBtn = document.createElement('button');
            allBtn.type = 'button';
            allBtn.className = 'context-option' + (d.active === '' ? ' active' : '');
            allBtn.setAttribute('data-context', '');
            allBtn.textContent = 'All';
            container.appendChild(allBtn);

            for (const ctx of d.contexts) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'context-option' + (d.active === ctx ? ' active' : '');
                btn.setAttribute('data-context', ctx);
                btn.textContent = ctx.charAt(0).toUpperCase() + ctx.slice(1);
                container.appendChild(btn);
            }

            // Reflect the active context in the filter state
            if (d.active) this.currentContext = d.active;
        } catch (e) {
            console.warn('Could not load contexts:', e);
        }
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
        
        // Vide le conteneur
        container.innerHTML = '';
        
        // Crée et ajoute chaque carte de tâche
        filteredTasks.forEach(task => {
            const taskCard = taskCardManager.createTaskCard(task, 'full');
            container.appendChild(taskCard);
        });
    }


    /**
     * Supprime une taskCard spécifique du DOM sans recharger toutes les tâches
     */
    removeTaskCard(taskUuid) {
        const taskCard = document.querySelector(`.task-card[data-task-id="${taskUuid}"]`);
        if (taskCard) {
            taskCard.remove();

            // Mettre à jour le message "aucune tâche" si nécessaire
            const container = document.getElementById('tasks-container');
            if (container && container.querySelectorAll('.task-card').length === 0) {
                container.innerHTML = '<div class="no-tasks">No tasks found</div>';
            }
        }
    }

    // Cette méthode n'est plus nécessaire car TaskEditor gère son propre nettoyage

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
    // Initialiser taskCardManager avec le gestionnaire d'actions spécifique à main.js
    taskCardManager = new TaskCardManager(new ScriptTaskActionHandler());
    
    // Initialiser taskEditor comme variable globale
    taskEditor = new TaskEditor({
        showAllFields: true,
        priorityFormat: 'letters',
        language: 'en',
        modalId: 'unified-task-editor',
        onSaveSuccess: (task, isEdit) => app.handleTaskSaveSuccess(task, isEdit),
        onSaveError: (error) => app.showNotification(error, 'error'),
        onCancel: () => app.handleTaskCancel()
    });
});
