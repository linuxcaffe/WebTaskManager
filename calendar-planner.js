/**
 * Calendar Planner - Intégration Toast UI Calendar avec Taskwarrior
 * Permet de glisser-déposer des tâches non planifiées dans le calendrier
 */

//===================================
// Variables globales
// ===================================
let calendar;
let unplannedTasks = [];
let allTasks = [];
let currentFilter = {
    pool: 'all',
    sort: 'urgency'
};
let selectedTaskCard = null;
let selectedTaskData = null;
let tempEventData = null; // Temporary storage for modified event dataVariables globales

// ===================================
// Initialisation
// ===================================
document.addEventListener('DOMContentLoaded', () => {
    initializeCalendar();
    setupEventListeners();
    loadTasks();
    console.log('SetupTasksSelection');
    console.log('Setup Task Selection Done');
});

// ===================================
// Initialisation du calendrier Toast UI
// ===================================
function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new tui.Calendar(calendarEl, {
        defaultView: 'week',
        useFormPopup: true,
        useDetailPopup: true,
        usageStatistics: false,
        isReadOnly: false,
        week: {
            startDayOfWeek: 1, // Lundi
            dayNames: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
            hourStart: 6,
            hourEnd: 23,
            taskView: true,
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
                const { title } = event;
                return `<div class="calendar-event-title">${title}</div>`;
            },
            popupSave() {
              return 'Ajouter';
            }
        },
        calendars: [
            {
                id: 'pro',
                name: 'Pool Pro',
                backgroundColor: '#28a745',
                borderColor: '#1e7e34',
            },
            {
                id: 'perso',
                name: 'Pool Perso',
                backgroundColor: '#ffc107',
                borderColor: '#e0a800',
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

    // Evenements liées à tui-calendar
    calendar.on('selectDateTime', handleSelectDateTimeEvent);

    calendar.on('beforeCreateEvent', (eventObj) => {
      // Use the temporarily stored event data if available
      if (tempEventData) {
        // Create the event with our modified data
        const newEvent = {
            ...tempEventData,
            id: String(Date.now()),
            calendarId: eventObj.calendarId || 'scheduled'
        };
        
        // Clear the temporary data
        tempEventData = null;
        
        calendar.createEvents([newEvent]);
        //console.log('Event created with modified data:', newEvent);
        return; // Prevent default creation
      }
      
      // Default behavior if no temp data
      const newEvent = {
        ...eventObj,
        id: String(Date.now()),
        calendarId: eventObj.calendarId || 'scheduled'
      };
      calendar.createEvents([newEvent]);
      //console.log('Event created with default data:', newEvent);
    });

    calendar.on('beforeUpdateEvent', ({ event, changes }) => {
      calendar.updateEvent(event.id, event.calendarId, changes);
    });

    // Écouter la suppression
    calendar.on('beforeDeleteEvent', (event) => {
      calendar.deleteEvent(event.id, event.calendarId);
    });

}

function handleSelectDateTimeEvent(eventInfo) {
    // If a task is selected, adjust the end date based on task duration
    if (selectedTaskData) {
        // Parse the task duration
        const duration = parseEstTime(selectedTaskData.estTime);
        
        if (duration) {
            // Calculate new end date based on task duration
            const newEndDate = new Date(eventInfo.start.getTime() + duration * 60000);
            
             // Update the form fields in the popup
            setTimeout(() => {
                // Find the input fields by class and name attribute
                const endInput = document.querySelector('input.toastui-calendar-content[name="end"]');
                const titleInput = document.querySelector('input.toastui-calendar-content[name="title"]');
                
                if (endInput) {
                    // Format the new end date as 'YYYY-MM-DD HH:MM'
                    const formattedEndDate = formatDateTimeForInput(newEndDate);
                    endInput.value = formattedEndDate;
                } else {
                    console.warn('End date input field not found');
                }
                
                if (titleInput) {
                    titleInput.value = selectedTaskData.description;
                } else {
                    console.warn('Title input field not found');
                }
            }, 100);   

            // Store the modified event data for use in beforeCreateEvent
            tempEventData = {
                start: eventInfo.start,
                end: newEndDate,
                title: selectedTaskData.description,
                isAllday: eventInfo.isAllday
            };
        }
    }
}

// ===================================
// Chargement des tâches depuis l'API
// ===================================
function loadTasks() {
    console.log('Chargement des tâches...');
    // Charger les tâches non planifiées
    fetch('/api/tasks')
        .then(response => response.json())
        .then(data => {
            console.log('Tâches non planifiées reçues:', data);
            if (data.success) {
                // Réinitialiser allTasks avant d'ajouter les nouvelles tâches
                allTasks = [];
                const initialTasks = data.tasks || [];
                unplannedTasks = initialTasks.filter(task => !task.scheduled);
                console.log(`${unplannedTasks.length} tâches non planifiées trouvées`);
                filterAndDisplayTasks();

                // Charger les tâches planifiées
                console.log('Chargement des tâches planifiées...');
                return fetch('/api/tasks/planned');
            } else {
                throw new Error(data.error || 'Erreur lors du chargement des tâches');
            }
        })
        .then(response => response.json())
        .then(data => {
            console.log('Tâches planifiées reçues:', data);
            if (data.success) {
                const plannedTasks = data.data || [];
                console.log(`${plannedTasks.length} tâches planifiées trouvées`);
                
                // Afficher les détails des tâches planifiées pour le débogage
                plannedTasks.forEach((task, index) => {
                    console.log(`Tâche planifiée ${index + 1}:`, {
                        description: task.description,
                        scheduled: task.scheduled,
                        due: task.due,
                        estTime: task.estTime,
                        pool: task.pool
                    });
                });
                
                // Mettre à jour allTasks avec les tâches non planifiées et planifiées
                allTasks = [...unplannedTasks, ...plannedTasks];
                console.log(`Total des tâches chargées: ${allTasks.length} (${unplannedTasks.length} non planifiées, ${plannedTasks.length} planifiées)`);
                processTasksForCalendar();
            } else {
                console.error('Erreur lors du chargement des tâches planifiées:', data.error);
            }
        })
        .catch(error => {
            console.error('Erreur lors du chargement des tâches:', error);
            showError('Erreur lors du chargement des tâches: ' + error.message);
        });
}

// ===================================
// Traitement des tâches pour le calendrier
// ===================================
function processTasksForCalendar() {
    // Séparer les tâches planifiées et non planifiées
    const scheduledTasks = [];
    unplannedTasks = [];

    allTasks.forEach(task => {
        if (task.scheduled) {
            scheduledTasks.push(task);
        } else {
            unplannedTasks.push(task);
        }
    });

    // Créer les événements pour les tâches planifiées
    const events = [];
    scheduledTasks.forEach(task => {
        try {
            const event = createCalendarEvent(task, task.scheduled);
            if (event) {
                events.push(event);
            }
        } catch (e) {
            console.error('Erreur lors de la création de l\'événement pour la tâche:', task, e);
        }
    });
    
    // Effacer les événements existants et ajouter les nouveaux
    calendar.clear();
    if (events.length > 0) {
        calendar.createEvents(events);
    }
    
    // Mettre à jour l'affichage
    calendar.render();
}

// ===================================
// Créer un événement calendrier depuis une tâche
// ===================================
function createCalendarEvent(task, scheduledDate) {
    // Vérifier et formater la date de planification au format ISO 8601 (20251220T120000Z)
    let start;
    try {
        // Convertir le format 20251220T120000Z en 2025-12-20T12:00:00Z pour une meilleure compatibilité
        const isoDate = scheduledDate.replace(
            /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
            '$1-$2-$3T$4:$5:$6Z'
        );
        start = new Date(isoDate);
        
        if (isNaN(start.getTime())) {
            console.error('Date de planification invalide:', scheduledDate, 'formaté en:', isoDate, 'pour la tâche:', task);
            return null;
        } else {
            console.log('Date convertie avec succès:', scheduledDate, '->', start);
        }
    } catch (e) {
        console.error('Erreur lors de la création de la date:', e, 'pour la tâche:', task);
        return null;
    }
    
    // Définir une durée par défaut si nécessaire
    let duration;
    if (task.estTime && task.estTime.startsWith('PT')) {
        // Format ISO 8601 pour la durée (ex: PT1H pour 1 heure, PT30M pour 30 minutes)
        const durationMatch = task.estTime.match(/PT(\d+H)?(\d+M)?/);
        let hours = 0, minutes = 0;
        if (durationMatch) {
            if (durationMatch[1]) hours = parseInt(durationMatch[1]);
            if (durationMatch[2]) minutes = parseInt(durationMatch[2]);
        }
        duration = hours * 60 + minutes;
    }
    
    // Durée par défaut de 60 minutes si non spécifiée ou invalide
    duration = duration || 60;
    const end = new Date(start.getTime() + duration * 60000);

    // Déterminer le pool et l'ID du calendrier
    const pool = (task.pool || 'scheduled').toLowerCase();
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
// Configuration de la sélection des tâches
// ===================================
function handleTaskCardClick(cardElement) {
    console.log('Evenement declenché !');
    // Deselect currently selected card if it's different
    if (selectedTaskCard && selectedTaskCard !== cardElement) {
        selectedTaskCard.classList.remove('selected');
    }

    // Toggle selection on clicked card
    if (selectedTaskCard === cardElement) {
        // Clicking the same card again - deselect it
        cardElement.classList.remove('selected');
        selectedTaskCard = null;
        selectedTaskData = null;
    } else {
        // Select the new card
        cardElement.classList.add('selected');
        selectedTaskCard = cardElement;
        selectedTaskData = JSON.parse(cardElement.dataset.taskData);
        
        console.log('Task selected:', selectedTaskData.description);
    }
}
// ===================================
// Fonction pour obtenir la tâche sélectionnée
// ===================================
function getSelectedTask() {
    return selectedTaskData;
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

    // Vide le conteneur
    container.innerHTML = '';

    // Crée et ajoute chaque carte de tâche
    tasks.forEach(task => {
        const taskCard = createTaskCard(task);
        container.appendChild(taskCard);
    });
}


function createTaskCard(task) {
    const priority = task.priority || 'M';
    const priorityClass = priority === 'H' ? 'high' : priority === 'M' ? 'medium' : 'low';
    const priorityText = priority === 'H' ? 'Haute' : priority === 'M' ? 'Moyenne' : 'Basse';

    const duration = parseEstTime(task.estTime);
    const durationText = duration ? formatDuration(duration) : 'Non estimé';

    // Gestion des dates avec vérification de validité
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
    const tags = task.tags || [];
    const pool = task.pool || 'pro';

    // Création de l'élément DOM au lieu de retourner une chaîne HTML
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.taskId = task.uuid;
    card.dataset.taskData = JSON.stringify(task).replace(/'/g, "&apos;");
    card.innerHTML = `
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
    `;

    // Ajout de l'eventListener directement
    card.addEventListener('click', function() {
        handleTaskCardClick(this);
    });

    return card;
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
    
    try {
        const dateRange = calendar.getDateRangeStart();
        const view = calendar.getViewName();
        
        // Extraire la date de l'objet dateRange
        let startDate;
        if (dateRange && dateRange.d) {
            // Si dateRange a une propriété 'd' (cas de Toast UI Calendar)
            startDate = new Date(dateRange.d);
        } else if (dateRange instanceof Date || (dateRange && dateRange.getTime)) {
            // Si c'est déjà un objet Date
            startDate = new Date(dateRange);
        } else {
            // Fallback sur la date actuelle
            startDate = new Date();
        }
        
        let title = '';
        
        if (view === 'month') {
            // Pour la vue mois, on prend le 1er jour du mois de la première semaine complète
            // pour éviter d'afficher le mois précédent
            let firstDayOfMonth = new Date(startDate);
            
            // Si on n'est pas le 1er du mois, on passe au mois suivant
            if (firstDayOfMonth.getDate() > 1) {
                firstDayOfMonth.setMonth(firstDayOfMonth.getMonth() + 1, 1);
            }
            
            title = firstDayOfMonth.toLocaleDateString('fr-FR', { 
                month: 'long', 
                year: 'numeric' 
            });
        } else if (view === 'week') {
            let endDateObj = calendar.getDateRangeEnd();
            let endDate = endDateObj && (endDateObj.d ? new Date(endDateObj.d) : new Date(endDateObj));
            
            if (!endDate || isNaN(endDate.getTime())) {
                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 6); // Ajoute 6 jours pour avoir une semaine complète
            }
            
            title = `${startDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} - ${endDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        } else {
            // Vue jour
            title = startDate.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                day: 'numeric', 
                month: 'long', 
                year: 'numeric' 
            });
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
    
    // Handle ISO 8601 duration format (PT2H30M) that TaskWarrior uses
    if (estTime.startsWith('PT')) {
        const match = estTime.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (match) {
            const hours = parseInt(match[1] || 0);
            const minutes = parseInt(match[2] || 0);
            const seconds = parseInt(match[3] || 0);
            
            return hours * 60 + minutes + Math.round(seconds / 60);
        }
    }
    
    // Fallback for old format: "1h30min" ou "30min" ou "1h"
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

function formatDateTimeForInput(date) {
    // Format a Date object as 'YYYY-MM-DD HH:MM' (with space separator)
    if (!date || !(date instanceof Date)) return '';
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}`;
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
