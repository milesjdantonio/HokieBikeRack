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
| 5V (perfboard build: ICSP pin 2) | VCC |
| GND (perfboard build: ICSP pin 6) | GND |
| 2 | SDA / **TXD** (reader sends) |
| 3 | SCL / **RXD** (reader receives) |

- **Perfboard build:** the board's jumpers take the Uno's 5V pin, so power the reader from the
  **ICSP header** instead (the 2×3 pins at the Uno's right edge, by the big chip). Pin 1 is
  marked with a dot or "1"; with the header the right way up, the pinout is
  `1 MISO · 2 5V · 3 SCK · 4 MOSI · 5 RESET · 6 GND`. Use **only pins 2 and 6**: the
  others are the chip's programming lines, and 5 (RESET) to GND holds the Uno in reset.
  Female jumper leads push straight onto the pins.

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

## Card buttons (add / remove)
The shield's two push buttons add and remove cards without a laptop. Set
`HBR_ENABLE_CARD_BUTTONS 1` in `config.h`.

| Button | One side | Other side |
|---|---|---|
| ADD | A0 | GND |
| REMOVE | A1 | GND |

- No resistors: the firmware turns on the Uno's internal pull-ups, so a pin reads HIGH until
  its button joins it to GND.
- Proto shield build: all three GND sockets are taken, so link `f15 → f12` (column 15 is the
  servo's ground) and use `g12` (REMOVE) and `h12` (ADD) as the ground side. Perfboard build:
  wire the buttons straight to A0/A1 and the Uno's third GND pin.
- Check the shield first: some join one side of a button to GND or 5V already. Beeps to GND?
  Skip that ground wire. Beeps to 5V? Don't use it on A0/A1 as it is.
- Use: press ADD (both LEDs flash, one beep), then tap the card within 15 s. Green + beep =
  added. REMOVE is the same and ends red with two beeps.
- Anyone who can reach the buttons can add a card: keep them inside the post, or set
  `HBR_ENABLE_CARD_BUTTONS 0` on the finished rack.

## Final build: soldered perfboard (18 × 14 holes, ~48 × 38 mm)
The half-size breadboard (~83 × 55 mm) doesn't fit in the rack. The same circuit goes on a piece
of perfboard. Holes are (column, row) from the parts side: column 1 = left edge, row 1 = top edge.
The interactive guide has the hole-by-hole picture, including a mirrored solder-side view.

| Part | Holes |
|---|---|
| R1 330 Ω (green) | 3,2 → 3,6 |
| R2 330 Ω (red) | 5,2 → 5,6 |
| R3 1 kΩ (buzzer) | 7,2 → 7,6 |
| Q1 2N2222 | E 6,8 · B 7,8 · C 8,8 (flat face toward the bottom edge) |
| Buzzer | − 10,11 · + 13,11 |
| Diode | underside, across the buzzer pins, stripe at 13,11 |
| C1 / C2 100–470 µF | + 16,12 − 16,13 / + 15,12 − 15,13 |

Underside wires (none cross):
- GND: column 1 rows 1–14, then row 14 to column 17; plus 2,7→1,7 · 4,9→1,9 · 6,8→6,10→1,10 ·
  15,13→15,14 · 16,13→16,14 · 17,13→17,14
- 5V: column 18 rows 1–13; plus 17,2→18,2 · 13,11→13,12→18,12
- D5: 3,1→3,2 and 3,6→3,7 · D6: 5,1→5,2 and 5,6→5,9 · D7: 7,1→7,2 and 7,6→7,8
- Buzzer −: 8,8→8,11→10,11 · D9: 12,1→12,9→17,9→17,11
- MPU: GND 16,1→16,3→17,3 · SCL 15,1→15,4→17,4 · SDA 14,1→14,5→17,5

Pins: inputs on row 1 (1 GND, 3 ~5, 5 ~6, 7 D7, 12 ~9, 14 A4, 15 A5, 16 second GND for the MPU,
18 5V); green LED − 2,7 / + 3,7; red LED − 4,9 / + 5,9; servo orange 17,11, red 17,12, brown 17,13;
MPU VCC 17,2, GND 17,3, SCL 17,4, SDA 17,5. The NFC reader stays wired straight to the Uno.

## Full pin table
| Uno pin | Use |
|---|---|
| 2 | PN532 TXD (UART mode; IRQ in I2C mode, optional) |
| 3 | PN532 RXD (UART mode; reset in I2C mode, optional) |
| 5 | Green LED |
| 6 | Red LED |
| 7 | Buzzer transistor base (via 1 kΩ) |
| 9 | Servo signal |
| A0 | ADD card button (to GND) |
| A1 | REMOVE card button (to GND) |
| A4 | I2C SDA |
| A5 | I2C SCL |

Keep free: **0 and 1** (USB serial: the serial monitor and uploads use them)
and **13** (the bootloader blinks it at power-on, which would twitch a servo).
