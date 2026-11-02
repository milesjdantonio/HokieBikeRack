# Wiring guide (ESP32 DevKit)

> ⚠️ Double-check against your exact boards' silkscreen and datasheets. Pin
> numbers below are **GPIO numbers** (labels like `D21`/`G21`/`21` on the board),
> not physical pin positions. Wire with USB **unplugged**.

## Power plan
```
Laptop USB ──► ESP32 (powers ESP32, PN532, MPU-6050, LEDs via its 3V3 pin)
5 V supply ──► servo (+ buzzer if it's a 5 V buzzer)
              └── GND of the 5 V supply ──► ESP32 GND   (shared ground: REQUIRED)
```
- Do **not** connect the external 5 V to the ESP32's 5V/VIN pin while USB is
  plugged in (two supplies fighting). Only the grounds are joined.
- Put the **100–1000 µF capacitor** across the servo's 5 V and GND, close to
  the servo. Electrolytic caps have polarity: stripe/short leg = GND.

## I2C bus (PN532 + MPU-6050 share it)
| ESP32 | PN532 (I2C mode) | MPU-6050 (GY-521) |
|---|---|---|
| 3V3 | VCC | VCC |
| GND | GND | GND |
| GPIO 21 | SDA | SDA |
| GPIO 22 | SCL | SCL |
| — | IRQ, RSTO: not connected | INT, AD0, XDA, XCL: not connected |

- **PN532 mode switches** (red Elechouse-style V3 board): I2C = switch **1 ON,
  2 OFF**. Other boards differ; check the printed table. Power-cycle after changing.
- Power the PN532 from **3.3 V**: its on-board pull-up resistors go to VCC, so
  5 V would put 5 V on the ESP32's SDA/SCL pins.
- AD0 unconnected = address `0x68`. If AD0 is tied high, it becomes `0x69`
  (then change `kAddress` in `tamper_sensor.cpp`).
- Verify with the serial command **`i2c-scan`** → expect `0x24` and `0x68`.

## LEDs
```
GPIO 25 ── 220–330 Ω ──► GREEN LED long leg (+)   short leg (−) ── GND
GPIO 26 ── 220–330 Ω ──► RED LED long leg (+)     short leg (−) ── GND
```
The resistor limits current (~5–8 mA at 3.3 V). No resistor = burnt LED or GPIO.

## Active buzzer through an NPN transistor
```
                      Buzzer +  ── 5 V (or 3.3 V if it's a 3 V buzzer)
                      Buzzer −  ── Collector (C)
GPIO 27 ── 1 kΩ ──── Base (B)
                      Emitter (E) ── GND
```
- Transistor leg order depends on the part (flat face toward you, legs down):
  **2N2222 (TO-92): E-B-C**, **S8050: E-B-C**, **BC547: C-B-E**. Check your datasheet!
- Optional: a diode (1N4148) across the buzzer, stripe toward +, to absorb voltage spikes.
- The buzzer's longer leg / "+" marking is positive.
- GPIO HIGH → transistor on → beep.

## MG90S servo
| Servo wire | Goes to |
|---|---|
| Brown / black | GND (shared with ESP32) |
| Red | **+5 V external supply** |
| Orange / yellow (signal) | GPIO 13 |

- 3.3 V signal is normally enough for MG90S. If it jitters, try a shorter wire.
- First test with **nothing attached to the horn**, and `HBR_ENABLE_SERVO 0`.
  Then set `1` and re-flash (see hardware-test-checklist.md).

## Full pin table
| GPIO | Use |
|---|---|
| 13 | Servo signal |
| 21 | I2C SDA |
| 22 | I2C SCL |
| 25 | Green LED |
| 26 | Red LED |
| 27 | Buzzer transistor base (via 1 kΩ) |
Avoid 0, 2, 5, 12, 15 (boot "strapping" pins) and 34–39 (input-only) for outputs.
