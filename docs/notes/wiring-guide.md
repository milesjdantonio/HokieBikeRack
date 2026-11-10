# Wiring guide (Arduino Uno R3)

> ⚠️ Double-check against your exact boards' silkscreen and datasheets. Pin
> numbers below are the labels printed on the Uno's headers (`~9`, `7`, `A4`…).
> Wire with USB **unplugged**.
>
> The old ESP32 wiring is in git: `git show esp32-final:docs/notes/wiring-guide.md`.

## Power plan
```
Laptop USB ──► Uno (powers the Uno, PN532, MPU-6050, LEDs via its 5V pin)
5 V supply ──► servo (+ buzzer if you like)
              └── GND of the 5 V supply ──► Uno GND   (shared ground: REQUIRED)
```
- Do **not** connect the external 5 V to the Uno's 5V or VIN pin while USB is
  plugged in (two supplies fighting). Only the grounds are joined.
- The Uno's 5V pin can't feed the servo: an MG90S can pull ~700 mA when it
  starts moving, and the dip resets the Uno.
- Put the **100–1000 µF capacitor** across the servo's 5 V and GND, close to
  the servo. Electrolytic caps have polarity: stripe/short leg = GND.

## I2C bus (PN532 + MPU-6050 share it)
| Uno | PN532 (I2C mode) | MPU-6050 (GY-521) |
|---|---|---|
| 5V | VCC | VCC |
| GND | GND | GND |
| A4 | SDA | SDA |
| A5 | SCL | SCL |
| 2 | IRQ (optional) | — |
| 3 | RSTO / RST (optional) | — |
| — | | INT, AD0, XDA, XCL: not connected |

- On the Uno R3, SDA/SCL also appear on the two unlabeled pins next to AREF.
  They're the same wires as A4/A5: use either, not both for different things.
- **PN532 mode switches** (red Elechouse-style V3 board): I2C = switch **1 ON,
  2 OFF**. Other boards differ; check the printed table. Power-cycle after changing.
- The Uno is a **5 V** board (the ESP32 was 3.3 V), so power both modules from
  **5V**. The PN532 V3 and the GY-521 both have their own 3.3 V regulator and
  accept 5 V on VCC.
- IRQ and RST are optional: the firmware reads the card over I2C either way.
- AD0 unconnected = address `0x68`. If AD0 is tied high, it becomes `0x69`
  (then change `kAddress` in `tamper_sensor.cpp`).
- Verify with the serial command **`i2c-scan`** → expect `0x24` and `0x68`.

## LEDs
```
Pin 5 ── 330 Ω ──► GREEN LED long leg (+)   short leg (−) ── GND
Pin 6 ── 330 Ω ──► RED LED long leg (+)     short leg (−) ── GND
```
The resistor limits current (~9 mA at 5 V with 330 Ω). No resistor = burnt LED or pin.
220 Ω also works (~14 mA).

## Active buzzer through an NPN transistor
```
                      Buzzer +  ── 5 V
                      Buzzer −  ── Collector (C)
Pin 7 ──── 1 kΩ ──── Base (B)
                      Emitter (E) ── GND
```
- Transistor leg order depends on the part (flat face toward you, legs down):
  **2N2222 (TO-92): E-B-C**, **S8050: E-B-C**, **BC547: C-B-E**. Check your datasheet!
- Optional: a diode (1N4148) across the buzzer, stripe toward +, to absorb voltage spikes.
- The buzzer's longer leg / "+" marking is positive.
- Pin HIGH → transistor on → beep.

## MG90S servo
| Servo wire | Goes to |
|---|---|
| Brown / black | GND (shared with the Uno) |
| Red | **+5 V external supply** |
| Orange / yellow (signal) | Pin 9 |

- The Uno's 5 V signal is what the MG90S expects.
- First test with **nothing attached to the horn**, and `HBR_ENABLE_SERVO 0`.
  Then set `1` and re-flash (see hardware-test-checklist.md).

## Full pin table
| Uno pin | Use |
|---|---|
| 2 | PN532 IRQ (optional) |
| 3 | PN532 reset (optional) |
| 5 | Green LED |
| 6 | Red LED |
| 7 | Buzzer transistor base (via 1 kΩ) |
| 9 | Servo signal |
| A4 | I2C SDA |
| A5 | I2C SCL |

Keep free: **0 and 1** (USB serial: the serial monitor and uploads use them)
and **13** (the bootloader blinks it at power-on, which would twitch a servo).
