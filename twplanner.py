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
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from tabulate import tabulate

# ========= Configuration calendrier =========
GRANULARITY_MIN = 30  # split autorisé uniquement par 30 min
WORKSLOTS_PRO = [("09:00", "12:00"), ("14:00", "18:00")]  # Lun-Ven
WORKDAYS_PRO = {0, 1, 2, 3, 4}  # 0=Lundi ... 6=Dimanche
NUDGE_THRESHOLD_MIN = 60 * 24  # 1 jour

# ========= Utilitaires de parsing =========

def parse_duration_to_minutes(s) -> int:
    """
    Parse une durée Taskwarrior UDA (ex: '4h', '30min', '2h30m', '1d') -> minutes.
    Accepte aussi un entier (minutes) ou ISO 'PT4H' (basique).
    """
    if s is None:
        return 0
    if isinstance(s, (int, float)):
        # On suppose minutes si entier simple (fallback)
        return int(s)
    s = str(s).strip().lower()

    # ISO 8601 rudimentaire 'ptxhymzs'
    if s.startswith("pt"):
        total = 0
        m = re.findall(r'(\d+)([hmsd])', s[2:])
        for num, unit in m:
            num = int(num)
            if unit == 'd':
                total += num * 24 * 60
            elif unit == 'h':
                total += num * 60
            elif unit == 'm':
                total += num
            elif unit == 's':
                total += math.ceil(num / 60)
        return total

    # ex: "2d 3h 15m", "4h", "30min", "2h30m"
    pattern = re.compile(r'(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)')
    total = 0
    for num, unit in pattern.findall(s):
        num = int(num)
        if unit in ('d', 'day', 'days'):
            total += num * 24 * 60
        elif unit in ('h', 'hr', 'hrs', 'hour', 'hours'):
            total += num * 60
        elif unit in ('m', 'min', 'mins', 'minute', 'minutes'):
            total += num
    if total == 0:
        # dernier recours: si '4h30' sans suffix 'm'
        m2 = re.match(r'(\d+)h(\d+)$', s)
        if m2:
            total = int(m2.group(1)) * 60 + int(m2.group(2))
    return total

def parse_tw_datetime(s: Optional[str]) -> Optional[dt.datetime]:
    """
    Parse des formats Taskwarrior courants:
    - '2025-12-12T18:00:00' (ISO local)
    - '20251212T180000Z' (UTC compact)
    - '20251212T180000' (local compact)
    """
    if not s:
        return None
    s = str(s).strip()
    # ISO avec Z
    if s.endswith('Z'):
        try:
            return dt.datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc).astimezone(None).replace(tzinfo=None)
        except:
            pass
    # Compact local
    try:
        return dt.datetime.strptime(s, "%Y%m%dT%H%M%S")
    except:
        pass
    # ISO standard
    try:
        if s.endswith('Z'):
            s = s[:-1] + "+00:00"
        return dt.datetime.fromisoformat(s).replace(tzinfo=None)
    except:
        return None

def fmt_tw_datetime_local(d: Optional[dt.datetime]) -> Optional[str]:
    """Format pour `task ... modify UDA=...` (ISO local, sans timezone)."""
    if d is None:
        return None
    return d.strftime("%Y-%m-%dT%H:%M:%S")

# ========= Modèle de données =========

@dataclass
class Task:
    uuid: str
    description: str
    project: str
    depends: List[str]
    due: Optional[dt.datetime]
    scheduled_lock: Optional[dt.datetime]  # verrou si présent
    est_min: int
    assignee: str
    pool: str
    urgency: float
    status: str

    # Calculés
    last_due_date: Optional[dt.datetime] = None
    critical_due_date: Optional[dt.datetime] = None
    proposed_scheduled: Optional[dt.datetime] = None

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

# ========= Outils calendrier / réservation =========

def is_workday_pro(d: dt.date) -> bool:
    return d.weekday() in WORKDAYS_PRO

def slots_for_day_pro(day: dt.date) -> List[Tuple[dt.datetime, dt.datetime]]:
    slots = []
    for s, e in WORKSLOTS_PRO:
        sh = dt.datetime.strptime(s, "%H:%M").time()
        eh = dt.datetime.strptime(e, "%H:%M").time()
        slots.append((dt.datetime.combine(day, sh), dt.datetime.combine(day, eh)))
    return slots

def round_down_to_granularity(d: dt.datetime, gran_min=GRANULARITY_MIN) -> dt.datetime:
    minutes = (d.hour * 60 + d.minute)
    rounded = (minutes // gran_min) * gran_min
    return d.replace(hour=0, minute=0, second=0, microsecond=0) + dt.timedelta(minutes=rounded)

def subtract_intervals(base: Tuple[dt.datetime, dt.datetime], occ: List[Tuple[dt.datetime, dt.datetime]]) -> List[Tuple[dt.datetime, dt.datetime]]:
    """Soustrait les intervalles occupés de base, retourne les intervalles libres (triés)."""
    start, end = base
    if start >= end:
        return []
    free = [(start, end)]
    for (os, oe) in sorted(occ):
        new_free = []
        for (fs, fe) in free:
            if oe <= fs or os >= fe:
                new_free.append((fs, fe))
            else:
                if os > fs:
                    new_free.append((fs, os))
                if oe < fe:
                    new_free.append((oe, fe))
        free = new_free
        if not free:
            break
    return sorted([(s, e) for (s, e) in free if (e - s).total_seconds() > 0], key=lambda x: x[0])

class ResourceCalendar:
    """Calendrier de réservations par ressource (pool, assignee)."""
    def __init__(self, pool: str, assignee: str):
        self.pool = pool
        self.assignee = assignee
        self.occ: List[Tuple[dt.datetime, dt.datetime]] = []  # intervals réservés triés

    def reserve(self, start: dt.datetime, end: dt.datetime):
        self.occ.append((start, end))
        self.occ.sort(key=lambda x: x[0])

    def find_backward(self, deadline: dt.datetime, minutes: int, allow_split=True, gran_min=GRANULARITY_MIN) -> Optional[dt.datetime]:
        """
        Recherche le dernier placement possible avant 'deadline' pour 'minutes'.
        Retourne le début global. Place en interne (réserve).
        """
        remaining = minutes
        placed_segments: List[Tuple[dt.datetime, dt.datetime]] = []
        cursor = deadline

        while remaining > 0:
            day = cursor.date()
            # Décrémente les jours jusqu’à un ouvré
            while self.pool == "pro" and not is_workday_pro(day):
                day = day - dt.timedelta(days=1)
                cursor = dt.datetime.combine(day, dt.time(23, 59, 59))

            # Slots jour (pro) ou un slot 24h (autre pool fini)
            if self.pool == "pro":
                slots = slots_for_day_pro(day)
            else:
                # Pour d'autres pools bornés, on pourrait paramétrer ici
                slots = [(dt.datetime.combine(day, dt.time(0, 0, 0)), dt.datetime.combine(day, dt.time(23, 59, 59)))]

            placed_today = False
            # Traite les slots du jour de la fin vers le début
            for (s, e) in reversed(slots):
                # Clip le slot à cursor
                e2 = min(e, cursor)
                if e2 <= s:
                    continue
                # Intervalles libres dans ce slot
                free = subtract_intervals((s, e2), self.occ)
                # On parcourt du plus tard vers le plus tôt
                for (fs, fe) in reversed(free):
                    # Aligner sur granularité
                    fe = round_down_to_granularity(fe, gran_min)
                    if fe <= fs:
                        continue
                    avail_min = int((fe - fs).total_seconds() // 60)
                    if avail_min <= 0:
                        continue
                    if allow_split:
                        chunk = min(remaining, (avail_min // gran_min) * gran_min)
                        if chunk <= 0:
                            continue
                        seg_start = fe - dt.timedelta(minutes=chunk)
                        self.reserve(seg_start, fe)
                        placed_segments.append((seg_start, fe))
                        remaining -= chunk
                        cursor = seg_start
                        placed_today = True
                        if remaining == 0:
                            # Retourner le plus petit start parmi les segments posés
                            return min(st for (st, ed) in placed_segments)
                    else:
                        # Un seul bloc contigu
                        if avail_min >= remaining:
                            seg_start = fe - dt.timedelta(minutes=remaining)
                            self.reserve(seg_start, fe)
                            placed_segments.append((seg_start, fe))
                            remaining = 0
                            return seg_start
                        # sinon on continue à chercher un plus grand segment
            # Si rien posé sur la journée, recule d'un jour
            if not placed_today:
                day = day - dt.timedelta(days=1)
                cursor = dt.datetime.combine(day, dt.time(23, 59, 59))

        return min(st for (st, ed) in placed_segments) if placed_segments else None

# ========= Moteur de planification =========

def topological_order(tasks: Dict[str, Task]) -> List[str]:
    children = defaultdict(list)
    indeg = defaultdict(int)
    for u, t in tasks.items():
        for p in t.depends:
            children[p].append(u)
        indeg[u] = indeg.get(u, 0)
    for u, t in tasks.items():
        for v in t.depends:
            indeg[u] += 1
    q = deque([u for u, d in indeg.items() if d == 0])
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for w in children[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                q.append(w)
    if len(order) != len(tasks):
        raise RuntimeError("Cycle détecté dans les dépendances.")
    return order

def compute_last_due_dates(tasks: Dict[str, Task]) -> None:
    order = topological_order(tasks)
    # Construire reverse-children
    children = defaultdict(list)
    for task_id, task in tasks.items():
        for dependency_id in task.depends:
            children[dependency_id].append(task_id)
    # Si la tache A depend de B alors A sera dans children[B]

    # Initialisation: sinks avec due
    for task_id in reversed(order):
        task = tasks[task_id]
        if not children[task_id]:
            # Tâche feuille : last_due_date = date d'échéance (moment où elle doit finir)
            if task.due:
                task.last_due_date = task.due
            else:
                task.last_due_date = None  # pas de contrainte
        else:
            # Tâche avec enfants : doit finir avant que ses enfants ne commencent
            # child_start_dates = quand les enfants doivent commencer (last_due_date - est_min)
            child_start_dates = []
            for child_id in children[task_id]:
                child_task = tasks[child_id]
                if child_task.last_due_date is not None:
                    child_start_date = child_task.last_due_date - dt.timedelta(minutes=child_task.est_min)
                    child_start_dates.append(child_start_date)
            
            if child_start_dates:
                task.last_due_date = min(child_start_dates)
            else:
                task.last_due_date = None
        task.critical_due_date = task.last_due_date  # initialement égal
    # Pas de retour: champs remplis in-place

def schedule(tasks: Dict[str, Task], allow_split=True) -> None:
    """Place les tâches en backward en respectant la capacité."""
    # Calendriers par ressource
    resource_calendars: Dict[Tuple[str, str], ResourceCalendar] = {}

    def get_calendar(pool: str, assignee: str) -> ResourceCalendar:
        resource_key = (pool, assignee)
        if resource_key not in resource_calendars:
            resource_calendars[resource_key] = ResourceCalendar(pool, assignee)
        return resource_calendars[resource_key]

    # Construire le graphe de dépendances
    task_children = defaultdict(list)
    dependency_count = defaultdict(int)
    for task_id, task in tasks.items():
        for dependency_id in task.depends:
            task_children[dependency_id].append(task_id)
        dependency_count[task_id] = len(task.depends)

    # Pré-réserver les tâches verrouillées (scheduled)
    for task_id, task in tasks.items():
        if task.status != "pending":
            continue
        if task.scheduled_lock and task.est_min > 0 and task.pool != "ext" and task.assignee != "exterieur":
            lock_start_time = task.scheduled_lock
            lock_end_time = lock_start_time + dt.timedelta(minutes=task.est_min)
            get_calendar(task.pool, task.assignee).reserve(lock_start_time, lock_end_time)
            task.proposed_scheduled = lock_start_time
            task.critical_due_date = lock_end_time
            # Cette ligne était ajoutée par claude sonnet... je l'ai retiré pour ne pas perdre l'info
            # de quand la tache doit vraiment être faite. C'est pas parce qu'on a planifié plus tot que ça
            # change la deadline. à voir si ça change quelque chose. 
            # Edit 30/10/2025 : Je pense qu'il faut ajouter une autre info de date due_date_for_schedule 
            # qui est la date de fin qui permette de respecter le planning, mais qui pototiellement 
            # peut être décaléer pour respecter la deadline du projet (en bougeant la tache planifiée)
            # ça permettrait d'identifier la fonction les leviers d'actions.

    # Frontière: tâches dont tous les enfants sont déjà planifiés (au départ: tâches finales)
    scheduled_tasks = set(task_id for task_id, task in tasks.items() if task.proposed_scheduled is not None)
    def all_children_scheduled(task_id: str) -> bool:
        return all((child_id in scheduled_tasks) for child_id in task_children[task_id])

    scheduling_frontier = {task_id for task_id, task in tasks.items() if task.status=="pending" and all_children_scheduled(task_id)}

    # Boucle de planification
    while scheduling_frontier:
        # Tri de la frontière par priorité
        def priority_sort_key(task_id):
            task = tasks[task_id]
            # Contrainte logique d'abord (plus tôt = plus contraint)
            latest_due_date = task.last_due_date or dt.datetime.max
            # Slack approx = distance à la date limite
            time_slack = (latest_due_date - dt.datetime.now()).total_seconds() / 60.0 if task.last_due_date else 1e18
            return (latest_due_date, task.urgency, -task.est_min)

        priority_sorted_tasks = sorted(scheduling_frontier, key=priority_sort_key)
        current_task_id = priority_sorted_tasks[0]
        scheduling_frontier.remove(current_task_id)
        current_task = tasks[current_task_id]

        if current_task.proposed_scheduled is not None:
            scheduled_tasks.add(current_task_id)
            # Propager la contrainte vers les tâches parentes
            for parent_task_id in current_task.depends:
                parent_task = tasks[parent_task_id]
                parent_deadline_candidate = current_task.proposed_scheduled - dt.timedelta(minutes=parent_task.est_min)
                if parent_task.last_due_date is None or parent_deadline_candidate < parent_task.last_due_date:
                    parent_task.last_due_date = parent_deadline_candidate
                # critical_due_date = fin de tâche parent = début + durée
                parent_critical_end = parent_deadline_candidate + dt.timedelta(minutes=parent_task.est_min)
                if parent_task.critical_due_date is None or parent_critical_end < parent_task.critical_due_date:
                    parent_task.critical_due_date = parent_critical_end
                # Si tous les enfants du parent sont planifiés, l'ajouter à la frontière
                if all_children_scheduled(parent_task_id):
                    scheduling_frontier.add(parent_task_id)
            continue

        # Déterminer la date butoir de placement (début de tâche)
        # Si critical_due_date existe, on calcule le début = fin - durée
        if current_task.critical_due_date:
            scheduling_deadline = current_task.critical_due_date - dt.timedelta(minutes=current_task.est_min)
        else:
            scheduling_deadline = current_task.last_due_date
        if scheduling_deadline is None:
            # Si aucune contrainte, on se fixe une large fenêtre (maintenant + 180j)
            scheduling_deadline = dt.datetime.now() + dt.timedelta(days=180)

        # Capacité infinie ?
        if current_task.pool == "ext" or current_task.assignee == "exterieur":
            current_task.proposed_scheduled = scheduling_deadline
            # critical_due_date = fin de tâche = début + durée
            current_task.critical_due_date = scheduling_deadline + dt.timedelta(minutes=current_task.est_min)
            scheduled_tasks.add(current_task_id)
        else:
            task_calendar = get_calendar(current_task.pool, current_task.assignee)
            scheduled_start_time = task_calendar.find_backward(deadline=scheduling_deadline, minutes=current_task.est_min, allow_split=allow_split, gran_min=GRANULARITY_MIN)
            if scheduled_start_time is None:
                # Échec: on remonte très en amont (conflit); on pose à défaut avant la deadline
                scheduled_start_time = scheduling_deadline - dt.timedelta(minutes=current_task.est_min)
                task_calendar.reserve(scheduled_start_time, scheduled_start_time + dt.timedelta(minutes=current_task.est_min))
            current_task.proposed_scheduled = scheduled_start_time
            # critical_due_date = fin de tâche = début + durée
            scheduled_end_time = scheduled_start_time + dt.timedelta(minutes=current_task.est_min)
            current_task.critical_due_date = min(current_task.critical_due_date or scheduled_end_time, scheduled_end_time)
            scheduled_tasks.add(current_task_id)

        # Propager la contrainte aux tâches parentes
        for parent_task_id in current_task.depends:
            parent_task = tasks[parent_task_id]
            parent_deadline_candidate = current_task.proposed_scheduled - dt.timedelta(minutes=parent_task.est_min)
            if parent_task.last_due_date is None or parent_deadline_candidate < parent_task.last_due_date:
                parent_task.last_due_date = parent_deadline_candidate
            # critical_due_date = fin de tâche parent = début + durée
            parent_critical_end = parent_deadline_candidate + dt.timedelta(minutes=parent_task.est_min)
            if parent_task.critical_due_date is None or parent_critical_end < parent_task.critical_due_date:
                parent_task.critical_due_date = parent_critical_end
            if all_children_scheduled(parent_task_id):
                scheduling_frontier.add(parent_task_id)

    # Fin: tout est placé ou verrouillé

def apply_updates_to_tw(tasks: Dict[str, Task]) -> None:
    for u, t in tasks.items():
        if t.status != "pending":
            continue
        updates = []
        if t.last_due_date:
            updates.append(f'last_due_date:{fmt_tw_datetime_local(t.last_due_date)}')
        if t.critical_due_date:
            updates.append(f'critical_due_date:{fmt_tw_datetime_local(t.critical_due_date)}')
        if t.proposed_scheduled:
            updates.append(f'proposed_scheduled:{fmt_tw_datetime_local(t.proposed_scheduled)}')
        # versioning minimal
        updates.append(f'schedule_ts:{fmt_tw_datetime_local(dt.datetime.now())}')
        updates.append('schedule_version:python-mvp-0.1')

        if updates:
            cmd = ["task", u, "modify", "rc.confirmation=no"] + updates
            subprocess.check_call(cmd)

def print_report(tasks: Dict[str, Task]) -> None:
    print("\n=== TWPlanner Simulation ===")
    rows = []
    for t in tasks.values():
        if t.status != "pending":
            continue
        nudge = None
        if t.last_due_date and t.proposed_scheduled:
            delta_min = int((t.last_due_date - t.proposed_scheduled).total_seconds() // 60)
            if delta_min > NUDGE_THRESHOLD_MIN:
                nudge = f"{delta_min//60}h"
        rows.append([
            t.description,
            t.assignee or "-",
            t.pool,
            t.est_min,
            fmt_tw_datetime_local(t.last_due_date) or "",
            fmt_tw_datetime_local(t.critical_due_date) or "",
            fmt_tw_datetime_local(t.proposed_scheduled) or "",
            nudge or ""
        ])
    
    # Affichage avec tabulate pour un rendu propre avec séparateurs alignés
    headers = ["Tâche", "Assignee", "Pool", "Durée(min)", "last_due_date", "critical_due_date", "proposed_scheduled", "Nudge"]
    if rows:
        print(tabulate(rows, headers=headers, tablefmt="grid"))
    else:
        print("Aucune tâche à afficher.")
    print("=== Fin ===\n")

def main():
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

    compute_last_due_dates(tasks)
    schedule(tasks, allow_split=not args.no_split)
    print_report(tasks)

    if args.apply:
        apply_updates_to_tw(tasks)
        print("Mises à jour appliquées dans Taskwarrior.")

if __name__ == "__main__":
    main()
