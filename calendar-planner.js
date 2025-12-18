/**
 * Calendar Planner - Intégration Toast UI Calendar avec Taskwarrior
 * Permet de glisser-déposer des tâches non planifiées dans le calendrier
 */

// ===================================
// Variables globales
// ===================================
let calendar;
let unplannedTasks = [];
let allTasks = [];
let currentFilter = {
    pool: 'all',
    sort: 'urgency'
};

// ===================================
// Initialisation
// ===================================
document.addEventListener('DOMContentLoaded', () => {
    initializeCalendar();
    setupEventListeners();
    //loadTasks();
});

// ===================================
// Initialisation du calendrier Toast UI
// ===================================
function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new tui.Calendar(calendarEl, {
        defaultView: 'week',
        useFormPopup: false,
        useDetailPopup: false,
        isReadOnly: false,
        week: {
            startDayOfWeek: 1, // Lundi
            dayNames: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
            hourStart: 6,
            hourEnd: 23,
            taskView: false,
            eventView: ['time'],
            collapseDuplicateEvents: {
                getDuplicateEvents: (targetEvent, events) => {
                    return events.filter(event => event.title === targetEvent.title);
                },
                getMainEvent: (events) => events[0]
            }
        },
        month: {
            dayNames: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
            startDayOfWeek: 1,
            narrowWeekend: true
        },
        template: {
            time(event) {
                const { title, start, end } = event;
                const startTime = formatTime(start);
                const endTime = formatTime(end);
                return `<div class="calendar-event-time">${startTime} - ${endTime}</div>
                        <div class="calendar-event-title">${title}</div>`;
            }
        },
        calendars: [
            {
                id: 'scheduled',
                name: 'Tâches planifiées',
                backgroundColor: '#4a90e2',
                borderColor: '#357abd',
                dragBackgroundColor: '#4a90e2'
            },
            {
                id: 'pro',
                name: 'Pool Pro',
                backgroundColor: '#28a745',
                borderColor: '#1e7e34',
                dragBackgroundColor: '#28a745'
            },
            {
                id: 'perso',
                name: 'Pool Perso',
                backgroundColor: '#ffc107',
                borderColor: '#e0a800',
                dragBackgroundColor: '#ffc107'
            }
        ]
    });

    updateCalendarTitle();
}

// ===================================
// Configuration des écouteurs d'événements
// ===================================
function setupEventListeners() {
    // Navigation du calendrier
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const todayBtn = document.getElementById('today-btn');
    
    console.log('Boutons de navigation:', { prevBtn, nextBtn, todayBtn });
    
    prevBtn.addEventListener('click', () => {
        console.log('Bouton précédent cliqué');
        try {
            calendar.prev();
            console.log('Navigation précédente effectuée');
            updateCalendarTitle();
        } catch (error) {
            console.error('Erreur lors de la navigation précédente:', error);
        }
    });

    nextBtn.addEventListener('click', () => {
        console.log('Bouton suivant cliqué');
        try {
            calendar.next();
            console.log('Navigation suivante effectuée');
            updateCalendarTitle();
        } catch (error) {
            console.error('Erreur lors de la navigation suivante:', error);
        }
    });

    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            console.log('Bouton aujourd\'hui cliqué');
            try {
                calendar.today();
                console.log('Retour à aujourd\'hui effectué');
                updateCalendarTitle();
            } catch (error) {
                console.error('Erreur lors du retour à aujourd\'hui:', error);
            }
        });
    }

    // Changement de vue
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const view = e.target.dataset.view;
            changeView(view);
        });
    });

    // Actualiser
    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadTasks();
    });

    // Filtres
    document.getElementById('filter-pool').addEventListener('change', (e) => {
        currentFilter.pool = e.target.value;
        filterAndDisplayTasks();
    });

    document.getElementById('sort-tasks').addEventListener('change', (e) => {
        currentFilter.sort = e.target.value;
        filterAndDisplayTasks();
    });

    // Événements du calendrier
    calendar.on('clickEvent', ({ event }) => {
        showTaskDetailModal(event);
    });

    calendar.on('beforeUpdateEvent', ({ event, changes }) => {
        handleEventUpdate(event, changes);
    });

    // Modal
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('modal-unschedule-btn').addEventListener('click', handleUnschedule);
    document.getElementById('modal-done-btn').addEventListener('click', handleMarkDone);

    // Fermer le modal en cliquant à l'extérieur
    document.getElementById('task-detail-modal').addEventListener('click', (e) => {
        if (e.target.id === 'task-detail-modal') {
            closeModal();
        }
    });
}

// ===================================
// Chargement des tâches depuis l'API
// ===================================
async function loadTasks() {
    try {
        const response = await fetch('/api/tasks');
        const data = await response.json();

        if (data.success) {
            allTasks = data.tasks;
            processTasksForCalendar();
            filterAndDisplayTasks();
        } else {
            showError('Erreur lors du chargement des tâches');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showError('Impossible de charger les tâches');
    }
}

// ===================================
// Traitement des tâches pour le calendrier
// ===================================
function processTasksForCalendar() {
    // Séparer les tâches planifiées et non planifiées
    const scheduledTasks = [];
    unplannedTasks = [];

    allTasks.forEach(task => {
        // Vérifier si la tâche a un scheduled ou proposed_scheduled
        const scheduledDate = task.scheduled || task.proposed_scheduled;
        
        if (scheduledDate) {
            scheduledTasks.push(createCalendarEvent(task, scheduledDate));
        } else {
            unplannedTasks.push(task);
        }
    });

    // Mettre à jour le calendrier avec les tâches planifiées
    calendar.clear();
    calendar.createEvents(scheduledTasks);
}

// ===================================
// Créer un événement calendrier depuis une tâche
// ===================================
function createCalendarEvent(task, scheduledDate) {
    const start = new Date(scheduledDate);
    const duration = parseEstTime(task.estTime) || 60; // Durée par défaut: 60 min
    const end = new Date(start.getTime() + duration * 60000);

    const pool = task.pool || 'scheduled';
    const calendarId = ['pro', 'perso'].includes(pool) ? pool : 'scheduled';

    return {
        id: task.uuid,
        calendarId: calendarId,
        title: task.description,
        start: start,
        end: end,
        isReadOnly: false,
        raw: task
    };
}

// ===================================
// Filtrer et afficher les tâches non planifiées
// ===================================
function filterAndDisplayTasks() {
    let filteredTasks = [...unplannedTasks];

    // Filtrer par pool
    if (currentFilter.pool !== 'all') {
        filteredTasks = filteredTasks.filter(task => 
            (task.pool || 'pro') === currentFilter.pool
        );
    }

    // Trier
    filteredTasks.sort((a, b) => {
        switch (currentFilter.sort) {
            case 'urgency':
                return (b.urgency || 0) - (a.urgency || 0);
            case 'due':
                if (!a.due && !b.due) return 0;
                if (!a.due) return 1;
                if (!b.due) return -1;
                return new Date(a.due) - new Date(b.due);
            case 'duration':
                const durationA = parseEstTime(a.estTime) || 0;
                const durationB = parseEstTime(b.estTime) || 0;
                return durationB - durationA;
            default:
                return 0;
        }
    });

    displayUnplannedTasks(filteredTasks);
}

// ===================================
// Afficher les tâches non planifiées
// ===================================
function displayUnplannedTasks(tasks) {
    const container = document.getElementById('unplanned-tasks');
    const countEl = document.getElementById('task-count');

    countEl.textContent = `${tasks.length} tâche${tasks.length > 1 ? 's' : ''}`;

    if (tasks.length === 0) {
        container.innerHTML = `
            <div class="empty-message">
                <span class="icon">✅</span>
                <p>Aucune tâche à planifier</p>
            </div>
        `;
        return;
    }

    container.innerHTML = tasks.map(task => createTaskCard(task)).join('');

    // Ajouter les événements de drag and drop
    setupDragAndDrop();
}

// ===================================
// Créer une carte de tâche
// ===================================
function createTaskCard(task) {
    const priority = task.priority || 'M';
    const priorityClass = priority === 'H' ? 'high' : priority === 'M' ? 'medium' : 'low';
    const priorityText = priority === 'H' ? 'Haute' : priority === 'M' ? 'Moyenne' : 'Basse';
    
    const duration = parseEstTime(task.estTime);
    const durationText = duration ? formatDuration(duration) : 'Non estimé';
    
    const dueDate = task.due ? new Date(task.due).toLocaleDateString('fr-FR') : '';
    const tags = task.tags || [];
    const pool = task.pool || 'pro';

    return `
        <div class="task-card" 
             draggable="true" 
             data-task-id="${task.uuid}"
             data-task-data='${JSON.stringify(task).replace(/'/g, "&apos;")}'>
            <div class="task-card-header">
                <span class="task-priority ${priorityClass}">${priorityText}</span>
            </div>
            <div class="task-description">${escapeHtml(task.description)}</div>
            <div class="task-meta">
                <span class="task-meta-item">⏱️ ${durationText}</span>
                ${dueDate ? `<span class="task-meta-item">📅 ${dueDate}</span>` : ''}
                <span class="task-meta-item">📂 ${pool}</span>
            </div>
            ${tags.length > 0 ? `
                <div class="task-tags">
                    ${tags.map(tag => `<span class="task-tag">#${tag}</span>`).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

// ===================================
// Configuration du Drag and Drop
// ===================================
function setupDragAndDrop() {
    const taskCards = document.querySelectorAll('.task-card');

    taskCards.forEach(card => {
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
    });

    // Permettre le drop sur le calendrier
    const calendarEl = document.getElementById('calendar');
    calendarEl.addEventListener('dragover', handleDragOver);
    calendarEl.addEventListener('drop', handleDrop);
}

let draggedTask = null;

function handleDragStart(e) {
    const taskData = JSON.parse(e.target.dataset.taskData);
    draggedTask = taskData;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.innerHTML);
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e) {
    e.preventDefault();
    
    if (!draggedTask) return;

    // Obtenir la position de la souris et calculer la date/heure
    const calendarEl = document.getElementById('calendar');
    const rect = calendarEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Utiliser l'API Toast UI pour obtenir la date à cette position
    const dateTime = getDateTimeFromPosition(x, y);
    
    if (dateTime) {
        scheduleTask(draggedTask, dateTime);
    }

    draggedTask = null;
}

// ===================================
// Obtenir la date/heure depuis la position
// ===================================
function getDateTimeFromPosition(x, y) {
    // Cette fonction approxime la date/heure basée sur la position
    // Toast UI Calendar n'expose pas directement cette fonctionnalité
    
    const view = calendar.getViewName();
    const dateRange = calendar.getDateRangeStart();
    
    // Calcul approximatif basé sur la vue actuelle
    // Pour une implémentation plus précise, il faudrait analyser la structure DOM du calendrier
    
    // Pour l'instant, on utilise la date actuelle + l'heure cliquée
    const now = new Date();
    now.setHours(9, 0, 0, 0); // Par défaut à 9h
    
    return now;
}

// ===================================
// Planifier une tâche
// ===================================
async function scheduleTask(task, dateTime) {
    try {
        // Utiliser proposed_scheduled selon la mémoire
        const response = await fetch(`/api/task/${task.id}/modify`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                proposed_scheduled: dateTime.toISOString()
            })
        });

        const data = await response.json();

        if (data.success) {
            showSuccess('Tâche planifiée avec succès');
            loadTasks(); // Recharger les tâches
        } else {
            showError('Erreur lors de la planification');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showError('Impossible de planifier la tâche');
    }
}

// ===================================
// Mise à jour d'événement (déplacement dans le calendrier)
// ===================================
async function handleEventUpdate(event, changes) {
    const task = event.raw;
    
    if (!task) return;

    const newStart = changes.start || event.start;
    
    try {
        const response = await fetch(`/api/task/${task.id}/modify`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                proposed_scheduled: newStart.toISOString()
            })
        });

        const data = await response.json();

        if (data.success) {
            calendar.updateEvent(event.id, event.calendarId, changes);
            showSuccess('Tâche déplacée');
        } else {
            showError('Erreur lors du déplacement');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showError('Impossible de déplacer la tâche');
    }
}

// ===================================
// Modal de détails de tâche
// ===================================
function showTaskDetailModal(event) {
    const task = event.raw;
    if (!task) return;

    const modal = document.getElementById('task-detail-modal');
    const modalBody = document.getElementById('modal-task-body');
    const modalTitle = document.getElementById('modal-task-title');

    modalTitle.textContent = task.description;

    const duration = parseEstTime(task.estTime);
    const durationText = duration ? formatDuration(duration) : 'Non estimé';
    const dueDate = task.due ? new Date(task.due).toLocaleString('fr-FR') : 'Non définie';
    const scheduledDate = event.start ? event.start.toLocaleString('fr-FR') : 'Non planifiée';
    const tags = task.tags || [];
    const project = task.project || 'Aucun';

    modalBody.innerHTML = `
        <div style="display: grid; gap: 1rem;">
            <div><strong>📅 Planifiée:</strong> ${scheduledDate}</div>
            <div><strong>⏰ Échéance:</strong> ${dueDate}</div>
            <div><strong>⏱️ Durée estimée:</strong> ${durationText}</div>
            <div><strong>📂 Projet:</strong> ${project}</div>
            <div><strong>🎯 Pool:</strong> ${task.pool || 'pro'}</div>
            ${tags.length > 0 ? `<div><strong>🏷️ Tags:</strong> ${tags.map(t => `#${t}`).join(', ')}</div>` : ''}
            <div><strong>🔥 Urgence:</strong> ${(task.urgency || 0).toFixed(2)}</div>
        </div>
    `;

    // Stocker l'ID de la tâche pour les actions
    modal.dataset.taskId = task.id;
    modal.dataset.eventId = event.id;

    modal.classList.add('show');
}

function closeModal() {
    const modal = document.getElementById('task-detail-modal');
    modal.classList.remove('show');
}

async function handleUnschedule() {
    const modal = document.getElementById('task-detail-modal');
    const taskId = modal.dataset.taskId;

    try {
        const response = await fetch(`/api/task/${taskId}/modify`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                proposed_scheduled: '',
                scheduled: ''
            })
        });

        const data = await response.json();

        if (data.success) {
            showSuccess('Tâche déplanifiée');
            closeModal();
            loadTasks();
        } else {
            showError('Erreur lors de la déplanification');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showError('Impossible de déplanifier la tâche');
    }
}

async function handleMarkDone() {
    const modal = document.getElementById('task-detail-modal');
    const taskId = modal.dataset.taskId;

    try {
        const response = await fetch(`/api/task/${taskId}/done`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showSuccess('Tâche terminée');
            closeModal();
            loadTasks();
        } else {
            showError('Erreur lors de la finalisation');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showError('Impossible de terminer la tâche');
    }
}

// ===================================
// Changement de vue du calendrier
// ===================================
function changeView(view) {
    calendar.changeView(view);
    
    // Mettre à jour les boutons actifs
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === view) {
            btn.classList.add('active');
        }
    });

    updateCalendarTitle();
}

// ===================================
// Mise à jour du titre du calendrier
// ===================================
function updateCalendarTitle() {
    const titleEl = document.getElementById('calendar-title');
    console.log('Mise à jour du titre du calendrier...');
    
    try {
        let dateRange = calendar.getDateRangeStart();
        const view = calendar.getViewName();
        
        // Vérifier si dateRange est un objet Date valide
        const isValidDate = dateRange && 
                          (dateRange instanceof Date || Object.prototype.toString.call(dateRange) === '[object Date]') && 
                          !isNaN(dateRange.getTime());
                          
        if (!isValidDate) {
            dateRange = new Date();
        }
        
        console.log('Données de la vue:', { 
            dateRange: dateRange.toString(), 
            view, 
            type: typeof dateRange,
            isDate: dateRange instanceof Date,
            time: dateRange.getTime()
        });

        let title = '';
        
        if (view === 'month') {
            title = dateRange.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
        } else if (view === 'week') {
            let endDate = calendar.getDateRangeEnd();
            if (!(endDate instanceof Date) || isNaN(endDate.getTime())) {
                endDate = new Date(dateRange);
                endDate.setDate(endDate.getDate() + 6); // Ajoute 6 jours pour avoir une semaine complète
            }
            title = `${dateRange.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} - ${endDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        } else {
            title = dateRange.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        }

        titleEl.textContent = title.charAt(0).toUpperCase() + title.slice(1);
        console.log('Titre mis à jour:', titleEl.textContent);
    } catch (error) {
        console.error('Erreur lors de la mise à jour du titre:', error);
    }
}

// ===================================
// Fonctions utilitaires
// ===================================
function parseEstTime(estTime) {
    if (!estTime) return null;
    
    // Format: "1h30min" ou "30min" ou "1h"
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

function formatDuration(minutes) {
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

function formatTime(date) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showSuccess(message) {
    // Simple notification (peut être amélioré avec une bibliothèque de notifications)
    console.log('✅', message);
    alert(message);
}

function showError(message) {
    console.error('❌', message);
    alert(message);
}
