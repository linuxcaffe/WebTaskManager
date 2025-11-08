#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Fichier de compatibilité - Importe depuis les nouveaux modules
Ce fichier permet de maintenir la compatibilité avec l'ancien code
"""

# Imports depuis les nouveaux modules
from TWTime import TimeSlot, parse_duration_to_minutes, parse_tw_datetime, fmt_tw_datetime_local
from TWCalendar import PoolCalendar
from TWTask import Task

# Exports pour compatibilité
__all__ = [
    'TimeSlot',
    'PoolCalendar',
    'Task',
    'parse_duration_to_minutes',
    'parse_tw_datetime',
    'fmt_tw_datetime_local'
]
