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
from models import TimeSlot, PoolCalendar, Task, parse_duration_to_minutes, parse_tw_datetime

# ========= Configuration calendrier =========
GRANULARITY_MIN = 30  # split autorisé uniquement par 30 min
NUDGE_THRESHOLD_MIN = 60 * 24  # 1 jour

# Définition des calendriers par pool et assignee
# Format: {assignee: {pool: {jour_semaine: [(heure_debut, heure_fin), ...]}}}
# jour_semaine: 0=Lundi, 1=Mardi, 2=Mercredi, 3=Jeudi, 4=Vendredi, 5=Samedi, 6=Dimanche

def get_default_calendar(assignee: str = "default") -> Dict[str, PoolCalendar]:
    """
    Retourne le calendrier par défaut pour un assignee.
    
    Args:
        assignee: Nom de l'assignee (pour l'instant un seul calendrier par défaut)
    
    Returns:
        Dictionnaire {pool_name: PoolCalendar}
    """
    calendars = {}
    
    # SLEEP: tous les jours de 00:00 à 08:00 et de 22:00 à 23:59
    sleep_slots = {}
    for day in range(7):  # 0=Lundi à 6=Dimanche
        sleep_slots[day] = [
            TimeSlot("00:00", "08:00"),
            TimeSlot("22:00", "23:59")
        ]
    calendars["sleep"] = PoolCalendar("sleep", sleep_slots)
    
    # PRO: 8:00-12:00 et 14:00-18:00 (sauf mercredi et vendredi: 16h)
    pro_slots = {}
    for day in range(7):
        if day == 2:  # Mercredi (0=Lundi, 2=Mercredi)
            pro_slots[day] = [
                TimeSlot("09:00", "12:00"),
                TimeSlot("14:00", "16:00")
            ]
        elif day == 4:  # Vendredi
            pro_slots[day] = [
                TimeSlot("09:00", "12:00"),
                TimeSlot("14:00", "16:00")
            ]
        elif day in [0, 1, 3]:  # Lundi, Mardi, Jeudi
            pro_slots[day] = [
                TimeSlot("09:00", "12:00"),
                TimeSlot("14:00", "18:00")
            ]
        # Pas de créneaux pro le week-end (5=Samedi, 6=Dimanche)
    calendars["pro"] = PoolCalendar("pro", pro_slots)
    
    # ASSO: Mardi 18:00-20:00 et Mercredi 16:00-20:00
    asso_slots = {
        1: [TimeSlot("18:00", "20:00")],  # Mardi
        2: [TimeSlot("16:00", "20:00")]   # Mercredi
    }
    calendars["asso"] = PoolCalendar("asso", asso_slots)
    
    # PERSO: pas besoin de planifier explicitement (c'est le reste du temps)
    # On peut le laisser vide ou ne pas le définir
    calendars["perso"] = PoolCalendar("perso", {})
    
    return calendars

# Stockage global des calendriers par assignee
CALENDARS_BY_ASSIGNEE: Dict[str, Dict[str, PoolCalendar]] = {
    "default": get_default_calendar("default")
}

# ========= Utilitaires calendrier =========

def time_to_minutes(time_str: str) -> int:
    """Convertit une heure au format HH:MM en minutes depuis minuit."""
    hours, minutes = map(int, time_str.split(":"))
    return hours * 60 + minutes

def minutes_to_time(minutes: int) -> str:
    """Convertit des minutes depuis minuit en format HH:MM."""
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"

def get_available_slots_for_day(date: dt.datetime, pool: str, assignee: str = "default") -> List[Tuple[dt.datetime, dt.datetime]]:
    """
    Retourne les créneaux disponibles pour un jour donné, un pool et un assignee.
    
    Args:
        date: Date pour laquelle chercher les créneaux
        pool: Nom du pool (pro, asso, perso, sleep)
        assignee: Nom de l'assignee
    
    Returns:
        Liste de tuples (datetime_debut, datetime_fin) représentant les créneaux disponibles
    """
    # Récupérer le calendrier de l'assignee
    if assignee not in CALENDARS_BY_ASSIGNEE:
        assignee = "default"
    
    calendars = CALENDARS_BY_ASSIGNEE[assignee]
    
    if pool not in calendars:
        return []
    
    pool_calendar = calendars[pool]
    day_of_week = date.weekday()  # 0=Lundi, 6=Dimanche
    
    if day_of_week not in pool_calendar.weekly_slots:
        return []
    
    # Convertir les TimeSlots en datetime
    available_slots = []
    for slot in pool_calendar.weekly_slots[day_of_week]:
        start_minutes = time_to_minutes(slot.start_time)
        end_minutes = time_to_minutes(slot.end_time)
        
        start_dt = date.replace(hour=start_minutes // 60, minute=start_minutes % 60, second=0, microsecond=0)
        end_dt = date.replace(hour=end_minutes // 60, minute=end_minutes % 60, second=0, microsecond=0)
        
        available_slots.append((start_dt, end_dt))
    
    return available_slots

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
    
    while current_date <= end_date:
        day_slots = get_available_slots_for_day(current_date, pool, assignee)
        
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

# ========= Utilitaires de parsing =========

def fmt_tw_datetime_local(d: Optional[dt.datetime]) -> Optional[str]:
    """Format pour `task ... modify UDA=...` (ISO local, sans timezone)."""
    if d is None:
        return None
    return d.strftime("%Y-%m-%dT%H:%M:%S")

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
        due = parse_tw_datetime(t.get("due"))
        scheduled_lock = parse_tw_datetime(t.get("scheduled"))  # verrou
        # UDA
        uda = t.get("uda", {})
        est = parse_duration_to_minutes(uda.get("estTime") or t.get("estTime"))
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
    for t in tasks.values():
        if t.status != "pending":
            continue
        nudge = None
        # Utiliser due au lieu de last_due_date qui n'existe pas
        if t.due and t.proposed_scheduled:
            delta_min = int((t.due - t.proposed_scheduled).total_seconds() // 60)
            if delta_min > NUDGE_THRESHOLD_MIN:
                nudge = f"{delta_min//60}h"
        rows.append([
            t.description,
            t.assignee or "-",
            t.pool,
            t.est_min,
            f"{t.urgency:.2f}",
            fmt_tw_datetime_local(t.due) or "",
            fmt_tw_datetime_local(t.scheduled_lock) or "",
            fmt_tw_datetime_local(t.scheduled_due_date) or "",
            fmt_tw_datetime_local(t.critical_due_date) or "",
            fmt_tw_datetime_local(t.proposed_scheduled) or "",
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
        print(f"Due date: {fmt_tw_datetime_local(task.due) or 'Non définie'}")
        print(f"Scheduled: {fmt_tw_datetime_local(task.scheduled_lock) or 'Non définie'}")
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
            print(f"✓ La date due ({fmt_tw_datetime_local(task.due)}) tombe DANS une plage horaire du pool '{task.pool}'")
        else:
            print(f"✗ La date due ({fmt_tw_datetime_local(task.due)}) tombe HORS des plages horaires du pool '{task.pool}'")
            # Afficher les plages disponibles pour ce jour
            if task.due:
                slots = get_available_slots_for_day(task.due, task.pool, task.assignee or "default")
                if slots:
                    print(f"  Plages disponibles pour le {task.due.strftime('%A %Y-%m-%d')} :")
                    for slot_start, slot_end in slots:
                        print(f"    - {slot_start.strftime('%H:%M')} à {slot_end.strftime('%H:%M')}")
                else:
                    print(f"  Aucune plage disponible pour le pool '{task.pool}' ce jour-là.")
        
        print("\n==== Test calculate_critical_due_date() ====")
        
        # Calculer la critical_due_date
        critical_due = task.calculate_critical_due_date()
        
        if critical_due is None:
            print("Impossible de calculer la critical_due_date (pas de date due ou pas de créneau trouvé).")
        else:
            print(f"Critical due date calculée: {fmt_tw_datetime_local(critical_due)}")
            
            if task.due and critical_due != task.due:
                time_diff = (task.due - critical_due).total_seconds() / 60
                print(f"Différence avec la date due: {int(time_diff)} minutes ({time_diff/60:.1f} heures)")
                print(f"→ La tâche doit être terminée avant {critical_due.strftime('%A %Y-%m-%d à %H:%M')}")
            else:
                print("La date due est déjà dans un créneau du pool, pas d'ajustement nécessaire.")
        
        # Assigner la critical_due_date à la tâche
        task.set_critical_due_date()
        print(f"\nCritical due date assignée à la tâche: {fmt_tw_datetime_local(task.critical_due_date)}")
    else:
        print(f"Aucune tâche trouvée avec l'UUID: {test_uuid}")
    
    print("==== Fin du test UUID ====\n")

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
            
            slots = get_available_slots_for_day(test_date, pool)
            
            if slots:
                print(f"{day_name} ({test_date.strftime('%Y-%m-%d')}):")
                for slot_start, slot_end in slots:
                    print(f"  - {slot_start.strftime('%H:%M')} à {slot_end.strftime('%H:%M')}")
            else:
                print(f"{day_name} ({test_date.strftime('%Y-%m-%d')}): Aucun créneau")
    
    # Test avec une tâche
    print("\n\n=== Test planification d'une tâche ===")
    test_uuid = "d3805c24-52a3-4cc1-b20f-0518dab2110d"
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
    test_task_from_uuid()
    #test_calendar_slots()
    