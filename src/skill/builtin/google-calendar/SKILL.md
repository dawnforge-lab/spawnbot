---
name: google-calendar
description: "Manage Google Calendar events using CalDAV. Use when the user asks about calendar, events, scheduling, meetings, or appointments. No OAuth, no Cloud Console."
---

# Google Calendar via CalDAV

Direct CalDAV access to Google Calendar. Uses the same Google App Password as Gmail — no separate OAuth or API setup.

## Setup

### Prerequisites
- Google Account with 2FA enabled
- App Password generated (same as Gmail setup)
- CalDAV library: `pip install caldav`

### Credentials
Store in `.env`:
```
GMAIL_ADDRESS=your@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxx
```

## CalDAV Connection

```
URL: https://calendar.google.com/calendar/dav/{email}/events/
Auth: Basic (email + App Password)
```

## Operations

### Get Upcoming Events

```python
import caldav
from datetime import datetime, timedelta

client = caldav.DAVClient(
    url=f"https://calendar.google.com/calendar/dav/{email}/events/",
    username=email,
    password=app_password,
)
principal = client.principal()
calendar = principal.calendars()[0]  # primary calendar

events = calendar.search(
    start=datetime.now(),
    end=datetime.now() + timedelta(days=7),
    expand=True,
)

for event in events:
    vevent = event.vobject_instance.vevent
    print(vevent.summary.value)       # title
    print(vevent.dtstart.value)       # start time
    print(vevent.dtend.value)         # end time
    print(vevent.location.value)      # location (if set)
    print(vevent.description.value)   # description (if set)
```

### Create Event

```python
from datetime import datetime

vcal = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Spawnbot//Calendar//EN
BEGIN:VEVENT
DTSTART:20260220T100000
DTEND:20260220T110000
SUMMARY:Team Meeting
DESCRIPTION:Weekly sync
LOCATION:Conference Room
END:VEVENT
END:VCALENDAR"""

calendar.save_event(vcal)
```

DateTime format: `YYYYMMDDTHHMMSS` (no separators)

### Update Event

1. Search for the event by title within a date range
2. Access `event.vobject_instance.vevent`
3. Modify properties (`.summary.value`, `.dtstart.value`, etc.)
4. Call `event.save()`

### Delete Event

1. Search for the event by title
2. Call `event.delete()`

### List Calendars

```python
principal = client.principal()
for cal in principal.calendars():
    print(cal.name, cal.url)
```

## iCalendar Format Reference

```
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260220T100000        — start (local time)
DTEND:20260220T110000          — end (local time)
SUMMARY:Event Title            — title
DESCRIPTION:Details here       — description
LOCATION:Room 42               — location
END:VEVENT
END:VCALENDAR
```

For timezone-aware events:
```
DTSTART;TZID=America/New_York:20260220T100000
```

## Creating the Tool

When you need calendar capabilities, use the `create-tool` skill to build calendar tools in `tools/`. Consider creating:

1. `gcal-events` — list upcoming events (accepts `days_ahead` argument)
2. `gcal-create` — create a new event (title, start, end, description, location)
3. `gcal-delete` — delete an event by title search

Each tool should read `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` from `process.env`. Shell out to Python since CalDAV requires the `caldav` pip package. Ensure `caldav` is installed before first use.

## Troubleshooting

- **"No calendars found"**: Enable IMAP in Gmail Settings > Forwarding and POP/IMAP
- **"caldav not installed"**: Run `pip install caldav`
- **Wrong calendar**: `principal.calendars()[0]` is usually the primary. Use `cal.name` to find specific calendars.
