/**
 * Calendar Planner - Intégration Toast UI Calendar avec Taskwarrior
 * Permet de glisser-déposer des tâches non planifiées dans le calendrier
 */

/**
 * Valriables globales
 */
let calendar;
let taskEditor;
let unplannedTasks = [];
let allTasks = [];
let selectedTaskCard = null;
let selectedTaskData = null;
let tempEventData = null;

/**
 * Initialisation
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initialiser taskCardManager avec le gestionnaire d'actions pour calendar-planner
    taskCardManager = new TaskCardManager(new CalendarTaskActionHandler());

    // Global taskEditor instance (used by task-card.js action buttons)
    taskEditor = new TaskEditor({
        showAllFields: true,
        priorityFormat: 'letters',
        language: 'en',
        modalId: 'unified-task-editor',
        onSaveSuccess: () => loadTasks(),
        onSaveError: (error) => document.dispatchEvent(new CustomEvent('tw-show-notification',
            { detail: { message: error, type: 'error' } })),
        onCancel: () => {}
    });

    initializeCalendar();
    setupEventListeners();
    initSidebarControls();
    loadTasks();

    createScrollIndicators();

    // TUI Calendar week/day view needs an explicit pixel height on #calendar to lay out
    // the time grid correctly. Month view works without it (grid-based), but week/day
    // expands to full content height otherwise. Measure after flex layout is settled.
    requestAnimationFrame(() => {
        fitCalendarHeight();
        const cont = document.querySelector('.calendar-container');
        if (cont) new ResizeObserver(fitCalendarHeight).observe(cont);
    });
    window.addEventListener('resize', fitCalendarHeight);

    document.addEventListener('taskSelected', (e) => {
        handleTaskCardClick(e.detail.cardElement);
    });

    // Mirror nav notifications to local notification bar
    document.addEventListener('tw-show-notification', (e) => {
        const { message, type } = e.detail || {};
        if (message) showCalNotification(message, type || 'info');
    });

    // Sync via nav hamburger menu → open dialog (same UX as List page)
    document.addEventListener('tw-menu-action', (e) => {
        if (e.detail.action !== 'sync') return;
        openSyncDialog();
    });

    // Close notification button
    const notifClose = document.getElementById('notif-close');
    if (notifClose) notifClose.addEventListener('click', () =>
        document.getElementById('notification')?.classList.remove('show'));
});

/**
 * Initialisation du calendrier Toast UI
 */
function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new tui.Calendar(calendarEl, {
        defaultView: 'week',
        useFormPopup: true,
        useDetailPopup: false,   // we own the detail popup via clickEvent
        usageStatistics: false,
        isReadOnly: false,
        week: {
            startDayOfWeek: 1,
            dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
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
            dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            startDayOfWeek: 1,
            narrowWeekend: true
        },
        template: {
            time(event)   { return `<span class="cal-ev-title">${event.title}</span>`; },
            allday(event) { return `<span class="cal-ev-title">${event.title}</span>`; },
            popupSave()   { return 'Add'; }
        },
        calendars: [
            {
                id: 'scheduled',
                name: 'Scheduled',
                backgroundColor: '#4a90e2',
                borderColor: '#357abd',
                color: '#fff',
            },
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
            },
            {
                id: 'due',
                name: 'Due',
                backgroundColor: '#e74c3c',
                borderColor: '#c0392b',
                color: '#fff',
            }
        ]
    });

    updateCalendarTitle();
}

/**
 * Configuration des écouteurs d'événements 
 */
function setupEventListeners() {
    document.getElementById('prev-btn').addEventListener('click', () => {
        calendar.prev(); updateCalendarTitle();
    });
    document.getElementById('next-btn').addEventListener('click', () => {
        calendar.next(); updateCalendarTitle();
    });
    document.getElementById('today-btn').addEventListener('click', () => {
        calendar.today(); updateCalendarTitle();
    });

    // View buttons (data-view attribute)
    document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', (e) => changeView(e.target.dataset.view));
    });

    // Reload when nav bar filters change
    document.addEventListener('tw-filter-change', () => loadTasks());

    // TUI calendar events
    calendar.on('selectDateTime',    handleSelectDateTimeEvent);
    calendar.on('beforeCreateEvent', handleBeforeCreateEvent);
    calendar.on('beforeUpdateEvent', handleBeforeUpdateEvent);
    calendar.on('beforeDeleteEvent', handleBeforeDeleteEvent);
    calendar.on('clickEvent', ({ event }) => showEventModal(event));

    // External drag-drop: native DOM events on the calendar container
    // (calendar.on('drop') does not fire for elements dragged in from outside TUI)
    const calEl = document.getElementById('calendar');
    calEl.addEventListener('dragover', e => e.preventDefault());
    calEl.addEventListener('drop', e => {
        e.preventDefault();
        const raw = e.dataTransfer?.getData('taskData');
        if (!raw || !selectedTaskData) return;

        // Walk up from the drop target looking for a date hint TUI puts on cells
        let dateStr = null;
        let el = document.elementFromPoint(e.clientX, e.clientY);
        while (el && el !== calEl) {
            if (el.dataset.date) { dateStr = el.dataset.date; break; }
            el = el.parentElement;
        }

        // Fallback: use the visible week/day range start at 09:00
        if (!dateStr) {
            const rs = calendar.getDateRangeStart();
            const d  = rs?.d ? new Date(rs.d) : (rs instanceof Date ? rs : new Date());
            dateStr  = d.toISOString().slice(0, 10);
        }

        const start = new Date(dateStr + 'T09:00:00');
        const dur   = parseEstTime(selectedTaskData.sched_duration) || 60;
        const end   = new Date(start.getTime() + dur * 60000);

        tempEventData = {
            id: selectedTaskData.uuid,
            start, end,
            title: selectedTaskData.description,
            isAllday: false
        };
        handleBeforeCreateEvent({ calendarId: 'scheduled' });
    });

}

function handleSelectDateTimeEvent(eventInfo) {
    // If a task is selected, adjust the end date based on task duration
    if (selectedTaskData) {
        // Parse the task duration
        const duration = parseEstTime(selectedTaskData.sched_duration);
        
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
                id: selectedTaskData.uuid,
                start: eventInfo.start,
                end: newEndDate,
                title: selectedTaskData.description,
                isAllday: eventInfo.isAllday
            };
        }
    }
}

/**
 * Fonction pour gérer l'événement beforeCreateEvent 
 */
async function handleBeforeCreateEvent(eventObj) {
    let newEvent;
    // Use the temporarily stored event data if available
    if (tempEventData) {
        // Create the event with our modified data
        newEvent = {
            ...tempEventData,
            calendarId: eventObj.calendarId || 'scheduled'
        };
        tempEventData = null;// Clear the temporary data
    } else {
        // Default behavior if no temp data
        newEvent = {
            ...eventObj,
            id: 'toast_' + String(Date.now()),
            calendarId: eventObj.calendarId || 'scheduled'
        };
    }
    
    // Handle toast-prefixed events (new tasks)
    if (newEvent.id && newEvent.id.startsWith('toast_')) {
        // Create new task via API
        const newTaskData = {
            description: newEvent.title,
            scheduled: newEvent.start ? (newEvent.start instanceof Date ? DateFromISOtoTW(newEvent.start.toISOString()) : DateFromISOtoTW(newEvent.start)) : null,
            sched_duration: calculateDurationFromEvent(newEvent)
        };

        const result = await addTaskToBackend(newTaskData);
        if (result.success && result.task && result.task.uuid) {
            // Update the event with the real UUID
            newEvent.id = result.task.uuid;
        } else {
            console.error('Failed to create task to backend:', result.error || 'Unknown error');
            // Show error to user
            showError('Failed to create task to backend: ' + (result.error || 'Unknown error'));
        }
    }
    // Sync to backend if this is a TaskWarrior task (not a toast_ prefixed ID)
    else if (newEvent.id && !newEvent.id.startsWith('toast_')) {
        // Prepare task data in the format expected by the backend
        const modifiedTaskData = {
            description: newEvent.title,
            scheduled: newEvent.start ? DateFromISOtoTW(newEvent.start.toISOString()) : null
        };

        const result = await modifyTaskInBackend(newEvent.id, modifiedTaskData);
        if (!result.success) {
            console.error('Failed to sync task to backend:', result.error);
        }
    }

    calendar.createEvents([newEvent]);
    console.log('Event created :', newEvent);

    // NOUVEAU CODE : Suppression de la taskCard et réinitialisation
    if (selectedTaskCard && selectedTaskData) {
        // Supprimer la taskCard du DOM
        selectedTaskCard.remove();

        // Réinitialiser les variables
        selectedTaskCard = null;
        selectedTaskData = null;
        tempEventData = null;

        applyFiltersAndDisplay();
    }
}

/**
 * Fonction pour gérer l'événement beforeUpdateEvent
 */
async function handleBeforeUpdateEvent({ event, changes }) {
    // Only handle TaskWarrior tasks (not toast_ prefixed IDs)
    if (event.id && !event.id.startsWith('toast_')) {
        // Prepare task data in the format expected by the backend
        const modifiedTaskData = {
            description: changes.title || event.title,
            scheduled: null
        };

        // Handle scheduled date using the new helper function
        console.log("Processing date changes - changes.start:", changes.start);
        console.log("Processing date changes - event.start:", event.start);
        
        // Extract dates using the helper function
        const extractedStartDate = extractDateFromToastChange(changes.start);
        const extractedEndDate = extractDateFromToastChange(changes.end);
        
        // Use extracted start date or fall back to event start date
        const finalStartDate = extractedStartDate || extractDateFromToastChange(event.start);
        const finalEndDate = extractedEndDate || extractDateFromToastChange(event.end);
        
        console.log("Extracted start date:", finalStartDate);
        console.log("Extracted end date:", finalEndDate);
        
        // Set scheduled date if we have a valid start date
        if (finalStartDate) {
            modifiedTaskData.scheduled = DateFromISOtoTW(finalStartDate.toISOString());
            console.log("Final scheduled date for backend:", modifiedTaskData.scheduled);
        } else {
            console.warn("No valid start date found - scheduled will remain null");
        }
        
        // Add duration if we have valid dates
        if (finalStartDate && finalEndDate) {
            const duration = calculateDurationFromEvent({
                start: finalStartDate,
                end: finalEndDate
            });
            modifiedTaskData.sched_duration = duration;
            console.log("Calculated duration:", duration);
        } else if (finalStartDate) {
            // If we have a start date but no end date, use default duration
            modifiedTaskData.sched_duration = 'PT30M';
            console.log("Using default duration PT30M (no end date available)");
        }

        try {
            console.log("Status : modifiedTaskData : ", modifiedTaskData);
            const result = await modifyTaskInBackend(event.id, modifiedTaskData);
            if (!result.success) {
                console.error('Failed to sync task update to backend:', result.error);
                showError('Failed to update task: ' + (result.error || 'Unknown error'));
                return false; // Prevent the update if backend sync fails
            }
            console.log('Task updated successfully:', event.id);
        } catch (error) {
            console.error('Error updating task:', error);
            showError('Error updating task: ' + error.message);
            return false;
        }
    }

    // Allow the update to proceed
    calendar.updateEvent(event.id, event.calendarId, changes);
    return true;

}

/**
 * Fonction pour gérer l'événement beforeDeleteEvent
 * Supprime la date planifiée d'une tâche au lieu de la supprimer complètement
 */
async function handleBeforeDeleteEvent(event) {
    // Only handle TaskWarrior tasks (not toast_ prefixed IDs)
    if (event.id && !event.id.startsWith('toast_')) {
        console.log('Handling delete event for task:', event.id);
        
        try {
            // Prepare task data to remove the scheduled date
            // Setting scheduled to null or empty string will unschedule the task
            const modifiedTaskData = {
                scheduled: null  // This removes the scheduled date from the task
            };

            console.log('Attempting to unschedule task by removing scheduled date:', modifiedTaskData);
            
            // Call the backend to modify the task (remove scheduled date)
            const result = await modifyTaskInBackend(event.id, modifiedTaskData);
            
            if (result.success) {
                console.log('Task unscheduled successfully:', event.id);
                showSuccess('Task has been unscheduled and moved back to the unplanned tasks list.');
                
                // Remove from calendar frontend
                calendar.deleteEvent(event.id, event.calendarId);
                
                // Refresh the unplanned tasks list to show the newly unscheduled task
                loadTasks();
                
                return true;
            } else {
                console.error('Failed to unschedule task:', result.error);
                showError('Failed to unschedule task: ' + (result.error || 'Unknown error'));
                return false; // Prevent deletion if backend sync fails
            }
        } catch (error) {
            console.error('Error unscheduling task:', error);
            showError('Error unscheduling task: ' + error.message);
            return false;
        }
    } else {
        // For toast_ prefixed events (new events not yet saved), just delete from calendar
        console.log('Deleting temporary event (toast_ prefixed):', event.id);
        calendar.deleteEvent(event.id, event.calendarId);
        return true;
    }
}

/**
 * Chargement des tâches depuis l'API 
 */
let dueTasks = [];  // tasks with due date but no scheduled date

function loadTasks() {
    // Show cached tasks immediately while fetch is in flight (avoids "Loading tasks..." flash)
    const cached = sessionStorage.getItem('tw-tasks-cache');
    if (cached) {
        try {
            const tasks = JSON.parse(cached);
            unplannedTasks = tasks.filter(t => !t.scheduled);
            allTasks = unplannedTasks;
            applyFiltersAndDisplay();
        } catch (e) { /* ignore stale cache */ }
    }

    const params   = window.twNav ? window.twNav.stateToParams() : 'status=pending';
    const navState = window.twNav ? window.twNav.getState() : {};
    const statusParam = 'status=' + encodeURIComponent((navState.statuses || ['pending']).join(','));
    Promise.all([
        fetch('/api/tasks?' + params).then(r => r.json()),
        fetch('/api/tasks/planned?' + statusParam).then(r => r.json()),
        fetch('/api/tasks/due?'     + statusParam).then(r => r.json()),
    ])
    .then(([data, plannedData, dueData]) => {
        if (!data.success) throw new Error(data.error || 'Failed to load tasks');

        const allFetched   = data.tasks || [];
        const plannedTasks = plannedData.success ? (plannedData.data || []) : [];
        dueTasks           = dueData.success      ? (dueData.data  || []) : [];

        // Sidebar: fetched tasks without a scheduled date
        unplannedTasks = allFetched.filter(task => !task.scheduled);
        allTasks = [...unplannedTasks, ...plannedTasks];

        applyFiltersAndDisplay();
        processTasksForCalendar();
    })
    .catch(error => showError('Failed to load tasks: ' + error.message));
}

/**
 * Traitement des tâches pour le calendrier 
 */
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
            const event = createCalendarEvent(task, task.scheduled, 'scheduled');
            if (event) events.push(event);
        } catch (e) {}
    });

    // Due tasks (no scheduled date) → all-day events in 'due' calendar
    dueTasks.forEach(task => {
        try {
            const event = createDueEvent(task);
            if (event) events.push(event);
        } catch (e) {}
    });
    
    // Effacer les événements existants et ajouter les nouveaux
    calendar.clear();
    if (events.length > 0) {
        calendar.createEvents(events);
    }
    
    // Mettre à jour l'affichage
    calendar.render();
    setTimeout(hookCalScrollIndicators, 150);
}

/**
 * Créer un événement calendrier depuis une tâche 
 */
function createCalendarEvent(task, scheduledDate) {
    // Vérifier et formater la date de planification au format ISO 8601 (20251220T120000Z)
    let start;
    try {
        // Convertir le format 20251220T120000Z en 2025-12-20T12:00:00Z pour une meilleure compatibilité
        // Strip Z so the date is treated as local time, not UTC.
        // TW stores midnight-UTC for date-only entries; interpreting as UTC
        // shifts them to the previous day in western timezones causing 2-day spans.
        const isoDate = scheduledDate.replace(
            /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
            '$1-$2-$3T$4:$5:$6'
        );
        start = new Date(isoDate);
        if (isNaN(start.getTime())) return null;
    } catch (e) {
        console.error('Erreur lors de la création de la date:', e, 'pour la tâche:', task);
        return null;
    }
    
    // Définir une durée par défaut si nécessaire
    let duration;
    if (task.sched_duration && task.sched_duration.startsWith('PT')) {
        // Format ISO 8601 pour la durée (ex: PT1H pour 1 heure, PT30M pour 30 minutes)
        const durationMatch = task.sched_duration.match(/PT(\d+H)?(\d+M)?/);
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

    const event = {
        id: task.uuid,
        calendarId: calendarId,
        title: task.description,
        start: start,
        end: end,
        isReadOnly: false,
        raw: task
    };
    // Status-based color: completed → grey, deleted → purple
    if (task.status === 'completed') {
        event.backgroundColor = '#78909c';
        event.borderColor     = '#546e7a';
        event.color           = '#fff';
    } else if (task.status === 'deleted') {
        event.backgroundColor = '#ab47bc';
        event.borderColor     = '#8e24aa';
        event.color           = '#fff';
    }
    return event;
}

function createDueEvent(task) {
    const rawDate = task.due;
    if (!rawDate) return null;

    const m = rawDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return null;
    const dateStr = `${m[1]}-${m[2]}-${m[3]}`;  // '2026-04-14' — no timezone ambiguity

    // If due_duration is set, show as a timed block at local midnight on that date
    const durStr = task.due_duration;
    if (durStr && durStr.startsWith('PT')) {
        const dm = durStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
        const mins = (dm ? (parseInt(dm[1] || 0) * 60 + parseInt(dm[2] || 0)) : 0) || 60;
        const start = new Date(dateStr + 'T00:00:00');
        return {
            id: task.uuid + '_due',
            calendarId: 'due',
            title: '⚑ ' + task.description,
            start,
            end: new Date(start.getTime() + mins * 60000),
            isReadOnly: true,
            raw: task
        };
    }

    // All-day: use plain date strings so TUI Calendar owns the timezone handling
    const dueColors = task.status === 'completed' ? { backgroundColor: '#78909c', borderColor: '#546e7a', color: '#fff' }
                    : task.status === 'deleted'   ? { backgroundColor: '#ab47bc', borderColor: '#8e24aa', color: '#fff' }
                    : {};
    return {
        id: task.uuid + '_due',
        calendarId: 'due',
        title: '⚑ ' + task.description,
        start: dateStr,
        end: dateStr,
        ...dueColors,
        isAllday: true,
        isReadOnly: true,
        raw: task
    };
}

class CalendarTaskActionHandler extends TaskActionHandler {
    constructor() {
        super({
            onTaskUpdate: () => loadTasks(),
            onTaskDelete: () => loadTasks(),
            showNotification: (msg, type) => {
                document.dispatchEvent(new CustomEvent('tw-show-notification',
                    { detail: { message: msg, type } }));
            }
        });
    }
}

// ── Event detail modal ────────────────────────────────────────────────────────

function showEventModal(calEvent) {
    const task   = calEvent.raw || {};
    const modal  = document.getElementById('task-detail-modal');
    if (!modal) return;

    document.getElementById('modal-task-title').textContent =
        task.description || calEvent.title || 'Task';

    const fmt = (twDate) => {
        const m = (twDate || '').match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/);
        if (!m) return twDate;
        return m[4] ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
    };

    const rows = [];
    if (task.status && task.status !== 'pending')
        rows.push(`<tr><th>Status</th><td><em>${task.status}</em></td></tr>`);
    if (task.project)  rows.push(`<tr><th>Project</th><td>${task.project}</td></tr>`);
    if (task.priority) {
        const label = { H: 'High', M: 'Medium', L: 'Low' }[task.priority] || task.priority;
        rows.push(`<tr><th>Priority</th><td>${label}</td></tr>`);
    }
    if (task.due)       rows.push(`<tr><th>Due</th><td>${fmt(task.due)}</td></tr>`);
    if (task.scheduled) rows.push(`<tr><th>Scheduled</th><td>${fmt(task.scheduled)}</td></tr>`);
    if (task.sched_duration) rows.push(`<tr><th>Duration</th><td>${task.sched_duration}</td></tr>`);
    if (task.tags && task.tags.length)
        rows.push(`<tr><th>Tags</th><td>${task.tags.map(t => `<span class="card-tag">${t}</span>`).join(' ')}</td></tr>`);
    if (task.urgency != null)
        rows.push(`<tr><th>Urgency</th><td>${Number(task.urgency).toFixed(1)}</td></tr>`);

    document.getElementById('modal-task-body').innerHTML = rows.length
        ? `<table class="task-detail-table">${rows.join('')}</table>`
        : '<em>No details available.</em>';

    // Unschedule only makes sense for scheduled (non-readonly) events
    const unschedBtn = document.getElementById('modal-unschedule-btn');
    unschedBtn.style.display = calEvent.isReadOnly ? 'none' : '';

    const close = () => modal.classList.remove('show');

    unschedBtn.onclick = async () => {
        const r = await modifyTaskInBackend(task.uuid, { scheduled: null });
        if (r.success) { close(); loadTasks(); }
    };
    document.getElementById('modal-done-btn').onclick = async () => {
        try {
            const r = await fetch(`/api/task/${task.uuid}/done`, { method: 'POST' });
            const d = await r.json();
            if (d.success) { close(); loadTasks(); }
        } catch (e) {}
    };
    document.getElementById('modal-close-btn').onclick  = close;
    document.getElementById('modal-cancel-btn').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };

    modal.classList.add('show');
}

/**
 * Configuration de la sélection des tâches
 */
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
        tempEventData = null;
    } else {
        // Select the new card
        cardElement.classList.add('selected');
        selectedTaskCard = cardElement;
        selectedTaskData = JSON.parse(cardElement.dataset.taskData);
        
        console.log('Task selected:', selectedTaskData.description);
        console.log('tempEventData updated:', tempEventData);
    }
}
/**
 * Fonction pour obtenir la tâche sélectionnée 
 */
function getSelectedTask() {
    return selectedTaskData;
}

// ── Sync dialog ───────────────────────────────────────────────────────────────

function openSyncDialog() {
    const dialog   = document.getElementById('sync-dialog');
    const btn      = document.getElementById('sync-now-btn');
    const output   = document.getElementById('sync-output');
    const method   = document.getElementById('sync-method');
    const closeBtn = document.getElementById('sync-dialog-close');
    if (!dialog) return;

    output.style.display = 'none';
    output.textContent   = '';
    btn.disabled         = false;
    btn.textContent      = 'Sync Now';

    fetch('/api/sync/info').then(r => r.json())
        .then(d => { method.textContent = `Method: ${d.method}`; })
        .catch(() => { method.textContent = ''; });

    dialog.style.display = 'flex';
    const close = () => { dialog.style.display = 'none'; };
    closeBtn.onclick = close;
    dialog.onclick   = (e) => { if (e.target === dialog) close(); };

    btn.onclick = () => {
        btn.disabled    = true;
        btn.textContent = 'Syncing…';
        output.style.display = 'none';
        fetch('/api/sync', { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                const text = data.output || (data.success ? 'Sync complete.' : 'Sync failed.');
                output.textContent   = text;
                output.style.display = 'block';
                btn.textContent      = data.success ? 'Sync Now' : 'Retry';
                btn.disabled         = false;
                if (data.success) { loadTasks(); window.twPollSyncStatus?.(); }
            })
            .catch(err => {
                output.textContent   = 'Error: ' + err;
                output.style.display = 'block';
                btn.textContent      = 'Retry';
                btn.disabled         = false;
            });
    };
}

// ── Notifications ─────────────────────────────────────────────────────────────

function showCalNotification(message, type = 'info') {
    const el  = document.getElementById('notification');
    const txt = document.getElementById('notif-text');
    if (!el) return;
    if (txt) txt.textContent = message; else el.textContent = message;
    el.className = `notification ${type} show`;
    const timeout = (window.twNotifTimeout != null) ? window.twNotifTimeout : 3000;
    clearTimeout(showCalNotification._t);
    if (timeout > 0)
        showCalNotification._t = setTimeout(() => el.classList.remove('show'), timeout);
}

// ── Sidebar sort ──────────────────────────────────────────────────────────────

const SIDEBAR_SORT_FIELDS = [
    { value: 'urgency',     label: 'Urgency (default)' },
    { value: 'priority',    label: 'Priority' },
    { value: 'due',         label: 'Due date' },
    { value: 'description', label: 'Description' },
    { value: 'project',     label: 'Project' },
    { value: 'entry',       label: 'Created' },
    { value: 'modified',    label: 'Modified' },
    { value: 'start',       label: 'Started' },
    { value: 'scheduled',   label: 'Scheduled' },
    { value: 'wait',        label: 'Wait date' },
    { value: 'id',          label: 'ID' },
    { value: 'tags',        label: 'Tags' },
];

function sortUnplanned(tasks) {
    const field = localStorage.getItem('tw-sort-field') || 'urgency';
    const rev   = localStorage.getItem('tw-sort-reverse') === 'true' ? -1 : 1;
    if (field === 'urgency') return rev === 1 ? tasks : [...tasks].reverse();
    const PRI = { H: 3, M: 2, L: 1 };
    return [...tasks].sort((a, b) => {
        let av = a[field], bv = b[field];
        if (field === 'priority') { av = PRI[av] || 0; bv = PRI[bv] || 0; }
        else if (field === 'tags') { av = (av || []).join(','); bv = (bv || []).join(','); }
        av = av ?? ''; bv = bv ?? '';
        if (av < bv) return -1 * rev;
        if (av > bv) return  1 * rev;
        return 0;
    });
}

function initSidebarControls() {
    const cardBtn  = document.getElementById('cal-view-card');
    const listBtn  = document.getElementById('cal-view-list');
    const container = document.getElementById('unplanned-tasks');

    const setView = (mode) => {
        localStorage.setItem('tw-view-mode', mode);
        cardBtn.classList.toggle('active', mode === 'card');
        listBtn.classList.toggle('active', mode === 'list');
        if (container) container.classList.toggle('list-view', mode === 'list');
    };
    setView(localStorage.getItem('tw-view-mode') || 'card');
    cardBtn?.addEventListener('click', () => setView('card'));
    listBtn?.addEventListener('click', () => setView('list'));

    // Expand/collapse on card click (mirrors main.js behaviour)
    if (container) {
        container.addEventListener('click', (e) => {
            if (e.target.closest('[data-task-action]')) return;
            const card = e.target.closest('.task-card');
            if (!card) return;
            const mode = localStorage.getItem('tw-view-mode') || 'card';
            if (mode === 'list') card.classList.toggle('expanded');
            else card.classList.toggle('collapsed');
        });
    }

    // Sort popup
    const sortBtn    = document.getElementById('cal-sort-btn');
    const sortPopup  = document.getElementById('cal-sort-popup');
    const sortFields = document.getElementById('cal-sort-fields');
    const revBox     = document.getElementById('cal-sort-reverse');
    if (!sortBtn || !sortPopup || !sortFields || !revBox) return;

    const curField = localStorage.getItem('tw-sort-field') || 'urgency';
    sortFields.innerHTML = SIDEBAR_SORT_FIELDS.map(f =>
        `<label><input type="radio" name="cal-sort" value="${f.value}"${f.value === curField ? ' checked' : ''}> ${f.label}</label>`
    ).join('');
    revBox.checked = localStorage.getItem('tw-sort-reverse') === 'true';

    const updateSortBtn = () => {
        const field = localStorage.getItem('tw-sort-field') || 'urgency';
        const rev   = localStorage.getItem('tw-sort-reverse') === 'true';
        const isDefault = field === 'urgency' && !rev;
        sortBtn.classList.toggle('sort-active', !isDefault);
        const label = SIDEBAR_SORT_FIELDS.find(f => f.value === field)?.label || field;
        sortBtn.title = isDefault ? 'Sort' : `Sort: ${label}${rev ? ' ↑' : ' ↓'}`;
    };
    updateSortBtn();

    sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sortPopup.style.display = sortPopup.style.display === 'none' ? 'block' : 'none';
    });
    sortFields.addEventListener('change', (e) => {
        if (e.target.name === 'cal-sort') {
            localStorage.setItem('tw-sort-field', e.target.value);
            updateSortBtn();
            applyFiltersAndDisplay();
        }
    });
    revBox.addEventListener('change', () => {
        localStorage.setItem('tw-sort-reverse', revBox.checked);
        updateSortBtn();
        applyFiltersAndDisplay();
    });
    document.addEventListener('click', () => { sortPopup.style.display = 'none'; });
    sortPopup.addEventListener('click', (e) => e.stopPropagation());
}

// ── Filter + display ──────────────────────────────────────────────────────────

/**
 * Filtrer et afficher les tâches non planifiées
 */
function applyFiltersAndDisplay() {
    const state    = window.twNav ? window.twNav.getState() : {};
    const filter   = (state.filter   || '').trim().toLowerCase();
    const priority = (state.priority || '').trim().toLowerCase();
    const project  = (state.project  || '').trim().toLowerCase();
    const tags     = (state.tags     || '').split(',').map(t => t.trim()).filter(Boolean);

    const filtered = unplannedTasks.filter(task => {
        if (filter   && !(task.description || '').toLowerCase().includes(filter))   return false;
        if (priority && !String(task.priority || '').toLowerCase().includes(priority)) return false;
        if (project  && !(task.project      || '').toLowerCase().includes(project)) return false;
        if (tags.length && !tags.every(t => (task.tags || []).includes(t)))         return false;
        return true;
    });

    if (window.twNav) window.twNav.setCount(filtered.length, unplannedTasks.length);
    displayUnplannedTasks(sortUnplanned(filtered));
}

/**
 * Afficher les tâches non planifiées 
 */
function displayUnplannedTasks(tasks) {
    const container = document.getElementById('unplanned-tasks');

    if (tasks.length === 0) {
        container.innerHTML = `
            <div class="empty-message">
                <span class="icon">✅</span>
                <p>No tasks to schedule</p>
            </div>
        `;
        return;
    }

    // Vide le conteneur
    container.innerHTML = '';

    tasks.forEach(task => {
        const taskCard = taskCardManager.createTaskCard(task);
        taskCard.draggable = true;
        taskCard.addEventListener('dragstart', (e) => {
            selectedTaskData = task;
            selectedTaskCard = taskCard;
            e.dataTransfer.setData('taskData', JSON.stringify(task));
            e.dataTransfer.effectAllowed = 'move';
            taskCard.style.opacity = '0.5';
        });
        taskCard.addEventListener('dragend', () => { taskCard.style.opacity = ''; });
        container.appendChild(taskCard);
    });
}

// La fonction createTaskCard est maintenant gérée par taskCardManager
/**
 * Changement de vue du calendrier 
 */
// ── Off-screen event indicators (week/day views) ──────────────────────────────

let _scrollCleanup = null;

function createScrollIndicators() {
    const container = document.querySelector('.calendar-container');
    if (!container || document.getElementById('cal-scroll-top')) return;
    container.insertAdjacentHTML('beforeend',
        '<div id="cal-scroll-top"    class="cal-scroll-indicator" style="display:none">▲</div>' +
        '<div id="cal-scroll-bottom" class="cal-scroll-indicator" style="display:none">▼</div>'
    );
}

function hookCalScrollIndicators() {
    if (_scrollCleanup) { _scrollCleanup(); _scrollCleanup = null; }
    const topEl = document.getElementById('cal-scroll-top');
    const botEl = document.getElementById('cal-scroll-bottom');
    if (!topEl || !botEl) return;

    if (calendar.getViewName() === 'month') {
        topEl.style.display = botEl.style.display = 'none';
        return;
    }

    // Find TUI Calendar's scrollable time-grid container
    const calEl = document.getElementById('calendar');
    const scrollEl = calEl && [...calEl.querySelectorAll('div')].find(el => {
        const ov = getComputedStyle(el).overflowY;
        return (ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 10;
    });
    if (!scrollEl) return;

    const update = () => {
        topEl.style.display = scrollEl.scrollTop > 5 ? '' : 'none';
        botEl.style.display =
            scrollEl.scrollTop + scrollEl.clientHeight < scrollEl.scrollHeight - 5 ? '' : 'none';
    };
    scrollEl.addEventListener('scroll', update, { passive: true });
    update();
    _scrollCleanup = () => scrollEl.removeEventListener('scroll', update);
}

function fitCalendarHeight() {
    const container = document.querySelector('.calendar-container');
    const calEl     = document.getElementById('calendar');
    if (!container || !calEl) return;
    const h = container.clientHeight;
    if (h > 0) calEl.style.height = h + 'px';
}

function changeView(view) {
    calendar.changeView(view);
    fitCalendarHeight();
    setTimeout(hookCalScrollIndicators, 150);
    document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    updateCalendarTitle();
}

function updateCalendarTitle() {
    const titleEl = document.getElementById('calendar-title');
    if (!titleEl) return;

    // Today button: active only when today falls within the visible range
    const todayBtn = document.getElementById('today-btn');
    if (todayBtn) {
        const now  = new Date();
        const rs   = calendar.getDateRangeStart();
        const re   = calendar.getDateRangeEnd();
        const s    = rs?.d ? new Date(rs.d) : (rs instanceof Date ? rs : null);
        const e    = re?.d ? new Date(re.d) : (re instanceof Date ? re : null);
        const inRange = s && e ? (s <= now && now <= new Date(e.getTime() + 86400000 - 1)) : true;
        todayBtn.classList.toggle('active', inRange);
    }

    const toDate = (raw) => {
        if (!raw) return null;
        if (raw.d) return new Date(raw.d);
        if (raw instanceof Date) return raw;
        return null;
    };

    const fmt = (d, opts) => d.toLocaleDateString('en-GB', opts);
    const MON_YEAR = { month: 'short', year: 'numeric' };
    const DAY_MON  = { day: 'numeric', month: 'short' };
    const FULL     = { day: 'numeric', month: 'short', year: 'numeric' };

    const view  = calendar.getViewName();
    const start = toDate(calendar.getDateRangeStart()) || new Date();
    const end   = toDate(calendar.getDateRangeEnd());

    let title;
    if (view === 'month') {
        // getDateRangeStart may land in prev month — nudge to first visible month day
        const d = new Date(start);
        if (d.getDate() > 1) d.setMonth(d.getMonth() + 1, 1);
        title = fmt(d, MON_YEAR);
    } else if (view === 'week' && end) {
        title = `${fmt(start, DAY_MON)} – ${fmt(end, FULL)}`;
    } else {
        title = fmt(start, FULL);
    }

    titleEl.textContent = title;
}

/**
 * Fonctions utilitaires 
 */
function parseEstTime(sched_duration) {
    if (!sched_duration) return null;
    
    // Handle ISO 8601 duration format (PT2H30M) that TaskWarrior uses
    if (sched_duration.startsWith('PT')) {
        const match = sched_duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (match) {
            const hours = parseInt(match[1] || 0);
            const minutes = parseInt(match[2] || 0);
            const seconds = parseInt(match[3] || 0);
            
            return hours * 60 + minutes + Math.round(seconds / 60);
        }
    }
    
    // Fallback for old format: "1h30min" ou "30min" ou "1h"
    const match = sched_duration.match(/(\d+)h|(\d+)min/g);
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
 * Extracts a Date object from Toast UI Calendar change objects
 * Handles the nested structure: { tzOffset: null, d: { d: Date(...) } }
 * @param {Object} changeObj - The change object from Toast UI Calendar
 * @returns {Date|null} - The extracted Date object or null if not found
 */
function extractDateFromToastChange(changeObj) {
    if (!changeObj) {
        console.log('extractDateFromToastChange: null/undefined input');
        return null;
    }

    // Log the original structure for debugging
    console.log('Extracting date from object:', changeObj);

    // Case 1: Already a Date object
    if (changeObj instanceof Date) {
        console.log('Direct Date object found');
        return changeObj;
    }

    // Case 2: Toast UI nested structure { tzOffset: null, d: { d: Date(...) } }
    if (changeObj.d && changeObj.d.d && changeObj.d.d instanceof Date) {
        console.log('Toast UI nested Date structure found:', changeObj.d.d);
        return changeObj.d.d;
    }

    // Case 3: Simpler nested structure { d: Date(...) }
    if (changeObj.d && changeObj.d instanceof Date) {
        console.log('Simple nested Date structure found:', changeObj.d);
        return changeObj.d;
    }

    // Case 4: String format
    if (typeof changeObj === 'string') {
        console.log('String date found, creating Date object:', changeObj);
        const date = new Date(changeObj);
        return isNaN(date.getTime()) ? null : date;
    }

    // Case 5: Try to create Date from object (fallback)
    try {
        const date = new Date(changeObj);
        if (!isNaN(date.getTime())) {
            console.log('Created Date from object:', date);
            return date;
        }
    } catch (e) {
        console.error('Failed to create Date from object:', e);
    }

    console.warn('Could not extract valid Date from object:', changeObj);
    return null;
}

async function addTaskToBackend(taskData) {
    /**
     * Add a new task to the backend
     * @param {Object} taskData - Task data to add
     * @returns {Promise<Object>} - Promise that resolves to {success: boolean, task: Object, error: string}
     */
    try {
        const response = await fetch('/api/task/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });

        const data = await response.json();

        if (data.success && data.task) {
            return {
                success: true,
                task: data.task,
                error: null
            };
        } else {
            return {
                success: false,
                task: null,
                error: data.error || 'Unknown error creating task'
            };
        }
    } catch (error) {
        console.error('Network error creating task:', error);
        return {
            success: false,
            task: null,
            error: error.message || 'Network error'
        };
    }
}


async function modifyTaskInBackend(taskId, taskData) {
    try {
        const response = await fetch(`/api/task/${taskId}/modify`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });
        const data = await response.json();

        return {
            success: data.success,
            error: data.error || 'Unknown error creating task'
        };
       
    } catch (error) {
        console.error('Network error modifying task:', error);
        return {
            success: false,
            error: error.message || 'Network error'
        };

    }
}
function calculateDurationFromEvent(event) {
    // Calculate duration between event.start and event.end
    // Returns ISO 8601 duration format (PT2H30M)
    
    if (!event || !event.start || !event.end) {
        console.warn('Event missing start or end time, using default duration');
        return 'PT30M'; // Default 30 minutes
    }
    
    try {
        // Handle cases where start/end might be strings or Date objects
        const startDate = event.start instanceof Date ? event.start : new Date(event.start);
        const endDate = event.end instanceof Date ? event.end : new Date(event.end);
        
        // Check for invalid dates
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            console.warn('Invalid date format in event, using default duration');
            return 'PT30M';
        }
        
        // Calculate duration in milliseconds
        const durationMs = endDate - startDate;
        
        // Handle negative or zero duration
        if (durationMs <= 0) {
            console.warn('Zero or negative duration, using default duration');
            return 'PT30M';
        }
        
        // Convert to hours and minutes
        const durationMinutes = Math.round(durationMs / (1000 * 60));
        const hours = Math.floor(durationMinutes / 60);
        const minutes = durationMinutes % 60;
        
        // Format as ISO 8601 duration (PT2H30M)
        let durationString = 'PT';
        if (hours > 0) {
            durationString += `${hours}H`;
        }
        if (minutes > 0) {
            durationString += `${minutes}M`;
        }
        
        // Default to PT30M if duration is 0 (shouldn't happen due to above check)
        return durationString === 'PT' ? 'PT30M' : durationString;
        
    } catch (error) {
        console.error('Error calculating duration:', error);
        return 'PT30M'; // Fallback to default
    }
}

function DateFromISOtoTW(isoString) {
    // Convert ISO string to YYYY-MM-DDTHH:MM:SS format
    // Input format: 20251220T120000Z or 2025-12-20T12:00:00Z
    // Output format: 2025-12-20T12:00:00
    
    if (!isoString) return null;
    
    // Handle both formats: 20251220T120000Z and 2025-12-20T12:00:00Z
    let date;
    
    // First try the compact format (20251220T120000Z)
    if (/^\d{8}T\d{6}Z$/.test(isoString)) {
        // Convert 20251220T120000Z to 2025-12-20T12:00:00
        const formatted = isoString.replace(
            /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
            '$1-$2-$3T$4:$5:$6'
        );
        return formatted;
    }
    // Try the standard ISO format (2025-12-20T12:00:00Z)
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(isoString)) {
        // Remove the Z at the end
        return isoString.slice(0, -1);
    }
    // Try format without Z (2025-12-20T12:00:00)
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(isoString)) {
        return isoString;
    }
    
    // If format doesn't match, try to parse as Date and format
    try {
        date = new Date(isoString);
        if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            
            return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
        }
    } catch (e) {
        console.error('Error parsing date:', e);
        return null;
    }
    
    return null;
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
