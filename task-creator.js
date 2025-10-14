/**
 * Composant réutilisable pour la création de tâches
 * Unifie les formulaires d'ajout entre index.html et day-planner.html
 */

class TaskCreator {
    constructor(options = {}) {
        this.options = {
            // Configuration par défaut
            showAllFields: true,
            priorityFormat: 'letters', // 'letters' (H/M/L) ou 'words' (high/medium/low)
            language: 'fr', // 'fr' ou 'en'
            containerId: 'task-creator-container',
            formId: 'task-creator-form',
            inline: true, // true pour formulaire inline, false pour modal
            ...options
        };
        
        this.onSubmit = options.onSubmit || (() => {});
        this.onCancel = options.onCancel || (() => {});
        
        this.init();
    }
    
    init() {
        this.createForm();
        this.bindEvents();
    }
    
    createForm() {
        const container = document.getElementById(this.options.containerId);
        if (!container) {
            console.error(`Container with id "${this.options.containerId}" not found`);
            return;
        }
        
        container.innerHTML = this.getFormHTML();
        this.form = container.querySelector(`#${this.options.formId}`);
    }
    
    getFormHTML() {
        const texts = this.getTexts();
        const priorityOptions = this.getPriorityOptions();
        
        return `
            <div class="task-creator ${this.options.inline ? 'inline' : 'modal'}">
                ${!this.options.inline ? `<h2>${texts.addTask}</h2>` : ''}
                <form id="${this.options.formId}">
                    <div class="form-group">
                        <input type="text" id="creator-description" placeholder="${texts.descriptionPlaceholder}" required>
                    </div>
                    
                    ${this.options.showAllFields ? `
                    <div class="form-row">
                        <div class="form-group">
                            <input type="text" id="creator-tags" placeholder="${texts.tagsPlaceholder}">
                        </div>
                        <div class="form-group">
                            <input type="text" id="creator-project" placeholder="${texts.projectPlaceholder}" list="creator-project-options">
                            <datalist id="creator-project-options"></datalist>
                        </div>
                        <div class="form-group">
                            <select id="creator-priority">
                                <option value="">${texts.priorityPlaceholder}</option>
                                ${priorityOptions.map(option => 
                                    `<option value="${option.value}">${option.label}</option>`
                                ).join('')}
                            </select>
                        </div>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label for="creator-due">${texts.dueDate}:</label>
                            <input type="datetime-local" id="creator-due">
                        </div>
                        <div class="form-group">
                            <label for="creator-scheduled">${texts.scheduled}:</label>
                            <input type="datetime-local" id="creator-scheduled">
                        </div>
                        <div class="form-group">
                            <label for="creator-duration">${texts.duration}:</label>
                            <input type="text" id="creator-duration" placeholder="${texts.durationPlaceholder}">
                        </div>
                    </div>
                    ` : `
                    <div class="form-row">
                        <div class="form-group">
                            <select id="creator-priority">
                                <option value="">${texts.priorityPlaceholder}</option>
                                ${priorityOptions.map(option => 
                                    `<option value="${option.value}">${option.label}</option>`
                                ).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <input type="text" id="creator-duration" placeholder="${texts.durationPlaceholder}" required>
                        </div>
                    </div>
                    `}
                    
                    <div class="form-actions">
                        <button type="submit" class="btn btn-success">
                            ${texts.addTask}
                        </button>
                        ${!this.options.inline ? `
                        <button type="button" class="btn btn-secondary" id="creator-cancel">
                            ${texts.cancel}
                        </button>
                        ` : ''}
                    </div>
                </form>
            </div>
        `;
    }
    
    getTexts() {
        if (this.options.language === 'fr') {
            return {
                addTask: 'Ajouter une tâche',
                descriptionPlaceholder: 'Description de la tâche',
                tagsPlaceholder: 'Tags (séparés par des virgules)',
                projectPlaceholder: 'Projet',
                priorityPlaceholder: 'Priorité',
                dueDate: 'Date d\'échéance',
                scheduled: 'Planifié',
                duration: 'Durée',
                durationPlaceholder: 'ex: 30min, 1h30m, 2d',
                cancel: 'Annuler'
            };
        } else {
            return {
                addTask: 'Add Task',
                descriptionPlaceholder: 'Task description',
                tagsPlaceholder: 'Tags (comma-separated)',
                projectPlaceholder: 'Project',
                priorityPlaceholder: 'Priority',
                dueDate: 'Due Date',
                scheduled: 'Scheduled',
                duration: 'Duration',
                durationPlaceholder: 'e.g., 30min, 1h30m, 2d',
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
        if (!this.form) return;
        
        // Événement de soumission du formulaire
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSubmit();
        });
        
        // Événement d'annulation (si pas inline)
        if (!this.options.inline) {
            const cancelBtn = this.form.querySelector('#creator-cancel');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    this.clearForm();
                    this.onCancel();
                });
            }
        }
    }
    
    handleSubmit() {
        const taskData = this.getFormData();
        
        if (!taskData.description.trim()) {
            alert(this.options.language === 'fr' ? 
                'La description est obligatoire' : 
                'Description is required');
            return;
        }
        
        // Validation supplémentaire pour les champs simplifiés
        if (!this.options.showAllFields && !taskData.duration.trim()) {
            alert(this.options.language === 'fr' ? 
                'La durée est obligatoire' : 
                'Duration is required');
            return;
        }
        
        this.onSubmit(taskData);
        this.clearForm();
    }
    
    getFormData() {
        const form = this.form;
        
        const taskData = {
            description: form.querySelector('#creator-description').value.trim()
        };
        
        if (this.options.showAllFields) {
            const tagsValue = form.querySelector('#creator-tags').value.trim();
            taskData.tags = tagsValue ? tagsValue.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
            taskData.project = form.querySelector('#creator-project').value.trim();
            taskData.priority = form.querySelector('#creator-priority').value;
            taskData.due = form.querySelector('#creator-due').value;
            taskData.scheduled = form.querySelector('#creator-scheduled').value;
            taskData.duration = form.querySelector('#creator-duration').value.trim();
        } else {
            taskData.priority = form.querySelector('#creator-priority').value;
            taskData.duration = form.querySelector('#creator-duration').value.trim();
            taskData.tags = [];
            taskData.project = '';
            taskData.due = '';
            taskData.scheduled = '';
        }
        
        return taskData;
    }
    
    clearForm() {
        if (this.form) {
            this.form.reset();
        }
    }
    
    // Méthode pour mettre à jour les suggestions de projets
    updateProjectSuggestions(projects = []) {
        if (!this.options.showAllFields) return;
        
        const datalist = this.form?.querySelector('#creator-project-options');
        if (!datalist) return;
        
        // Vider les options existantes
        datalist.innerHTML = '';
        
        // Ajouter les nouveaux projets
        projects.forEach(project => {
            if (project) {
                const option = document.createElement('option');
                option.value = project;
                datalist.appendChild(option);
            }
        });
    }
    
    // Méthode pour pré-remplir le formulaire
    setFormData(data) {
        if (!this.form) return;
        
        const descField = this.form.querySelector('#creator-description');
        if (descField && data.description) {
            descField.value = data.description;
        }
        
        if (this.options.showAllFields) {
            const tagsField = this.form.querySelector('#creator-tags');
            const projectField = this.form.querySelector('#creator-project');
            const priorityField = this.form.querySelector('#creator-priority');
            const dueField = this.form.querySelector('#creator-due');
            const scheduledField = this.form.querySelector('#creator-scheduled');
            const durationField = this.form.querySelector('#creator-duration');
            
            if (tagsField && data.tags) {
                tagsField.value = Array.isArray(data.tags) ? data.tags.join(', ') : data.tags;
            }
            if (projectField && data.project) {
                projectField.value = data.project;
            }
            if (priorityField && data.priority) {
                priorityField.value = data.priority;
            }
            if (dueField && data.due) {
                dueField.value = this.formatDateForInput(data.due);
            }
            if (scheduledField && data.scheduled) {
                scheduledField.value = this.formatDateForInput(data.scheduled);
            }
            if (durationField && data.duration) {
                durationField.value = data.duration;
            }
        } else {
            const priorityField = this.form.querySelector('#creator-priority');
            const durationField = this.form.querySelector('#creator-duration');
            
            if (priorityField && data.priority) {
                priorityField.value = data.priority;
            }
            if (durationField && data.duration) {
                durationField.value = data.duration;
            }
        }
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
        const container = document.getElementById(this.options.containerId);
        if (container) {
            container.innerHTML = '';
        }
    }
}

// Export pour utilisation en module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaskCreator;
}
