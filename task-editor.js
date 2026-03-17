/**
 * Composant réutilisable pour l'édition de tâches
 * Unifie les formulaires entre index.html et day-planner.html
 */

class TaskEditor {
    constructor(options = {}) {
        this.options = {
            // Configuration par défaut
            showAllFields: true,
            priorityFormat: 'letters', // 'letters' (H/M/L) ou 'words' (high/medium/low)
            language: 'fr', // 'fr' ou 'en'
            modalId: 'task-editor-modal',
            ...options
        };
        
        this.currentTask = null;
        this.onSave = options.onSave || (() => {});
        this.onCancel = options.onCancel || (() => {});
        this.onSaveSuccess = options.onSaveSuccess || (() => {});
        this.onSaveError = options.onSaveError || (() => {});
        
        this.init();
    }
    
    init() {
        this.createModal();
        this.bindEvents();
    }
    
    createModal() {
        // Supprimer le modal existant s'il existe
        const existingModal = document.getElementById(this.options.modalId);
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.id = this.options.modalId;
        modal.className = 'modal task-editor-modal';
        modal.innerHTML = this.getModalHTML();
        
        document.body.appendChild(modal);
        this.modal = modal;
    }
    
    getModalHTML() {
        const texts = this.getTexts();
        const priorityOptions = this.getPriorityOptions();
        
        return `
            <div class="modal-content">
                <div class="modal-header">
                    <h3 id="task-editor-title">${texts.addTask}</h3>
                    <span class="close task-editor-close">&times;</span>
                </div>
                <form id="task-editor-form">
                    <div class="form-group">
                        <label for="task-editor-description">${texts.description}:</label>
                        <input type="text" id="task-editor-description" required>
                    </div>
                    
                    ${this.options.showAllFields ? `
                    <div class="form-group">
                        <label for="task-editor-tags">${texts.tags}:</label>
                        <input type="text" id="task-editor-tags" placeholder="${texts.tagsPlaceholder}">
                    </div>
                    
                    <div class="form-group">
                        <label for="task-editor-project">${texts.project}:</label>
                        <input type="text" id="task-editor-project" placeholder="${texts.projectPlaceholder}">
                    </div>
                    ` : ''}
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label for="task-editor-priority">${texts.priority}:</label>
                            <select id="task-editor-priority">
                                <option value="">${texts.noPriority}</option>
                                ${priorityOptions.map(option => 
                                    `<option value="${option.value}">${option.label}</option>`
                                ).join('')}
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="task-editor-duration">${texts.duration}:</label>
                            <input type="text" id="task-editor-duration" placeholder="${texts.durationPlaceholder}">
                        </div>
                    </div>
                    
                    ${this.options.showAllFields ? `
                    <div class="form-row">
                        <div class="form-group">
                            <label for="task-editor-due">${texts.dueDate}:</label>
                            <input type="datetime-local" id="task-editor-due">
                        </div>
                        
                        <div class="form-group">
                            <label for="task-editor-scheduled">${texts.scheduled}:</label>
                            <input type="datetime-local" id="task-editor-scheduled">
                        </div>
                    </div>
                    ` : ''}
                    
                    <div class="modal-actions">
                        <button type="submit" class="btn btn-primary" id="task-editor-save">
                            ${texts.save}
                        </button>
                        <button type="button" class="btn btn-secondary" id="task-editor-cancel">
                            ${texts.cancel}
                        </button>
                    </div>
                </form>
            </div>
        `;
    }
    
    getTexts() {
        if (this.options.language === 'fr') {
            return {
                addTask: 'Ajouter une tâche',
                editTask: 'Modifier la tâche',
                description: 'Description',
                tags: 'Tags',
                tagsPlaceholder: 'Tags séparés par des virgules',
                project: 'Projet',
                projectPlaceholder: 'Nom du projet',
                priority: 'Priorité',
                noPriority: 'Aucune',
                duration: 'Durée',
                durationPlaceholder: 'ex: 30min, 1h30m, 2d',
                dueDate: 'Date d\'échéance',
                scheduled: 'Planifié',
                save: 'Sauvegarder',
                cancel: 'Annuler'
            };
        } else {
            return {
                addTask: 'Add Task',
                editTask: 'Edit Task',
                description: 'Description',
                tags: 'Tags',
                tagsPlaceholder: 'Comma-separated tags',
                project: 'Project',
                projectPlaceholder: 'Project name',
                priority: 'Priority',
                noPriority: 'None',
                duration: 'Duration',
                durationPlaceholder: 'e.g., 30min, 1h30m, 2d',
                dueDate: 'Due Date',
                scheduled: 'Scheduled',
                save: 'Save Changes',
                cancel: 'Cancel'
            };
        }
    }
    
    getPriorityOptions() {
        if (this.options.priorityFormat === 'letters') {
            return [
                { value: 'H', label: this.options.language === 'fr' ? 'Élevée' : 'High' },
                { value: 'M', label: this.options.language === 'fr' ? 'Moyenne' : 'Medium' },
                { value: 'L', label: this.options.language === 'fr' ? 'Faible' : 'Low' }
            ];
        } else {
            return [
                { value: 'high', label: this.options.language === 'fr' ? 'Élevée' : 'High' },
                { value: 'medium', label: this.options.language === 'fr' ? 'Moyenne' : 'Medium' },
                { value: 'low', label: this.options.language === 'fr' ? 'Faible' : 'Low' }
            ];
        }
    }
    
    bindEvents() {
        // Événement de fermeture
        this.modal.querySelector('.task-editor-close').addEventListener('click', () => {
            this.hide();
        });
        
        // Fermeture en cliquant à l'extérieur
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hide();
            }
        });
        
        // Événement d'annulation
        this.modal.querySelector('#task-editor-cancel').addEventListener('click', () => {
            this.hide();
            this.onCancel();
        });
        
        // Événement de soumission du formulaire
        this.modal.querySelector('#task-editor-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSave();
        });
        
        // Échap pour fermer
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.style.display === 'block') {
                this.hide();
            }
        });
    }
    
    show(task = null) {
        this.currentTask = task;
        const title = this.modal.querySelector('#task-editor-title');
        const texts = this.getTexts();
        
        if (task) {
            title.textContent = texts.editTask;
            this.populateForm(task);
        } else {
            title.textContent = texts.addTask;
            this.clearForm();
        }
        
        this.modal.style.display = 'block';
        
        // Focus sur le premier champ
        setTimeout(() => {
            this.modal.querySelector('#task-editor-description').focus();
        }, 100);
    }

    showForTask(task) {
        this.show(task);
    }
    
    hide() {
        this.modal.style.display = 'none';
        this.currentTask = null;
    }
    
    populateForm(task) {
        const form = this.modal.querySelector('#task-editor-form');
        
        // Champs de base
        form.querySelector('#task-editor-description').value = task.description || '';
        form.querySelector('#task-editor-priority').value = task.priority || '';
        form.querySelector('#task-editor-duration').value = task.duration || '';
        
        // Champs étendus si disponibles
        if (this.options.showAllFields) {
            const tagsField = form.querySelector('#task-editor-tags');
            const projectField = form.querySelector('#task-editor-project');
            const dueField = form.querySelector('#task-editor-due');
            const scheduledField = form.querySelector('#task-editor-scheduled');
            
            if (tagsField) tagsField.value = Array.isArray(task.tags) ? task.tags.join(', ') : (task.tags || '');
            if (projectField) projectField.value = task.project || '';
            if (dueField) dueField.value = this.formatDateForInput(task.due);
            if (scheduledField) scheduledField.value = this.formatDateForInput(task.scheduled);
        }
    }
    
    clearForm() {
        const form = this.modal.querySelector('#task-editor-form');
        form.reset();
    }
    
    handleSave() {
        const form = this.modal.querySelector('#task-editor-form');
        const formData = new FormData(form);
        
        const taskData = {
            description: form.querySelector('#task-editor-description').value,
            priority: form.querySelector('#task-editor-priority').value,
            duration: form.querySelector('#task-editor-duration').value
        };
        
        // Ajouter les champs étendus si disponibles
        if (this.options.showAllFields) {
            const tagsField = form.querySelector('#task-editor-tags');
            const projectField = form.querySelector('#task-editor-project');
            const dueField = form.querySelector('#task-editor-due');
            const scheduledField = form.querySelector('#task-editor-scheduled');
            
            if (tagsField) {
                taskData.tags = tagsField.value.split(',').map(tag => tag.trim()).filter(tag => tag);
            }
            if (projectField) taskData.project = projectField.value;
            if (dueField) taskData.due = dueField.value;
            if (scheduledField) taskData.scheduled = scheduledField.value;
        }
        
        // Ajouter l'ID si on modifie une tâche existante
        if (this.currentTask) {
            taskData.id = this.currentTask.id;
            taskData.uuid = this.currentTask.uuid;
        }
        
        // Appeler la nouvelle méthode de sauvegarde
        this.saveTask(taskData, this.currentTask !== null);
    }

    async saveTask(taskData, isEdit) {
        try {
            const taskDataForAPI = this.prepareTaskDataForAPI(taskData, isEdit);
            const endpoint = isEdit ? `/api/task/${taskData.uuid}/modify` : '/api/task/add';
            const method = isEdit ? 'PUT' : 'POST';

            const response = await fetch(endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(taskDataForAPI)
            });

            const data = await response.json();

            if (data.success) {
                this.onSaveSuccess(data.task, isEdit);
                this.hide();
            } else {
                this.onSaveError(data.error || (isEdit ? 'Failed to update task' : 'Failed to add task'));
            }
        } catch (error) {
            this.onSaveError('Network error: ' + error.message);
        }
    }

    prepareTaskDataForAPI(taskData, isEdit) {
        const preparedData = {
            description: taskData.description,
            tags: taskData.tags || [],
            project: taskData.project || null,
            priority: taskData.priority || null,
            duration: taskData.duration || null
        };

        // Formater les dates si elles existent
        if (taskData.due) {
            preparedData.due = this.formatDateForTask(taskData.due);
        }
        if (taskData.scheduled) {
            preparedData.scheduled = this.formatDateForTask(taskData.scheduled);
        }

        // Pour la modification, utiliser 'est' au lieu de 'duration'
        if (isEdit && preparedData.duration) {
            preparedData.est = preparedData.duration;
            delete preparedData.duration;
        }

        return preparedData;
    }

    formatDateForTask(dateString) {
        // Convertir le format datetime-local en format TaskWarrior
        if (!dateString) return '';
        
        // Retourner la chaîne avec les secondes ajoutées si nécessaire
        return dateString.length === 16 ? `${dateString}:00` : dateString;
    }
    
    formatDateForInput(dateString) {
        if (!dateString) return '';
        
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return '';
            
            // Format pour datetime-local input
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        } catch (e) {
            return '';
        }
    }
    
    // Méthode utilitaire pour convertir entre les formats de priorité
    static convertPriority(priority, fromFormat, toFormat) {
        const priorityMap = {
            'H': 'high',
            'M': 'medium', 
            'L': 'low',
            'high': 'H',
            'medium': 'M',
            'low': 'L'
        };
        
        if (fromFormat === toFormat) return priority;
        return priorityMap[priority] || priority;
    }
    
    // Méthode pour détruire le composant
    destroy() {
        if (this.modal) {
            this.modal.remove();
        }
    }
}

// Export pour utilisation en module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaskEditor;
}
