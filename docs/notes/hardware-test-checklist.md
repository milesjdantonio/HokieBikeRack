# Hardware bench test checklist

Work top to bottom. Each step only adds one new thing, so when something breaks
you know what caused it. Write results in the "Notes" column (or in the
PR) so they become part of the project record.

Serial monitor: `pio device monitor` (115200 baud) from `firmware/`.
Type commands + Enter.

## 0. Prep (laptop)
- [ ] `cd firmware && pio test -e native` → 37 tests pass.
- [ ] Copy `include/config.example.h` → `include/config.h`. Set `HBR_CARD_KEY`
      (`python -c "import secrets; print(secrets.token_hex(32))"`). Leave Wi-Fi empty for now.
- [ ] `pio run -t upload` with **only the ESP32** plugged in. Monitor shows
      "HokieBikeRack firmware 0.2.0 starting" and `[nfc] PN532 not found`, `[accel] … not found`. That's expected.
- [ ] Type `status`. Everything reads sensibly.

| Step | Pass? | Notes |
|---|---|---|

## 1. Lights + buzzer (USB unplugged while wiring)
- [ ] Wire LEDs and buzzer (wiring-guide.md). Power up.
- [ ] Boot: red+green flash with a beep, then green.
- [ ] Idle: a short **red** blip every 5 s (not ready: no card list yet). Expected.
- [ ] `tap 0011223344` → red + two beeps, log says `DENIED (NO_SNAPSHOT)`.
- [ ] `shake` → red blinks + 3 chirps (warning). `shake` again within 30 s (after 3 s) → flashing red + siren for 10 s.
- [ ] Buzzer too quiet/loud? Note it. Transistor getting hot? Check the leg order.

## 2. I2C sensors
- [ ] Set PN532 switches to I2C. Wire PN532 + MPU-6050 at **3.3 V**.
- [ ] `i2c-scan` → `0x24 (PN532)` and `0x68 (MPU-6050)`.
- [ ] Reboot. Log shows `[nfc] PN532 firmware 1.6` (or similar) and `[accel] WHO_AM_I = 0x..`.
- [ ] Tap each kit card: `[card] read a 4-byte card ID` (or 7). **Record the length per card type.**
- [ ] Hold a card on the reader: only ONE event (debounce). Remove and tap again after 2 s: a new event.
- [ ] `accel` with the board still: z ≈ ±1.0, x,y ≈ 0, deviation < 0.05 g.
- [ ] Tap the table, then shake the board: watch the deviation. Note typical "bump" vs "shake" numbers.
- [ ] Unplug the PN532 SDA wire for 5 s → `[nfc] reader stopped answering`. Plug back → `reader is back` (within ~15 s).

## 3. Network + dashboard
- [ ] Laptop **joined to the phone hotspot first** (2.4 GHz!), then start the backend
      (`mvn spring-boot:run -Dspring-boot.run.profiles=embedded`) and open http://localhost:8080 (no login in demo mode).
- [ ] Windows firewall: the JDK that runs the server needs an inbound allow rule. On 2026-11-02 there
      was one for `jdk-25.0.5` (Public). If Windows asks when the server starts, allow it.
- [ ] Dashboard → Racks → create rack → **Add device** → copy the snippet into `config.h`. The snippet
      now fills in `HBR_API_BASE_URL` with this laptop's address on its current Wi-Fi (never `localhost`,
      which on the ESP32 means the ESP32 itself). That's why the laptop joins the hotspot BEFORE you add
      the device. Add `HBR_WIFI_SSID/PASSWORD` and `HBR_CARD_KEY`. Re-flash.
- [ ] Not sure the laptop is reachable? From a phone on the same hotspot open
      `http://<laptop-ip>:8080/api/v1/health`; it should say `"status":"ok"`.
      Checked 2026-11-02 with the simulator over the Wi-Fi address: boot, card list, tap, alarm and
      heartbeat all reached the server.
- [ ] Monitor: `[net] Wi-Fi connected`, then a card list download. `status` shows clock set + card list.
- [ ] Dashboard: rack **ONLINE**, device health shows Reader OK / Accel OK / Clock set.
- [ ] Idle blip turns **green**.
- [ ] Tap a card → denied → appears under "Unknown cards tapped" → **Register** it for this rack.
- [ ] Within ~60 s (or type `sync`) tap again → **green + beep, simulated unlock**, event "Access granted".
- [ ] Revoke the card on the dashboard → `sync` → tap → denied.

## 4. Servo bench test (linkage DISCONNECTED)
- [ ] Wire servo to the **separate 5 V supply**, shared GND, capacitor across 5 V/GND.
- [ ] `config.h`: `HBR_ENABLE_SERVO 1`. Re-flash. Keep hands clear: it may jump at boot.
- [ ] Boot: servo moves to LOCKED angle. Allowed tap: moves to UNLOCKED, back after 5 s.
- [ ] Watch for resets while moving: a `DEVICE_BOOT` event with reset reason **BROWNOUT** = power problem.
- [ ] Find the real latch angles (change `HBR_SERVO_LOCKED_DEG`/`UNLOCKED_DEG`), avoid straining at the ends (buzzing = pushing past its limit).
- [ ] Unplug the 5 V supply mid-unlock: what does the latch do? (Write it down: this is the fail-safe/fail-secure behaviour of the mechanism.)
- [ ] Only then connect the linkage, with someone supervising.

## 5. Tamper calibration (mounted on the rack, if possible)
- [ ] Normal use (park, lock, remove bike) → no warnings (it's disarmed for 10 s after an unlock).
- [ ] Wind/bumps → no warnings. If there are, raise `thresholdG`.
- [ ] Deliberate prying/shaking → warning, then alarm if continued.
- [ ] Allowed card during an alarm → siren stops.

## 6. Failure tests
- [ ] Turn the hotspot off → registered card still works (offline mode). Events queue (`status`).
- [ ] Hotspot back on → backlog uploads (`[net] uploaded N event(s)`), no duplicates on the dashboard.
- [ ] Stop the backend (Ctrl+C) → rack keeps working; events wait; restart backend → they arrive.
- [ ] Power-cycle the ESP32 with the hotspot OFF → cards denied with `CLOCK_NOT_SET`. (Expected, KNOWNBUGS #3.) Hotspot on → works again.
- [ ] Unknown card, repeated taps, holding a card, two cards quickly: behaviour as expected?

## 7. Rider sign-up with a real Hokie Passport (in person)
Needs sections 2 and 3 done (rack online, card list syncing). Two people is easiest: one "rider"
with a phone, one "admin" at the laptop. Time: about 10 minutes.

**First, can the rack read a Hokie Passport at all?**
- [ ] Serial monitor open. Tap the HokieP 3 times. Each tap prints `[card] read a N-byte card ID`
      and `DENIED NOT_LISTED`, and the admin's Needs You shows the **same** card each time.
      If the card shows up as a different card on every tap, it uses a random ID (some DESFire
      cards do) and can't be linked this way: write that down and use a kit card for the rest.
- [ ] Nothing at all printed? The PN532 can't read that card type (e.g. HID iCLASS). Note it.

**Sign up, approve, link**
- [ ] Rider's phone on the **same hotspot**. Open `http://<laptop-ip>:8080/rider/` → My Card →
      **Request Access**: real name, VT email, Hokie Passport number. Page says "Request sent".
- [ ] Admin (laptop, `/admin/`): a toast and **Needs You → Access Requests** → Review → **Approve**
      (or type `approve <name>`). Within ~5 s the rider's phone says "You're approved".
- [ ] Rider stands at the rack, presses **Link My HokieP** (2-minute countdown), taps the HokieP.
      Rack: red light + two beeps (expected). Phone: "Hi, <name>" with "<name>'s HokieP".
      Admin: the card appears under Cards That Work Here with "Rider: <name>".
- [ ] Wait up to 60 s (or type `sync` in the serial monitor), tap again: **green + beep, lock opens**.
      Phone → My Card → Your Bike: "parked at <rack>". Rider map: that rack shows "Your bike".
- [ ] Shake the rack until the siren goes. Phone: red **"Alarm at <rack>, where your bike is"**
      banner + toast; the map pin is the slashed, pulsing red one. Admin: alarm in Needs You.
- [ ] Admin: Mark Handled (or police Resolved). Phone banner goes away within ~5 s.
- [ ] Tap the HokieP once more (leave): phone says "Not parked right now"; the rack's open spots go up.

**Edge cases worth one try each**
- [ ] Deny a request: the phone says it wasn't approved.
- [ ] Press Link, wait 2 minutes, tap: nothing links (window closed). Press Link again and it works.
- [ ] Two riders pressing Link at the same time: neither links (can't tell whose card it was). Retry one at a time.
- [ ] Rider clears their browser: My Card → Already Have a Rider Code? (or admin → card → New Rider Code).

## Record results
Add findings to `docs/HARDWARE_DECISIONS.md` (card type, angles, threshold, power notes)
and new bugs to `firmware/KNOWNBUGS.txt`.
