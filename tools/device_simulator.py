#!/usr/bin/env python3
"""
HokieBikeRack device simulator: pretends to be an ESP32 rack so you can demo
and test the backend + dashboard with NO hardware.

It uses the exact same API, device token, HMAC card references and access
rules as the real firmware. Every event it sends is tagged "simulated": true,
so the dashboard shows a SIM badge and you never confuse it with real data.

Only uses the Python standard library (no pip install needed).

Quick start (backend running on http://localhost:8080):
    python tools/device_simulator.py setup --admin-password <pw>      # makes a rack + device
    python tools/device_simulator.py demo  --admin-password <pw>      # scripted story
    python tools/device_simulator.py tap 04a1b2c3d4                   # one card tap
    python tools/device_simulator.py shake [--alarm]                  # tamper
    python tools/device_simulator.py online                           # heartbeat loop (Ctrl+C to stop)

The device ID/token are saved in tools/.sim-device.json (git-ignored).
See docs/notes/overview.md for how this maps onto the real firmware.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

# HBR_SIM_DEVICE_FILE lets one laptop pretend to be several racks (one file per rack).
STATE_FILE = Path(os.environ.get("HBR_SIM_DEVICE_FILE") or Path(__file__).with_name(".sim-device.json"))
DEFAULT_URL = os.environ.get("HBR_API_BASE_URL", "http://localhost:8080")
# Must equal HBR_CARD_KEY in firmware/include/config.h if you want real cards
# and simulated taps to produce the same references.
DEFAULT_CARD_KEY = os.environ.get("HBR_CARD_KEY", "dev-only-card-key-change-me-0123456789")
FIRMWARE_VERSION = "sim-0.2.0"
START = time.monotonic()


# ---------------------------------------------------------------- helpers

def credential_ref(card_key: str, uid_hex: str) -> str:
    """Same formula as firmware/src/credential_ref.cpp."""
    message = ("hbr-card-v1:" + uid_hex.lower()).encode()
    return hmac.new(card_key.encode(), message, hashlib.sha256).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def request(method, url, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            text = resp.read().decode()
            return resp.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, text
    except urllib.error.URLError as e:
        sys.exit(f"Can't reach {url}: {e.reason}. Is the backend running?")


def admin_headers(args):
    # No password = the server's demo mode (website login off), which needs no Authorization.
    if not args.admin_password:
        return {}
    token = base64.b64encode(f"{args.admin_user}:{args.admin_password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def load_state():
    if not STATE_FILE.exists():
        sys.exit("No simulated device yet. Run: python tools/device_simulator.py setup --admin-password <pw>")
    return json.loads(STATE_FILE.read_text())


class Device:
    """A fake ESP32: same endpoints, same token, same local access decision."""

    def __init__(self, url, state, card_key):
        self.url = url.rstrip("/")
        self.id = state["deviceId"]
        self.token = state["deviceToken"]
        self.card_key = card_key
        self.snapshot = None

    def _api(self, method, endpoint, body=None):
        return request(method, f"{self.url}/api/v1/devices/{self.id}/{endpoint}", body,
                       {"Authorization": f"Bearer {self.token}"})

    def heartbeat(self):
        status, body = self._api("POST", "heartbeat", {
            "firmwareVersion": FIRMWARE_VERSION,
            "uptimeMs": int((time.monotonic() - START) * 1000),
            "wifiRssi": -55, "freeHeap": 180000, "queueDepth": 0,
            "snapshotRevision": (self.snapshot or {}).get("revision", 0),
            "snapshotCardCount": len((self.snapshot or {}).get("credentialReferences", [])),
            "clockSynced": True, "lockUnlocked": False, "alarmActive": False,
            "readerOk": True, "accelOk": True, "servoEnabled": False, "simulated": True,
        })
        if status != 200:
            sys.exit(f"Heartbeat failed ({status}): {body}. Wrong token? Re-run setup.")

    def fetch_snapshot(self):
        status, body = self._api("GET", "authorization-snapshot")
        if status != 200:
            sys.exit(f"Snapshot failed ({status}): {body}")
        old = (self.snapshot or {}).get("revision", -1)
        if body["revision"] < old:
            print("  ! server sent an older revision; ignored (rollback protection)")
            return
        self.snapshot = body
        print(f"  card list: revision {body['revision']}, {body['credentialCount']} card(s), valid until {body['validUntil']}")

    def send(self, event_type, severity, details):
        details = dict(details, simulated=True)
        event = {"id": str(uuid.uuid4()), "deviceId": self.id, "eventType": event_type, "severity": severity,
                 "occurredAt": now_iso(), "uptimeMs": int((time.monotonic() - START) * 1000),
                 "details": details, "firmwareVersion": FIRMWARE_VERSION}
        status, body = self._api("POST", "events", {"events": [event]})
        if status != 200:
            sys.exit(f"Event upload failed ({status}): {body}")
        return event

    def tap(self, uid_hex):
        """Mirror of handleCard() in firmware/src/main.cpp + decideAccess()."""
        if self.snapshot is None:
            self.fetch_snapshot()
        ref = credential_ref(self.card_key, uid_hex)
        snap = self.snapshot
        if time.time() >= snap["validUntilEpoch"]:
            allowed, reason = False, "SNAPSHOT_EXPIRED"
        elif ref in snap["credentialReferences"]:
            allowed, reason = True, None
        else:
            allowed, reason = False, "NOT_LISTED"
        details = {"credentialReference": ref}
        if allowed:
            self.send("ACCESS_GRANTED", "INFO", details)
            print(f"  tap {uid_hex}: GRANTED  (green LED + beep, lock opens 5 s)   ref {ref[:12]}...")
        else:
            details["reason"] = reason
            self.send("ACCESS_DENIED", "LOW", details)
            print(f"  tap {uid_hex}: DENIED {reason}  (red LED + two beeps)   ref {ref[:12]}...")
        return allowed, ref

    def shake(self, alarm=False):
        if alarm:
            self.send("TAMPER_ALARM", "HIGH", {"deviationG": 1.31, "thresholdG": 0.35})
            print("  shake: TAMPER_ALARM  (flashing red + 10 s siren)")
        else:
            self.send("TAMPER_WARNING", "MEDIUM", {"deviationG": 0.62, "thresholdG": 0.35})
            print("  shake: TAMPER_WARNING  (red blinks + quick chirps)")


# ---------------------------------------------------------------- commands

def cmd_setup(args):
    headers = admin_headers(args)
    body = {"name": args.rack_name, "locationDescription": args.location}
    if args.lat is not None and args.lng is not None:
        body.update(latitude=args.lat, longitude=args.lng)  # puts the rack on the app's map
    status, rack = request("POST", f"{args.url}/api/v1/racks", body, headers)
    if status != 201:
        sys.exit(f"Creating rack failed ({status}): {rack}")
    rack_id = rack["rack"]["id"]
    status, dev = request("POST", f"{args.url}/api/v1/racks/{rack_id}/devices",
                          {"label": "Simulated ESP32"}, headers)
    if status != 201:
        sys.exit(f"Adding device failed ({status}): {dev}")
    STATE_FILE.write_text(json.dumps({"rackId": rack_id, "deviceId": dev["device"]["id"],
                                      "deviceToken": dev["deviceToken"]}, indent=2))
    print(f"Created rack '{args.rack_name}' with a simulated device. Saved to {STATE_FILE.name}.")
    d = Device(args.url, load_state(), args.card_key)
    d.send("DEVICE_BOOT", "INFO", {"resetReason": "POWER_ON", "servoEnabled": False, "readerOk": True, "accelOk": True})
    d.heartbeat()
    d.fetch_snapshot()
    print("The rack should now show ONLINE on the dashboard.")


def cmd_tap(args):
    d = Device(args.url, load_state(), args.card_key)
    d.fetch_snapshot()
    d.heartbeat()
    d.tap(args.uid)


def cmd_shake(args):
    d = Device(args.url, load_state(), args.card_key)
    d.heartbeat()
    d.shake(alarm=args.alarm)


def cmd_online(args):
    d = Device(args.url, load_state(), args.card_key)
    print("Sending a heartbeat + card list download every 60 s. Ctrl+C to stop.")
    try:
        while True:
            d.heartbeat()
            d.fetch_snapshot()
            time.sleep(60)
    except KeyboardInterrupt:
        print("stopped")


def cmd_demo(args):
    """A scripted story for presentations. Each step pauses so you can watch the dashboard."""
    headers = admin_headers(args)
    state = load_state()
    d = Device(args.url, state, args.card_key)
    pause = lambda: time.sleep(args.pause)
    rider_uid = args.uid

    print("1) Rack boots and checks in")
    d.send("DEVICE_BOOT", "INFO", {"resetReason": "POWER_ON", "servoEnabled": False, "readerOk": True, "accelOk": True})
    d.heartbeat()
    d.fetch_snapshot()
    pause()

    print("2) A new rider taps their card -> unknown, so denied")
    allowed, ref = d.tap(rider_uid)
    pause()

    if not allowed:
        print("3) Admin registers that card (what clicking 'Register' on the dashboard does)")
        status, body = request("POST", f"{args.url}/api/v1/credentials", {
            "credentialReference": ref, "displayLabel": args.rider_name,
            "allRacks": False, "rackIds": [state["rackId"]]}, headers)
        if status not in (201, 409):
            sys.exit(f"Register failed ({status}): {body}")
        print(f"  registered '{args.rider_name}'")
        print("   ...rack downloads the new card list (normally within ~60 s)")
        d.fetch_snapshot()
        pause()

    print("4) Rider taps again -> allowed")
    d.tap(rider_uid)
    pause()

    print("5) A stranger taps a random card -> denied")
    d.tap(uuid.uuid4().hex[:8])
    pause()

    print("6) Someone shakes the rack -> warning, then keeps going -> alarm")
    d.shake(alarm=False)
    pause()
    d.shake(alarm=True)
    d.heartbeat()
    print("Done. Check the Overview, Events and App preview pages.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default=DEFAULT_URL, help=f"backend base URL (default {DEFAULT_URL})")
    p.add_argument("--card-key", default=DEFAULT_CARD_KEY, help="same as HBR_CARD_KEY on the racks")
    p.add_argument("--admin-user", default=os.environ.get("ADMIN_USERNAME", "admin"))
    p.add_argument("--admin-password", default=os.environ.get("ADMIN_PASSWORD"))
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("setup", help="create a rack + simulated device")
    s.add_argument("--rack-name", default="Demo Rack (simulated)")
    s.add_argument("--location", default="Squires Student Center, north side")
    # Approximate spot outside Squires Student Center, Virginia Tech.
    s.add_argument("--lat", type=float, default=37.2297)
    s.add_argument("--lng", type=float, default=-80.4185)
    s.set_defaults(fn=cmd_setup)

    t = sub.add_parser("tap", help="tap a card with this UID (hex)")
    t.add_argument("uid")
    t.set_defaults(fn=cmd_tap)

    sh = sub.add_parser("shake", help="send a tamper event")
    sh.add_argument("--alarm", action="store_true", help="send the ALARM (second stage) instead of a warning")
    sh.set_defaults(fn=cmd_shake)

    o = sub.add_parser("online", help="keep the device online (heartbeat every 60 s)")
    o.set_defaults(fn=cmd_online)

    dm = sub.add_parser("demo", help="scripted demo story")
    dm.add_argument("--uid", default="04a1b2c3d4e5f6", help="rider card UID (hex)")
    dm.add_argument("--rider-name", default="Demo rider")
    dm.add_argument("--pause", type=float, default=2.0, help="seconds between steps")
    dm.set_defaults(fn=cmd_demo)

    args = p.parse_args()
    args.url = args.url.rstrip("/")
    args.fn(args)


if __name__ == "__main__":
    main()
