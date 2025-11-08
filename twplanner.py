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
    scheduled_due_date: Optional[dt.datetime] = None #Due date (end of task) for respecting schedule
    critical_due_date: Optional[dt.datetime] = None #Due date (end of task) for respecting hard due date
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


    print_report(tasks)

    if args.apply:
        apply_updates_to_tw(tasks)
        print("Mises à jour appliquées dans Taskwarrior.")

if __name__ == "__main__":
    main()
