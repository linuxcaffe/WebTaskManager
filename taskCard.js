/**
 * TaskActionHandler - Interface pour gérer les actions des tâches
 * Version autonome sans dépendance à l'objet app global
 */
class TaskActionHandler {
    /**
     * @param {Object} options - Options de configuration
     * @param {Function} options.onTaskUpdate - Callback pour mise à jour des tâches
     * @param {Function} options.onTaskDelete - Callback pour suppression de tâche
     * @param {Function} options.onEditRequest - Callback pour demande d'édition
     * @param {Function} options.showNotification - Callback pour afficher des notifications
     */
    constructor(options = {}) {
        this.onTaskUpdate = options.onTaskUpdate || (() => {});
        this.onTaskDelete = options.onTaskDelete || (() => {});
        this.onEditRequest = options.onEditRequest || (() => {});
        this.showNotification = options.showNotification || (() => {});
    }

    async performTaskAction(taskUuid, action) {
        const actionMap = {
            'start': 'POST',
            'stop': 'POST',
            'done': 'POST',
            'delete': 'DELETE'
        };

        const method = actionMap[action];
        const endpoint = action === 'delete' ? `/api/task/${taskUuid}/delete` : `/api/task/${taskUuid}/${action}`;

        try {
            const response = await fetch(endpoint, { method });
            const data = await response.json();

            if (data.success) {
                if (action === 'delete') {
                    this.onTaskDelete(taskUuid);
                } else if (data.task) {
                    this.onTaskUpdate(data.task);
                } else {
                    // Si pas de tâche retournée, on déclenche une recharge complète
                    this.onTaskUpdate(null);
                }
                this.showNotification(`Task ${action} successful`, 'success');
            } else {
                this.showNotification(data.message || `Failed to ${action} task`, 'error');
            }
        } catch (error) {
            this.showNotification('Network error: ' + error.message, 'error');
        }
    }
    
    openEditModal(task) {
        this.onEditRequest(task);
    }
    
    confirmDelete(taskUuid) {
        if (confirm('Are you sure you want to delete this task?')) {
            this.performTaskAction(taskUuid, 'delete');
        }
    }
}

/**
 * ScriptTaskActionHandler - Implémentation spécifique pour script.js
 * Maintenue pour compatibilité ascendante
 */
class ScriptTaskActionHandler extends TaskActionHandler {
    constructor() {
        super({
            onTaskUpdate: (task) => {
                if (task) {
                    const taskIndex = app.tasks.findIndex(t => t.uuid === task.uuid);
                    if (taskIndex !== -1) {
                        app.tasks[taskIndex] = task;
                    }
                }
                app.renderTasks();
            },
            onTaskDelete: (taskUuid) => {
                app.removeTaskCard(taskUuid);
                app.tasks = app.tasks.filter(task => task.uuid !== taskUuid);
            },
            onEditRequest: (task) => app.openEditModal(task),
            showNotification: (message, type) => app.showNotification(message, type)
        });
    }
}


/**
 * TaskCardManager - Gestionnaire centralisé pour la création et la gestion des TaskCards
 * Permet de basculer entre les modes minimaliste et complet
 */

class TaskCardManager {
    constructor(actionHandler = null) {
        this.templates = {};
        this.actionHandler = actionHandler || new TaskActionHandler();
        this.loadTemplates();
    }

    /**
     * Définit un gestionnaire d'actions personnalisé
     * @param {TaskActionHandler} handler - Le gestionnaire d'actions à utiliser
     */
    setActionHandler(handler) {
        this.actionHandler = handler;
    }

    /**
     * Charge les templates depuis le DOM
     */
    loadTemplates() {
        // Vérifier si les templates sont déjà dans le DOM
        const minimalTemplate = document.getElementById('task-card-minimal');
        const fullTemplate = document.getElementById('task-card-full');

        if (minimalTemplate && fullTemplate) {
            this.templates.minimal = minimalTemplate;
            this.templates.full = fullTemplate;
        } else {
            // Si les templates ne sont pas dans le DOM, les charger dynamiquement
            this.loadTemplatesFromFile();
        }
    }

    /**
     * Charge les templates depuis le fichier HTML
     */
    async loadTemplatesFromFile() {
        try {
            const response = await fetch('task-card-templates.html');
            const html = await response.text();
            
            // Créer un élément temporaire pour parser le HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            
            // Extraire les templates
            const minimalTemplate = tempDiv.querySelector('#task-card-minimal');
            const fullTemplate = tempDiv.querySelector('#task-card-full');
            
            if (minimalTemplate && fullTemplate) {
                this.templates.minimal = minimalTemplate;
                this.templates.full = fullTemplate;
                
                // Ajouter les templates au DOM pour qu'ils soient disponibles
                document.body.appendChild(minimalTemplate);
                document.body.appendChild(fullTemplate);
            } else {
                console.error('Templates non trouvés dans le fichier task-card-templates.html');
            }
        } catch (error) {
            console.error('Erreur lors du chargement des templates:', error);
        }
    }

    /**
     * Crée une TaskCard en utilisant le template approprié
     * @param {Object} task - Les données de la tâche
     * @param {string} mode - Le mode ('minimal' ou 'full')
     * @returns {HTMLElement} - L'élément TaskCard
     */
    createTaskCard(task, mode = 'minimal') {
        if (!this.templates[mode]) {
            console.error(`Template ${mode} non disponible`);
            return null;
        }

        // Cloner le template
        const template = this.templates[mode];
        const card = template.content.cloneNode(true).querySelector('.task-card');

        // Remplir les slots avec les données de la tâche
        this.fillSlots(card, task, mode);

        // Ajouter les données de la tâche à l'élément
        card.dataset.taskId = task.uuid;
        card.dataset.taskData = JSON.stringify(task).replace(/'/g, "&apos;");

        // Ajouter un gestionnaire d'événements pour la sélection
        card.addEventListener('click', function(e) {
            // Ne pas déclencher si le clic est sur le bouton de bascule ou sur un bouton d'action
            if (e.target.closest('.toggle-mode-btn') || e.target.closest('.btn')) {
                return;
            }
            // Optionnel: tu peux ajouter ici ton propre comportement de clic
            // console.log('Task card clicked:', task.uuid);
        });

        return card;
    }

    /**
     * Remplit les slots d'une TaskCard avec les données de la tâche
     * @param {HTMLElement} card - L'élément TaskCard
     * @param {Object} task - Les données de la tâche
     * @param {string} mode - Le mode ('minimal' ou 'full')
     */
    fillSlots(card, task, mode) {
        // Priorité
        const priority = task.priority || 'M';
        const priorityClass = priority === 'H' ? 'high' : priority === 'M' ? 'medium' : 'low';
        const priorityText = priority === 'H' ? 'Haute' : priority === 'M' ? 'Moyenne' : 'Basse';
        const prioritySlot = card.querySelector('[name="priority"]');
        if (prioritySlot) {
            prioritySlot.textContent = priorityText;
            prioritySlot.className = `task-priority ${priorityClass}`;
        }

        // Description
        const descriptionSlot = card.querySelector('[name="description"]');
        if (descriptionSlot) {
            descriptionSlot.textContent = this.escapeHtml(task.description);
        }

        // Durée
        const duration = this.parseEstTime(task.estTime);
        const durationText = duration ? this.formatDuration(duration) : 'Non estimé';
        const durationSlot = card.querySelector('[name="duration"]');
        if (durationSlot) {
            durationSlot.textContent = durationText;
        }

        // Pool
        const pool = task.pool || 'pro';
        const poolSlot = card.querySelector('[name="pool"]');
        if (poolSlot) {
            poolSlot.textContent = pool;
        }

        // Date d'échéance (uniquement en mode complet)
        if (mode === 'full') {
            let dueDate = '';
            if (task.due) {
                try {
                    const date = new Date(task.due);
                    if (!isNaN(date.getTime())) {
                        dueDate = date.toLocaleDateString('fr-FR');
                    }
                } catch (e) {
                    console.error('Format de date invalide pour la tâche:', task);
                }
            }
            const dueSlot = card.querySelector('[name="due"]');
            if (dueSlot) {
                dueSlot.textContent = dueDate;
            }

            // Tags
            const tags = task.tags || [];
            const tagsSlot = card.querySelector('[name="tags"]');
            if (tagsSlot) {
                tagsSlot.innerHTML = tags.map(tag => `<span class="task-tag">#${this.escapeHtml(tag)}</span>`).join('');
            }

            // Actions
            const actionsSlot = card.querySelector('[name="actions"]');
            if (actionsSlot) {
                actionsSlot.innerHTML = this.createTaskActions(task);
            }
        }
    }

    /**
     * Crée les boutons d'action pour une tâche
     * @param {Object} task - Les données de la tâche
     * @returns {string} - Le HTML des boutons d'action
     */
    createTaskActions(task) {
        return `
            ${task.start ?
                `<button class="btn btn-warning btn-small" onclick="taskCardManager.actionHandler.performTaskAction('${task.uuid}', 'stop')">
                    <span class="icon">⏸️</span> Stop
                </button>` :
                `<button class="btn btn-success btn-small" onclick="taskCardManager.actionHandler.performTaskAction('${task.uuid}', 'start')">
                    <span class="icon">▶️</span> Start
                </button>`
            }
            <button class="btn btn-primary btn-small" onclick="taskCardManager.actionHandler.openEditModal(${JSON.stringify(task).replace(/\"/g, '&quot;')})">
                <span class="icon">✏️</span> Edit
            </button>
            <button class="btn btn-success btn-small" onclick="taskCardManager.actionHandler.performTaskAction('${task.uuid}', 'done')">
                <span class="icon">✅</span> Done
            </button>
            <button class="btn btn-danger btn-small" onclick="taskCardManager.actionHandler.confirmDelete('${task.uuid}')">
                <span class="icon">🗑️</span> Delete
            </button>
        `;
        /** 
         * Ceci est pour pallier au bug d'affichage de vim... Très bizarre.
         * return `}`;
        */
    }

    /**
     * Formate la durée en minutes pour l'affichage
     * @param {number} minutes - La durée en minutes
     * @returns {string} - La durée formatée
     */
    formatDuration(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        
        if (hours > 0 && mins > 0) {
            return `${hours}h${mins}min`;
        } else if (hours > 0) {
            return `${hours}h`;
        } else {
            return `${mins}min`;
        }
    }

    /**
     * Basculer entre les modes minimaliste et complet
     * @param {HTMLElement} cardElement - L'élément TaskCard
     */
    toggleMode(cardElement) {
        const taskData = JSON.parse(cardElement.dataset.taskData);
        const currentMode = cardElement.classList.contains('full-mode') ? 'full' : 'minimal';
        const newMode = currentMode === 'minimal' ? 'full' : 'minimal';

        // Créer une nouvelle carte avec le mode opposé
        const newCard = this.createTaskCard(taskData, newMode);
        
        // Remplacer l'ancienne carte par la nouvelle
        cardElement.parentNode.replaceChild(newCard, cardElement);
    }

    /**
     * Parse la durée estimée d'une tâche
     * @param {string} estTime - La durée estimée au format ISO 8601 ou autre
     * @returns {number|null} - La durée en minutes
     */
    parseEstTime(estTime) {
        if (!estTime) return null;
        
        // Gérer le format ISO 8601 (PT2H30M)
        if (estTime.startsWith('PT')) {
            const match = estTime.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (match) {
                const hours = parseInt(match[1] || 0);
                const minutes = parseInt(match[2] || 0);
                const seconds = parseInt(match[3] || 0);
                
                return hours * 60 + minutes + Math.round(seconds / 60);
            }
        }
        
        // Gérer l'ancien format (1h30min, 30min, etc.)
        const match = estTime.match(/(\d+)h|(\d+)min/g);
        if (!match) return null;
        
        let minutes = 0;
        match.forEach(part => {
            if (part.includes('h')) {
                minutes += parseInt(part) * 60;
            } else if (part.includes('min')) {
                minutes += parseInt(part);
            }
        });
        
        return minutes;
    }


    /**
     * Échappe les caractères HTML pour éviter les attaques XSS
     * @param {string} text - Le texte à échapper
     * @returns {string} - Le texte échappé
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}


