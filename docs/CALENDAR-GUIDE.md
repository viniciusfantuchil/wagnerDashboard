# How to fill in a calendar event for the board

One page for whoever keeps the crew calendars (Diandra, Carlos). The office TV reads the calendars every 5 minutes. When an event follows this format, the board shows the job correctly and only raises the alerts that matter.

The board never guesses. If the deposit is not written in the event, the board shows **Deposit unknown** and a yellow **Calendar** alert. It never treats a job as paid.

## 1. Title

```
<Customer> – <Service> <size>
```

| Write | The board shows |
|---|---|
| `Hartley – Driveway 420 sf` | Hartley · Driveway 420 sf |
| `Nguyen – Wall block 65 lnft` | Nguyen · Wall block 65 lnft |
| `Whitaker – Sealing 900 sf` | Whitaker · Sealing 900 sf |
| `Stop @ Barry Schiedel` | Barry Schiedel · Stop |
| `EST – Sorensen – Driveway` or `Estimate – Sorensen – Driveway` | an estimate visit for Kevin, not a job |
| `Linda Green – 1`, `Stop @ Shafer – 4` | stop 1 / stop 4 of the crew's route for the day |

- Use a dash with spaces around it between the customer and the service.
- A number at the end is the **route order**: the sequence the crew should follow (Jardel's sealing stops). The board numbers the crew's pins in that order and draws the route on the map.
- **No dollar amounts and no payment words in the title** ("paid", "50%", "$2,500"). The board removes them and flags the event. Payment status goes in the description.

## 2. Location

The full street address: `1234 Example Dr, Viera, FL 32940`.

The TV shows only the city. The address is used to place the job on the map.

## 3. Description

One line per item, exactly like this (upper or lower case both work):

```
Status: In progress
Deposit: OK
Permit: OK
Material: OK
Confirm48: SENT
Day: 1/2
Note: Gate code at the side door
```

| Line | Allowed values | Meaning on the board |
|---|---|---|
| `Status:` | `Scheduled`, `In progress`, `Issue`, `Done` or `Postponed` | The status chip and pin color. Missing line = Scheduled. `Issue` = red **Stopped** alert, with the `Note:` as the reason. |
| `Deposit:` | `OK` or `PENDING` | `PENDING` = red **Deposit** alert (D-003). Missing line = "Deposit unknown". |
| `Permit:` | `OK`, `PENDING` or `N/A` | `PENDING` on the next workday = **Permit** alert. |
| `Material:` | `OK` or `PENDING` | `PENDING` on the next workday = **Material** alert. |
| `Confirm48:` | `SENT` or `PENDING` | `PENDING` on the next workday = **Customer** alert (D-007). |
| `Day:` | `1/2`, `2/2`, `1/3`, ... | Shows "day 1 of 2" on the job card. |
| `Note:` | any short text | Shown in red on the job card, and as the reason when a job is stopped. |

Only `OK` counts as paid. "Paid", "yes" or "received" are not read as OK, so the board will ask for the event to be fixed.

## 4. Colors

Keep using colors to tell the crews apart, as today. The board does not read event colors.

To change a job's status on the TV, edit the `Status:` line, or use the **Job Status** screen on your phone (`/control`, with your username and password), which writes the same lines for you. The board picks it up within 5 minutes.

## 5. Times

A start and end time are best. All-day events also work; the board shows them as **All day**.

## Copy-paste template

```
Title:       <Customer> – <Service> <size>
Location:    <street>, <city>, FL <zip>
Description:
Status: Scheduled
Deposit: PENDING
Permit: PENDING
Material: PENDING
Confirm48: PENDING
Note:
```

Change each `PENDING` to `OK` (or `SENT`) as it happens.
