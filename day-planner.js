// Planificateur de Journée - JavaScript moderne avec drag & drop

class DayPlanner {
    constructor() {
        this.tasks = JSON.parse(localStorage.getItem('dayPlannerTasks')) || [];
        this.scheduledTasks = JSON.parse(localStorage.getItem('dayPlannerScheduled')) || [];
        this.currentEditingTask = null;
        this.draggedTask = null;
        this.startHour = 6;
        this.endHour = 22;
        
        // Initialiser le composant TaskEditor unifié
        this.taskEditor = new TaskEditor({
            showAllFields: true, // Afficher tous les champs comme dans index.html
            priorityFormat: 'words', // high/medium/low
            language: 'fr',
            modalId: 'day-planner-task-editor',
            onSave: (taskData, isEdit) => this.handleTaskSave(taskData, isEdit),
            onCancel: () => this.handleTaskCancel()
        });
        
        // Initialiser le composant TaskCreator en mode modal
        this.taskCreator = new TaskCreator({
            showAllFields: true, // Afficher tous les champs
            priorityFormat: 'words', // high/medium/low
            language: 'fr',
            containerId: 'day-planner-task-creator-modal',
            inline: false, // Mode modal
            onSubmit: (taskData) => this.handleTaskCreate(taskData),
            onCancel: () => this.closeTaskCreatorModal()
        });
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.generateTimeSlots();
        this.displayCurrentDate();
        this.renderTasks();
        this.renderScheduledTasks();
        
        // Créer le container pour le modal TaskCreator
        this.createTaskCreatorModal();
    }

    setupEventListeners() {
        // Boutons principaux
        document.getElementById('save-btn').addEventListener('click', () => this.saveToFile());
        document.getElementById('reset-btn').addEventListener('click', () => this.resetPlanner());
        document.getElementById('add-task-btn').addEventListener('click', () => this.openTaskCreatorModal());
        
        // Tri des tâches
        document.getElementById('sort-tasks').addEventListener('change', (e) => this.sortTasks(e.target.value));

        // Raccourcis clavier
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.saveToFile();
            }
        });
    }

    generateTimeSlots() {
        const timeSlotsContainer = document.getElementById('time-slots');
        timeSlotsContainer.innerHTML = '';

        for (let hour = this.startHour; hour <= this.endHour; hour++) {
            // Créneau de l'heure pleine
            const hourSlot = this.createTimeSlot(hour, 0, true);
            timeSlotsContainer.appendChild(hourSlot);

            // Créneau de la demi-heure (sauf pour la dernière heure)
            if (hour < this.endHour) {
                const halfHourSlot = this.createTimeSlot(hour, 30, false);
                timeSlotsContainer.appendChild(halfHourSlot);
            }
        }
    }

    createTimeSlot(hour, minutes, isHour) {
        const slot = document.createElement('div');
        slot.className = `time-slot ${isHour ? 'hour' : 'half-hour'}`;
        slot.dataset.time = `${hour}:${minutes.toString().padStart(2, '0')}`;

        const timeLabel = document.createElement('div');
        timeLabel.className = 'time-label';
        if (isHour) {
            timeLabel.textContent = `${hour}:00`;
        }

        const timeContent = document.createElement('div');
        timeContent.className = 'time-content';
        
        // Rendre la zone droppable
        this.makeDroppable(timeContent);

        slot.appendChild(timeLabel);
        slot.appendChild(timeContent);

        return slot;
    }

    makeDroppable(element) {
        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            element.classList.add('drop-zone', 'drag-over');
        });

        element.addEventListener('dragleave', (e) => {
            if (!element.contains(e.relatedTarget)) {
                element.classList.remove('drag-over');
            }
        });

        element.addEventListener('drop', (e) => {
            e.preventDefault();
            element.classList.remove('drop-zone', 'drag-over');
            
            if (this.draggedTask) {
                const timeSlot = element.closest('.time-slot');
                const time = timeSlot.dataset.time;
                this.scheduleTask(this.draggedTask, time);
            }
        });
    }

    displayCurrentDate() {
        const dateDisplay = document.getElementById('current-date');
        const today = new Date();
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        };
        dateDisplay.textContent = today.toLocaleDateString('fr-FR', options);
    }

    openTaskModal(task = null) {
        // Utiliser le nouveau composant TaskEditor
        if (task) {
            this.taskEditor.show({
                id: task.id,
                description: task.title, // Mapper title vers description
                priority: task.priority,
                duration: this.formatDurationForEditor(task.duration),
                tags: [], // Pas de tags dans le day planner pour l'instant
                project: '', // Pas de projet dans le day planner pour l'instant
                due: null,
                scheduled: null
            });
        } else {
            this.taskEditor.show();
        }
    }

    closeTaskModal() {
        this.taskEditor.hide();
        this.currentEditingTask = null;
    }

    // Gestionnaire unifié pour la sauvegarde des tâches (édition)
    handleTaskSave(taskData, isEdit) {
        const duration = this.parseDurationFromEditor(taskData.duration);
        
        if (!taskData.description || !duration) {
            alert('Veuillez remplir tous les champs obligatoires.');
            return;
        }

        const finalTaskData = {
            id: isEdit ? taskData.id : Date.now(),
            title: taskData.description, // Mapper description vers title
            description: '', // Pas de description séparée dans le day planner
            duration: duration,
            priority: taskData.priority || 'medium',
            // Stocker les nouveaux champs même s'ils ne sont pas utilisés dans l'affichage
            tags: taskData.tags || [],
            project: taskData.project || '',
            due: taskData.due || null,
            scheduled: taskData.scheduled || null
        };

        if (isEdit) {
            const index = this.tasks.findIndex(t => t.id === taskData.id);
            if (index !== -1) {
                this.tasks[index] = finalTaskData;
            }
        } else {
            this.tasks.push(finalTaskData);
        }

        this.saveTasks();
        this.renderTasks();
    }
    
    // Créer le container pour le modal TaskCreator
    createTaskCreatorModal() {
        const modalContainer = document.createElement('div');
        modalContainer.id = 'day-planner-task-creator-modal';
        modalContainer.className = 'modal';
        modalContainer.style.display = 'none';
        document.body.appendChild(modalContainer);
    }
    
    // Ouvrir le modal de création de tâche
    openTaskCreatorModal() {
        const modal = document.getElementById('day-planner-task-creator-modal');
        if (modal) {
            modal.style.display = 'block';
        }
    }
    
    // Fermer le modal de création de tâche
    closeTaskCreatorModal() {
        const modal = document.getElementById('day-planner-task-creator-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    // Gestionnaire unifié pour la création de tâches
    handleTaskCreate(taskData) {
        const duration = this.parseDurationFromEditor(taskData.duration);
        
        if (!taskData.description || !duration) {
            alert('Veuillez remplir tous les champs obligatoires.');
            return;
        }

        const newTaskData = {
            id: Date.now(),
            title: taskData.description,
            description: '',
            duration: duration,
            priority: taskData.priority || 'medium',
            tags: taskData.tags || [],
            project: taskData.project || '',
            due: taskData.due || null,
            scheduled: taskData.scheduled || null
        };

        this.tasks.push(newTaskData);
        this.saveTasks();
        this.renderTasks();
        
        // Fermer le modal
        this.closeTaskCreatorModal();
        
        // Afficher une notification de succès
        this.showNotification('Tâche ajoutée avec succès !', 'success');
    }
    
    // Gestionnaire pour l'annulation
    handleTaskCancel() {
        this.currentEditingTask = null;
    }

    renderTasks() {
        const container = document.getElementById('unplanned-tasks');
        container.innerHTML = '';

        if (this.tasks.length === 0) {
            container.innerHTML = '<div class="loading">Aucune tâche à planifier</div>';
            return;
        }

        this.tasks.forEach(task => {
            const taskElement = this.createTaskElement(task);
            container.appendChild(taskElement);
        });
    }

    createTaskElement(task) {
        const taskDiv = document.createElement('div');
        taskDiv.className = `unplanned-task priority-${task.priority}`;
        taskDiv.draggable = true;
        taskDiv.dataset.taskId = task.id;

        taskDiv.innerHTML = `
            <div class="task-title">${task.title}</div>
            ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
            <div class="task-meta">
                <span class="task-duration">${task.duration} min</span>
                <div class="task-actions">
                    <button class="task-action-btn edit-task" title="Modifier">✏️</button>
                    <button class="task-action-btn delete-task" title="Supprimer">🗑️</button>
                </div>
            </div>
        `;

        // Événements de drag
        taskDiv.addEventListener('dragstart', (e) => {
            this.draggedTask = task;
            taskDiv.classList.add('dragging');
            document.getElementById('drag-overlay').classList.add('active');
            
            // Ajouter les zones de drop
            document.querySelectorAll('.time-content').forEach(content => {
                content.classList.add('drop-zone');
            });
        });

        taskDiv.addEventListener('dragend', () => {
            taskDiv.classList.remove('dragging');
            document.getElementById('drag-overlay').classList.remove('active');
            this.draggedTask = null;
            
            // Retirer les zones de drop
            document.querySelectorAll('.time-content').forEach(content => {
                content.classList.remove('drop-zone', 'drag-over');
            });
        });

        // Boutons d'action
        taskDiv.querySelector('.edit-task').addEventListener('click', (e) => {
            e.stopPropagation();
            this.openTaskModal(task);
        });

        taskDiv.querySelector('.delete-task').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteTask(task.id);
        });

        return taskDiv;
    }

    scheduleTask(task, time) {
        const [hour, minute] = time.split(':').map(Number);
        
        // Vérifier les conflits
        if (this.hasTimeConflict(hour, minute, task.duration)) {
            alert('Ce créneau horaire est déjà occupé ou se chevauche avec une autre tâche.');
            return;
        }

        // Ajouter à la planification
        const scheduledTask = {
            ...task,
            scheduledTime: time,
            scheduledHour: hour,
            scheduledMinute: minute
        };

        this.scheduledTasks.push(scheduledTask);

        // Retirer de la liste des tâches non planifiées
        this.tasks = this.tasks.filter(t => t.id !== task.id);

        this.saveTasks();
        this.renderTasks();
        this.renderScheduledTasks();
    }

    hasTimeConflict(hour, minute, duration) {
        const startTime = hour * 60 + minute;
        const endTime = startTime + duration;

        return this.scheduledTasks.some(task => {
            const taskStart = task.scheduledHour * 60 + task.scheduledMinute;
            const taskEnd = taskStart + task.duration;
            
            return (startTime < taskEnd && endTime > taskStart);
        });
    }

    renderScheduledTasks() {
        // Nettoyer les tâches existantes
        document.querySelectorAll('.scheduled-task').forEach(task => task.remove());

        this.scheduledTasks.forEach(task => {
            const taskElement = this.createScheduledTaskElement(task);
            const timeSlot = document.querySelector(`[data-time="${task.scheduledTime}"]`);
            
            if (timeSlot) {
                const timeContent = timeSlot.querySelector('.time-content');
                timeContent.appendChild(taskElement);
            }
        });
    }

    createScheduledTaskElement(task) {
        const taskDiv = document.createElement('div');
        taskDiv.className = `scheduled-task priority-${task.priority}`;
        taskDiv.style.height = `${(task.duration / 30) * 60 - 10}px`; // 60px par demi-heure, moins 10px de marge
        taskDiv.dataset.taskId = task.id;

        taskDiv.innerHTML = `
            <div class="scheduled-task-title">${task.title}</div>
            <div class="scheduled-task-duration">${task.duration} min</div>
            <div class="scheduled-task-actions">
                <button class="task-action-btn unschedule-task" title="Déplanifier">↩️</button>
                <button class="task-action-btn delete-scheduled-task" title="Supprimer">🗑️</button>
            </div>
        `;

        // Rendre redimensionnable
        this.makeResizable(taskDiv, task);

        // Boutons d'action
        taskDiv.querySelector('.unschedule-task').addEventListener('click', (e) => {
            e.stopPropagation();
            this.unscheduleTask(task.id);
        });

        taskDiv.querySelector('.delete-scheduled-task').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteScheduledTask(task.id);
        });

        return taskDiv;
    }

    makeResizable(element, task) {
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;

        // Ajouter une poignée de redimensionnement
        const resizeHandle = document.createElement('div');
        resizeHandle.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 5px;
            background: rgba(0,0,0,0.1);
            cursor: ns-resize;
            opacity: 0;
            transition: opacity 0.2s;
        `;
        element.appendChild(resizeHandle);

        element.addEventListener('mouseenter', () => {
            resizeHandle.style.opacity = '1';
        });

        element.addEventListener('mouseleave', () => {
            if (!isResizing) {
                resizeHandle.style.opacity = '0';
            }
        });

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = parseInt(window.getComputedStyle(element).height);
            
            document.addEventListener('mousemove', handleResize);
            document.addEventListener('mouseup', stopResize);
            e.preventDefault();
        });

        const handleResize = (e) => {
            if (!isResizing) return;
            
            const deltaY = e.clientY - startY;
            const newHeight = Math.max(50, startHeight + deltaY); // Hauteur minimum de 50px
            const newDuration = Math.round((newHeight + 10) / 60 * 30); // Convertir en minutes
            
            element.style.height = `${newHeight}px`;
            
            // Mettre à jour l'affichage de la durée
            const durationElement = element.querySelector('.scheduled-task-duration');
            durationElement.textContent = `${newDuration} min`;
        };

        const stopResize = () => {
            if (!isResizing) return;
            
            isResizing = false;
            resizeHandle.style.opacity = '0';
            
            // Mettre à jour la durée de la tâche
            const newHeight = parseInt(element.style.height);
            const newDuration = Math.round((newHeight + 10) / 60 * 30);
            
            // Mettre à jour dans les données
            const taskIndex = this.scheduledTasks.findIndex(t => t.id === task.id);
            if (taskIndex !== -1) {
                this.scheduledTasks[taskIndex].duration = newDuration;
                this.saveTasks();
            }
            
            document.removeEventListener('mousemove', handleResize);
            document.removeEventListener('mouseup', stopResize);
        };
    }

    unscheduleTask(taskId) {
        const taskIndex = this.scheduledTasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            const task = this.scheduledTasks[taskIndex];
            
            // Retirer les propriétés de planification
            const { scheduledTime, scheduledHour, scheduledMinute, ...unscheduledTask } = task;
            
            // Remettre dans la liste des tâches non planifiées
            this.tasks.push(unscheduledTask);
            this.scheduledTasks.splice(taskIndex, 1);
            
            this.saveTasks();
            this.renderTasks();
            this.renderScheduledTasks();
        }
    }

    deleteTask(taskId) {
        if (confirm('Êtes-vous sûr de vouloir supprimer cette tâche ?')) {
            this.tasks = this.tasks.filter(t => t.id !== taskId);
            this.saveTasks();
            this.renderTasks();
        }
    }

    deleteScheduledTask(taskId) {
        if (confirm('Êtes-vous sûr de vouloir supprimer cette tâche planifiée ?')) {
            this.scheduledTasks = this.scheduledTasks.filter(t => t.id !== taskId);
            this.saveTasks();
            this.renderScheduledTasks();
        }
    }

    sortTasks(sortBy) {
        switch (sortBy) {
            case 'priority':
                const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
                this.tasks.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
                break;
            case 'duration':
                this.tasks.sort((a, b) => a.duration - b.duration);
                break;
            case 'alphabetical':
                this.tasks.sort((a, b) => a.title.localeCompare(b.title));
                break;
        }
        this.renderTasks();
    }

    saveTasks() {
        localStorage.setItem('dayPlannerTasks', JSON.stringify(this.tasks));
        localStorage.setItem('dayPlannerScheduled', JSON.stringify(this.scheduledTasks));
    }

    saveToFile() {
        const data = {
            date: new Date().toISOString().split('T')[0],
            tasks: this.tasks,
            scheduledTasks: this.scheduledTasks,
            exportedAt: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `planification-${data.date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showNotification('Planification sauvegardée avec succès !', 'success');
    }

    resetPlanner() {
        if (confirm('Êtes-vous sûr de vouloir réinitialiser toute la planification ? Cette action est irréversible.')) {
            this.tasks = [];
            this.scheduledTasks = [];
            this.saveTasks();
            this.renderTasks();
            this.renderScheduledTasks();
            this.showNotification('Planification réinitialisée', 'info');
        }
    }

    // Méthodes utilitaires pour la conversion de durée
    formatDurationForEditor(minutes) {
        if (minutes < 60) {
            return `${minutes}min`;
        } else {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            if (remainingMinutes === 0) {
                return `${hours}h`;
            } else {
                return `${hours}h${remainingMinutes}m`;
            }
        }
    }
    
    parseDurationFromEditor(durationString) {
        if (!durationString) return 0;
        
        // Gérer les formats: "30min", "1h", "1h30m", "90"
        const hourMatch = durationString.match(/(\d+)h/);
        const minuteMatch = durationString.match(/(\d+)m/);
        const plainNumber = durationString.match(/^(\d+)$/);
        
        let totalMinutes = 0;
        
        if (hourMatch) {
            totalMinutes += parseInt(hourMatch[1]) * 60;
        }
        
        if (minuteMatch) {
            totalMinutes += parseInt(minuteMatch[1]);
        }
        
        if (plainNumber && !hourMatch && !minuteMatch) {
            totalMinutes = parseInt(plainNumber[1]);
        }
        
        return totalMinutes;
    }

    showNotification(message, type = 'info') {
        // Créer une notification toast
        const notification = document.createElement('div');
        notification.className = `notification toast ${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            z-index: 10000;
            animation: slideInRight 0.3s ease;
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease forwards';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

// Ajouter les animations CSS pour les notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialiser l'application quand le DOM est chargé
document.addEventListener('DOMContentLoaded', () => {
    new DayPlanner();
});

// Ajouter quelques tâches d'exemple au premier chargement
if (!localStorage.getItem('dayPlannerTasks')) {
    const exampleTasks = [
        {
            id: 1,
            title: 'Réunion équipe',
            description: 'Point hebdomadaire avec l\'équipe de développement',
            duration: 60,
            priority: 'high'
        },
        {
            id: 2,
            title: 'Révision code',
            description: 'Relecture des pull requests en attente',
            duration: 45,
            priority: 'medium'
        },
        {
            id: 3,
            title: 'Pause déjeuner',
            description: 'Temps de pause et repas',
            duration: 60,
            priority: 'low'
        },
        {
            id: 4,
            title: 'Formation JavaScript',
            description: 'Apprentissage des nouvelles fonctionnalités ES2024',
            duration: 90,
            priority: 'medium'
        }
    ];
    
    localStorage.setItem('dayPlannerTasks', JSON.stringify(exampleTasks));
}
