# Wiring guide (Arduino Uno R3)

> ⚠️ Double-check against your exact boards' silkscreen and datasheets. Pin
> numbers below are the labels printed on the Uno's headers (`~9`, `7`, `A4`…).
> Wire with USB **unplugged**.
>
> The old ESP32 wiring is in git: `git show esp32-final:docs/notes/wiring-guide.md`.

## Power plan
```
Laptop USB ──► Uno 5V pin ──► rails ──► PN532, MPU-6050, buzzer, servo
```
- **Servo on the Uno's 5V (our build, OK'd by the lab ULA for a small MG90S).** It works
  on the bench, but an MG90S can pull ~0.7–1 A for a moment when it starts or strains,
  and USB gives ~0.5 A. A big dip restarts the Uno (it boots LOCKED) or knocks the
  sensors off I2C.
- Put the **100–1000 µF capacitor** across the servo's 5 V and GND, close to the servo.
  It covers those short spikes. Electrolytic caps have polarity: stripe/short leg = GND.
- **Fallback: separate 5 V supply** (5 V ⎓ 2 A adapter, or 4×AA NiMH). Use it if the
  start-up messages reappear in the serial monitor when the servo moves, or the sensors
  drop out. Then the servo's red wire goes to the supply's + only; the supply's − joins
  the Uno's GND (shared ground: required). Never connect the supply's + to the Uno's 5V
  or VIN, or to the rails.

## PN532 NFC reader: UART (our build)
Set `HBR_READER_UART 1` in `config.h` and the reader's switches to **both OFF** (HSU/UART).

| Uno | PN532 header (front label / back label) |
|---|---|
| 5V | VCC |
| GND | GND |
| 2 | SDA / **TXD** (reader sends) |
| 3 | SCL / **RXD** (reader receives) |

- The startup log should say `[nfc] PN532 firmware 1.6 (UART)`. "Not answering"? Swap the
  wires on pins 2 and 3, and check the switches.
- **Why not I2C:** on the bench our reader answered over I2C (version, setup) but held the
  clock line low for good the moment it switched its antenna on to look for a card, which
  also knocked the MPU-6050 off the bus. Over UART the same board reads cards reliably.
- The firmware uses SoftwareSerial on D2/D3 and switches the reader from 115200 to 38400 baud
  at startup (SoftwareSerial drops bits at 115200).
- I2C mode is still in the firmware (`HBR_READER_UART 0`, switches 1 ON 2 OFF, SDA → A4,
  SCL → A5) for a reader that behaves.

## I2C bus (MPU-6050)
| Uno | MPU-6050 (GY-521) |
|---|---|
| 5V | VCC |
| GND | GND (its own Uno GND pin) |
| A4 | SDA |
| A5 | SCL |
| — | INT, AD0, XDA, XCL: not connected |

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
- Put a **100–1000 µF capacitor across the bottom rails right by the MPU-6050** (column 17,
  stripe on the − rail). It smooths the dips and spikes the buzzer and servo put on the rail.
- Give the MPU-6050 its **own wire to a Uno GND pin** (the Uno has three), not the ground
  rail the LEDs and buzzer use. On the bench it dropped off the bus every time the buzzer
  sounded while it shared that ground. Keep SDA/SCL away from the buzzer wires.
- **Solder the header pins** on both modules. Loose pins pushed through the holes held the
  bus down on the bench (`i2c-scan` slow, nothing found; before the I2C timeout fix the Uno
  froze at boot). Each module's power LED must be steady before you look at SDA/SCL.
- Verify with the serial command **`i2c-scan`** → expect `0x68` (and `0x24` only if the reader is in I2C mode). A healthy scan
  takes well under a second; ~3 s means something is holding SDA or SCL low.

## LEDs
```
Pin 5 ── 330 Ω ──► GREEN LED long leg (+)   short leg (−) ── GND
Pin 6 ── 330 Ω ──► RED LED long leg (+)     short leg (−) ── GND
```
The resistor limits current (~9 mA at 5 V with 330 Ω). No resistor = burnt LED or pin.
220 Ω also works (~14 mA).

**Light tubing around the post.** Wrap the tubing around the top of the post and push one
end over the green LED and the other over the red LED, so the whole tube shows the colour
(both on at boot = amber). Seal each joint with heat-shrink so outside light doesn't leak
in. At about 9 mA (330 Ω at 5 V) a 5 mm LED lights a short tube well but fades along a long one: test the
length first. If it's too dim, use high-brightness LEDs; don't just lower the resistor
below 220 Ω (an Uno pin is good for about 20 mA; 40 mA is its absolute limit).

## Buzzer through an NPN transistor
```
                      Buzzer +  ── 5 V
                      Buzzer −  ── Collector (C)
Pin 7 ──── 1 kΩ ──── Base (B)
                      Emitter (E) ── GND
```
- Transistor leg order depends on the part (flat face toward you, legs down):
  **2N2222 (TO-92): E-B-C**, **S8050: E-B-C**, **BC547: C-B-E**. Check your datasheet!
- **Required: a diode (1N4148 or 1N4001) across the buzzer, stripe toward +.** Each time the
  buzzer switches off it kicks a spike into the 5 V line. On the bench that knocked the
  MPU-6050 off I2C after every beep (tamper sensor blind ~10 s), even with its own GND wire.
  Breadboard: plain end in `c26`, stripe in `c29`.
- The buzzer's longer leg / "+" marking is positive.
- **Active** buzzer (beeps on plain 5 V): pin HIGH → transistor on → beep.
  Keep `HBR_BUZZER_PASSIVE 0` in `config.h`.
- **Passive** buzzer (only clicks on plain 5 V; ours is one): set `HBR_BUZZER_PASSIVE 1`
  and the firmware plays a tone on pin 7 (`HBR_BUZZER_TONE_HZ`, default 2700 Hz).

## MG90S servo
| Servo wire | Goes to |
|---|---|
| Brown / black | GND (shared with the Uno) |
| Red | **5 V**: the Uno's 5V rail (or the external supply's +, if you need the fallback) |
| Orange / yellow (signal) | Pin 9 |

- The Uno's 5 V signal is what the MG90S expects.
- First test with **nothing attached to the horn**, and `HBR_ENABLE_SERVO 0`.
  Then set `1` and re-flash (see hardware-test-checklist.md).

## Full pin table
| Uno pin | Use |
|---|---|
| 2 | PN532 TXD (UART mode; IRQ in I2C mode, optional) |
| 3 | PN532 RXD (UART mode; reset in I2C mode, optional) |
| 5 | Green LED |
| 6 | Red LED |
| 7 | Buzzer transistor base (via 1 kΩ) |
| 9 | Servo signal |
| A4 | I2C SDA |
| A5 | I2C SCL |

Keep free: **0 and 1** (USB serial: the serial monitor and uploads use them)
and **13** (the bootloader blinks it at power-on, which would twitch a servo).
