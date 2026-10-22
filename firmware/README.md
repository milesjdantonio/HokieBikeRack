# ESP32 firmware

C++ / PlatformIO scaffold for a standard ESP32 development board. The team reports a PN532 reader/card kit, an MG90S 9 g hobby servo, and a 3-axis accelerometer. Exact board, NFC card technology, and accelerometer module are not yet known.

## Planned responsibilities
- PN532 credential reading (read-only bring-up first).
- Local authorization decisions using a versioned, integrity-protected cache.
- Accelerometer sampling and calibrated tamper-event detection.
- A bounded servo-control abstraction after power and mechanical safety review.
- Durable event queue and authenticated API synchronization.

## Current status
`src/main.cpp` remains a serial-only placeholder. It does not initialize NFC, Wi-Fi, sensors, or the servo. No lock action is implemented.

## Bring-up order
1. Identify exact ESP32 board, PN532 breakout/card type, and accelerometer chip/module.
2. Decide I2C/SPI interfaces and pin assignments from module documentation.
3. Test PN532 in read-only mode with non-sensitive sample cards.
4. Read accelerometer samples, inspect axis orientation/noise, and establish a baseline.
5. Unit-test authorization and tamper-detection policy without physical lock control.
6. Bench-test the MG90S with linkage disconnected and a suitable external supply; verify travel and startup behavior.
7. Integrate a simulated actuator, then only after review conduct supervised mechanism tests.

## Servo safety
Do not power the MG90S from an ESP32 GPIO or assume the board's 3.3 V rail can handle servo transients. Use an appropriately rated supply and confirm voltage/current requirements from the specific servo documentation. Common ground is normally required for the control signal, subject to the selected wiring design. A hobby servo can move unexpectedly at boot; keep it mechanically unloaded during initial tests. Position feedback is not available from a typical three-wire MG90S, so do not assume commanded angle proves that the lock engaged.
