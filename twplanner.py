#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import datetime as dt
import json
import math
import re
import subprocess
import sys
from collections import defaultdict, deque
from typing import Dict, List, Optional, Tuple
from tabulate import tabulate

# Import des modèles de données
import TWTime
from TWCalendar import PoolCalendar
from TWTask import Task

# ========= Configuration calendrier =========
GRANULARITY_MIN = 30  # split autorisé uniquement par 30 min
NUDGE_THRESHOLD_MIN = 60 * 24  # 1 jour

# Définition des calendriers par pool et assignee
# Format: {assignee: {pool: {jour_semaine: [(heure_debut, heure_fin), ...]}}}
# jour_semaine: 0=Lundi, 1=Mardi, 2=Mercredi, 3=Jeudi, 4=Vendredi, 5=Samedi, 6=Dimanche

# Stockage global des calendriers par assignee
CALENDARS_BY_ASSIGNEE: Dict[str, Dict[str, PoolCalendar]] = {
    "default": PoolCalendar.get_default_calendars("default")
}

# ========= Utilitaires calendrier =========

def get_available_slots_in_range(start_date: dt.datetime, end_date: dt.datetime, pool: str, assignee: str = "default") -> List[Tuple[dt.datetime, dt.datetime]]:
    """
    Retourne tous les créneaux disponibles entre deux dates pour un pool et un assignee.
    
    Args:
        start_date: Date de début
        end_date: Date de fin
        pool: Nom du pool
        assignee: Nom de l'assignee
    
    Returns:
        Liste de tuples (datetime_debut, datetime_fin) représentant les créneaux disponibles
    """
    all_slots = []
    current_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Récupérer le calendrier du pool
    if assignee not in CALENDARS_BY_ASSIGNEE:
        assignee = "default"
    calendars = CALENDARS_BY_ASSIGNEE[assignee]
    if pool not in calendars:
        return []
    pool_calendar = calendars[pool]
    
    while current_date <= end_date:
        day_slots = pool_calendar.get_slots_for_day(current_date)
        
        # Filtrer les créneaux qui sont dans la plage demandée
        for slot_start, slot_end in day_slots:
            # Ajuster le début et la fin si nécessaire
            actual_start = max(slot_start, start_date)
            actual_end = min(slot_end, end_date)
            
            if actual_start < actual_end:
                all_slots.append((actual_start, actual_end))
        
        current_date += dt.timedelta(days=1)
    
    return all_slots

def can_schedule_task(task: Task, start_time: dt.datetime, assignee: str = "default") -> bool:
    """
    Vérifie si une tâche peut être planifiée à partir d'un moment donné.
    
    Args:
        task: La tâche à planifier
        start_time: Heure de début proposée
        assignee: Nom de l'assignee
    
    Returns:
        True si la tâche peut être planifiée, False sinon
    """
    if task.est_min <= 0:
        return False
    
    end_time = start_time + dt.timedelta(minutes=task.est_min)
    
    # Récupérer les créneaux disponibles pour ce pool
    available_slots = get_available_slots_in_range(start_time, end_time, task.pool, assignee)
    
    # Calculer le temps total disponible
    total_available_minutes = 0
    for slot_start, slot_end in available_slots:
        duration = (slot_end - slot_start).total_seconds() / 60
        total_available_minutes += duration
    
    # Vérifier si on a assez de temps disponible
    return total_available_minutes >= task.est_min

def get_previous_free_slot(
    date: dt.datetime, 
    pool: str, 
    assignee: str = "default",
    min_duration: int = 0,
    max_days_back: int = 30,
    schedule_type: str = "scheduled"
) -> Optional[Tuple[dt.datetime, dt.datetime]]:
    """
    Trouve le dernier créneau libre avant une date donnée pour un pool spécifique.
    
    Cette fonction combine les créneaux théoriques du calendrier avec les tâches
    planifiées pour trouver un créneau réellement disponible.
    
    Args:
        date: Date de référence (cherche avant cette date)
        pool: Nom du pool (pro, asso, sleep, perso)
        assignee: Nom de l'assignee
        min_duration: Durée minimale requise en minutes (0 = n'importe quelle durée)
        max_days_back: Nombre maximum de jours à remonter dans le temps
        schedule_type: Type de schedule à considérer ("scheduled" pour le vrai scheduled,
                      "proposed" pour proposed_scheduled, "both" pour les deux)
    
    Returns:
        Tuple (datetime_debut, datetime_fin) du créneau libre trouvé, ou None si aucun
    """
    # Récupérer le calendrier du pool
    if assignee not in CALENDARS_BY_ASSIGNEE:
        assignee = "default"
    calendars = CALENDARS_BY_ASSIGNEE[assignee]
    
    if pool not in calendars:
        return None
    
    pool_calendar = calendars[pool]
    
    # Récupérer toutes les tâches planifiées pour ce pool et cet assignee
    # On cherche les tâches avec scheduled_lock défini
    try:
        #à voir si on choisi de filtrer dès la commande en fonction du paramètre. Je suppose que ça va dépendre du nombre de tache à traiter
        #cmd = ["task", f"pool:{pool}", "status:pending", "scheduled.any:", "rc.verbose=nothing", "export"]
        cmd = ["task", f'pool:"{pool}"', 'and', 'status.not:"completed"', 'and', r'\(', 'scheduled.not:', 'or', 'proposed_scheduled.not:', r'\)', 'rc.verbose=nothing', 'export']
        #print(f"\nDEBUG: Commande exécutée = {' '.join(cmd)}\n")
        out = subprocess.check_output(cmd, text=True)
        #print(f"\nDEBUG: Sortie de la commande = {out}\n")
        scheduled_tasks_data = json.loads(out or "[]")
        #print(f"DEBUG: Nombre de tâches récupérées = {len(scheduled_tasks_data)}\n")
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        scheduled_tasks_data = []
    
    # Construire une liste des périodes occupées
    occupied_periods = []
    for task_data in scheduled_tasks_data:
        task_assignee = task_data.get("uda", {}).get("assignee") or task_data.get("assignee") or ""
        if assignee != "default" and task_assignee != assignee:
            continue
        
        # Chercher d'abord le scheduled (prioritaire)
        scheduled = TWTime.parse_tw_datetime(task_data.get("scheduled"))
        
        # Si pas de scheduled et que schedule_type inclut "proposed", chercher proposed_scheduled
        if not scheduled and schedule_type in ["proposed"]:
            scheduled = TWTime.parse_tw_datetime(
                task_data.get("uda", {}).get("proposed_scheduled") or task_data.get("proposed_scheduled")
            )
        
        est_min = TWTime.parse_duration_to_minutes(
            task_data.get("uda", {}).get("estTime") or task_data.get("estTime")
        )
        
        if scheduled and est_min > 0:
            end_time = scheduled + dt.timedelta(minutes=est_min)
            occupied_periods.append((scheduled, end_time))
    
    # Trier les périodes occupées par date de début
    occupied_periods.sort()
    
    # Chercher le dernier créneau libre en remontant dans le temps
    current_date = date.replace(hour=0, minute=0, second=0, microsecond=0)
    
    for days_back in range(max_days_back):
        check_date = current_date - dt.timedelta(days=days_back)
        slots = pool_calendar.get_slots_for_day(check_date) 
        
        # Parcourir les créneaux de ce jour en ordre inverse (du plus récent au plus ancien)
        for slot_start, slot_end in reversed(slots):
            # Ne considérer que les créneaux qui se terminent avant la date de référence
            if slot_end > date:
                continue
            
            # Vérifier si ce créneau est libre (pas d'intersection avec les tâches planifiées)
            is_free = True
            free_start = slot_start
            free_end = slot_end
            #print("slot start : ", slot_start, " slot_end : ", slot_end, " is_free : ", is_free)
            
            for occupied_start, occupied_end in occupied_periods:  
                #print("occupied_start : ", occupied_start, ", occupied_end : ", occupied_end)
                # Vérifier s'il y a une intersection
                if not (occupied_end <= slot_start or occupied_start >= slot_end):
                    # Il y a une intersection, le créneau n'est pas complètement libre
                    # On peut essayer de trouver un sous-créneau libre
                    if occupied_start > slot_start and occupied_end < slot_end:
                        # La tâche est au milieu du créneau
                        # On prend la partie après la tâche si elle est avant la date
                        if occupied_end < date:
                            free_start = occupied_end
                            free_end = slot_end
                        else:
                            # Sinon on prend la partie avant la tâche
                            free_start = slot_start
                            free_end = occupied_start
                    elif occupied_start <= slot_start and occupied_end >= slot_end:
                        # Le créneau est complètement occupé
                        is_free = False
                        break
                    elif occupied_start <= slot_start:
                        # La tâche commence avant le créneau et se termine dedans
                        free_start = occupied_end
                    else:
                        # La tâche commence dans le créneau
                        free_end = occupied_start
            
            if is_free:
                # Vérifier si le créneau libre a la durée minimale requise
                duration = (free_end - free_start).total_seconds() / 60
                #print("duration : ", duration)
                if duration >= min_duration:
                    return (free_start, free_end)
    
    return None

# ========= Utilitaires de parsing =========

# ========= Lecture Taskwarrior =========

def tw_export(project: str) -> List[dict]:
    cmd = ["task", f"project:{project}", "status:pending", "rc.verbose=nothing", "export"]
    out = subprocess.check_output(cmd, text=True)
    data = json.loads(out or "[]")
    return data

def load_tasks_from_tw(project: str) -> Dict[str, Task]:
    raw = tw_export(project)
    tasks: Dict[str, Task] = {}
    for t in raw:
        uuid = t.get("uuid")
        desc = t.get("description", "")
        proj = t.get("project", "")
        depends = []
        dep = t.get("depends")
        if dep:
            if isinstance(dep, str):
                depends = [d.strip() for d in dep.split(",") if d.strip()]
            elif isinstance(dep, list):
                depends = [str(d).strip() for d in dep if str(d).strip()]
            else:
                # Handle other types by converting to string first
                depends = [str(dep).strip()] if str(dep).strip() else []
        due = TWTime.parse_tw_datetime(t.get("due"))
        scheduled_lock = TWTime.parse_tw_datetime(t.get("scheduled"))  # verrou
        # UDA
        uda = t.get("uda", {})
        est = TWTime.parse_duration_to_minutes(uda.get("estTime") or t.get("estTime"))
        assignee = uda.get("assignee") or t.get("assignee") or ""
        pool = uda.get("pool") or t.get("pool") or "pro"
        urgency = float(t.get("urgency", 0))
        status = t.get("status", "pending")

        tasks[uuid] = Task(
            uuid=uuid, description=desc, project=proj, depends=depends,
            due=due, scheduled_lock=scheduled_lock, est_min=est,
            assignee=assignee, pool=pool, urgency=urgency, status=status
        )
    return tasks

def print_report(tasks: Dict[str, Task]) -> None:
    rows = []
    for current_task in tasks.values():
        if current_task.status != "pending":
            continue
        nudge = None
        # Utiliser due au lieu de last_due_date qui n'existe pas
        if current_task.due and current_task.proposed_scheduled:
            delta_min = int((current_task.due - current_task.proposed_scheduled).total_seconds() // 60)
            if delta_min > NUDGE_THRESHOLD_MIN:
                nudge = f"{delta_min//60}h"
        rows.append([
            current_task.description,
            current_task.assignee or "-",
            current_task.pool,
            current_task.est_min,
            f"{current_task.urgency:.2f}",
            TWTime.fmt_tw_datetime_local(current_task.due) or "",
            TWTime.fmt_tw_datetime_local(current_task.scheduled_lock) or "",
            TWTime.fmt_tw_datetime_local(current_task.scheduled_due_date) or "",
            TWTime.fmt_tw_datetime_local(current_task.critical_due_date) or "",
            TWTime.fmt_tw_datetime_local(current_task.proposed_scheduled) or "",
            nudge or ""
        ])
    
    # Affichage avec tabulate pour un rendu propre avec séparateurs alignés
    headers = ["Tâche", "Assignee", "Pool", "Durée(min)", "Urgency", "Due", "Scheduled", "Scheduled_Due", "Critical_Due", "Proposed", "Nudge"]
    if rows:
        print(tabulate(rows, headers=headers, tablefmt="grid"))
    else:
        print("Aucune tâche à afficher.")
    

def test_calculate_due_date():
    """
    Fonction de test qui collecte toutes les tâches ayant une date d'échéance
    (due, scheduled, scheduled_due_date, ou critical_due_date) et les affiche.
    """
    print("==== Test Calculate Due Date ====")
    
    # Charger toutes les tâches du projet
    tasks = load_tasks_from_tw("TEST.TWPlanner")
    
    # Filtrer les tâches qui ont au moins une date d'échéance définie
    tasks_with_due_dates = {}
    
    for uuid, task in tasks.items():
        has_due_date = (
            task.due is not None or
            task.scheduled_lock is not None or
            task.scheduled_due_date is not None or
            task.critical_due_date is not None
        )
        
        if has_due_date:
            tasks_with_due_dates[uuid] = task
    
    print(f"Nombre de tâches avec dates d'échéance: {len(tasks_with_due_dates)}")
    
    # Afficher les tâches avec print_report
    if tasks_with_due_dates:
        print_report(tasks_with_due_dates)
    else:
        print("Aucune tâche avec date d'échéance trouvée.")
    
    print("==== Fin du test ====\n")

def test_task_from_uuid():
    """
    Fonction de test pour récupérer une tâche spécifique par UUID
    et tester la méthode get_dependencies().
    """
    test_uuid = "d3805c24-52a3-4cc1-b20f-0518dab2110d"
    
    print(f"==== Test récupération tâche UUID: {test_uuid} ====")
    
    # Récupérer la tâche par UUID
    task = Task.from_uuid(test_uuid)
    
    if task:
        print(f"Tâche trouvée !")
        print(f"UUID: {task.uuid}")
        print(f"Description: {task.description}")
        print(f"Projet: {task.project}")
        print(f"Status: {task.status}")
        print(f"Assignee: {task.assignee or 'Non assigné'}")
        print(f"Pool: {task.pool}")
        print(f"Estimation (min): {task.est_min}")
        print(f"Due date: {TWTime.fmt_tw_datetime_local(task.due) or 'Non définie'}")
        print(f"Scheduled: {TWTime.fmt_tw_datetime_local(task.scheduled_lock) or 'Non définie'}")
        print(f"Urgency: {task.urgency}")
        print(f"Dépendances: {task.depends}")
        
        print("\n==== Test get_dependencies() ====")
        
        # Récupérer les dépendances
        dependencies = task.get_dependencies()
        
        if dependencies:
            print(f"Nombre de dépendances trouvées: {len(dependencies)}")
            print("Affichage des tâches dépendantes avec print_report:")
            print_report(dependencies)
        else:
            print("Aucune dépendance trouvée pour cette tâche.")
        
        print("\n==== Test is_due_in_pool_slot() ====")
        
        # Vérifier si la date due est dans une plage du pool
        is_in_slot = task.is_due_in_pool_slot()
        
        if is_in_slot is None:
            print("La tâche n'a pas de date due définie.")
        elif is_in_slot:
            print(f"✓ La date due ({TWTime.fmt_tw_datetime_local(task.due)}) tombe DANS une plage horaire du pool '{task.pool}'")
        else:
            print(f"✗ La date due ({TWTime.fmt_tw_datetime_local(task.due)}) tombe HORS des plages horaires du pool '{task.pool}'")
            # Afficher les plages disponibles pour ce jour
            if task.due:
                assignee = task.assignee or "default"
                if assignee not in CALENDARS_BY_ASSIGNEE:
                    assignee = "default"
                calendars = CALENDARS_BY_ASSIGNEE[assignee]
                if task.pool in calendars:
                    pool_calendar = calendars[task.pool]
                    slots = pool_calendar.get_slots_for_day(task.due)
                else:
                    slots = []
                if slots:
                    print(f"  Plages disponibles pour le {task.due.strftime('%A %Y-%m-%d')} :")
                    for slot_start, slot_end in slots:
                        print(f"    - {slot_start.strftime('%H:%M')} à {slot_end.strftime('%H:%M')}")
                else:
                    print(f"  Aucune plage disponible pour le pool '{task.pool}' ce jour-là.")
        
        print("\n==== Test get_previous_free_slot() ====")
        
        # Utiliser la date due comme référence, ou maintenant si pas de due
        reference_date = task.due if task.due else dt.datetime.now()
        
        # Chercher un créneau libre pour la durée de la tâche
        previous_free_slot = get_previous_free_slot(
            date=reference_date,
            pool=task.pool,
            assignee=task.assignee or "default",
            min_duration=task.est_min,
            schedule_type="proposed"
        )
        
        if previous_free_slot is None:
            print(f"✗ Aucun créneau libre trouvé dans le pool '{task.pool}' avant {TWTime.fmt_tw_datetime_local(reference_date)}")
            print(f"  (durée requise: {task.est_min} minutes)")
        else:
            slot_start, slot_end = previous_free_slot
            duration = (slot_end - slot_start).total_seconds() / 60
            
            print(f"✓ Créneau libre trouvé dans le pool '{task.pool}':")
            print(f"  Début: {slot_start.strftime('%A %Y-%m-%d à %H:%M')}")
            print(f"  Fin:   {slot_end.strftime('%A %Y-%m-%d à %H:%M')}")
            print(f"  Durée disponible: {int(duration)} minutes")
            print(f"  Durée requise: {task.est_min} minutes")
            
            if task.due:
                time_before_due = (task.due - slot_end).total_seconds() / 60
                print(f"  Temps avant la date due: {int(time_before_due)} minutes ({time_before_due/60:.1f} heures)")
                
                # Vérifier si la tâche peut être planifiée dans ce créneau
                if duration >= task.est_min:
                    print(f"  → La tâche PEUT être planifiée dans ce créneau")
                    # Calculer quand elle devrait commencer pour finir à temps
                    task_start = slot_end - dt.timedelta(minutes=task.est_min)
                    if task_start >= slot_start:
                        print(f"  → Planification suggérée: {task_start.strftime('%A %Y-%m-%d à %H:%M')} - {slot_end.strftime('%H:%M')}")
                    else:
                        print(f"  ⚠ Le créneau est trop court, la tâche devrait commencer avant le début du créneau")
                else:
                    print(f"  ✗ Le créneau est trop court pour la tâche")
        

        # Assigner la critical_due_date à la tâche
        task.set_critical_due_date()
        print(f"\nCritical due date assignée à la tâche: {TWTime.fmt_tw_datetime_local(task.critical_due_date)}")
    else:
        print(f"Aucune tâche trouvée avec l'UUID: {test_uuid}")
    
    print("==== Fin du test UUID ====\n")

def test_set_proposed_scheduled():
    """
    Fonction de test pour la méthode set_proposed_scheduled() de la classe Task.
    Teste également la planification des dépendances.
    """
    test_uuid = "f5a56957-270f-4d44-baee-469157398656"
    
    print(f"==== Test set_proposed_scheduled() pour UUID: {test_uuid} ====\n")
    
    # Récupérer la tâche par UUID
    task = Task.from_uuid(test_uuid)
    
    if not task:
        print(f"✗ Aucune tâche trouvée avec l'UUID: {test_uuid}")
        return
    
    print(f"Tâche principale: {task.description}")
    
    # Récupérer les dépendances
    dependencies = task.get_dependencies()
    
    if dependencies:
        print(f"\n=== Dépendances (AVANT planification) ===")
        print_report(dependencies)
        
        # Trier les dépendances par urgence (de la moins urgente à la plus urgente)
        sorted_deps = sorted(dependencies.values(), key=lambda t: t.urgency)
        
        print(f"\n=== Planification des dépendances ===")
        for dep_task in sorted_deps:
            print(f"\nPlanification de: {dep_task.description} (urgence: {dep_task.urgency:.2f})")
            success = dep_task.set_proposed_scheduled(schedule_type="proposed")
            if success:
                print(f"  ✓ Planifié à {TWTime.fmt_tw_datetime_local(dep_task.proposed_scheduled)}")
            else:
                print(f"  ✗ Échec de la planification")
        
        print(f"\n=== Dépendances (APRÈS planification) ===")
        # Recharger les dépendances pour voir les valeurs mises à jour
        updated_deps = task.get_dependencies()
        print_report(updated_deps)
    else:
        print("\nAucune dépendance trouvée pour cette tâche.")
    
    # Planifier la tâche principale
    print(f"\n=== Planification de la tâche principale ===")
    success = task.set_proposed_scheduled(schedule_type="proposed")
    
    if success:
        print(f"✓ Tâche principale planifiée à {TWTime.fmt_tw_datetime_local(task.proposed_scheduled)}")
    else:
        print(f"✗ Échec de la planification de la tâche principale")
    
    print("\n==== Fin du test set_proposed_scheduled() ====\n")

def test_calendar_slots():
    """
    Fonction de test pour afficher les créneaux disponibles pour différents pools.
    """
    print("==== Test Calendrier - Créneaux disponibles ====\n")
    
    # Définir une semaine de test (du lundi au dimanche)
    start_date = dt.datetime(2025, 11, 10, 0, 0)  # Lundi 10 novembre 2025
    
    pools = ["sleep", "pro", "asso"]
    days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
    
    for pool in pools:
        print(f"\n=== Pool: {pool.upper()} ===")
        for day_offset in range(7):
            test_date = start_date + dt.timedelta(days=day_offset)
            day_name = days[day_offset]
            
            # Récupérer le calendrier du pool
            if pool in CALENDARS_BY_ASSIGNEE["default"]:
                pool_calendar = CALENDARS_BY_ASSIGNEE["default"][pool]
                slots = pool_calendar.get_slots_for_day(test_date)
            else:
                slots = []
            
            if slots:
                print(f"{day_name} ({test_date.strftime('%Y-%m-%d')}):")
                for slot_start, slot_end in slots:
                    print(f"  - {slot_start.strftime('%H:%M')} à {slot_end.strftime('%H:%M')}")
            else:
                print(f"{day_name} ({test_date.strftime('%Y-%m-%d')}): Aucun créneau")
    
    # Test avec une tâche
    print("\n\n=== Test planification d'une tâche ===")
    test_uuid = "f5a56957-270f-4d44-baee-469157398656"
    task = Task.from_uuid(test_uuid)
    
    if task:
        print(f"Tâche: {task.description}")
        print(f"Pool: {task.pool}")
        print(f"Durée estimée: {task.est_min} minutes")
        print(f"Assignee: {task.assignee or 'default'}")
        
        # Tester si on peut planifier la tâche lundi matin à 9h
        test_start = dt.datetime(2025, 11, 10, 9, 0)  # Lundi 9h
        print(f"\nTest de planification à partir du {test_start.strftime('%Y-%m-%d %H:%M')}:")
        
        can_schedule = can_schedule_task(task, test_start, task.assignee or "default")
        print(f"Peut être planifiée: {'OUI' if can_schedule else 'NON'}")
        
        # Afficher les créneaux disponibles pour cette tâche
        end_time = test_start + dt.timedelta(minutes=task.est_min)
        available = get_available_slots_in_range(test_start, end_time, task.pool, task.assignee or "default")
        
        if available:
            print(f"\nCréneaux disponibles entre {test_start.strftime('%Y-%m-%d %H:%M')} et {end_time.strftime('%Y-%m-%d %H:%M')}:")
            total_minutes = 0
            for slot_start, slot_end in available:
                duration = (slot_end - slot_start).total_seconds() / 60
                total_minutes += duration
                print(f"  - {slot_start.strftime('%Y-%m-%d %H:%M')} à {slot_end.strftime('%Y-%m-%d %H:%M')} ({int(duration)} min)")
            print(f"Total disponible: {int(total_minutes)} minutes (besoin: {task.est_min} minutes)")
    else:
        print("Tâche non trouvée pour le test de planification")
    
    print("\n==== Fin du test calendrier ====\n")

#pour plus tard
def main_plannificateur():
    parser = argparse.ArgumentParser(description="TWPlanner - Backward scheduler (MVP)")
    parser.add_argument("--project", required=True, help="Nom du projet Taskwarrior (ex: TEST.TWPlanner)")
    parser.add_argument("--simulate", action="store_true", help="Simulation (n'écrit pas dans TW)")
    parser.add_argument("--apply", action="store_true", help="Appliquer les UDAs calculées dans TW")
    parser.add_argument("--no-split", action="store_true", help="Interdit le split (par défaut: split 30 min autorisé)")
    args = parser.parse_args()

    if args.apply and args.simulate:
        print("Choisir soit --simulate, soit --apply (pas les deux).", file=sys.stderr)
        sys.exit(2)

    tasks = load_tasks_from_tw(args.project)
    # Filtre: uniquement pending ayant une estimation
    tasks = {u: t for u, t in tasks.items() if t.status == "pending" and t.est_min > 0}

    if not tasks:
        print("Aucune tâche éligible trouvée.", file=sys.stderr)
        sys.exit(1)
    

    print_report(tasks)

    if args.apply:
        apply_updates_to_tw(tasks)
        print("Mises à jour appliquées dans Taskwarrior.")

if __name__ == "__main__":
    #test_task_from_uuid()
    #test_calendar_slots()
    test_set_proposed_scheduled()