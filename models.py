#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Modèles de données pour TWPlanner
Contient les classes pour les tâches et les calendriers
"""

import datetime as dt
import json
import math
import re
import subprocess
from dataclasses import dataclass, field
from typing import Dict, List, Optional

# ========= Modèles de calendrier =========

@dataclass
class TimeSlot:
    """Représente un créneau horaire dans une journée"""
    start_time: str  # Format "HH:MM"
    end_time: str    # Format "HH:MM"

@dataclass
class PoolCalendar:
    """Calendrier des disponibilités pour un pool spécifique"""
    pool_name: str
    # Dictionnaire: jour_semaine -> liste de créneaux
    weekly_slots: Dict[int, List[TimeSlot]] = field(default_factory=dict)

# ========= Utilitaires pour Task =========

def parse_duration_to_minutes(s) -> int:
    """
    Parse une durée Taskwarrior UDA (ex: '4h', '30min', '2h30m', '1d') -> minutes.
    Accepte aussi un entier (minutes) ou ISO 'PT4H' (basique).
    """
    if s is None:
        return 0
    if isinstance(s, (int, float)):
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

# ========= Modèle de tâche =========

@dataclass
class Task:
    """Représente une tâche Taskwarrior"""
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
    scheduled_due_date: Optional[dt.datetime] = None  # Due date (end of task) for respecting schedule
    critical_due_date: Optional[dt.datetime] = None   # Due date (end of task) for respecting hard due date
    proposed_scheduled: Optional[dt.datetime] = None

    @classmethod
    def from_uuid(cls, uuid: str) -> Optional['Task']:
        """
        Récupère une tâche spécifique par son UUID en utilisant la commande 'task [uuid]'.
        
        Args:
            uuid: L'UUID de la tâche à récupérer
        
        Returns:
            L'objet Task correspondant ou None si non trouvé
        """
        try:
            # Utiliser la commande task avec l'UUID spécifique
            cmd = ["task", uuid, "rc.verbose=nothing", "export"]
            out = subprocess.check_output(cmd, text=True)
            data = json.loads(out or "[]")
            
            if not data:
                return None
            
            # Prendre la première tâche (il ne devrait y en avoir qu'une)
            t = data[0]
            
            # Parser les données
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
                    depends = [str(dep).strip()] if str(dep).strip() else []
            
            due = parse_tw_datetime(t.get("due"))
            scheduled_lock = parse_tw_datetime(t.get("scheduled"))
            
            # UDA
            uda = t.get("uda", {})
            est = parse_duration_to_minutes(uda.get("estTime") or t.get("estTime"))
            assignee = uda.get("assignee") or t.get("assignee") or ""
            pool = uda.get("pool") or t.get("pool") or "pro"
            urgency = float(t.get("urgency", 0))
            status = t.get("status", "pending")
            
            return cls(
                uuid=uuid, description=desc, project=proj, depends=depends,
                due=due, scheduled_lock=scheduled_lock, est_min=est,
                assignee=assignee, pool=pool, urgency=urgency, status=status
            )
            
        except subprocess.CalledProcessError:
            # La commande a échoué (tâche non trouvée ou autre erreur)
            return None
        except (json.JSONDecodeError, KeyError, IndexError):
            # Erreur de parsing JSON ou données manquantes
            return None

    def get_dependencies(self) -> Dict[str, 'Task']:
        """
        Récupère toutes les tâches dont cette tâche dépend.
        
        Returns:
            Dictionnaire des tâches dépendantes (uuid -> Task)
        """
        dependencies = {}
        
        # Parcourir tous les UUIDs de dépendances
        for dep_uuid in self.depends:
            # Récupérer chaque tâche dépendante
            dep_task = Task.from_uuid(dep_uuid)
            if dep_task:
                dependencies[dep_uuid] = dep_task
        
        return dependencies

    def can_schedule_at(self, start_time: dt.datetime, calendars_by_assignee: Dict) -> bool:
        """
        Vérifie si cette tâche peut être planifiée à partir d'un moment donné.
        
        Args:
            start_time: Heure de début proposée
            calendars_by_assignee: Dictionnaire des calendriers par assignee
        
        Returns:
            True si la tâche peut être planifiée, False sinon
        """
        if self.est_min <= 0:
            return False
        
        # Import local pour éviter les dépendances circulaires
        from twplanner import get_available_slots_in_range
        
        end_time = start_time + dt.timedelta(minutes=self.est_min)
        assignee = self.assignee or "default"
        
        # Récupérer les créneaux disponibles pour ce pool
        available_slots = get_available_slots_in_range(start_time, end_time, self.pool, assignee)
        
        # Calculer le temps total disponible
        total_available_minutes = 0
        for slot_start, slot_end in available_slots:
            duration = (slot_end - slot_start).total_seconds() / 60
            total_available_minutes += duration
        
        # Vérifier si on a assez de temps disponible
        return total_available_minutes >= self.est_min

    def is_due_in_pool_slot(self) -> bool:
        """
        Vérifie si la date due de cette tâche tombe dans une plage horaire 
        correspondant à son pool.
        
        Returns:
            True si la date due est dans une plage du pool, False sinon
            None si la tâche n'a pas de date due
        """
        if self.due is None:
            return None
        
        # Import local pour éviter les dépendances circulaires
        from twplanner import get_available_slots_for_day
        
        assignee = self.assignee or "default"
        
        # Récupérer les créneaux disponibles pour le jour de la date due
        slots = get_available_slots_for_day(self.due, self.pool, assignee)
        
        # Vérifier si la date due tombe dans un des créneaux
        for slot_start, slot_end in slots:
            if slot_start <= self.due <= slot_end:
                return True
        
        return False

    def calculate_critical_due_date(self) -> Optional[dt.datetime]:
        """
        Calcule la critical_due_date : la fin du dernier créneau du pool avant la date due.
        Si la date due est déjà dans un créneau du pool, retourne la date due elle-même.
        
        Returns:
            La fin du dernier créneau avant la date due, ou None si pas de date due
        """
        if self.due is None:
            return None
        
        # Import local pour éviter les dépendances circulaires
        from twplanner import get_available_slots_for_day
        
        assignee = self.assignee or "default"
        
        # Vérifier si la date due est déjà dans un créneau
        if self.is_due_in_pool_slot():
            return self.due
        
        # Chercher le dernier créneau avant la date due
        # On commence par le jour de la date due et on remonte dans le temps
        current_date = self.due.replace(hour=0, minute=0, second=0, microsecond=0)
        max_days_back = 30  # Limite de recherche : 30 jours en arrière
        
        last_slot_end = None
        
        for days_back in range(max_days_back):
            check_date = current_date - dt.timedelta(days=days_back)
            slots = get_available_slots_for_day(check_date, self.pool, assignee)
            
            # Parcourir les créneaux de ce jour
            for slot_start, slot_end in slots:
                # Ne considérer que les créneaux qui se terminent avant la date due
                if slot_end < self.due:
                    # Garder le créneau le plus proche (le plus récent)
                    if last_slot_end is None or slot_end > last_slot_end:
                        last_slot_end = slot_end
            
            # Si on a trouvé un créneau dans ce jour, on peut s'arrêter
            # (car on cherche le plus proche)
            if last_slot_end is not None and days_back == 0:
                break
            
            # Si on a trouvé un créneau dans un jour précédent, on s'arrête
            if last_slot_end is not None and days_back > 0:
                break
        
        return last_slot_end

    def set_critical_due_date(self) -> None:
        """
        Calcule et assigne la critical_due_date pour cette tâche.
        """
        self.critical_due_date = self.calculate_critical_due_date()
