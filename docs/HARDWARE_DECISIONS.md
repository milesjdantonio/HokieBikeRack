# Hardware decisions and open questions

Wiring: [notes/wiring-guide.md](notes/wiring-guide.md). Bench test: [notes/hardware-test-checklist.md](notes/hardware-test-checklist.md).

## Confirmed (2026-11-02)
| Part | Decision |
|---|---|
| Board | Standard ESP32 DevKit (`esp32dev`, ESP32-WROOM-32). Exact revision: record during bench test. |
| NFC | PN532 kit, **I2C mode**, address 0x24, powered at 3.3 V. Library: Adafruit PN532 1.3.x. |
| Accelerometer | **MPU-6050 on a GY-521 board**, I2C 0x68, ±4 g, 44 Hz low-pass. Own register driver. |
| Actuator | MG90S servo on a **separate 5 V supply**, shared ground, 100–1000 µF capacitor. ESP32Servo library. **Disabled by default** (`HBR_ENABLE_SERVO 0`). |
| Lights | Separate **red + green LEDs** with 220–330 Ω resistors. |
| Sound | **Active buzzer** switched by an NPN transistor (2N2222/BC547/S8050) with a 1 kΩ base resistor. |
| Lock behaviour | Momentary: unlock 5 s, auto re-lock. |
| Demo network | Phone hotspot (2.4 GHz WPA2-Personal). |

## Pin map
| GPIO | Use |
|---|---|
| 21 / 22 | I2C SDA / SCL (PN532 + MPU-6050) |
| 13 | Servo signal |
| 25 | Green LED |
| 26 | Red LED |
| 27 | Buzzer transistor base |
Defined in `firmware/include/pins.h`. All avoid strapping pins (0, 2, 5, 12, 15) and input-only pins (34–39).

## PN532 and cards
- A card UID can be cloned; UID matching is a prototype convenience. The firmware hashes
  the UID with a secret key (HMAC) so the raw ID is never stored or transmitted.
- To record during the bench test: card UID length (4 = likely MIFARE Classic, 7 = likely NTAG/Ultralight), reader firmware version.
- Don't log raw card identifiers (the firmware prints only the ID length and a reference prefix).

## Servo safety
- Never power the servo from an ESP32 pin. Separate 5 V supply, grounds joined.
- First tests with the linkage disconnected. The servo may jump at boot.
- No position feedback: commanded angle is not proof of engagement.
- Record: locked/unlocked angles, behaviour on power loss mid-unlock, any brownout resets.

## Accelerometer
- Default threshold 0.35 g over 3 samples at 50 Hz; warning → alarm within 30 s.
- Disarmed while unlocked and 10 s after. Never moves the lock.
- Record: typical deviation for normal bumps vs deliberate shaking once mounted.

## Results (fill in after the bench test)
| Item | Result |
|---|---|
| ESP32 board model/revision | |
| PN532 firmware version | |
| Card UID lengths / types | |
| MPU-6050 WHO_AM_I | |
| Servo locked/unlocked angles | |
| Tamper threshold chosen | |
| Power notes (brownouts?) | |
