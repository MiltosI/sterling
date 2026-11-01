# Partly Parts API — sandbox

**Base URL:** `http://localhost:4000/v1` (or your Render address + `/v1`)
**Token:** `sbx_live_practice_9f2c41d7e8`
**Auth:** send the header `Authorization: Bearer <token>` on every request.
**Rate limit:** 30 requests per minute per token. Over the limit you get `429` with a `Retry-After` header (seconds).

## 1. Look up a vehicle
`GET /vehicles/lookup?registration=FY17KXN`

`registration` must be uppercase letters and digits with no spaces.

```json
{
  "registration": "FY17KXN",
  "matches": [
    {
      "vehicle_id": "veh_fiesta7",
      "make": "Ford", "model": "Fiesta", "generation": "Mk7.5",
      "variant": "1.0 EcoBoost Titanium", "year": 2017,
      "engine": "998cc petrol", "fuel": "Petrol",
      "body_type": "5-door hatchback", "colour": "Silver",
      "vin": "…"
    }
  ]
}
```
`matches` can contain more than one vehicle when the registration alone can't pin down the exact variant.

## 2. Parts that fit a vehicle
`GET /vehicles/{vehicle_id}/parts?category=lighting&page=1&page_size=20`

`category` is optional. `page_size` defaults to 20, maximum 50.

```json
{
  "vehicle_id": "veh_fiesta7",
  "page": 1, "page_size": 20, "total": 32, "next_page": 2,
  "parts": [
    {
      "partly_part_id": "PLY-FIE-011",
      "part_type": "headlamp",
      "name": "Headlamp, nearside (left)",
      "category": "lighting",
      "position": "nearside",
      "oe_numbers": ["H1BB-10K544-AC"]
    }
  ]
}
```
`oe_numbers` are the manufacturer's part numbers. The first is current; any others are older numbers for the same part.

Categories: `body`, `lighting`, `mirrors`, `cooling`, `electrical`, `engine`, `transmission`, `wheels`, `safety`.

## Errors
| Status | `error` | Meaning |
|---|---|---|
| 400 | `missing_registration` / `invalid_registration` | Bad input |
| 401 | `missing_token` / `invalid_token` | Auth problem |
| 404 | `vehicle_not_found` | Unknown registration or vehicle |
| 429 | `rate_limited` | Slow down, see `Retry-After` |
| 503 | `upstream_unavailable` | Temporary, retry later |

## Test registrations
`FY17KXN`, `GK18WPL`, `BV16HRT`, `LC19ZMA`, `MJ15TUE`, `YH20OPB`, `RX16DFV`, `WN18CJE`, `DE19ANK`, `SA17LHG`, `PO69RFK`, `KM67VYS`
