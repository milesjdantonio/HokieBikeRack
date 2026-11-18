#pragma once
#include <stdint.h>
// Which Arduino Uno R3 pin connects to which part. Shared file: tell your teammate before changing it.
// Full wiring guide with pictures-in-words: docs/notes/wiring-guide.md
//
// Pins to keep free on the Uno:
//   D0, D1   USB serial (the serial monitor and uploads use them)
//   D13      the bootloader flashes it at power-on; bad for the servo
//   A4, A5   the I2C bus (below)
// The Servo library uses Timer1, which turns off PWM on D9 and D10. We only
// need on/off for the LEDs and buzzer, so that doesn't matter here.

// I2C bus, shared by the PN532 (address 0x24) and the MPU-6050 (address 0x68).
// On the Uno R3 these are A4 = SDA and A5 = SCL (also repeated on the two
// pins next to AREF). They're fixed in hardware, so they aren't set here.
// 100 kHz ("standard mode") is slower but more forgiving of long breadboard wires.
constexpr uint32_t I2C_CLOCK_HZ = 100000;

// PN532 IRQ and RESET. Wiring them is OPTIONAL: we poll the chip over I2C.
// They still need real pin numbers, because the Adafruit library calls
// pinMode() on them, and a made-up pin number would scribble over random
// memory on the Uno. 2 and 3 are what the Adafruit PN532 Uno shield uses.
constexpr uint8_t PN532_IRQ_PIN = 2;
constexpr uint8_t PN532_RESET_PIN = 3;

// PN532 over UART instead (HBR_READER_UART 1 in config.h; reader switches both OFF).
// Same two pins, different job: SoftwareSerial receives on D2, sends on D3.
//   reader TXD (front label SDA) -> D2,  reader RXD (front label SCL) -> D3
constexpr uint8_t PN532_UART_RX_PIN = 2;
constexpr uint8_t PN532_UART_TX_PIN = 3;

// MG90S servo signal wire (orange/yellow). Servo power comes from the Uno's 5V
// (on the perfboard: 5V bus, with C1/C2 next to the servo pins). If the Uno
// restarts when the servo moves, use a separate 5 V supply with a shared GND.
constexpr uint8_t SERVO_SIGNAL_PIN = 9;

// LEDs: pin -> 220-330 ohm resistor -> LED long leg; LED short leg -> GND.
constexpr uint8_t LED_GREEN_PIN = 5;
constexpr uint8_t LED_RED_PIN = 6;

// Active buzzer, switched by an NPN transistor:
// pin -> 1 k resistor -> transistor base. HIGH = buzzer on.
constexpr uint8_t BUZZER_PIN = 7;
