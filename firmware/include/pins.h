#pragma once
#include <stdint.h>
// Which ESP32 pin connects to which part. Shared file: tell your teammate before changing it.
// Full wiring guide with pictures-in-words: docs/notes/wiring-guide.md
//
// Chosen for a standard "ESP32 DevKit" (ESP32-WROOM-32, 30 or 38 pins).
// All of these are safe general-purpose pins: none are "strapping" pins
// (0, 2, 5, 12, 15) that change how the chip boots, and none are input-only
// pins (34-39).

// I2C bus, shared by the PN532 (address 0x24) and the MPU-6050 (address 0x68).
// These are the ESP32's default I2C pins.
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;
// 100 kHz ("standard mode") is slower but more forgiving of long breadboard wires.
constexpr uint32_t I2C_CLOCK_HZ = 100000;

// PN532 IRQ and RESET pins are not wired; we poll the chip over I2C instead.
// If you wire them later, put the GPIO numbers here.
constexpr int PN532_IRQ_PIN = -1;
constexpr int PN532_RESET_PIN = -1;

// MG90S servo signal wire (orange/yellow). Servo POWER comes from the separate
// 5 V supply, NOT from the ESP32. Only the ground is shared.
constexpr int SERVO_SIGNAL_PIN = 13;

// LEDs: GPIO -> 220-330 ohm resistor -> LED long leg; LED short leg -> GND.
constexpr int LED_GREEN_PIN = 25;
constexpr int LED_RED_PIN = 26;

// Active buzzer, switched by an NPN transistor:
// GPIO -> 1 k resistor -> transistor base. HIGH = buzzer on.
constexpr int BUZZER_PIN = 27;
