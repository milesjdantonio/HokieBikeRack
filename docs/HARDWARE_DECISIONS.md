# Hardware decisions and open questions

Wiring: [notes/wiring-guide.md](notes/wiring-guide.md). Bench test: [notes/hardware-test-checklist.md](notes/hardware-test-checklist.md).

## Board change (2026-11-10)
The rack now runs on an **Arduino Uno R3** instead of an ESP32 DevKit. The Uno
has no Wi-Fi, 2 KB of RAM and 32 KB of flash, so the firmware works offline:
cards are enrolled at the rack and kept in EEPROM (up to 63), and events are
printed to the serial monitor. The ESP32 version is the git tag `esp32-final`.

## Confirmed (2026-11-02, board updated 2026-11-10)
| Part | Decision |
|---|---|
| Board | **Arduino Uno R3** (ATmega328P, 5 V, 16 MHz). Was an ESP32 DevKit until 2026-11-10. |
| NFC | PN532 kit, **I2C mode**, address 0x24, powered at 5 V (from the Uno). Library: Adafruit PN532 1.3.x. |
| Accelerometer | **MPU-6050 on a GY-521 board**, I2C 0x68, ±4 g, 44 Hz low-pass. Own register driver. |
| Actuator | MG90S servo on a **separate 5 V supply**, shared ground, 100–1000 µF capacitor. Arduino Servo library. **Disabled by default** (`HBR_ENABLE_SERVO 0`). |
| Lights | Separate **red + green LEDs** with 220–330 Ω resistors. |
| Sound | Buzzer switched by an NPN transistor (2N2222/BC547/S8050) with a 1 kΩ base resistor. The prototype's buzzer is **passive** (`HBR_BUZZER_PASSIVE 1`: the Uno plays a tone); an active one (`0`, on/off) also works. |
| Lock behaviour | Tap to unlock, the same card taps again to lock. Reminder (green stays on, red flashes, beep) after 10 s; re-locks itself after 120 s. |
| Card list | Enrolled at the rack (`enroll` + tap), saved in EEPROM. No network. |

## Pin map (Uno R3)
| Pin | Use |
|---|---|
| A4 / A5 | I2C SDA / SCL (PN532 + MPU-6050) |
| 2 / 3 | PN532 IRQ / reset (optional) |
| 9 | Servo signal |
| 5 | Green LED |
| 6 | Red LED |
| 7 | Buzzer transistor base |
Defined in `firmware/include/pins.h`. Keeps 0/1 (USB serial) and 13 (blinks at boot) free.

## PN532 and cards
- A card UID can be cloned; UID matching is a prototype convenience. The firmware hashes
  the UID with a secret key (HMAC) so the raw ID is never stored or transmitted.
- To record during the bench test: card UID length (4 = likely MIFARE Classic, 7 = likely NTAG/Ultralight), reader firmware version.
- Don't log raw card identifiers (the firmware prints only the ID length and a reference prefix).

## Servo safety
- Never power the servo from the Uno's 5V pin. Separate 5 V supply, grounds joined.
- First tests with the linkage disconnected. The servo may jump at boot.
- No position feedback: commanded angle is not proof of engagement.
- Record: locked/unlocked angles, behaviour on power loss mid-unlock, any brownout resets.

## Accelerometer
- Default threshold 0.30 g over 3 samples at 50 Hz; warning → alarm within 30 s.
- Disarmed while unlocked and 10 s after. Never moves the lock.
- Record: typical deviation for normal bumps vs deliberate shaking once mounted.

## Results (fill in after the bench test)
| Item | Result |
|---|---|
| Uno board (genuine / clone, USB chip) | Clone with a CH340 USB chip. Its COM port changes with the USB socket (COM3, COM5, COM6 so far). |
| PN532 firmware version | not recorded yet (`status` prints it) |
| Card UID lengths / types | not recorded yet. Two kit cards enrolled and working. Phones send a random ID each tap, so they can't be used. |
| MPU-6050 WHO_AM_I | answers (0.97 g at rest, mostly on the y axis as mounted) |
| Servo locked/unlocked angles | LOCKED 130 / UNLOCKED 65 in config.h, servo upside down (`HBR_SERVO_REVERSED 1`) = 50° / 115° on the servo |
| Tamper threshold chosen | 0.30 g |
| Power notes (brownouts?) | A dip on 5 V (servo, buzzer) can restart the MPU-6050 asleep; the firmware now checks every 2 s and wakes it. Over I2C the PN532 held the bus, so the reader runs over UART. A faint buzzer turned out to be loose wires. |
