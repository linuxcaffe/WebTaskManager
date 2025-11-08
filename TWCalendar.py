#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
TWCalendar - Gestion des calendriers pour TWPlanner
Contient la classe PoolCalendar pour gérer les disponibilités par pool
"""

import datetime as dt
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from TWTime import TimeSlot


@dataclass
class PoolCalendar:
    """Calendrier des disponibilités pour un pool spécifique"""
    pool_name: str
    # Dictionnaire: jour_semaine -> liste de créneaux
    weekly_slots: Dict[int, List[TimeSlot]] = field(default_factory=dict)
    
    @staticmethod
    def get_default_calendars(assignee: str = "default") -> Dict[str, 'PoolCalendar']:
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
                    TimeSlot("08:00", "12:00"),
                    TimeSlot("14:00", "16:00")
                ]
            elif day == 4:  # Vendredi
                pro_slots[day] = [
                    TimeSlot("08:00", "12:00"),
                    TimeSlot("14:00", "16:00")
                ]
            elif day in [0, 1, 3]:  # Lundi, Mardi, Jeudi
                pro_slots[day] = [
                    TimeSlot("08:00", "12:00"),
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
    
    def get_slots_for_day(self, date: dt.datetime) -> List[tuple]:
        """
        Retourne les créneaux disponibles pour un jour donné.
        
        Args:
            date: Date pour laquelle chercher les créneaux
        
        Returns:
            Liste de tuples (datetime_debut, datetime_fin) représentant les créneaux disponibles
        """
        day_of_week = date.weekday()  # 0=Lundi, 6=Dimanche
        
        if day_of_week not in self.weekly_slots:
            return []
        
        # Convertir les TimeSlots en datetime
        available_slots = []
        for slot in self.weekly_slots[day_of_week]:
            # Parser les heures
            start_hours, start_minutes = map(int, slot.start_time.split(":"))
            end_hours, end_minutes = map(int, slot.end_time.split(":"))
            
            start_dt = date.replace(hour=start_hours, minute=start_minutes, second=0, microsecond=0)
            end_dt = date.replace(hour=end_hours, minute=end_minutes, second=0, microsecond=0)
            
            available_slots.append((start_dt, end_dt))
        
        return available_slots
    
    def get_previous_slot_end(self, date: dt.datetime, max_days_back: int = 30) -> Optional[dt.datetime]:
        """
        Trouve la fin du dernier créneau avant une date donnée.
        
        Args:
            date: Date de référence
            max_days_back: Nombre maximum de jours à remonter dans le temps (défaut: 30)
        
        Returns:
            La fin du dernier créneau avant la date, ou None si aucun créneau trouvé
        """
        # Vérifier si la date est déjà dans un créneau
        current_date = date.replace(hour=0, minute=0, second=0, microsecond=0)
        slots_today = self.get_slots_for_day(date)
        
        for slot_start, slot_end in slots_today:
            if slot_start <= date <= slot_end:
                # La date est déjà dans un créneau, retourner la date elle-même
                return date
        
        # Chercher le dernier créneau avant la date
        last_slot_end = None
        
        for days_back in range(max_days_back):
            check_date = current_date - dt.timedelta(days=days_back)
            slots = self.get_slots_for_day(check_date)
            
            # Parcourir les créneaux de ce jour
            for slot_start, slot_end in slots:
                # Ne considérer que les créneaux qui se terminent avant la date de référence
                if slot_end < date:
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
