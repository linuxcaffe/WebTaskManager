#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
TWTask - Gestion des tâches pour TWPlanner
Contient la classe Task pour représenter une tâche Taskwarrior
"""

import datetime as dt
import json
import subprocess
from dataclasses import dataclass
from typing import Dict, List, Optional
from TWTime import parse_duration_to_minutes, parse_tw_datetime


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
        from twplanner import CALENDARS_BY_ASSIGNEE
        
        assignee = self.assignee or "default"
        
        # Récupérer le calendrier du pool pour cet assignee
        if assignee not in CALENDARS_BY_ASSIGNEE:
            assignee = "default"
        
        calendars = CALENDARS_BY_ASSIGNEE[assignee]
        
        if self.pool not in calendars:
            return False
        
        pool_calendar = calendars[self.pool]
        
        # Récupérer les créneaux disponibles pour le jour de la date due
        slots = pool_calendar.get_slots_for_day(self.due)
        
        # Vérifier si la date due tombe dans un des créneaux
        for slot_start, slot_end in slots:
            if slot_start <= self.due <= slot_end:
                return True
        
        return False

    def get_previous_slot_end(self) -> Optional[dt.datetime]:
        """
        Trouve la fin du dernier créneau du pool avant la date due.
        Si la date due est déjà dans un créneau du pool, retourne la date due elle-même.
        
        Returns:
            La fin du dernier créneau avant la date due, ou None si pas de date due
        """
        if self.due is None:
            return None
        
        # Import local pour éviter les dépendances circulaires
        from twplanner import CALENDARS_BY_ASSIGNEE
        
        assignee = self.assignee or "default"
        
        # Récupérer le calendrier du pool pour cet assignee
        if assignee not in CALENDARS_BY_ASSIGNEE:
            assignee = "default"
        
        calendars = CALENDARS_BY_ASSIGNEE[assignee]
        
        if self.pool not in calendars:
            return None
        
        pool_calendar = calendars[self.pool]
        
        # Utiliser la méthode get_previous_slot_end de PoolCalendar
        return pool_calendar.get_previous_slot_end(self.due)

    def set_critical_due_date(self) -> None:
        """
        Calcule et assigne la critical_due_date pour cette tâche.
        """
        self.critical_due_date = self.get_previous_slot_end()
