# Hardware decisions and open questions

## Confirmed / reported by team
- Board family: standard ESP32 development board; exact model/revision still to be confirmed.
- NFC: PN532 reader and NFC cards supplied together in a kit. Exact kit, card type, and supported authentication features are not yet identified.
- Actuator: MG90S 9 g metal-gear hobby servo.
- Motion/tamper sensing: a 3-axis accelerometer; exact module and chip are not yet identified.
- First target: local development/demo.
- Contributors: multiple teammates.

## PN532 and cards
Before choosing software libraries or claiming security, identify the exact reader board and card type from the kit listing/packaging. PN532 can interact with several NFC technologies, but not every card exposes the same data or authentication capabilities. A card UID may be cloneable; do not treat UID-only checks as strong authentication.
- Choose I2C or SPI after checking the exact breakout's jumpers and documentation.
- Record voltage/logic levels, pin mapping, and library version.
- Start with read-only diagnostics using non-sensitive test cards.
- Do not log raw card identifiers in committed logs or screenshots.

## MG90S servo — wiring and mechanical safety
- Do not power the servo from an ESP32 GPIO. The GPIO is only a control signal.
- Use a suitable regulated supply sized for servo peak/stall current; connect supply ground and ESP32 ground together when appropriate to the selected circuit.
- Verify the exact servo supply voltage/current requirements and the ESP32 board's logic compatibility before wiring.
- Use a mechanically unloaded bench test first, with the linkage disconnected. Servo position is not proof that the rack is physically locked.
- Define a safe mechanical position, travel limits, startup behavior, unlock duration, and manual release. Test reset, brownout, power loss, jam, and signal loss.
- Do not attach the servo to a real bicycle/rack until the linkage cannot pinch, bind, damage the rack, or trap a bicycle, and the fail-safe behavior has been reviewed.
- Keep actuator output disabled in the current firmware scaffold.

## 3-axis accelerometer
The exact module/chip is still required to select the driver and bus. Confirm whether the board uses I2C or SPI, voltage/logic levels, range, sample rate, and interrupt support. Begin with raw sample logging and calibration while the mechanism is stationary and during controlled taps.
- Establish a baseline and filter/debounce thresholds to limit false alarms.
- Detect candidate events in firmware; send timestamp, sensor summary, and severity to the event queue.
- Sensor events should not directly command servo movement.
- Test normal handling, wind/bumps, mounting looseness, power cycling, and sensor disconnects before relying on alerts.

## Pin map
No pins are prescribed yet. Confirm exact ESP32 variant and both module breakouts before choosing pins. Avoid ESP32 boot-strapping pins for signals that may be pulled to the wrong level during reset; record the final map in firmware configuration and a wiring diagram.
