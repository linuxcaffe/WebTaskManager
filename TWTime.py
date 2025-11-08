#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
TWTime - Gestion du temps pour TWPlanner
Contient la classe TimeSlot et les fonctions de parsing du temps
"""

import datetime as dt
import math
import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class TimeSlot:
    """Représente un créneau horaire dans une journée"""
    start_time: str  # Format "HH:MM"
    end_time: str    # Format "HH:MM"


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


def fmt_tw_datetime_local(d: Optional[dt.datetime]) -> Optional[str]:
    """Format pour `task ... modify UDA=...` (ISO local, sans timezone)."""
    if d is None:
        return None
    return d.strftime("%Y-%m-%dT%H:%M:%S")


def time_to_minutes(time_str: str) -> int:
    """Convertit une heure au format HH:MM en minutes depuis minuit."""
    hours, minutes = map(int, time_str.split(":"))
    return hours * 60 + minutes


def minutes_to_time(minutes: int) -> str:
    """Convertit des minutes depuis minuit en format HH:MM."""
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"
